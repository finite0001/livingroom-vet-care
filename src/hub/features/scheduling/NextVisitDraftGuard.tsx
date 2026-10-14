import { useEffect } from "react";
import { useUnsavedChanges } from "../clinical/use-unsaved-changes";
interface GuardProps {
  dirty: boolean;
  description: string;
  onDirtyChange?: (dirty: boolean) => void;
}
function LocalGuard({ dirty, description }: GuardProps) {
  return useUnsavedChanges(dirty, description);
}
// Patient 360 aggregates all drafts into its one router blocker; standalone pages own theirs.
export function NextVisitDraftGuard({
  dirty,
  description,
  onDirtyChange,
}: GuardProps) {
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  return onDirtyChange ? null : (
    <LocalGuard dirty={dirty} description={description} />
  );
}
