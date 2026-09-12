export interface ContactFields {
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
}
export interface ContactPointer {
  request_id: string;
  capability: string;
}
export function newContactPointer(): ContactPointer {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return {
    request_id: crypto.randomUUID(),
    capability: [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""),
  };
}
export function readContactPointer(
  storage: Pick<Storage, "getItem">,
): ContactPointer | null {
  try {
    const p = JSON.parse(storage.getItem("lrv-contact-request") ?? "null");
    return p &&
      typeof p.request_id === "string" &&
      /^[0-9a-f-]{36}$/.test(p.request_id) &&
      typeof p.capability === "string" &&
      /^[a-f0-9]{64}$/.test(p.capability)
      ? p
      : null;
  } catch {
    return null;
  }
}
export async function contactRequest(
  endpoint: string,
  pointer: ContactPointer,
  fields?: ContactFields,
  token?: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!endpoint) throw new Error("The request form is not available yet.");
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...pointer,
      action: fields ? "submit" : "receipt",
      ...(fields ? { payload: fields, token } : {}),
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "The request form is temporarily busy. Please retry later."
        : "Receipt is not confirmed. Check this request before retrying.",
    );
  const value = await response.json();
  if (typeof value?.received !== "boolean")
    throw new Error("Receipt is not confirmed.");
  return value.received;
}
