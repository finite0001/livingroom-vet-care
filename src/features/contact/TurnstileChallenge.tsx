import { useEffect, useRef, useState } from "react";
interface WidgetApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: WidgetApi;
  }
}
interface Props {
  requestId: string;
  onToken: (token: string) => void;
}
export function TurnstileChallenge({ requestId, onToken }: Props) {
  const host = useRef<HTMLDivElement>(null),
    callback = useRef(onToken);
  callback.current = onToken;
  const [failed, setFailed] = useState(false);
  const sitekey = import.meta.env.VITE_CONTACT_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!sitekey || !host.current) return;
    let alive = true,
      widget: string | undefined;
    const render = () => {
      if (!alive || !host.current || !window.turnstile) return;
      widget = window.turnstile.render(host.current, {
        sitekey,
        action: "contact_intake",
        cData: requestId,
        callback: (token: string) => callback.current(token),
        "expired-callback": () => callback.current(""),
        "error-callback": () => {
          callback.current("");
          setFailed(true);
        },
      });
    };
    let script = document.querySelector<HTMLScriptElement>(
      "script[data-contact-turnstile]",
    );
    if (window.turnstile) render();
    else {
      if (!script) {
        script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.contactTurnstile = "true";
        document.head.append(script);
      }
      script.addEventListener("load", render);
      script.addEventListener("error", () => setFailed(true), { once: true });
    }
    return () => {
      alive = false;
      script?.removeEventListener("load", render);
      if (widget) window.turnstile?.remove(widget);
    };
  }, [requestId, sitekey]);
  return (
    <div>
      <div ref={host} />
      {(!sitekey || failed) && (
        <p role="alert">Verification is unavailable. Please try again later.</p>
      )}
    </div>
  );
}
