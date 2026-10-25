import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const text = readFileSync(new URL("./run-local-authenticated-clinical-workspace-review.mjs", import.meta.url), "utf8");
const source = ts.createSourceFile("clinical-driver.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "finalDeadlineCheck");
assert(declaration && ts.isFunctionDeclaration(declaration));

// Execute the actual source function with an inert clock/output interface;
// importing the executable browser driver itself would start a different test.
test("clinical driver refuses a late persisted result without a browser", () => {
  for (const now of [119999, 120000, 120001]) {
    const writes: unknown[] = [], failures: boolean[] = [];
    const check = runInNewContext(declaration.getText(source) + ";finalDeadlineCheck", {
      performance: { now: () => now }, deadline: 120000,
      latchFailure: () => failures.push(true), output: (...args: unknown[]) => writes.push(args),
    });
    if (now < 120000) {
      check(); assert.equal(writes.length, 0); assert.equal(failures.length, 0);
    } else {
      assert.throws(check, /cutoff exceeded/);
      assert.equal(failures.length, 1);
      assert.equal(JSON.stringify(writes), JSON.stringify([["post-persistence-cutoff-failure.json", { passed: false, candidate_result_not_acceptance: true }]]));
    }
  }
});

test("clinical driver checks its cutoff after result persistence and terminal output", () => {
  const checks = source.statements.filter(statement => ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) && statement.expression.expression.getText(source) === "finalDeadlineCheck");
  assert.equal(checks.length, 2);
  const resultOffset = text.lastIndexOf('output("result.json"');
  const terminalOffset = text.lastIndexOf("console.log(");
  assert(resultOffset >= 0 && resultOffset < checks[0].getStart(source));
  assert(checks[0].getStart(source) < terminalOffset && terminalOffset < checks[1].getStart(source));
});
