import { finalized, uuid } from "./fixture.ts";
export function source() {
  const v = finalized();
  return {
    job: {
      id: v.id,
      panel_id: v.panel_id,
      pet_id: v.pet_id,
      source_hash: v.source_hash,
      snapshot: {
        schema: 1,
        purpose: "diagnostic_result",
        diagnostic: v,
        patient: {
          id: v.pet_id,
          name: "SYNTHETIC Juniper <script>BAD</script>",
          species: "Dog",
          breed: null,
          dob: null,
          birth_date_precision: "unknown",
          microchip_id: null,
        },
      },
      snapshot_hash: "b".repeat(64),
      requested_by: uuid(800),
      created_by: uuid(800),
      updated_by: uuid(800),
      status: "pending",
      version: 1,
      fence: 0,
      claim_id: null,
      lease_until: null,
      renderer_sha: null,
      settings_sha: null,
      last_error: "",
      created_at: "2026-10-11T20:00:00Z",
      updated_at: "2026-10-11T20:00:00Z",
    },
    panels: [structuredClone(v)],
    total_panels: 1,
  };
}
export function longSource() {
  const s = source(),
    v = s.job.snapshot.diagnostic;
  v.snapshot.panel_name = "SYNTHETIC 100-finding report";
  v.snapshot.interpretation =
    "Synthetic Unicode check: Zoë, μg, café. Documentary findings only.";
  const original = v.snapshot.observations;
  v.snapshot.observations = [
    ...original,
    ...Array.from({ length: 98 }, (_, i) => ({
      ...original[0],
      id: uuid(2000 + i),
      analyte_key: `synthetic-${i}`,
      label: `SYNTHETIC finding ${i}`,
      value_number: i - 49,
      reference_text:
        "Original documentary reference retained; synthetic lengthy text exercises wrapping.",
      source_flag: i % 2 ? "Recorded high flag" : "",
    })),
  ];
  s.panels = [structuredClone(v)];
  for (let i = 1; i <= 3; i++) {
    const p = finalized(30 + i);
    p.snapshot.collected_on = `2026-09-${String(10 + i).padStart(2, "0")}`;
    p.snapshot.reported_on = p.snapshot.collected_on;
    p.snapshot.observations[0].value_number = i * 15;
    if (i === 3) p.snapshot.observations[0].unit = "mg/L";
    s.panels.push(p);
  }
  s.total_panels = 5;
  return s;
}
