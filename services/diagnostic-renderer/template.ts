import { z } from "zod";
import { pdfJobSchema } from "../../src/hub/features/diagnostics/pdf-jobs/model.ts";
import { finalizedSchema } from "../../src/hub/features/diagnostics/model.ts";
import {
  comparableSeries,
  plotPoints,
} from "../../src/hub/features/diagnostics/trends.ts";
import { renderInputSchema, sha256, type RenderInput } from "./sandbox.ts";
export const reportSourceSchema = z
  .object({
    job: pdfJobSchema,
    panels: z.array(finalizedSchema).min(1).max(200),
    total_panels: z.number().int().min(1).max(100000),
  })
  .strict()
  .superRefine((s, c) => {
    if (
      s.panels.some(
        (p) =>
          p.pet_id !== s.job.pet_id ||
          Date.parse(p.reviewed_at) >
            Date.parse(s.job.snapshot.diagnostic.reviewed_at),
      ) ||
      new Set(s.panels.map((p) => p.panel_id)).size !== s.panels.length ||
      s.total_panels < s.panels.length
    )
      c.addIssue({
        code: "custom",
        message: "Exact single-patient historical census required",
      });
    const source = s.panels.find((p) => p.panel_id === s.job.panel_id);
    if (
      !source ||
      source.id !== s.job.id ||
      source.source_hash !== s.job.source_hash ||
      JSON.stringify(source) !== JSON.stringify(s.job.snapshot.diagnostic)
    )
      c.addIssue({
        code: "custom",
        message: "Exact reviewed source version required",
      });
  });
