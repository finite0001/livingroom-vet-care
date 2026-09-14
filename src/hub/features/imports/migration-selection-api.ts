import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MigrationScopeInput, MigrationManifest, MigrationCursor } from "./migration-run-api.ts";
export const migrationResourceLabels: Record<MigrationScopeInput["resource"], string> = { contact: "Contacts", animal: "Patients", healthstatus: "Weights", consult: "Consultations", history: "Clinical history", vaccination: "Vaccinations", prescription: "Prescriptions", prescriptionitem: "Prescription items", attachment: "Attachments" };
const uuid = z.string().uuid();
const cursorSchema = z.object({ before_at: z.string().datetime({ offset: true }), before_id: uuid }).strict();
import { precedes } from "./attachment-review-history.ts";
const mappingSchema = z.object({ id: uuid, resource: z.enum(["contact", "animal"]), client_id: uuid, pet_id: uuid.nullable(), external_id: z.string(), snapshot_id: uuid, head_version: z.number().int().positive(), source_origin: z.enum(["https://api.trial.ezyvet.com", "https://api.ezyvet.com"]), source_site_uid: z.string() }).strict();
export interface MigrationMapping extends z.infer<typeof mappingSchema> { patient_name: string | null; household_name: string }
export interface MigrationParent { id: string; external_id: string; version: number }
export interface MigrationRunChoice { id: string; requested_by: string; source_origin: string; source_site_uid: string; resource: string; status: string; created_at: string }
export const migrationResources: MigrationScopeInput["resource"][] = ["contact", "animal", "healthstatus", "consult", "history", "vaccination", "prescription", "prescriptionitem", "attachment"];
export function migrationParentType(resource: MigrationScopeInput["resource"], mapping: MigrationMapping): MigrationScopeInput["parent_type"] {
  return resource === "contact" || (resource === "attachment" && mapping.resource === "contact") ? "contact" : resource === "vaccination" ? "consult" : resource === "prescriptionitem" ? "prescription" : "animal";
}
export function createMigrationSelectionApi(client: SupabaseClient, actor: string) {
  uuid.parse(actor);
  function offset(page: number) { z.number().int().min(0).max(10000).parse(page); return page * 20; }
  return {
    async mappings(page = 0): Promise<{ rows: MigrationMapping[]; has_more: boolean }> {
      const start = offset(page);
      const { data, error } = await client.from("ezyvet_record_links").select("id,resource,client_id,pet_id,external_id,snapshot_id,head_version,source_origin,source_site_uid").in("resource", ["contact", "animal"]).order("id").range(start, start + 20);
      if (error) throw error;
      const rows = z.array(mappingSchema).max(21).parse(data);
      if (!rows.length) return { rows: [], has_more: false };
      const [clients, pets] = await Promise.all([
        client.from("clients").select("id,full_name").in("id", [...new Set(rows.map(r => r.client_id))]),
        client.from("pets").select("id,name,client_id").in("id", rows.flatMap(r => r.pet_id ? [r.pet_id] : [])),
      ]);
      if (clients.error) throw clients.error; if (pets.error) throw pets.error;
      const households = z.array(z.object({ id: uuid, full_name: z.string() })).parse(clients.data);
      const patients = z.array(z.object({ id: uuid, name: z.string(), client_id: uuid })).parse(pets.data);
      return { has_more: rows.length > 20, rows: rows.slice(0, 20).map(row => {
        const household = households.find(c => c.id === row.client_id), patient = patients.find(p => p.id === row.pet_id);
        if (!household || (row.pet_id && (!patient || patient.client_id !== row.client_id))) throw new Error("Mapped household changed; refresh choices");
        return { ...row, household_name: household.full_name, patient_name: patient?.name ?? null };
      }) };
    },
    async parents(mapping: MigrationMapping, resource: MigrationScopeInput["resource"], page = 0, parentType = migrationParentType(resource, mapping)) {
      const parent = parentType, start = offset(page);
      if (parent !== migrationParentType(resource, mapping) && !(resource === "attachment" && mapping.resource === "animal" && parent === "consult")) throw new Error("Unsupported source parent choice");
      let query = client.from("ezyvet_import_snapshots").select("id,external_id").eq("source_origin", mapping.source_origin).eq("source_site_uid", mapping.source_site_uid).eq("resource", parent);
      query = parent === "animal" || parent === "contact" ? query.eq("external_id", mapping.external_id) : query.eq("payload->>animal_id", mapping.external_id);
      const { data, error } = await query.order("created_at", { ascending: false }).order("id").range(start, start + 20);
      if (error) throw error;
      const snapshots = z.array(z.object({ id: uuid, external_id: z.string() })).max(21).parse(data);
      if (!snapshots.length) return { rows: [] as MigrationParent[], has_more: false };
      const heads = await client.from("ezyvet_identity_heads").select("snapshot_id,external_id,version").eq("source_origin", mapping.source_origin).eq("source_site_uid", mapping.source_site_uid).eq("resource", parent).in("snapshot_id", snapshots.slice(0, 20).map(s => s.id));
      if (heads.error) throw heads.error;
      const parsed = z.array(z.object({ snapshot_id: uuid, external_id: z.string(), version: z.number().int().positive() })).parse(heads.data);
      return { has_more: snapshots.length > 20, rows: snapshots.slice(0, 20).flatMap(s => { const h = parsed.find(h => h.snapshot_id === s.id && h.external_id === s.external_id); return h ? [{ id: s.id!, external_id: s.external_id!, version: h.version! }] : []; }) };
    },
    async runs(manifest: MigrationManifest, scope: MigrationManifest["scopes"][number], cursor: MigrationCursor | null = null) {
      if (cursor) cursorSchema.parse(cursor);
      const rowSchema = z.object({ id: uuid, requested_by: z.literal(actor), source_origin: z.literal(manifest.run.source_origin), source_site_uid: z.literal(manifest.run.source_site_uid), resource: z.literal(scope.resource), status: z.enum(["running", "review_ready", "page_limit_reached"]), created_at: z.string().datetime({ offset: true }) });
      const scoped = !["contact", "animal", "healthstatus"].includes(scope.resource);
      let raw: unknown[], more: boolean, next: MigrationCursor | null;
      if (scoped) {
        const family = ["history", "consult"].includes(scope.resource) ? "clinical" : scope.resource;
        const args: Record<string, unknown> = { p_animal_link_id: scope.mapping_id, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: 20 };
        if (["clinical", "prescription"].includes(family)) args.p_resource = scope.resource;
        const { data, error } = await client.rpc(`list_ezyvet_${family}_runs`, args);
        if (error) throw error;
        const page = z.object({ runs: z.array(z.unknown()).max(20), has_more: z.boolean(), next_cursor: cursorSchema.nullable() }).strict().parse(data);
        raw = page.runs; more = page.has_more; next = page.next_cursor;
      } else {
        let query = client.from("ezyvet_import_runs").select("id,requested_by,source_origin,source_site_uid,resource,status,created_at").eq("requested_by", actor).eq("source_origin", manifest.run.source_origin).eq("source_site_uid", manifest.run.source_site_uid).eq("resource", scope.resource);
        if (cursor) query = query.or(`created_at.lt.${cursor.before_at},and(created_at.eq.${cursor.before_at},id.lt.${cursor.before_id})`);
        const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(21);
        if (error) throw error;
        raw = z.array(rowSchema.strict()).max(21).parse(data); more = raw.length > 20; raw = raw.slice(0, 20);
        const last = raw.length ? rowSchema.parse(raw.at(-1)) : null;
        next = more && last ? { before_at: last.created_at, before_id: last.id } : null;
      }
      const rows = raw.map(value => rowSchema.parse(value));
      let previous = cursor;
      const ids = new Set<string>();
      for (const row of rows) {
        if (ids.has(row.id) || (previous && !precedes(row.created_at, row.id, previous.before_at, previous.before_id))) throw new Error("Source run order differs");
        previous = { before_at: row.created_at, before_id: row.id }; ids.add(row.id);
      }
      if (more !== !!next || (more && (rows.length !== 20 || next?.before_at !== previous?.before_at || next?.before_id !== previous?.before_id))) throw new Error("Source run cursor differs");
      const filtered = rows.filter((_, index) => {
        if (!scoped) return true;
        const value = raw[index] as Record<string, unknown>;
        if (value.scope === "legacy_unscoped") return false;
        if (scope.resource === "attachment") {
          const parent = z.object({ animal_link_id: z.literal(scope.mapping_id), pet_id: z.literal(scope.pet_id), client_id: z.literal(scope.client_id), parent_snapshot_id: uuid, parent_observed_head_version: z.number().int().positive() }).parse(value.parent_context);
          return parent.parent_snapshot_id === scope.parent_snapshot_id && parent.parent_observed_head_version === scope.parent_head_version;
        }
        z.object({ animal_link_id: z.literal(scope.mapping_id), pet_id: z.literal(scope.pet_id), client_id: z.literal(scope.client_id) }).parse(value);
        const family = scope.resource === "vaccination" ? "consult" : scope.resource === "prescriptionitem" ? "prescription" : null;
        return !family || (value[`${family}_snapshot_id`] === scope.parent_snapshot_id && value[`${family}_observed_head_version`] === scope.parent_head_version);
      });
      return { rows: filtered, has_more: more, next_cursor: next };
    },
  };
}
