import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { EstimateDraft } from "../../src/hub/features/estimates/estimate-api";
import type {
  PublicationPreparation,
  PublicationPrepareRequest,
  PublicationEvent,
  PublicationReceipt,
  PublicationMutation,
  EstimatePublication,
  PublicationTarget,
} from "../../src/hub/features/estimates/publication-api";
import {
  estimatePublicationArtifact,
  type EstimatePublicationSnapshot,
} from "../../supabase/functions/_shared/estimate-publication-document";
export const id = (n: number) =>
  `fa530000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const actor = id(1),
  client = id(2),
  pet = id(3),
  estimate = id(4),
  hash = "a".repeat(64),
  time = "2026-09-16T12:00:00.000Z";
export async function publicationFixture(page: Page) {
  const state = {
    actor,
    client,
    losePrepare: false,
    loseMutation: false,
    neverMutation: false,
    loseClose: false,
    holdMutation: false,
    releaseMutation: () => {},
    mutations: [] as { id: string; mutation: PublicationMutation }[],
    prepares: [] as { id: string; request: PublicationPrepareRequest }[],
    closes: [] as { id: string; mutation: PublicationMutation }[],
    downloads: [] as string[],
  };
  const drafts = new Map<string, EstimateDraft>(),
    preparations = new Map<string, PublicationPreparation>(),
    htmls = new Map<string, string>(),
    events: PublicationEvent[] = [],
    receipts = new Map<string, PublicationReceipt>(),
    closures = new Map<string, unknown>();
  function draft(c = client): EstimateDraft {
    return {
      id: c === client ? estimate : id(44),
      client_id: c,
      pet_id: c === client ? pet : id(33),
      version: 1,
      fields: {
        title:
          c === client ? "Housecall care proposal" : "Other household proposal",
        notes: "Discuss comfort during the visit.",
        terms:
          "Contact the practice before any scope change.\nNo clinical consent or payment is recorded.",
        accept_by: "2026-10-31",
        lines: [
          {
            id: id(5),
            product_id: id(6),
            product_version: 1,
            description: "Partial consultation",
            kind: "service",
            unit: "visit",
            quantity: "0.5",
            pricing: { kind: "allocated", amount_cents: "1250" },
            pricing_reason: "Agreed partial consultation allocation",
          },
        ],
      },
      total_cents: "1250",
      created_by: actor,
      created_at: time,
      updated_by: actor,
      updated_at: time,
    };
  }
  drafts.set(client, draft());
  drafts.set(id(22), draft(id(22)));
  const target = (d: EstimateDraft): PublicationTarget => ({
    estimate_id: d.id,
    client_id: d.client_id,
    pet_id: d.pet_id,
  });
  const head = () =>
    events.length
      ? {
          event_id: events.at(-1)!.id,
          version: events.length,
          record_hash: events.at(-1)!.record_hash,
        }
      : { event_id: null, version: 0, record_hash: null };
  const current = () =>
    events.at(-1)?.kind === "published" ? events.at(-1)!.publication : null;
  const latest = () =>
    [...events].reverse().find((e) => e.kind === "published")?.publication ??
    null;
  function context(d: EstimateDraft) {
    return {
      target: target(d),
      draft: structuredClone(d),
      draft_record_hash: hash,
      publication_head: head(),
      current_publication_id: current()?.id ?? null,
      practice: {
        version: 1 as const,
        name: "The Living Room Veterinary Care" as const,
        address: "2619 Spruce Street, Boulder, CO" as const,
        domain: "thelivingroom.vet" as const,
      },
      client: {
        id: d.client_id,
        version: 1,
        name:
          d.client_id === client ? "Synthetic household" : "Other household",
        mailing_address: null,
      },
      patient: {
        id: d.pet_id,
        version: 1,
        name: d.client_id === client ? "Juniper" : "Willow",
        species: "Dog",
        breed: null,
      },
    };
  }
  function session(actorId: string) {
    const exp = Math.floor(Date.now() / 1000) + 3600,
      user = {
        id: actorId,
        aud: "authenticated",
        role: "authenticated",
        email: "synthetic@example.test",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        created_at: time,
      };
    return {
      access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actorId, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.${Buffer.from("synthetic-signature").toString("base64url")}`,
      refresh_token: "synthetic-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: exp,
      user,
    };
  }
  await page.addInitScript((s) => {
    if (!localStorage.getItem("sb-127-auth-token"))
      localStorage.setItem("sb-127-auth-token", JSON.stringify(s));
  }, session(actor));
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = new URL(route.request().url()),
      name = url.pathname.split("/").at(-1)!;
    let value: unknown;
    if (url.pathname.includes("/auth/")) {
      await route.fulfill({
        json:
          name === "user" ? session(state.actor).user : session(state.actor),
      });
      return;
    }
    if (
      !url.pathname.includes("/rpc/") &&
      !url.pathname.includes("/functions/")
    ) {
      value =
        name === "profiles"
          ? {
              id: state.actor,
              first_name: "Synthetic",
              last_name: "Staff",
              full_name: "Synthetic Staff",
              role: "STAFF",
              is_active: true,
            }
          : name === "user_roles"
            ? [{ role: "STAFF" }]
            : name === "pets"
              ? [
                  {
                    id: state.client === client ? pet : id(33),
                    name: state.client === client ? "Juniper" : "Willow",
                  },
                ]
              : name === "catalog_products"
                ? [
                    {
                      id: id(6),
                      name: "Consultation",
                      kind: "service",
                      unit: "visit",
                      unit_price_cents: 2500,
                      active: true,
                      version: 1,
                    },
                  ]
                : [];
      await route.fulfill({ json: value });
      return;
    }
    const a = route.request().postDataJSON();
    const d = drafts.get(a.p_client_id ?? state.client) ?? draft();
    if (name === "list_native_estimate_drafts")
      value = {
        version: 1,
        actor_id: state.actor,
        client_id: d.client_id,
        drafts: [d],
        has_more: false,
        next_cursor: null,
      };
    else if (name === "read_native_estimate_draft")
      value = { version: 1, actor_id: state.actor, draft: d };
    else if (name === "read_native_estimate_decision_state")
      value = {
        version: 1, target: target(d), publication_head: head(),
        decision_head: { event_id: null, version: 0, record_hash: null },
        current_publication_id: current()?.id ?? null, current_decision: null,
      };
    else if (name === "read_native_estimate_decisions")
      value = {
        version: 1, target: target(d),
        head: { event_id: null, version: 0, record_hash: null },
        items: [], next_before_sequence: null, has_more: false,
      };
    else if (name === "read_native_estimate_publication")
      value = {
        version: 1,
        actor_id: state.actor,
        target: target(d),
        head: head(),
        current: current(),
        current_status: !events.length
          ? "none"
          : current()
            ? "open"
            : "withdrawn",
        latest_publication: latest(),
      };
    else if (name === "read_native_estimate_publication_history") {
      const rows = [...events]
          .reverse()
          .filter(
            (e) =>
              a.p_before_version === null || e.version < a.p_before_version,
          ),
        selected = rows.slice(0, a.p_limit);
      value = {
        version: 1,
        actor_id: state.actor,
        target: target(d),
        head: head(),
        events: selected,
        has_more: rows.length > a.p_limit,
        next_before_version:
          rows.length > a.p_limit ? selected.at(-1)!.version : null,
      };
    } else if (name === "preview_native_estimate_publication")
      value = {
        version: 1,
        actor_id: state.actor,
        context: context(d),
        source_hash: hash,
      };
    else if (name === "prepare-estimate-publication") {
      state.prepares.push(a);
      if (!preparations.has(a.id)) {
        const c = context(d),
          s: EstimatePublicationSnapshot = {
            schema_version: 1,
            preparation_id: a.id,
            prepared_at: time,
            target: target(d),
            draft_version: d.version,
            draft_record_hash: hash,
            practice: c.practice,
            client: c.client,
            patient: c.patient,
            title: d.fields.title,
            notes: d.fields.notes,
            terms: d.fields.terms,
            lines: d.fields.lines.map((line) => ({
              line,
              amount_cents: "1250",
            })),
            total_cents: "1250",
            currency: "usd",
            acceptance: {
              accept_by: d.fields.accept_by,
              timezone: "America/Denver",
              expires_at: "2026-11-01T06:00:00Z",
              acknowledgment_version: 1,
              scope: "entire_exact_revision",
              price_validity: "accepted_quantities",
              not_clinical_consent: true,
              not_payment: true,
            },
          },
          rendered = await estimatePublicationArtifact(s);
        preparations.set(a.id, {
          version: 1,
          id: a.id,
          actor_id: state.actor,
          request: a.request,
          request_hash: hash,
          context: c,
          source_hash: hash,
          snapshot: s,
          content_hash: hash,
          artifact: rendered.artifact,
          created_at: time,
        });
        htmls.set(a.id, rendered.html);
      }
      if (state.losePrepare) {
        await route.abort("failed");
        return;
      }
      value = { version: 1, preparation: preparations.get(a.id) };
    } else if (name === "recover-estimate-publication-preparation")
      value = { version: 1, preparation: preparations.get(a.id) ?? null };
    else if (name === "read-estimate-publication-artifact") {
      state.downloads.push(a.preparation_id);
      const p = preparations.get(a.preparation_id)!;
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": p.artifact!.mime_type,
          "Content-Disposition": `attachment; filename="${p.artifact!.filename}"`,
          "Cache-Control": "no-store, private",
          "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
        },
        body: htmls.get(a.preparation_id)!,
      });
      return;
    } else if (
      name === "publish_native_estimate" ||
      name === "withdraw_native_estimate"
    ) {
      const m: PublicationMutation =
        name === "publish_native_estimate"
          ? { kind: "publish", request: a.p_request }
          : { kind: "withdraw", request: a.p_request };
      state.mutations.push({ id: a.p_id, mutation: m });
      if (state.neverMutation) {
        await route.abort("failed");
        return;
      }
      if (!receipts.has(a.p_id)) {
        const stamp = new Date(
          Date.parse(time) + (events.length + 1) * 1000,
        ).toISOString();
        let p: EstimatePublication | null = null;
        if (m.kind === "publish") {
          const prepared = preparations.get(m.request.preparation_id)!;
          p = {
            id: a.p_id,
            target: target(d),
            preparation_id: prepared.id,
            draft_version: prepared.snapshot.draft_version,
            draft_record_hash: hash,
            content_hash: hash,
            artifact: prepared.artifact!,
            accept_by: prepared.snapshot.acceptance.accept_by,
            expires_at: prepared.snapshot.acceptance.expires_at,
            published_by: state.actor,
            published_at: stamp,
            replaces_publication_id: m.request.replaces_publication_id,
          };
        }
        const e: PublicationEvent = {
          id: a.p_id,
          target: target(d),
          version: events.length + 1,
          previous_hash: head().record_hash,
          kind: p ? "published" : "withdrawn",
          actor_id: state.actor,
          created_at: stamp,
          publication_id: p ? p.id : a.p_request.publication_id,
          publication: p,
          reason: p ? null : a.p_request.reason,
          record_hash: hash,
        };
        events.push(e);
        receipts.set(a.p_id, {
          version: 1,
          id: a.p_id,
          actor_id: state.actor,
          mutation: m,
          request_hash: hash,
          result: e,
          created_at: stamp,
        });
      }
      if (state.holdMutation)
        await new Promise<void>((resolve) => {
          state.releaseMutation = resolve;
        });
      if (state.loseMutation) {
        await route.abort("failed");
        return;
      }
      value = receipts.get(a.p_id);
    } else if (name === "recover_native_estimate_publication_operation")
      value = receipts.get(a.p_id) ?? null;
    else if (name === "close_native_estimate_publication_operation") {
      state.closes.push({ id: a.p_id, mutation: a.p_mutation });
      if (receipts.has(a.p_id))
        value = {
          version: 1,
          status: "recorded",
          receipt: receipts.get(a.p_id),
        };
      else {
        if (!closures.has(a.p_id))
          closures.set(a.p_id, {
            version: 1,
            status: "closed_unrecorded",
            closure: {
              version: 1,
              id: a.p_id,
              actor_id: state.actor,
              mutation: a.p_mutation,
              request_hash: hash,
              closed_at: time,
              record_hash: hash,
            },
          });
        value = closures.get(a.p_id);
      }
      if (state.loseClose) {
        await route.abort("failed");
        return;
      }
    } else if (name === "read_native_estimate_published_revision") {
      const p = events.find(
          (e) => e.publication?.id === a.p_publication_id,
        )!.publication!,
        preparation = preparations.get(p.preparation_id)!;
      value = {
        version: 1,
        actor_id: state.actor,
        publication: p,
        snapshot: preparation.snapshot,
        head: head(),
        status:
          current()?.id === p.id
            ? "open"
            : latest()?.id === p.id
              ? "withdrawn"
              : "superseded",
      };
    } else value = null;
    await route.fulfill({ json: value });
  });
  async function mount(c = client) {
    state.client = c;
    await page.goto("/");
    await page.evaluate(async (c) => {
      const h = await import(
        "/tests/estimates/publication-browser-harness.tsx"
      );
      h.mountEstimatePublication(c);
    }, c);
    await expect(
      page.getByRole("button", {
        name: `${drafts.get(c)!.fields.title} · revision 1 · $12.50`,
      }),
    ).toBeVisible({ timeout: 30000 });
    await page
      .getByRole("button", {
        name: `${drafts.get(c)!.fields.title} · revision 1 · $12.50`,
      })
      .click();
    await page
      .getByRole("button", { name: "Review publication and history" })
      .click();
    await expect(
      page.getByRole("region", { name: "Estimate publication", exact: true }),
    ).toBeVisible();
  }
  async function switchHousehold(c: string) {
    state.client = c;
    await page.evaluate(async (c) => {
      const h = await import(
        "/tests/estimates/publication-browser-harness.tsx"
      );
      h.mountEstimatePublication(c);
    }, c);
  }
  async function switchActor(actorId: string) {
    state.actor = actorId;
    await page.evaluate(async (token) => {
      const h = await import(
        "/tests/estimates/publication-browser-harness.tsx"
      );
      await h.changePublicationStaff(token);
    }, session(actorId).access_token);
  }
  await mount();
  return {
    state,
    drafts,
    events,
    preparations,
    htmls,
    mount,
    switchHousehold,
    switchActor,
  };
}
