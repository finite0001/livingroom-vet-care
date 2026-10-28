import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
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

test("retained invoice and clinical runtimes keep their explicit historical 206 boundary", () => {
  // CI runs these unchanged runtimes in the admitted historical worktree.
  // The separate narcotics workflow verifies the complete current application.
  for (const directory of ["invoice-reminders", "clinical-audio", "clinical-notes", "clinical-dictation"]) {
    const source = readFileSync(new URL(`../${directory}/local-roundtrip.ts`, import.meta.url), "utf8");
    assert.deepEqual(migrationExpectations(source), ["206"],
      `${directory}/local-roundtrip.ts must match its historical owned migration inventory`);
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
    check(sql("select max(version)from supabase_migrations.schema_migrations;"), "20261022010000");
    check(sql("select max(version)from public.pets;"), "old");
  `), ["20261022010000"]);
});

test("current inventory preserves the exact 206 prefix and names both forward migrations", () => {
  const inventory = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  const candidate = JSON.parse(readFileSync(new URL("../../scripts/narcotics-log/release-candidate.json", import.meta.url), "utf8"));
  assert.equal(inventory.length, 208);
  assert.equal(candidate.migration_count, 208);
  assert.equal(candidate.prefix_migration_count, 206);
  assert.equal(inventory[205], "20261022010000_controlled_secondary_review_private.sql");
  assert.deepEqual(inventory.slice(206), ["20261027223535_controlled_record_review_workflows.sql", "20261027223544_narcotics_count_and_stock_workflows.sql"]);
  assert.deepEqual(Object.keys(candidate.migrations).sort(), inventory.slice(206));
  for (const name of inventory.slice(206)) {
    const raw = readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url));
    assert.deepEqual(candidate.migrations[name], { bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") });
  }
});

test("retained scalar ledger guards require historical 206 and its exact version", () => {
  for (const path of ["invoice-reminders/local-roundtrip.ts", "clinical-audio/local-roundtrip.ts",
    "clinical-notes/local-roundtrip.ts", "clinical-dictation/local-roundtrip.ts",
    "clinical-calls/local-roundtrip.ts", "clinical-recap/local-roundtrip.ts",
    "inventory/stock-writer-local.ts", "imaging/local-roundtrip.ts",
    "scheduling/operational-reconciliation-local.ts", "controlled-drugs/native-local.ts"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.deepEqual(migrationExpectations(source), ["206"], `${path} current count`);
    assert.deepEqual(migrationLatestExpectations(source), ["20261022010000"], `${path} current version`);
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
  assert.deepEqual(objectInventoryExpectations(source), [{ count: "206", latest: "20261022010000" }]);
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
    sqlCheck(sql("select count(*)from supabase_migrations.schema_migrations;"), "206");
    Check(sql("select max(version)from supabase_migrations.schema_migrations;"), "20261022010000");
  `;
  assert.deepEqual(migrationExpectations(source), ["206"]);
  assert.deepEqual(migrationLatestExpectations(source), ["20261022010000"]);
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

interface ReceiptCounterContract {
  countedGuards: number;
  helper: string;
  counter: string;
}

function ledgerCounterContract(source: string): ReceiptCounterContract {
  const file = ts.createSourceFile("producer.ts", source, ts.ScriptTarget.Latest, true);
  const helpers: string[] = [];
  const counters = new Map<string, string>();
  function visit(node: ts.Node) {
    const body = ts.isFunctionDeclaration(node) ? node.body
      : ts.isVariableDeclaration(node) && node.initializer
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ? node.initializer.body : undefined;
    if (body && (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node))
      && node.name && ts.isIdentifier(node.name)) {
      const increments: string[] = [];
      function increment(child: ts.Node) {
        if ((ts.isPostfixUnaryExpression(child) || ts.isPrefixUnaryExpression(child))
          && child.operator === ts.SyntaxKind.PlusPlusToken && ts.isIdentifier(child.operand)) {
          increments.push(child.operand.text);
        }
        ts.forEachChild(child, increment);
      }
      increment(body);
      if (increments.length === 1) counters.set(node.name.text, increments[0]!);
    }
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      let actual = node.arguments[0];
      if (actual && ts.isCallExpression(actual) && actual.expression.getText(file) === "JSON.parse") actual = actual.arguments[0];
      if (actual && ts.isCallExpression(actual) && actual.expression.getText(file) === "sql") {
        const query = actual.arguments[0];
        if (query && ts.isStringLiteralLike(query)
          && /\bsupabase_migrations\.schema_migrations\b/i.test(query.text)) {
          assert.ok(ts.isIdentifier(node.expression), "Ledger receipt helper must be a declared identifier");
          helpers.push(node.expression.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(helpers.length > 0);
  assert.equal(new Set(helpers).size, 1, "Ledger assertions must increment the same receipt counter");
  const helper = helpers[0]!;
  const counter = counters.get(helper);
  assert.ok(counter, "Each ledger assertion helper must increment exactly one receipt counter once");
  return { countedGuards: helpers.length, helper, counter };
}

function receiverApiCount(source: string, variable: string) {
  const matches = [...source.matchAll(new RegExp(`\\b${variable}\\[['"]api_checks['"]\\]\\s*==\\s*(\\d+)`, "g"))];
  assert.equal(matches.length, 1, "Exactly one strict receiver receipt-count comparison required");
  return Number(matches[0]![1]);
}

test("exact receipt counters follow counted ledger guards in all affected strict receivers", () => {
  // Released #288 observed totals included one migration-count assertion. The
  // non-ledger workloads are unchanged; canonical promotion adds one counted
  // latest-version assertion. These are receipt checks, not HTTP request counts.
  const contracts = [
    { producer: "scheduling/operational-reconciliation-local.ts", receiver: "scheduling/disposable.py", variable: "receipt", nonLedger: 41, helper: "check", counter: "checks" },
    { producer: "controlled-drugs/native-local.ts", receiver: "scheduling/disposable.py", variable: "controlled_receipt", nonLedger: 27, helper: "receipt", counter: "checks" },
    { producer: "inventory/stock-writer-local.ts", receiver: "prescriptions/native-disposable.py", variable: "stock_api", nonLedger: 39, helper: "check", counter: "checks" },
  ];
  for (const contract of contracts) {
    const producer = readFileSync(new URL(`../${contract.producer}`, import.meta.url), "utf8");
    const receiver = readFileSync(new URL(`../${contract.receiver}`, import.meta.url), "utf8");
    const actual = ledgerCounterContract(producer);
    assert.deepEqual(actual, { countedGuards: 2, helper: contract.helper, counter: contract.counter });
    const expected = contract.nonLedger + actual.countedGuards;
    assert.equal(receiverApiCount(receiver, contract.variable), expected, `${contract.producer} receiver must include both counted ledger assertions`);
    assert.notEqual(receiverApiCount(receiver, contract.variable), expected - 1, "The prior count must be rejected");
  }
});

test("receipt contract detects a newly counted assertion and refuses stale or weak receiver checks", () => {
  const producer = `const check = (a: unknown,b: unknown) => { checks++; };
    check(sql("select count(*)from supabase_migrations.schema_migrations;"), "206");
    check(sql("select max(version)from supabase_migrations.schema_migrations;"), "20261022010000");`;
  const contract = ledgerCounterContract(producer);
  assert.equal(contract.countedGuards, 2);
  assert.equal(receiverApiCount("assert receipt['api_checks']==43 and receipt['passed']", "receipt"), 41 + contract.countedGuards);
  assert.notEqual(receiverApiCount("assert receipt['api_checks']==42", "receipt"), 41 + contract.countedGuards);
  assert.throws(() => receiverApiCount("assert receipt['api_checks']>=42", "receipt"));
  const added = producer + '\ncheck(sql("select min(version)from supabase_migrations.schema_migrations;"), "old");';
  assert.equal(ledgerCounterContract(added).countedGuards, 3);
  assert.notEqual(43, 41 + ledgerCounterContract(added).countedGuards);
  assert.throws(() => ledgerCounterContract(producer.replace('checks++;', 'checks++; other++;')));
});

test("all eleven changed ledger guards retain their exact receipt-counter destination", () => {
  const expected = [
    ["invoice-reminders/local-roundtrip.ts", "check", "checks", 2],
    ["clinical-audio/local-roundtrip.ts", "sqlCheck", "sqlChecks", 2],
    ["clinical-notes/local-roundtrip.ts", "apiCheck", "apiChecks", 2],
    ["clinical-dictation/local-roundtrip.ts", "sqlCheck", "sqlChecks", 2],
    ["clinical-calls/local-roundtrip.ts", "check", "apiChecks", 2],
    ["clinical-recap/local-roundtrip.ts", "check", "apiChecks", 2],
    ["inventory/stock-writer-local.ts", "check", "checks", 2],
    ["imaging/local-roundtrip.ts", "check", "apiChecks", 2],
    ["scheduling/operational-reconciliation-local.ts", "check", "checks", 2],
    ["controlled-drugs/native-local.ts", "receipt", "checks", 2],
    // This existing assertion gained a new expected object, not another call.
    ["scheduling/operational-tasks-local.ts", "check", "checks", 1],
  ] as const;
  for (const [path, helper, counter, countedGuards] of expected) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.deepEqual(ledgerCounterContract(source), { countedGuards, helper, counter }, path);
  }
});
