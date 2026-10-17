/** Offline fixed-input planner. Never contacts Supabase or a model provider. */
import { z } from "zod";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  EVALUATION_CASES,
  EVALUATION_NAMESPACE,
  FIXTURE_REVISION,
} from "./evaluation-corpus.ts";
import { createHash } from "node:crypto";
import { recapJobReadSchema } from "../../supabase/functions/_shared/clinical-recap-model.ts";
import {
  clinicalRecapJsonSchema,
  clinicalRecapRequest,
} from "../../supabase/functions/_shared/clinical-recap-handler.ts";
import { veterinaryContextReceipt } from "../../supabase/functions/_shared/clinical-veterinary-context.ts";
const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const nonblank = (max: number) =>
  z.string().max(max).refine((value) => !!value.trim());
const sourceKind = z.enum(["signed_encounter", "addendum", "native_problem"]);
const supportSchema = z.object({
  source_alias: nonblank(100),
  field_path: nonblank(100),
  quote: nonblank(1000),
}).strict();
const inventorySchema = z.object({
  required: z.array(
    z.object({
      id: nonblank(100),
      description: nonblank(4000),
      severity: z.enum(["critical", "major"]),
      display: z.enum([
        "claim",
        "metadata",
        "coverage",
        "deterministic_warning",
      ]),
      support: z.array(supportSchema).max(16),
    }).strict(),
  ).min(1).max(64),
  forbidden: z.array(
    z.object({
      id: nonblank(100),
      description: nonblank(4000),
      severity: z.enum(["critical", "major"]),
    }).strict(),
  ).max(64),
  adjudication: nonblank(4000),
}).strict();
const aliasSchema = z.object({
  id: z.string().uuid(),
  source_ref: z.string().regex(/^src_00(?:0[1-9]|[1-5][0-9]|6[0-4])$/)
    .nullable(),
  kind: sourceKind,
  version: z.number().int().positive().nullable(),
  excluded: z.boolean(),
}).strict().refine((value) => value.excluded === (value.source_ref === null));
const caseSchema = z.object({
  id: z.enum(["A", "B", "C", "D", "E", "F", "G", "H"]),
  title: nonblank(200),
  context: recapJobReadSchema,
  expected_facts: inventorySchema,
  source_aliases: z.record(aliasSchema),
  creation_receipts: z.record(z.unknown()),
  structural_probe: z.unknown(),
  structural_probe_scope: nonblank(4000),
  scaffold_notes: z.array(nonblank(4000)).max(10),
  deterministic_vocabulary_warning: z.string().max(500).nullable(),
}).strict();
const corpusSchema = z.object({
  corpus_version: z.string().startsWith("lrv-recap-synthetic-eight-v1.").max(
    200,
  ),
  fixture_revision: z.literal("lrv-recap-facts-v1"),
  namespace: z.string().uuid(),
  run_id: nonblank(100),
  exported_at: z.string().datetime(),
  identity: nonblank(200),
  synthetic_only: z.literal(true),
  provider_requests: z.literal(0),
  author_id: z.string().uuid(),
  client_id: z.string().uuid(),
  identity_assignment: nonblank(4000),
  cases: z.array(caseSchema).length(8),
  semantic_negative_controls: z.array(z.unknown()).length(3),
  engineering_proof: z.record(z.unknown()),
}).strict();
export function validateFixtureCapture(
  item: z.infer<typeof caseSchema>,
  authorId: string,
) {
  const fixture = EVALUATION_CASES.find((fixture) => fixture.id === item.id);
  if (
    !fixture || fixture.title !== item.title ||
    !isDeepStrictEqual(
      item.expected_facts,
      inventorySchema.parse(fixture.expected_facts),
    )
  ) throw Error("Exact fixed fact inventory required.");
  const { source_set: set } = item.context.manifest;
  const patient = set.patient;
  const archived = fixture.lifecycle
    ? new Date(fixture.lifecycle.archived_at).toISOString().replace(
      /\.(\d{3})Z$/,
      ".$1000Z",
    )
    : null;
  if (
    patient.name !== `SYNTHETIC RECAP ${fixture.id}` ||
    patient.species !== "Dog" || patient.breed !== null ||
    patient.dob !== null || patient.birth_date_precision !== "unknown" ||
    patient.sex !== "unknown" || patient.neuter_status !== "unknown" ||
    patient.archived_at !== archived ||
    patient.deceased_at !== (fixture.lifecycle?.deceased_at ?? null)
  ) throw Error("Fixed synthetic patient projection differs.");
  const expectedAliases = fixture.encounters.flatMap(
    (encounter) => [
      encounter.alias,
      ...(encounter.addenda ?? []).map((addendum) => addendum.alias),
    ],
  ).concat(fixture.problems.map((problem) => problem.alias));
  if (
    !isDeepStrictEqual(
      Object.keys(item.source_aliases).sort(),
      expectedAliases.sort(),
    ) ||
    set.sources.length !==
      expectedAliases.length -
        fixture.problems.filter((problem) => problem.outside_linked).length ||
    new Set(Object.values(item.source_aliases).map((alias) => alias.id))
        .size !== expectedAliases.length
  ) throw Error("Exact fixture membership required.");
  const sourceFor = (aliasName: string, kind: z.infer<typeof sourceKind>) => {
    const alias = item.source_aliases[aliasName];
    const source = set.sources.find((source) =>
      source.ref === alias?.source_ref
    );
    if (
      !source || alias.excluded || source.id !== alias.id ||
      source.kind !== kind || alias.kind !== kind ||
      alias.version !== source.version
    ) throw Error("Fixed source alias differs.");
    return source;
  };
  for (const encounter of fixture.encounters) {
    const source = sourceFor(encounter.alias, "signed_encounter");
    if (
      source.kind !== "signed_encounter" ||
      !isDeepStrictEqual(source.fields, {
        subjective: encounter.subjective,
        objective: encounter.objective,
        assessment: encounter.assessment,
        plan: encounter.plan,
      }) ||
      source.metadata.visit_at !==
        new Date(encounter.visit_at).toISOString().replace(
          /\.(\d{3})Z$/,
          ".$1000Z",
        ) ||
      source.metadata.created_by !== authorId ||
      source.metadata.signed_by !== authorId
    ) throw Error("Fixed signed source content differs.");
    for (const addendum of encounter.addenda ?? []) {
      const added = sourceFor(addendum.alias, "addendum");
      if (
        added.kind !== "addendum" ||
        added.fields.content !== addendum.content ||
        added.metadata.encounter_id !== source.id ||
        added.metadata.created_by !== authorId
      ) throw Error("Fixed addendum differs.");
    }
  }
  for (const problem of fixture.problems) {
    const alias = item.source_aliases[problem.alias];
    if (problem.outside_linked) {
      if (
        !alias.excluded || alias.source_ref !== null ||
        alias.kind !== "native_problem"
      ) throw Error("Outside-linked source must remain excluded.");
      continue;
    }
    const source = sourceFor(problem.alias, "native_problem");
    if (
      source.kind !== "native_problem" ||
      !isDeepStrictEqual(source.fields, {
        title: problem.title,
        notes: problem.notes,
        status: problem.status,
        importance: problem.importance,
        onset_date: problem.onset_date,
      }) || source.metadata.created_by !== authorId ||
      source.metadata.updated_by !== authorId
    ) throw Error("Fixed native problem differs.");
  }
  const expectedEncounterIds = fixture.encounters.map((encounter) =>
    item.source_aliases[encounter.alias].id
  ).sort();
  if (
    !isDeepStrictEqual(set.selection, {
      encounter_ids: expectedEncounterIds,
      include_native_problems: fixture.include_native_problems,
      visit_from: fixture.visit_from,
      visit_to: fixture.visit_to,
    }) ||
    set.exclusions.outside_linked_problem_count !==
      (fixture.include_native_problems
        ? fixture.problems.filter((problem) => problem.outside_linked).length
        : null)
  ) throw Error("Exact fixed selection/exclusion scope required.");
}
export async function planCorpus(bytes: Uint8Array) {
  if (bytes.length > 4_000_000) {
    throw Error("Synthetic corpus exceeds fixed planner budget.");
  }
  const corpus = corpusSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  if (
    corpus.namespace !== EVALUATION_NAMESPACE ||
    corpus.fixture_revision !== FIXTURE_REVISION
  ) throw Error("Fixed corpus namespace/revision differs.");
  const cases = [];
  for (const [index, item] of corpus.cases.entries()) {
    const id = String.fromCharCode(65 + index);
    if (item.id !== id) {
      throw Error("Fixed A..H cases and fact inventory required.");
    }
    const context = recapJobReadSchema.parse(item.context);
    if (context.actor_id !== corpus.author_id) {
      throw Error("Synthetic capture author differs.");
    }
    validateFixtureCapture(item, corpus.author_id);
    if (
      context.manifest.source_set.patient.name !== `SYNTHETIC RECAP ${id}` ||
      context.actor_id !== context.job.actor_id ||
      context.job.attempts.length || context.output || context.review ||
      context.job.review_version !== 1 ||
      context.current.source_status !== "current" ||
      context.policy.status !== "approved" ||
      context.policy.version !== context.job.policy_version ||
      context.policy.generation_model !== "gpt-6-luna"
    ) {
      throw Error(
        "Unused, owned, approved, current synthetic capture required.",
      );
    }
    for (const alias of Object.values(item.source_aliases)) {
      if (
        alias.source_ref !== null &&
        !context.manifest.source_set.sources.some((source) =>
          source.ref === alias.source_ref && source.id === alias.id &&
          source.kind === alias.kind && source.version === alias.version
        )
      ) throw Error("Source aliases differ from captured sources.");
    }
    for (const fact of item.expected_facts.required) {
      for (const evidence of fact.support) {
        const alias = item.source_aliases[evidence.source_alias];
        const source = context.manifest.source_set.sources.find((source) =>
          source.ref === alias?.source_ref
        );
        const field = evidence.field_path.startsWith("fields.")
          ? (source?.fields as Record<string, unknown> | undefined)
            ?.[evidence.field_path.slice(7)]
          : undefined;
        if (
          !alias || typeof field !== "string" || !field.includes(evidence.quote)
        ) {
          throw Error("Fact inventory evidence differs from captured sources.");
        }
      }
    }
    const request = clinicalRecapRequest(
      context.policy.generation_model,
      context,
    );
    if (
      request.store !== false || request.background !== false ||
      request.stream !== false || request.max_output_tokens !== 8000 ||
      "tools" in request
    ) throw Error("Provider request safety options changed.");
    const requestBody = JSON.stringify(request),
      languageContext = await veterinaryContextReceipt(request);
    cases.push({
      id,
      title: item.title,
      manifest_sha256: context.manifest.sha256,
      source_fingerprint: context.manifest.source_fingerprint,
      context_sha256: sha(JSON.stringify(context)),
      fact_inventory_sha256: sha(JSON.stringify(item.expected_facts)),
      request_sha256: sha(requestBody),
      request_body_b64: Buffer.from(requestBody).toString("base64"),
      language_context: languageContext,
      policy_version: context.policy.version,
      model: request.model,
    });
  }
  return {
    corpus_version: corpus.corpus_version,
    namespace: corpus.namespace,
    fixture_revision: corpus.fixture_revision,
    corpus_sha256: sha(bytes),
    output_schema_sha256: sha(JSON.stringify(clinicalRecapJsonSchema)),
    cases,
  };
}
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  try {
    process.stdout.write(
      JSON.stringify(await planCorpus(readFileSync(process.argv[2]))) + "\n",
    );
  } catch {
    process.stderr.write(
      "Offline synthetic corpus validation failed. No hosted/provider operation attempted.\n",
    );
    process.exitCode = 1;
  }
}
