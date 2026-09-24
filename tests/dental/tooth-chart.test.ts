import test from "node:test";
import assert from "node:assert/strict";
import {
  dentalSpecies,
  toothQuadrants,
  emptyTooth,
  validateDentalData,
} from "../../src/hub/features/dental/tooth-chart.ts";
const teeth = (species: string, dentition: string) =>
  toothQuadrants(species, dentition).flatMap((quadrant) => quadrant.teeth);
test("AVDC permanent and deciduous dog/cat tooth counts and deliberate numbering gaps", () => {
  assert.equal(teeth("dog", "adult").length, 42);
  assert.equal(teeth("cat", "adult").length, 30);
  assert.equal(teeth("dog", "deciduous").length, 28);
  assert.equal(teeth("cat", "deciduous").length, 26);
  assert.equal(teeth("cat", "adult").includes("105"), false);
  assert.equal(teeth("cat", "adult").includes("306"), false);
  assert.equal(teeth("cat", "adult").includes("307"), true);
  assert.equal(teeth("dog", "deciduous").includes("505"), false);
  assert.equal(teeth("dog", "deciduous").includes("806"), true);
  assert.equal(teeth("cat", "deciduous").includes("806"), false);
  assert.deepEqual(toothQuadrants("dog", "adult")[0].teeth, [
    "110",
    "109",
    "108",
    "107",
    "106",
    "105",
    "104",
    "103",
    "102",
    "101",
  ]);
  assert.equal(toothQuadrants("dog", "adult")[2].teeth.at(-1), "401");
});
test("unsupported species and explicit manual mode have no invented tooth layout", () => {
  assert.equal(dentalSpecies("Rabbit"), "manual");
  assert.equal(dentalSpecies(" Feline "), "cat");
  assert.deepEqual(toothQuadrants("manual", "adult"), []);
  assert.deepEqual(toothQuadrants("dog", "manual"), []);
  assert.equal(emptyTooth().presence, "not_recorded");
});
test("measurements require descriptive site and finite positive millimeters", () => {
  for (const value of [0, -1, Infinity, NaN])
    assert.match(
      validateDentalData({
        "101": {
          ...emptyTooth(),
          measurements: [{ label: "Buccal", value_mm: value }],
        },
      })!,
      /finite value/,
    );
  assert.match(
    validateDentalData({
      "101": { ...emptyTooth(), measurements: [{ label: "", value_mm: 2 }] },
    })!,
    /site\/description/,
  );
  assert.equal(
    validateDentalData({
      "101": {
        ...emptyTooth(),
        measurements: [{ label: "Buccal probing", value_mm: 2.5 }],
      },
    }),
    null,
  );
});
