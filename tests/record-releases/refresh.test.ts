import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { refreshPatientReleases } from "../../src/hub/features/record-releases/refresh.ts";

test("a confirmed source change refreshes mounted candidates without changing a sibling patient's cache", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const key = ["release-candidates-v13", "patient-a", "staff", 0];
  const sibling = ["release-candidates-v13", "patient-b", "staff", 0];
  cache.setQueryData(key, ["original encounter"]);
  cache.setQueryData(sibling, ["sibling encounter"]);
  let reads = 0;
  const observer = new QueryObserver(cache, { queryKey: key, queryFn: async () => { reads++; return ["original encounter", "new signed encounter"]; } });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await refreshPatientReleases(cache, "patient-a");
    assert.equal(reads, 1);
    assert.deepEqual(cache.getQueryData(key), ["original encounter", "new signed encounter"]);
    assert.deepEqual(cache.getQueryData(sibling), ["sibling encounter"]);
    assert.equal(cache.getQueryState(sibling)?.isInvalidated, false);
  } finally { unsubscribe(); cache.clear(); }
});

test("a record-only chart or stock save marks cached release sources and history stale", async () => {
  const cache = new QueryClient();
  const keys = [
    ["release-candidates-v13", "patient-a", "staff", 0],
    ["release-candidates-v13", "patient-b", "staff", 1],
    ["patient-record-releases", "patient-a", "staff", 0],
  ];
  keys.forEach(key => cache.setQueryData(key, ["retained evidence"]));
  try {
    await refreshPatientReleases(cache);
    for (const key of keys) {
      assert.equal(cache.getQueryState(key)?.isInvalidated, true);
      assert.deepEqual(cache.getQueryData(key), ["retained evidence"]);
    }
  } finally { cache.clear(); }
});

test("a frozen release preview retains its evidence while source invalidation is observable", async () => {
  const cache = new QueryClient();
  const key = ["release-candidates-v13", "patient-a", "staff", 0];
  cache.setQueryData(key, ["reviewed source"]);
  let reads = 0;
  const observer = new QueryObserver(cache, { queryKey: key, enabled: false, queryFn: async () => { reads++; return ["changed source"]; } });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await refreshPatientReleases(cache, "patient-a");
    assert.equal(reads, 0);
    assert.equal(cache.getQueryState(key)?.isInvalidated, true);
    assert.deepEqual(cache.getQueryData(key), ["reviewed source"]);
  } finally { unsubscribe(); cache.clear(); }
});