export interface ReportSource extends z.infer<typeof reportSourceSchema> {}
export function escapeText(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
/** Only already-frozen source data. Persistence/census creation belongs to the service coordinator. */
export function diagnosticRenderInput(raw: unknown): RenderInput {
  const s = reportSourceSchema.parse(raw),
    v = s.job.snapshot.diagnostic,
    p = s.job.snapshot.patient,
    a = v.snapshot;
  const e = escapeText,
    expected = [
      p.name,
      a.panel_name,
      v.reviewer_name,
      v.entered_by_name,
      "Source version " + v.number,
    ];
  const rows = a.observations
    .map((o) => {
      const value =
        o.kind === "numeric" ? String(o.value_number) : o.value_text!;
      expected.push(o.label, value, ...(o.unit ? [o.unit] : []));
      const ref = [
        o.reference_low === null ? "" : `Lower: ${o.reference_low}`,
        o.reference_high === null ? "" : `Upper: ${o.reference_high}`,
        o.reference_text,
      ]
        .filter(Boolean)
        .join("; ");
      return `<tr><td>${e(o.label)}<br><small>${e(o.analyte_key)}</small></td><td>${e(value)}</td><td>${e(o.unit ?? "")}</td><td>${e(ref)}</td><td>${e(o.source_flag)}</td></tr>`;
    })
    .join("");
  const graphs = comparableSeries(s.panels)
    .map((series) => {
      const title = `${series.label} · ${series.unit ?? "qualitative"}`;
      const caption = `${series.specimen}; ${series.method}; ${series.source}`;
      let graphic = "";
      if (series.kind === "numeric" && series.points.length > 1) {
        const points = plotPoints(series);
        const low = Math.min(...points.map((t) => t.finding.value_number!)),
          high = Math.max(...points.map((t) => t.finding.value_number!));
        const ticks =
          low === high
            ? `<text x="35" y="84" text-anchor="end">${e(low)}</text>`
            : `<text x="35" y="34" text-anchor="end">${e(high)}</text><text x="35" y="144" text-anchor="end">${e(low)}</text>`;
        graphic = `<svg viewBox="0 0 640 180" role="img" aria-label="${e(title)}"><g transform="translate(30 0)"><path d="M40 20V140H560" fill="none" stroke="currentColor"/>${ticks}<text x="40" y="164">${e(points[0].day)}</text><text x="560" y="164" text-anchor="end">${e(points.at(-1)!.day)}</text><polyline points="${points.map((t) => `${t.x.toFixed(3)},${t.y.toFixed(3)}`).join(" ")}" fill="none" stroke="currentColor"/>${points.map((t) => `<circle cx="${t.x.toFixed(3)}" cy="${t.y.toFixed(3)}" r="3" fill="currentColor"/>`).join("")}</g></svg>`;
      }
      const history = series.points
        .map(
          (t) =>
            `<li>${e(t.day)}: ${e(t.finding.kind === "numeric" ? String(t.finding.value_number) : t.finding.value_text)} ${e(t.finding.unit ?? "")} — source version ${t.panel.number}, ${e(t.panel.id)}; reference ${e([t.finding.reference_low, t.finding.reference_high, t.finding.reference_text].filter((x) => x !== null && x !== "").join(" / "))}</li>`,
        )
        .join("");
      return `<section class="series"><h3>${e(title)}</h3><p>${e(caption)}</p>${graphic}<ul>${history}</ul></section>`;
    })
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Diagnostic report</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
 :root{--foreground:20 12% 18%;--background:45 20% 98%;--border:25 15% 75%;--muted:25 15% 92%}body{font-family:'Noto Sans',sans-serif;color:hsl(var(--foreground));font-size:9pt;line-height:1.35}h1{font-size:20pt}h2{font-size:13pt;margin-top:18pt}h3{font-size:10pt}p,td,li{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid hsl(var(--border));padding:5pt;vertical-align:top}thead{display:table-header-group}th{background:hsl(var(--muted));text-align:left}tr{break-inside:avoid}th:nth-child(1){width:21%}th:nth-child(2){width:18%}th:nth-child(3){width:10%}th:nth-child(4){width:27%}th:nth-child(5){width:24%}small{font-size:7pt}.series svg text{font-size:9px}.series svg{width:100%;height:110pt}.series{break-inside:avoid}.provenance{font-size:7pt;overflow-wrap:anywhere}ul{padding-left:15pt}li{margin-bottom:3pt}
 </style></head><body><header><p>The Living Room Vet</p><h1>${e(a.panel_name)}</h1><h2>${e(p.name)}</h2><p>${e(p.species)} · ${e(p.breed ?? "Breed not recorded")} · Birth date: ${e(p.dob ?? "not recorded")} (${e(p.birth_date_precision)}) · Microchip: ${e(p.microchip_id ?? "not recorded")}</p><p>Collected ${e(a.collected_on)} · Reported ${e(a.reported_on)} · ${e(a.specimen)} · ${e(a.method)} · ${e(a.source)}</p></header><h2>Reviewed findings</h2><table><thead><tr><th>Finding</th><th>Recorded result</th><th>Original unit</th><th>Recorded reference</th><th>Recorded flag</th></tr></thead><tbody>${rows}</tbody></table><h2>Clinical interpretation</h2><p>${e(a.interpretation || "Not recorded")}</p><p>Entered by ${e(v.entered_by_name)}. Reviewed by ${e(v.reviewer_name)} at ${e(v.reviewed_at)}.</p><p>Review note: ${e(v.review_note)}</p>${v.correction_reason ? `<p>Correction reason: ${e(v.correction_reason)}</p>` : ""}<h2>Comparable history</h2><p>History through source review time ${e(v.reviewed_at)}. ${s.panels.length} of ${s.total_panels} reviewed panels included${s.panels.length < s.total_panels ? "; history is explicitly limited" : ""}. Series keep original category, identity, specimen, method, source, unit and finding kind.</p>${graphs}<section class="provenance"><h2>Source version ${v.number}</h2><p>Patient ${e(p.id)} · Panel ${e(v.panel_id)} · Reviewed version ${e(v.id)}</p><p>Source hash ${e(v.source_hash)}. Patient display fields captured at PDF request ${e(s.job.created_at)}.</p>${v.source_context.document ? `<p>Original source reference: ${e(v.source_context.document.file_name)}, version ${v.source_context.document.version}.</p>` : ""}</section></body></html>`;
  return renderInputSchema.parse({
    version: 1,
    job_id: s.job.id,
    source_hash: s.job.source_hash,
    snapshot_hash: s.job.snapshot_hash,
    html_sha256: sha256(html),
    html_bytes: Buffer.byteLength(html),
    html,
    expected_texts: [...new Set(expected.filter((t) => t.trim().length > 0))],
  });
}
