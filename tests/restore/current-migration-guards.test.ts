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

function migrationLatestExpectations(source: string) {
  const file = ts.createSourceFile("guard.ts", source, ts.ScriptTarget.Latest, true);
  const expectations: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const [actual, expected] = node.arguments;
      if (actual && ts.isCallExpression(actual) && actual.expression.getText(file) === "sql") {
        const query = actual.arguments[0];
        if (query && ts.isStringLiteralLike(query)
          && /max\s*\(\s*version\s*\)/i.test(query.text)
          && /\bsupabase_migrations\.schema_migrations\b/i.test(query.text)
          && expected && ts.isStringLiteralLike(expected)) expectations.push(expected.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return expectations;
}

test("latest migration guards recognize actual ledger queries and exclude other latest values", () => {
  assert.deepEqual(migrationLatestExpectations(`
    check(sql("select max(version)from supabase_migrations.schema_migrations;"), "20261020151157");
    check(sql("select max(version)from public.pets;"), "old");
  `), ["20261020151157"]);
});

test("all current scalar ledger guards require canonical 205 and its exact version", () => {
  const inventory = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  assert.equal(inventory.length, 205);
  assert.equal(inventory.at(-1), "20261020151157_controlled_stock_private_engine.sql");
  for (const path of ["invoice-reminders/local-roundtrip.ts", "clinical-audio/local-roundtrip.ts",
    "clinical-notes/local-roundtrip.ts", "clinical-dictation/local-roundtrip.ts",
    "clinical-calls/local-roundtrip.ts", "clinical-recap/local-roundtrip.ts",
    "inventory/stock-writer-local.ts", "imaging/local-roundtrip.ts",
    "scheduling/operational-reconciliation-local.ts", "controlled-drugs/native-local.ts"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.deepEqual(migrationExpectations(source), ["205"], `${path} current count`);
    assert.deepEqual(migrationLatestExpectations(source), ["20261020151157"], `${path} current version`);
  }
});

function objectInventoryExpectations(source: string) {
  const file = ts.createSourceFile("guard.ts", source, ts.ScriptTarget.Latest, true);
  const values: Array<Record<string, string>> = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const [actual, expected] = node.arguments;
      if (actual?.getText(file).includes("supabase_migrations.schema_migrations")
        && expected && ts.isObjectLiteralExpression(expected)) {
        const value: Record<string, string> = {};
        for (const property of expected.properties) {
          if (ts.isPropertyAssignment(property)
            && (ts.isStringLiteralLike(property.initializer) || ts.isNumericLiteral(property.initializer))) {
            value[property.name.getText(file)] = property.initializer.text;
          }
        }
        values.push(value);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return values;
}

test("operational task object guard retains exact canonical count and latest version", () => {
  const source = readFileSync(new URL("../scheduling/operational-tasks-local.ts", import.meta.url), "utf8");
  assert.deepEqual(objectInventoryExpectations(source), [{ count: "205", latest: "20261020151157" }]);
  assert.deepEqual(objectInventoryExpectations(`check(JSON.parse(sql("select count(*)from public.pets")), {count: 204,latest: "old"});`), []);
});

function undeclaredMigrationGuardCallees(source: string) {
  const file = ts.createSourceFile("guard.ts", source, ts.ScriptTarget.Latest, true);
  const declared = new Set<string>();
  const guardCallees: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node))
      && node.name && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isImportSpecifier(node) || ts.isImportClause(node)) {
      if (node.name) declared.add(node.name.text);
    }
    if (ts.isCallExpression(node)) {
      const actual = node.arguments[0];
      if (actual && ts.isCallExpression(actual) && actual.expression.getText(file) === "sql") {
        const query = actual.arguments[0];
        if (query && ts.isStringLiteralLike(query)
          && /\bsupabase_migrations\.schema_migrations\b/i.test(query.text)) {
          guardCallees.push(node.expression.getText(file));
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return guardCallees.filter((name) => !declared.has(name));
}

test("ledger guard assertions reject undeclared helpers even when their expected count is correct", () => {
  const source = `
    const sqlCheck = (actual: unknown, expected: unknown) => {};
    sqlCheck(sql("select count(*)from supabase_migrations.schema_migrations;"), "205");
    Check(sql("select max(version)from supabase_migrations.schema_migrations;"), "20261020151157");
  `;
  assert.deepEqual(migrationExpectations(source), ["205"]);
  assert.deepEqual(migrationLatestExpectations(source), ["20261020151157"]);
  assert.deepEqual(undeclaredMigrationGuardCallees(source), ["Check"]);
  assert.deepEqual(undeclaredMigrationGuardCallees(source.replace("    Check(", "    sqlCheck(")), []);
});

test("every current ledger scalar assertion uses an actually declared helper", () => {
  for (const path of ["invoice-reminders/local-roundtrip.ts", "clinical-audio/local-roundtrip.ts",
    "clinical-notes/local-roundtrip.ts", "clinical-dictation/local-roundtrip.ts",
    "clinical-calls/local-roundtrip.ts", "clinical-recap/local-roundtrip.ts",
    "inventory/stock-writer-local.ts", "imaging/local-roundtrip.ts",
    "scheduling/operational-reconciliation-local.ts", "controlled-drugs/native-local.ts"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.deepEqual(undeclaredMigrationGuardCallees(source), [], `${path} must execute a declared assertion helper`);
  }
});
