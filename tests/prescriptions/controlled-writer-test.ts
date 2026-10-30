/** Explicit inert dependency for adapter unit tests. Production factories never
 * infer test mode or fall back to a supplied SDK client for controlled writes. */
import type { PrescriptionRpc } from "../../src/hub/features/prescriptions/prescription-api.ts";
import type { ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";
import type { ControlledWriterInvoker } from "../../src/hub/features/controlled-drugs/entry/controlled-api.ts";
import { decodeExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
export function controlledTestFactory<A, R>(factory: (client: PrescriptionRpc, actor: string, target: A,
  identity?: Readonly<ReviewIdentity> | null, invoke?: ControlledWriterInvoker) => R) {
  return (client: PrescriptionRpc, actor: string, target: A): R => {
    const identity = { actorId: actor, sessionId: "10000000-0000-4000-8000-999999999999", generation: 1 };
    const invoke: ControlledWriterInvoker = async (writer, args, expected, admit) => {
      if (expected !== identity) throw new Error("Test lost its explicitly supplied identity");
      const { data, error } = await client.rpc(writer, args as never);
      if (error) throw error;
      return admit!(decodeExactJson(new TextEncoder().encode(JSON.stringify(data))));
    };
    return factory(client, actor, target, identity, invoke);
  };
}
