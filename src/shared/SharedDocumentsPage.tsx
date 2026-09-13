import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchArtifact, fetchManifest, sandboxedReport, validCapability } from "./document-link-client";
import type { DocumentArtifact, DocumentManifest } from "./document-link-client";

interface SharedDocumentsPageProps {
  grantId: string;
  token: string;
}

export default function SharedDocumentsPage({ grantId, token }: SharedDocumentsPageProps) {
  const [manifest, setManifest] = useState<DocumentManifest | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [closed, setClosed] = useState(false);
  const capability = useRef(token);
  const request = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const isValid = validCapability(grantId, capability.current);

  useEffect(() => {
    const clear = () => {
      request.current?.abort();
      capability.current = "";
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
      setManifest(null);
      setReport(null);
      setClosed(true);
    };
    window.addEventListener("pagehide", clear);
    return () => { window.removeEventListener("pagehide", clear); clear(); };
  }, []);

  function closeDocuments() {
    request.current?.abort();
    capability.current = "";
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    setManifest(null);
    setReport(null);
    setClosed(true);
    setBusy(false);
  }

  async function openDocuments() {
    if (busy || !isValid || closed) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    try {
      const result = await fetchManifest(grantId, capability.current, controller.signal);
      if (!controller.signal.aborted) setManifest(result);
    } catch {
      if (!controller.signal.aborted) { setFailed(true); setManifest(null); setReport(null); }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function retrieve(artifact: DocumentArtifact, preview: boolean) {
    if (busy || closed) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    // Each action makes a fresh authorization request; don't reuse downloaded data.
    setReport(null);
    try {
      const blob = await fetchArtifact(grantId, capability.current, artifact, controller.signal);
      if (controller.signal.aborted) return;
      if (preview) {
        const html = await blob.text();
        if (!controller.signal.aborted) setReport(sandboxedReport(html));
      } else {
        const url = URL.createObjectURL(blob);
        urls.current.add(url);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = artifact.filename;
        anchor.referrerPolicy = "no-referrer";
        anchor.click();
        window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 1000);
      }
    } catch {
      if (!controller.signal.aborted) { setFailed(true); setManifest(null); setReport(null); }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 font-sans text-foreground md:px-8 md:py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="border-b border-border pb-6">
          <p className="text-sm font-medium text-muted-foreground">The Living Room Vet</p>
          <h1 className="mt-2 font-serif text-3xl">Your documents</h1>
        </header>
        <section aria-label="Document access" aria-busy={busy} className="space-y-4 rounded-lg border border-border bg-card p-5 md:p-6">
          {closed || !isValid ? (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Open the original link from your message</h2>
              <p className="text-sm text-muted-foreground">For privacy, this page does not save access details. Reopen the link from the practice to view your documents.</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">This private link opens the documents shared by the practice. Anyone with the original link can use it until it expires or the practice withdraws access.</p>
              {!manifest && <Button disabled={busy} onClick={() => void openDocuments()}>{busy ? "Opening documents…" : failed ? "Try again" : "Open documents"}</Button>}
              {manifest && (
                <>
                  <p className="text-sm">Available until <time dateTime={manifest.expires_at}>{new Date(manifest.expires_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZoneName: undefined })}</time> (your local time).</p>
                  <ul className="divide-y divide-border">
                    {manifest.manifest.map(artifact => (
                      <li key={artifact.index} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <p className="break-words font-medium">{artifact.filename}</p>
                          <p className="text-sm text-muted-foreground">{artifact.index === 0 ? "Practice report" : "Original attachment"} · {Math.max(1, Math.ceil(artifact.file_size / 1024))} KB</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {artifact.index === 0 && <Button variant="outline" disabled={busy} onClick={() => void retrieve(artifact, true)}>View report</Button>}
                          <Button variant="outline" disabled={busy} onClick={() => void retrieve(artifact, false)} aria-label={`Download ${artifact.filename}`}>Download</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {failed && <p role="alert" className="text-sm text-destructive">The documents are unavailable. The link may have expired or access may have changed. Reopen your original message or contact the practice if this continues.</p>}
              {busy && manifest && <p role="status" className="text-sm text-muted-foreground">Checking access and opening the document…</p>}
              <p className="text-sm text-muted-foreground">Downloaded copies remain on your device. Close this page when finished, especially on a shared device.</p>
              <Button variant="ghost" onClick={closeDocuments}>Close documents</Button>
            </>
          )}
        </section>
        {report && <section aria-label="Report preview" className="space-y-3">
          <h2 className="text-lg font-semibold">Report preview</h2>
          <iframe title="Shared practice report" sandbox="" referrerPolicy="no-referrer" srcDoc={report} className="h-[70vh] w-full rounded-lg border border-border bg-card" />
        </section>}
      </div>
    </main>
  );
}
