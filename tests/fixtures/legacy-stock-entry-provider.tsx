/** Synthetic browser transport only. Production and genuine Auth proofs use
 * the original provider directly and never import this fixture. */
import type { ComponentProps } from "react";
import { ControlledStockEntryProvider as Original } from "../../src/hub/features/controlled-drugs/entry/ControlledStockEntryProvider";

const origin = "https://abcdefghijklmnopqrst.supabase.co";
const connection = Object.freeze({ projectRef: "abcdefghijklmnopqrst", url: origin,
  publishableKey: "sb_publishable_synthetic_browser_fixture" });
const localFetch: typeof fetch = (input, init) => {
  if (typeof input !== "string") throw new Error("Explicit synthetic RPC URL required");
  const url = new URL(input);
  if (url.origin !== origin || !url.pathname.startsWith("/rest/v1/rpc/") || url.search || url.hash)
    throw new Error("Synthetic stock transport refuses foreign requests");
  return fetch("http://127.0.0.1:54321" + url.pathname, init);
};
export function ControlledStockEntryProvider(props: ComponentProps<typeof Original>) {
  return <Original {...props} connection={connection} fetcher={localFetch} />;
}
