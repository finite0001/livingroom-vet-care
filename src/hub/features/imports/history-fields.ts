export interface ClinicalProblemDraft {
  title: string;
  notes: string;
  onset: string;
  status: "" | "active" | "resolved";
  importance: "" | "routine" | "high";
}
/** Source narrative is evidence, never a default diagnosis, status or alert. */
export function emptyClinicalProblem(): ClinicalProblemDraft {
  return { title: "", notes: "", onset: "", status: "", importance: "" };
}
export function reviewedProblem(draft: ClinicalProblemDraft) {
  const title = draft.title.trim();
  if (!title || title.length > 250 || draft.notes.length > 10000)
    throw new Error(
      "Enter a reviewed problem title of at most 250 characters and notes of at most 10,000 characters.",
    );
  if (!draft.status || !draft.importance)
    throw new Error(
      "Explicitly select the locally reviewed status and importance.",
    );
  if (draft.onset) {
    const value = new Date(`${draft.onset}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.onset) ||
      !Number.isFinite(value.getTime()) ||
      value.toISOString().slice(0, 10) !== draft.onset
    )
      throw new Error("Enter a valid known onset date or leave it blank.");
  }
  return {
    title,
    notes: draft.notes,
    onset_date: draft.onset || null,
    status: draft.status,
    importance: draft.importance,
  };
}
