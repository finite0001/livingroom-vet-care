import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function migrationExpectations(source: string) {
  const file = ts.createSourceFile("guard.ts", source, ts.ScriptTarget.Latest, true);
  const expectations: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const [actual, expected] = node.arguments;
      if (actual && ts.isCallExpression(actual) && actual.expression.getText(file) === "sql") {
        const query = actual.arguments[0];
        if (query && ts.isStringLiteralLike(query)
          && /count\s*\(\s*\*\s*\)/i.test(query.text)
          && /\bsupabase_migrations\.schema_migrations\b/i.test(query.text)
          && expected && (ts.isStringLiteralLike(expected) || ts.isNumericLiteral(expected))) {
          expectations.push(expected.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return expectations;
}

test("migration inventory recognizes multiline runtime guards without matching other counts", () => {
  assert.deepEqual(migrationExpectations(`
    check(
      sql("select count(*)from supabase_migrations.schema_migrations;"),
      "202",
    );
    sqlCheck(sql("select count(*) from public.pets;"), "202");
    assert.equal(sql("SELECT COUNT (*) FROM supabase_migrations.schema_migrations"), 203);
  `), ["202", "203"]);
});

test("current owned invoice and clinical runtimes expect the checked-in migration count", () => {
  const current = String(readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((name) => /^\d+_.+\.sql$/.test(name)).length);
  assert.notEqual(current, "0");
  // These are current disposable runtimes, never the intentional historical upgrade fixtures.
  for (const directory of ["invoice-reminders", "clinical-audio", "clinical-notes", "clinical-dictation"]) {
    const source = readFileSync(new URL(`../${directory}/local-roundtrip.ts`, import.meta.url), "utf8");
    assert.deepEqual(migrationExpectations(source), [current],
      `${directory}/local-roundtrip.ts must match its current owned migration inventory`);
  }
});
