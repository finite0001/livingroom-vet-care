import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ExternalLink, Minus, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hub/contexts/auth-context";

const phoneUrl = "https://phone.cloudtalk.io?partner=livingroom-vet-care";
// Remembers that this browser uses the embedded phone, so it reloads after a
// page refresh and incoming calls keep ringing. Never stores call data.
const activeKey = "cloudtalk-phone-active";

function readActive(): boolean {
  try { return window.localStorage.getItem(activeKey) === "1"; } catch { return false; }
}

function writeActive(active: boolean) {
  try {
    if (active) window.localStorage.setItem(activeKey, "1");
    else window.localStorage.removeItem(activeKey);
  } catch { /* Storage can be blocked; the phone still works for this page load. */ }
}

export function CloudTalkPhoneDock() {
  const { pathname } = useLocation();
  const { user, profile, roles } = useAuth();
  const inHub = pathname.startsWith("/hub/") || pathname === "/hub";
  const allowed = inHub && !!user && !!profile?.is_active && roles.length > 0;
  const [mounted, setMounted] = useState(() => pathname === "/hub/call" || readActive());
  const [open, setOpen] = useState(pathname === "/hub/call");
  const [ringing, setRinging] = useState(false);
  const [onCall, setOnCall] = useState(false);

  // The Phone page always opens the panel; other pages leave it as the agent set it.
  useEffect(() => {
    if (pathname === "/hub/call") {
      setMounted(true);
      setOpen(true);
    }
  }, [pathname]);
  useEffect(() => {
    if (!allowed) {
      setOpen(false);
      setRinging(false);
      setOnCall(false);
    }
  }, [allowed]);
  useEffect(() => { if (mounted) writeActive(true); }, [mounted]);
  useEffect(() => {
    if (!mounted) return;
    const onMessage = (message: MessageEvent) => {
      if (message.origin !== "https://phone.cloudtalk.io") return;
      try {
        const payload = typeof message.data === "string" ? JSON.parse(message.data) : message.data;
        if (payload?.event === "ringing") { setRinging(true); setOnCall(true); }
        if (payload?.event === "calling" || payload?.event === "dialing") setOnCall(true);
        if (payload?.event === "ended") { setRinging(false); setOnCall(false); }
      } catch { /* Ignore unrelated cross-window messages. */ }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mounted]);

  if (!allowed) return null;

  const openPhone = () => { setMounted(true); setOpen(true); setRinging(false); };
  const popOut = () => {
    const popup = window.open(phoneUrl, "cloudtalk-phone", "popup,width=400,height=720");
    if (!popup) return;
    // One phone per browser: the pop-out window takes over from the embedded one.
    writeActive(false);
    setOpen(false);
    setMounted(false);
  };

  return (
    <>
      {!open && (
        <>
          <Button
            type="button"
            onClick={openPhone}
            className={cn("fixed bottom-20 right-4 z-50 hidden rounded-full shadow-lg min-[440px]:inline-flex md:bottom-4", ringing && "animate-pulse")}
          >
            <Phone className="mr-2 h-4 w-4" aria-hidden="true" />{ringing ? "Incoming call" : onCall ? "On call" : "Phone"}
          </Button>
          <Button asChild className="fixed bottom-20 right-4 z-50 rounded-full shadow-lg min-[440px]:hidden">
            <a href={phoneUrl} target="_blank" rel="noopener noreferrer"><Phone className="mr-2 h-4 w-4" aria-hidden="true" />Phone</a>
          </Button>
        </>
      )}
      {mounted && (
        <aside
          aria-label="CloudTalk phone"
          aria-hidden={!open}
          style={open ? undefined : { visibility: "hidden" }}
          className={open
            ? "fixed bottom-20 right-4 z-50 hidden h-[min(720px,calc(100vh-6rem))] w-[400px] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl min-[440px]:flex md:bottom-4 md:h-[min(720px,calc(100vh-2rem))]"
            : "fixed -left-[10000px] top-0 flex h-[700px] w-[400px] flex-col overflow-hidden"}
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
            <span className="text-sm font-semibold">{onCall ? "CloudTalk phone · on call" : "CloudTalk phone"}</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={popOut}
                disabled={onCall}
                aria-label={onCall ? "Pop out is unavailable during a call" : "Pop out phone into its own window"}
                title={onCall ? "Finish the call before popping out" : "Pop out into its own window (ends any call in this panel)"}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Minimize phone" title="Minimize (calls keep going)">
                <Minus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <iframe title="CloudTalk phone" src={phoneUrl} allow="microphone *" className="min-h-0 w-full flex-1 border-0" />
        </aside>
      )}
    </>
  );
}
