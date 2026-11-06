export interface OriginalTimeEntry {
  id: string;
  staff_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  note: string | null;
}

export interface TimeEntryCorrection {
  clock_in_at: string;
  clock_out_at: string;
  note: string | null;
}

interface TimeEntryFilter {
  eq(column: string, value: string): TimeEntryFilter;
  is(column: string, value: null): TimeEntryFilter;
  not(column: string, operator: string, value: null): TimeEntryFilter;
  select(columns: "id"): PromiseLike<{ data: { id: string }[] | null; error: unknown }>;
}

export interface TimeEntryClient {
  from(table: "time_entries"): {
    update(values: TimeEntryCorrection): TimeEntryFilter;
    delete(): TimeEntryFilter;
  };
}

function requireClosed(original: OriginalTimeEntry): asserts original is OriginalTimeEntry & { clock_out_at: string } {
  if (!original.clock_out_at)
    throw new Error("Ask the staff member to clock out before correcting or deleting their shift.");
}

function matchOriginal(query: TimeEntryFilter, original: OriginalTimeEntry & { clock_out_at: string }) {
  const matched = query.eq("id", original.id).eq("staff_id", original.staff_id)
    .not("clock_out_at", "is", null)
    .eq("clock_in_at", original.clock_in_at).eq("clock_out_at", original.clock_out_at);
  return original.note === null ? matched.is("note", null) : matched.eq("note", original.note);
}

async function confirm(query: TimeEntryFilter) {
  const { data, error } = await query.select("id");
  if (error) throw error;
  if (data?.length !== 1)
    throw new Error("This entry changed or is no longer editable. Refresh the timesheet and review it again.");
}

/** Closed shifts cannot change current duty; compare the exact reviewed row in the same request. */
export async function updateClosedTimeEntry(client: TimeEntryClient, original: OriginalTimeEntry, values: TimeEntryCorrection) {
  requireClosed(original);
  const start = Date.parse(values.clock_in_at), end = Date.parse(values.clock_out_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > Date.now())
    throw new Error("Use a valid closed shift with clock out after clock in and no future times.");
  await confirm(matchOriginal(client.from("time_entries").update(values), original));
}

export async function deleteClosedTimeEntry(client: TimeEntryClient, original: OriginalTimeEntry) {
  requireClosed(original);
  await confirm(matchOriginal(client.from("time_entries").delete(), original));
}
