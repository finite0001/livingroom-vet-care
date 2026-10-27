import { useSyncExternalStore } from "react";
import { useReviewStaffSessions } from "../record-review/staff-session-context.ts";

/** Capture at render, before a submit handler can await reads or UI. An old
 * closure intentionally keeps its old session/generation for gateway refusal. */
export function useControlledWriterIdentity() {
  const sessions = useReviewStaffSessions();
  return useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, () => null);
}
