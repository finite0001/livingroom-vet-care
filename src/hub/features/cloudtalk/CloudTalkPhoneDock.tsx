import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Phone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hub/contexts/auth-context";

const phoneUrl = "https://phone.cloudtalk.io?partner=livingroom-vet-care";

export function CloudTalkPhoneDock() {
  const { pathname } = useLocation();
  const { user, profile } = useAuth();
  const inHub = pathname.startsWith("/hub/") || pathname === "/hub";
  const open = pathname === "/hub/call";
  const [mounted, setMounted] = useState(open);
  const [ringing, setRinging] = useState(false);

  useEffect(() => {
    if (!inHub || !user || !profile?.is_active) setMounted(false);
    else if (open) setMounted(true);
  }, [inHub, open, user, profile?.is_active]);
  useEffect(() => {
    if (!mounted) return;
    const onMessage = (message: MessageEvent) => {
      if (message.origin !== "https://phone.cloudtalk.io") return;
      try {
        const payload = typeof message.data === "string" ? JSON.parse(message.data) : message.data;
        if (payload?.event === "ringing") setRinging(true);
        if (payload?.event === "ended") setRinging(false);
      } catch { /* Ignore unrelated cross-window messages. */ }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mounted]);

  if (!mounted || !user || !profile?.is_active) return null;
  return (
    <>
      {!open && ringing && (
        <Link to="/hub/call" className="fixed bottom-20 right-4 z-50 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg md:bottom-4">
          <Phone className="mr-2 inline h-4 w-4" aria-hidden="true" />Incoming call
        </Link>
      )}
      <aside
        aria-label="CloudTalk phone"
        aria-hidden={!open}
        style={open ? undefined : { visibility: "hidden" }}
        className={open ? "fixed inset-y-0 right-0 z-50 hidden w-[420px] overflow-y-auto border-l border-border bg-background shadow-xl min-[440px]:block" : "fixed -left-[10000px] top-0 h-[700px] w-[420px] overflow-hidden"}
      >
        <div className="flex h-12 items-center justify-between border-b border-border px-3">
          <span className="text-sm font-semibold">CloudTalk phone</span>
          {open && <Button asChild size="icon" variant="ghost" aria-label="Minimize phone"><Link to="/hub"><X className="h-4 w-4" /></Link></Button>}
        </div>
        <iframe title="CloudTalk phone" src={phoneUrl} allow="microphone *" className="h-[calc(100%-3rem)] min-h-[700px] w-full border-0" />
      </aside>
    </>
  );
}
