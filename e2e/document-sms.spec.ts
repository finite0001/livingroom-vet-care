import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  fixture,
  backend,
  actor,
  client,
  invoice,
  conversation,
} from "./invoice-email-fixture";
const report =
  "<!doctype html><html><body><h1>Frozen text invoice</h1></body></html>";
const digest = createHash("sha256").update(report).digest("hex");
for (const losePreparation of [false, true, "before"] as const)
  test(`lost preparation ${losePreparation}: document text reviews actual frozen bytes and recovers a lost queue receipt without storing capability`, async ({
    page,
    baseURL,
  }) => {
    let saved:
      | import("../src/hub/features/document-links/state").LinkPreparation
      | null = null;
    let request:
      | import("../src/hub/features/document-links/state").LinkIntent
      | null = null;
    let queued = 0;
    const prepareIds: string[] = [];
    let attested = false;
    await fixture(page, baseURL);
    await page.route(`${backend}/**/*document*`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      const earlierId = "77777777-7777-4777-8777-777777777777";
      if (path.endsWith("read_document_link_history"))
        return route.fulfill({
          json: saved
            ? [saved.grant.id, earlierId].map((id) => ({
                id,
                created_at: "2026-09-12T18:00:00Z",
                expires_at: saved!.grant.expires_at,
                state: "reviewed",
                recipient: saved!.grant.recipient,
                receipt_state: "queued",
              }))
            : [],
        });
      if (
        (path.endsWith("recover-document-link") ||
          path.endsWith("recover_document_link")) &&
        route.request().postDataJSON().p_request_id === earlierId &&
        saved
      )
        return route.fulfill({
          json: {
            ...saved,
            grant: { ...saved.grant, id: earlierId },
            receipt: { ...saved.receipt, outbox_id: "earlier-queue" },
          },
        });

      if (
        path.endsWith("recover-document-link") ||
        path.endsWith("recover_document_link")
      )
        return route.fulfill({
          body: JSON.stringify(saved),
          contentType: "application/json",
        });
      if (path.endsWith("preview_document_link"))
        return route.fulfill({
          json: { recipient: "+13035550123", source_hash: "a".repeat(64) },
        });
      if (path.endsWith("prepare-document-link")) {
        request = route.request().postDataJSON();
        prepareIds.push(request!.p_request_id);
        if (losePreparation === "before" && prepareIds.length === 1)
          return route.abort("connectionfailed");
        saved = {
          grant: {
            id: request.p_request_id,
            family: "invoice",
            source_id: invoice,
            client_id: client,
            actor_id: actor,
            conversation_id: conversation,
            recipient: request.p_recipient,
            source_hash: request.p_source_hash,
            message_template: request.p_message_template,
            expires_at: request.p_expires_at,
            state: "captured",
          },
          artifact_hash: "b".repeat(64),
          message_hash: createHash("sha256")
            .update(
              "Documents https://thelivingroom.vet/shared/id#v1." +
                "z".repeat(43),
            )
            .digest("hex"),
          manifest: [
            {
              index: 0,
              filename: "invoice.html",
              mime_type: "text/html",
              file_size: Buffer.byteLength(report),
              sha256: digest,
            },
          ],
          report_html: report,
          receipt: null,
          client_url:
            "https://thelivingroom.vet/shared/id#v1." + "z".repeat(43),
          materialized_message:
            "Documents https://thelivingroom.vet/shared/id#v1." +
            "z".repeat(43),
        };
        return route.fulfill({
          body: JSON.stringify(saved),
          contentType: "application/json",
        });
      }
      if (path.endsWith("read_document_link_artifact"))
        return route.fulfill({
          json: {
            ...saved.manifest[0],
            content: Buffer.from(report).toString("base64"),
          },
        });
      if (path.endsWith("attest_document_link")) {
        attested = true;
        saved.grant.state = "reviewed";
        return route.fulfill({ json: null });
      }
      if (path.endsWith("enqueue_document_link_sms")) {
        expect(attested).toBe(true);
        queued++;
        saved.receipt = {
          outbox_id: "queue-1",
          message_id: "message-1",
          state: "queued",
          queued: true,
          delivered: false,
        };
        return route.abort("connectionfailed");
      }
      return route.fallback();
    });
    const sms = page.getByRole("region", {
      name: "Document text message",
      exact: true,
    });
    await sms
      .getByRole("button", { name: "Recover document text and receipt" })
      .click();
    await expect(sms.getByLabel("Link expiry")).toBeEnabled();
    await sms
      .getByLabel("Link expiry")
      .fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
    await sms
      .getByRole("button", { name: "Prepare exact document text", exact: true })
      .click();
    if (losePreparation === "before") {
      await expect(
        sms.getByRole("button", { name: "Retry same document preparation" }),
      ).toBeEnabled();
      await page.reload();
      await page
        .getByRole("button", { name: /issued.*125.00/ })
        .first()
        .click();
      await sms
        .getByRole("button", { name: "Retry same document preparation" })
        .click();
      expect(new Set(prepareIds).size).toBe(1);
    }
    await expect(sms.getByText("Frozen recipient: +13035550123")).toBeVisible();
    if (losePreparation) {
      await page.reload();
      await page
        .getByRole("button", { name: /issued.*125.00/ })
        .first()
        .click();
      await expect(
        sms.getByText("Frozen recipient: +13035550123"),
      ).toBeVisible();
    }
    await expect(sms.getByRole("checkbox")).toBeDisabled();
    const stored = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(stored).not.toContain("#v1.");
    expect(stored).not.toContain("materialized_message");
    await sms.getByRole("button", { name: "Review invoice.html" }).click();
    await expect(
      sms
        .frameLocator("iframe")
        .getByRole("heading", { name: "Frozen text invoice" }),
    ).toBeVisible();
    await sms.getByRole("checkbox").check();
    await sms
      .getByRole("button", { name: "Queue reviewed document text" })
      .click();
    await expect(sms.getByText(/Saved queue receipt: queue-1/)).toBeVisible();
    expect(queued).toBe(1);
    await sms.getByText("Earlier document texts", { exact: true }).click();
    await sms
      .getByLabel("Saved document text")
      .selectOption("77777777-7777-4777-8777-777777777777");
    await sms
      .getByRole("button", { name: "Review earlier document text" })
      .click();
    await expect(
      sms.getByText(/Saved queue receipt: earlier-queue/),
    ).toBeVisible();

    await sms
      .getByRole("button", { name: "Compose a separate document text" })
      .click();
    await expect(
      sms.getByRole("button", { name: "Recover document text and receipt" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /issued.*125.00/ }).last(),
    ).toBeDisabled();
  });
