import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CameraLease, cameraConstraints, cameraError } from "./camera-lease.ts";
import { decoderReplySchema, type DecodedSymbol } from "./decoder-contract.ts";

export type ScanLookupKind = "supplier_sku" | "supplier_barcode" | "gtin";
interface BarcodeScanDialogProps { close(): void; onUseCode(symbol: DecodedSymbol, kind: ScanLookupKind): void }
interface CameraChoice { id: string; label: string }
export default function BarcodeScanDialog({ close, onUseCode }: BarcodeScanDialogProps) {
  const codeTypeId = useId(), cameraId = useId();
  const video = useRef<HTMLVideoElement>(null), lease = useRef(new CameraLease()), epoch = useRef(0);
  const resources = useRef<() => void>(() => {});
  const [phase, setPhase] = useState<"idle" | "requesting" | "scanning" | "paused" | "found" | "error">("idle");
  const [message, setMessage] = useState("Point the camera at one product label. Camera images stay on this device");
  const [symbols, setSymbols] = useState<DecodedSymbol[]>([]), [kind, setKind] = useState<ScanLookupKind>("supplier_barcode");
  const [cameras, setCameras] = useState<CameraChoice[]>([]), [chosenCamera, setChosenCamera] = useState("");
  const stop = useCallback(() => {
    epoch.current++;
    const cleanup = resources.current; resources.current = () => {}; cleanup();
    lease.current.stop();
    if (video.current) video.current.srcObject = null;
  }, []);
  const pause = useCallback((reason: string) => { stop(); setPhase("paused"); setMessage(reason); }, [stop]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) pause("Camera paused while this page is hidden. Start again when ready"); };
    const leaving = () => pause("Camera paused while leaving this page. Start again when ready");
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", leaving);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", leaving); stop(); };
  }, [pause, stop]);
  async function start(deviceId = chosenCamera) {
    stop(); const current = epoch.current;
    setSymbols([]); setPhase("requesting"); setMessage("Waiting for camera permission…");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new DOMException("Unavailable", "SecurityError");
      const stream = await lease.current.acquire(() => navigator.mediaDevices.getUserMedia(cameraConstraints(deviceId || undefined)));
      if (!stream || epoch.current !== current) return;
      if (!video.current) { lease.current.stop(); return; }
      video.current.srcObject = stream;
      const startup = window.setTimeout(() => {
        if (epoch.current === current) pause("The camera preview did not start. Retry or enter the code manually");
      }, 10000);
      resources.current = () => clearTimeout(startup);
      await video.current.play();
      clearTimeout(startup);
      if (epoch.current !== current || !lease.current.owns(stream)) return;
      const decoder = new Worker(new URL("./barcode-worker.ts", import.meta.url), { type: "module" });
      let animation = 0, sequence = 0, pending = 0, previousFrame = 0, stopped = false;
      const canvas = document.createElement("canvas"), context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) { decoder.terminate(); throw new Error("Camera frame unavailable"); }
      const fail = () => { if (epoch.current === current) { stop(); setPhase("error"); setMessage("The barcode reader stopped. Retry or enter the code manually"); } };
      const ended = () => { if (epoch.current === current) pause("Camera feed interrupted. Start again or choose another camera"); };
      const tracks = stream.getVideoTracks();
      tracks.forEach((track) => { track.addEventListener("ended", ended); track.addEventListener("mute", ended); });
      decoder.onerror = fail; decoder.onmessageerror = fail;
      decoder.onmessage = (event: MessageEvent<unknown>) => {
        if (epoch.current !== current || stopped) return;
        const parsed = decoderReplySchema.safeParse(event.data);
        if (!parsed.success || parsed.data.sequence !== pending || parsed.data.outcome === "failed") { fail(); return; }
        pending = 0;
        if (parsed.data.symbols.length) {
          const found = parsed.data.symbols;
          stop(); setSymbols(found); setKind(found.length === 1 && ["EAN13", "EAN8", "UPCA"].includes(found[0].format) ? "gtin" : "supplier_barcode");
          setPhase("found"); setMessage(found.length > 1 ? "More than one barcode was read. Compare the labels and choose a code" : "Camera paused. Confirm the code type before using it for lookup");
        }
      };
      const tick = (now: number) => {
        if (stopped || epoch.current !== current) return;
        animation = requestAnimationFrame(tick);
        const element = video.current;
        if (pending || now - previousFrame < 250 || !element || element.readyState < 2 || !element.videoWidth || !element.videoHeight) return;
        previousFrame = now;
        const scale = Math.min(1, 1280 / element.videoWidth, 960 / element.videoHeight);
        canvas.width = Math.max(1, Math.floor(element.videoWidth * scale)); canvas.height = Math.max(1, Math.floor(element.videoHeight * scale));
        try {
          context.drawImage(element, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          pending = ++sequence;
          decoder.postMessage({ sequence, width: frame.width, height: frame.height, data: frame.data }, [frame.data.buffer]);
        } catch { fail(); }
      };
      const timeout = window.setTimeout(() => { if (epoch.current === current) pause("No code confirmed within one minute. Reposition the label and start again or enter it manually"); }, 60000);
      resources.current = () => {
        stopped = true; cancelAnimationFrame(animation); clearTimeout(timeout); decoder.terminate();
        tracks.forEach((track) => { track.removeEventListener("ended", ended); track.removeEventListener("mute", ended); });
      };
      setPhase("scanning"); setMessage("Hold one barcode steady in the frame. Compare the product and package after lookup");
      animation = requestAnimationFrame(tick);
      void navigator.mediaDevices.enumerateDevices().then((devices) => {
        if (epoch.current === current) setCameras(devices.filter((device) => device.kind === "videoinput").map((device, index) => ({ id: device.deviceId, label: device.label || `Camera ${index + 1}` })));
      }).catch(() => { /* Scanning does not depend on optional device selection. */ });
    } catch (cause) {
      if (epoch.current !== current) return;
      stop(); setPhase("error"); setMessage(cameraError(cause));
    }
  }
  function dismiss() { stop(); close(); }
  return <Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl [&_button]:min-h-11 [&_button]:min-w-11 [&>button]:h-auto">
    <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Camera className="h-5 w-5" aria-hidden="true" />Scan a barcode</DialogTitle><DialogDescription>Confirm a product code for reviewed inventory lookup</DialogDescription></DialogHeader>
    <p role={phase === "error" ? "alert" : "status"} className={phase === "error" ? "text-sm text-destructive" : "text-sm"}>{message}</p>
    <video ref={video} hidden={phase === "found"} muted playsInline aria-label="Product barcode camera preview" className="aspect-video w-full rounded-xl border bg-muted object-contain" />
    {cameras.length > 1 && <div className="grid gap-1 text-sm"><label htmlFor={cameraId}>Camera</label><select id={cameraId} className="min-h-11 w-full rounded-md border border-input bg-background px-3" value={chosenCamera} onChange={(event) => { setChosenCamera(event.target.value); pause("Camera selected. Start again to use it"); }}><option value="">Prefer rear camera</option>{cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.label}</option>)}</select></div>}
    <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void start()} disabled={phase === "requesting"}>{phase === "scanning" ? "Restart camera" : "Start camera"}</Button>{(phase === "requesting" || phase === "scanning") && <Button type="button" variant="outline" onClick={() => pause("Camera stopped. Start again or enter the code manually")}><CameraOff className="mr-2 h-4 w-4" aria-hidden="true" />Stop camera</Button>}</div>
    {symbols.length > 0 && <section aria-label="Scanned product codes" className="space-y-3">
      <div className="grid gap-1 text-sm"><label htmlFor={codeTypeId}>Use code as</label><select id={codeTypeId} className="min-h-11 w-full rounded-md border border-input bg-background px-3" value={kind} onChange={(event) => setKind(event.target.value as ScanLookupKind)}><option value="gtin">Manufacturer UPC / EAN / GTIN</option><option value="supplier_barcode">Supplier printed barcode</option><option value="supplier_sku">Supplier SKU</option></select></div>
      {symbols.map((symbol, index) => {
        const structured = ["]C1", "]d2", "]Q3"].includes(symbol.symbologyIdentifier) || Array.from(symbol.text).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
        const usable = symbol.text.length > 0 && symbol.text.length <= 200 && !structured && !(symbol.format === "UPCE" && kind === "gtin");
        return <div key={index} className="space-y-2 rounded-xl border p-3"><p className="text-sm text-muted-foreground">{symbol.format}</p><p className="break-all font-mono text-sm">{JSON.stringify(symbol.text)}</p>
          {!usable && <p className="text-sm">This code needs manual product-identifier review for the selected code type. Enter its product code in the lookup screen</p>}
          <Button type="button" variant="outline" disabled={!usable} onClick={() => { stop(); onUseCode(symbol, kind); close(); }}>Use code {index + 1} for lookup</Button>
        </div>;
      })}
      <p className="text-sm text-muted-foreground">Lot, expiry, quantity and stock changes require their own review</p>
    </section>}
    <a className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/third-party/barcode-scanner/NOTICE.txt" target="_blank" rel="noreferrer">Barcode reader license</a>
    <Button type="button" variant="outline" onClick={dismiss}>Close scanner and enter manually</Button>
  </DialogContent></Dialog>;
}
