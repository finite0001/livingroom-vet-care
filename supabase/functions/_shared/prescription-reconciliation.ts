export interface InvalidPrescriptionReference {
  index: number;
  value: unknown;
}

export interface PrescriptionItemReconciliation {
  status: "matched" | "unresolved";
  sourceListPresent: boolean;
  scanComplete: boolean;
  expectedIds: string[];
  observedIds: string[];
  missingIds: string[];
  unexpectedIds: string[];
  duplicateSourceIds: string[];
  duplicateObservedIds: string[];
  invalidSourceReferences: InvalidPrescriptionReference[];
  invalidObservedReferences: InvalidPrescriptionReference[];
}

// Decimal strings remain strings: converting them through Number can silently
// merge distinct upstream identifiers beyond JavaScript's safe integer range.
function identity(value: unknown): string | null {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    return value;
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : null;
}

function inspectReferences(values: readonly unknown[]) {
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  const invalid: InvalidPrescriptionReference[] = [];
  values.forEach((value, index) => {
    const id = identity(value);
    if (id === null) invalid.push({ index, value });
    else if (ids.has(id)) duplicates.add(id);
    else ids.add(id);
  });
  return { ids, duplicates: [...duplicates], invalid };
}

/** Compares references only; a match is not clinical approval or proof that a
 * paginated provider scan is a consistent export. Callers must independently
 * validate each item's same-site parent, patient and observed source revision.
 */
export function reconcilePrescriptionItems(
  sourceItemList: unknown,
  observedItemIds: readonly unknown[],
  scanComplete: boolean,
): PrescriptionItemReconciliation {
  const sourceListPresent = Array.isArray(sourceItemList);
  const expected = inspectReferences(sourceListPresent ? sourceItemList : []);
  const observed = inspectReferences(observedItemIds);
  if (!sourceListPresent) {
    expected.invalid.push({ index: -1, value: sourceItemList });
  }
  const missingIds = [...expected.ids].filter((id) => !observed.ids.has(id));
  const unexpectedIds = [...observed.ids].filter((id) => !expected.ids.has(id));
  const matched = sourceListPresent && scanComplete === true &&
    missingIds.length === 0 && unexpectedIds.length === 0 &&
    expected.duplicates.length === 0 && observed.duplicates.length === 0 &&
    expected.invalid.length === 0 && observed.invalid.length === 0;
  return {
    status: matched ? "matched" : "unresolved",
    sourceListPresent,
    scanComplete: scanComplete === true,
    expectedIds: [...expected.ids],
    observedIds: [...observed.ids],
    missingIds,
    unexpectedIds,
    duplicateSourceIds: expected.duplicates,
    duplicateObservedIds: observed.duplicates,
    invalidSourceReferences: expected.invalid,
    invalidObservedReferences: observed.invalid,
  };
}
