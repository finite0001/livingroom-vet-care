export interface OriginalTimeEntry {
  id: string;
  staff_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  note: string | null;
}

export interface TimeEntryCorrection {
  clock_in_at: string;
  clock_out_at: string | null;
  note: string | null;
}

export interface TimeEntryArguments {
  p_id: string;
  p_staff_id: string;
  p_expected_clock_in_at: string;
  p_expected_clock_out_at: string | null;
  p_expected_note: string | null;
  p_clock_in_at: string;
  p_clock_out_at: string | null;
  p_note: string | null;
  p_delete: boolean;
}

export interface TimeEntryClient {
  rpc(name: "admin_correct_time_entry", args: TimeEntryArguments): PromiseLike<{
    data: OriginalTimeEntry | null;
    error: { message: string; code?: string } | null;
  }>;
}

async function correct(client: TimeEntryClient, original: OriginalTimeEntry, values: TimeEntryCorrection, remove: boolean) {
  const { data, error } = await client.rpc("admin_correct_time_entry", {
    p_id: original.id,
    p_staff_id: original.staff_id,
    p_expected_clock_in_at: original.clock_in_at,
    p_expected_clock_out_at: original.clock_out_at,
    p_expected_note: original.note,
    p_clock_in_at: values.clock_in_at,
    p_clock_out_at: values.clock_out_at,
    p_note: values.note,
    p_delete: remove,
  });
  if (error) throw new Error(error.message);
  if (!data || data.id !== original.id || data.staff_id !== original.staff_id)
    throw new Error("The correction could not be verified. Refresh the timesheet before retrying.");
}

/** The RPC checks administrator identity, expected values and duty state in one transaction. */
export async function updateTimeEntry(client: TimeEntryClient, original: OriginalTimeEntry, values: TimeEntryCorrection) {
  const start = Date.parse(values.clock_in_at);
  const end = values.clock_out_at === null ? null : Date.parse(values.clock_out_at);
  if (!Number.isFinite(start) || start > Date.now() || (end !== null && (!Number.isFinite(end) || end <= start || end > Date.now())))
    throw new Error("Use valid times with clock out after clock in and no future times.");
  if (original.clock_out_at !== null && values.clock_out_at === null)
    throw new Error("Closed entries cannot be reopened.");
  await correct(client, original, values, false);
}

export async function deleteTimeEntry(client: TimeEntryClient, original: OriginalTimeEntry) {
  await correct(client, original, original, true);
}
