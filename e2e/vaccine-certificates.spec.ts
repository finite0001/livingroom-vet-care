import { test, expect } from "@playwright/test";
import { renderVaccineCertificate } from "../src/hub/features/certificates/print";
import { certificate } from "../tests/certificates/fixture";

test("issued rabies print renders complete frozen details without network assets", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.setContent(renderVaccineCertificate(certificate, []));
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("heading", {
      name: "Rabies Vaccination Certificate",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Actual administrator", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("2027-09-12", { exact: true })).toBeVisible();
  await expect(
    page.getByText("<script>alert(1)</script>", { exact: true }),
  ).toBeVisible();
  expect(requests).toEqual([]);
  await page.screenshot({
    path: "/tmp/livingroom-rabies-certificate.png",
    fullPage: true,
  });
  const pdf = await page.pdf({ format: "Letter", printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
});

test("corrected certificate prints its invalidation notice and original frozen record", async ({
  page,
}) => {
  await page.setContent(
    renderVaccineCertificate(certificate, [
      {
        id: "event",
        kind: "treatment_corrected",
        reason: "Wrong lot entered",
        created_at: "2026-09-13T00:00:00Z",
        replacement_id: null,
      },
    ]),
  );
  await expect(page.getByRole("alert")).toContainText("INVALIDATED");
  await expect(page.getByRole("alert")).toContainText("Wrong lot entered");
  await expect(page.getByText("LOT-1", { exact: true })).toBeVisible();
});
