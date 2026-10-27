import type { Page } from "@playwright/test";
const name = "lrv:controlled-count-operation:v1:00000000-0000-0000-0000-000000000001";
export async function holdCountActorLock(page: Page) {
  await page.evaluate(async key => {
    await new Promise<void>(acquired => {
      void navigator.locks.request(key, { mode: "exclusive" }, async () => {
        await new Promise<void>(release => { Reflect.set(window, "__releaseSyntheticCountLock", release); acquired(); });
      });
    });
  }, name);
}
export async function releaseCountActorLock(page: Page) {
  await page.evaluate(async key => {
    const release: unknown = Reflect.get(window, "__releaseSyntheticCountLock");
    if (typeof release !== "function") throw new Error("Synthetic lock was not held");
    release(); Reflect.deleteProperty(window, "__releaseSyntheticCountLock");
    await navigator.locks.request(key, { mode: "exclusive" }, () => {});
  }, name);
}
