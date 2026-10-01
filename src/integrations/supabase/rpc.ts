import type { Database, Json } from "./types";

/** Generated RPC catalogue, for transports injected into feature APIs. */
export type RpcFunctions = Database["public"]["Functions"];
export type RpcName = keyof RpcFunctions;
export type RpcArgs<N extends RpcName> = RpcFunctions[N]["Args"];

/**
 * Typed request payloads are plain JSON (already zod-validated by the caller),
 * but TypeScript interfaces carry no index signature and so are not
 * structurally assignable to Json. Use only for jsonb RPC arguments.
 */
export const asJson = <T extends object>(value: T): Json => value as unknown as Json;
