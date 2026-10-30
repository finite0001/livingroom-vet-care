import { sameReviewIdentity, type ReviewIdentity } from "../record-review/raw-rpc.ts";
export interface WitnessRequestJob { readonly identity: Readonly<ReviewIdentity> }
/** UI liveness only. This grants no permission and replaces no actor/WebLock check. */
export function createWitnessRequestScope() {
  let current: WitnessRequestJob | null = null;
  return Object.freeze({
    begin(identity: Readonly<ReviewIdentity>): WitnessRequestJob | null {
      if (current && sameReviewIdentity(current.identity, identity)) return null;
      const job = Object.freeze({ identity }); current = job; return job;
    },
    finish(job: WitnessRequestJob): boolean {
      if (current !== job) return false;
      current = null; return true;
    },
  });
}
