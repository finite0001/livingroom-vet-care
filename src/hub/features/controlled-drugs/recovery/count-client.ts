import type { ReviewIdentity, ReviewSessionSource } from "../record-review/raw-rpc.ts";
import type { CountClient } from "../count/count-client.ts";
import type { CountReadData } from "../count/count-read-wire.ts";
import { parseCountRequest } from "../count/count-request-schema.ts";
import { verifyCountSavedReply } from "../count/count-wire.ts";
import type { RecoveryOperations } from "./operation-controller.ts";
import type { RecoveryStatus } from "./schema.ts";

/** Retains the original count controller, validation and signing components.
 * Only fresh count starts use the recovery-owned atomic marker facade. */
export function createRecoveryCountClient(base: CountClient, operations: RecoveryOperations, sessions: ReviewSessionSource,
  status: () => RecoveryStatus | null, observed: (data: CountReadData, identity: ReviewIdentity) => void): CountClient {
  return Object.freeze({ ...base,
    async mutate(action, input, identity) {
      const current = status();
      if (action !== "start" || current?.mode === "idle") return base.mutate(action, input, identity);
      if (!current || !current.is_admin || !current.fresh_session || !current.epoch_id || current.needs_new_epoch || !sessions.isCurrent(identity)) throw new Error("A fresh administrator login and active recovery attempt are required to start this count.");
      const request = parseCountRequest("start", input);
      const result = await operations.save({ schema_version: 1, actor_id: identity.actorId, operation_id: request.operation_id, action: "start_count",
        expected_head_id: current.head_id, expected_head_hash: current.head_hash, data: { request } }, identity);
      if (result.action !== "start_count") throw new Error("The original recovery count must be checked.");
      return verifyCountSavedReply("start", request, { schema_version: 1, state: "saved", data: { receipt: result.data.count_receipt } });
    },
    async discover(request, identity) {
      const result = await base.discover(request, identity), current = status();
      if (current?.mode !== "armed" || current.is_admin && current.fresh_session && current.epoch_id && !current.needs_new_epoch) return result;
      return Object.freeze({ ...result, available_actions: Object.freeze(result.available_actions.filter(action => action !== "start")) });
    },
    async read(request, identity) {
      const result = await base.read(request, identity);
      if (sessions.isCurrent(identity)) observed(result.data, identity);
      return result;
    },
  });
}
