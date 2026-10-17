import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { EVALUATION_CASES } from "./evaluation-corpus.ts";
import { recapFixture } from "./fixtures.ts";
import { validateFixtureCapture } from "./synthetic-provider-plan.ts";

function fixedA() {
  const fixture = EVALUATION_CASES[0], f = recapFixture();
  const aliases: Record<
    string,
    {
      id: string;
      source_ref: string;
      kind: "signed_encounter";
      version: number;
      excluded: boolean;
    }
  > = {};
  const original = f.context.manifest.source_set.sources[0];
  if (original.kind !== "signed_encounter") {
    throw Error("Signed fixture required");
  }
  const sources = fixture.encounters.map((encounter) => ({
    ...original,
    id: randomUUID(),
    fields: {
      subjective: encounter.subjective,
      objective: encounter.objective,
      assessment: encounter.assessment,
      plan: encounter.plan,
    },
    metadata: {
      ...original.metadata,
      visit_at: new Date(encounter.visit_at).toISOString().replace("Z", "000Z"),
    },
    alias: encounter.alias,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const projected = sources.map(({ alias, ...source }, index) => {
    const ref = `src_${String(index + 1).padStart(4, "0")}`;
    aliases[alias] = {
      id: source.id,
      source_ref: ref,
      kind: "signed_encounter",
      version: source.version,
      excluded: false,
    };
    return { ...source, ref };
  });
  const context = {
    ...f.context,
    manifest: {
      ...f.context.manifest,
      source_set: {
        ...f.context.manifest.source_set,
        patient: {
          ...f.context.manifest.source_set.patient,
          name: "SYNTHETIC RECAP A",
          species: "Dog",
        },
        sources: projected,
        selection: {
          encounter_ids: projected.map((source) => source.id),
          include_native_problems: false,
          visit_from: null,
          visit_to: null,
        },
      },
    },
  };
  const item = {
    id: "A",
    title: fixture.title,
    context,
    expected_facts: structuredClone(fixture.expected_facts),
    source_aliases: aliases,
    creation_receipts: {},
    structural_probe: null,
    structural_probe_scope: "Offline boundary test only",
    scaffold_notes: [],
    deterministic_vocabulary_warning: null,
  };
  return {
    item: item as Parameters<typeof validateFixtureCapture>[0],
    actor: f.actor,
  };
}

test("fixed-source allowlist rejects arbitrary clinical text even with a synthetic patient name", () => {
  const { item, actor } = fixedA();
  assert.doesNotThrow(() => validateFixtureCapture(item, actor));
  const changed = structuredClone(item),
    source = changed.context.manifest.source_set.sources[0];
  if (source.kind !== "signed_encounter") throw Error();
  source.fields.subjective = "Unapproved clinical content renamed SYNTHETIC.";
  assert.throws(
    () => validateFixtureCapture(changed, actor),
    /Fixed signed source content differs/,
  );
});

test("fixed expected facts cannot be relabeled to approve an altered inference", () => {
  const { item, actor } = fixedA();
  item.expected_facts.required[0].description =
    "Approve an unsupported normal examination.";
  assert.throws(
    () => validateFixtureCapture(item, actor),
    /Exact fixed fact inventory required/,
  );
});

test("fixed source scope rejects extra aliases and patient identity substitution", () => {
  const { item, actor } = fixedA();
  const changed = structuredClone(item);
  changed.source_aliases["E-EXTRA"] = {
    ...Object.values(changed.source_aliases)[0],
    id: randomUUID(),
  };
  assert.throws(
    () => validateFixtureCapture(changed, actor),
    /Exact fixture membership/,
  );
  item.context.manifest.source_set.patient.dob = "2020-01-01";
  assert.throws(
    () => validateFixtureCapture(item, actor),
    /Fixed synthetic patient projection/,
  );
});
