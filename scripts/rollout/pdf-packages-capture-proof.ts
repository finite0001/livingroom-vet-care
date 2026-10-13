/** Genuine owned Auth/Storage, admitted native PDF and existing capture RPCs. No provider sends. */
import assert from "node:assert/strict";

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import { buildDocumentLinkArtifacts } from "../../supabase/functions/_shared/document-link-artifacts.ts";
import {
  documentLinkConfig,
  materializeDocumentLink,
} from "../../supabase/functions/_shared/document-link-capability.ts";
import {
  renderRecordRelease,
  type ReleaseBundle,
} from "../../supabase/functions/_shared/record-release-renderer.ts";
interface Input {
  staff: SupabaseClient;
  admin: SupabaseClient;
  actor: string;
  job: string;
  pet: string;
  bytes: Uint8Array;
  sql(query: string): string;
  mode: "current" | "historical";
  project: string;
  url: string;
  anon: string;
  accessToken: string;
}
export async function proveDiagnosticRecordPackages(a: Input) {
  const q = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  let checks = 0;
  const rpc = async (
    db: SupabaseClient,
    name: string,
    args: Record<string, unknown>,
  ) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.code} ${error.message}`);
    return data;
  };
  const denied = async (
    db: SupabaseClient,
    name: string,
    args: Record<string, unknown>,
    code: string,
  ) => {
    const { error } = await db.rpc(name, args);
    assert.equal(error?.code, code);
    checks++;
  };
  const client = JSON.parse(
    a.sql(
      `select jsonb_build_object('id',c.id,'email',c.primary_email,'phone',c.primary_phone) from clients c join pets p on p.client_id=c.id where p.id=${q(a.pet)}`,
    ),
  );
  const originalOutbox = a.sql("select count(*) from communication_outbox");
  assert.equal(a.sql("select count(*) from record_release_policy"), "0");
  assert.equal(
    a.sql("select count(*) from record_request_disclosure_policy"),
    "0",
  );
  const download = async (bucket: string, path: string, size: number) => {
    assert.equal(bucket, "diagnostic-pdfs");
    const { data, error } = await a.admin.storage.from(bucket).download(path);
    if (error) throw error;
    const bytes = new Uint8Array(await data.arrayBuffer());
    assert.equal(bytes.length, size);
    return bytes;
  };
  try {
  a.sql(
    `insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,${q(a.actor)},now(),'Synthetic owned schema14 acceptance',14);insert into record_request_disclosure_policy(id,enabled,accepted_at,reviewer,review_reference) values(true,true,now(),'Synthetic reviewer','Synthetic owned recipient workflow ${a.actor}');`,
  );
    for (const destination of [
      "client_email",
      "third_party_email",
      "client_sms",
    ] as const) {
      const request = randomUUID(),
        manifest = randomUUID(),
        third = destination === "third_party_email",
        channel = destination === "client_sms" ? "SMS" : "EMAIL";
      const saved = await rpc(a.staff, "save_record_request", {
        p_action_id: randomUUID(),
        p_id: request,
        p_expected_version: null,
        p_values: {
          pet_id: a.pet,
          client_id: client.id,
          direction: "outgoing",
          subset: "custom",
          channel,
          recipient_kind: third ? "third_party" : "client",
          recipient_name: third ? "Synthetic referring clinic" : null,
          recipient_email: third ? "synthetic-referral@example.test" : null,
          requester_name: "Synthetic client",
          request_note: "Synthetic exact diagnostic disclosure",
          requested_on: new Date().toISOString().slice(0, 10),
          assigned_to: a.actor,
        },
      });
      const family =
        a.mode === "current"
          ? "diagnostic_pdf_ids"
          : "diagnostic_pdf_historical_ids";
      const prepared = await rpc(a.staff, "prepare_record_request_manifest", {
        p_action_id: randomUUID(),
        p_request_id: request,
        p_expected_version: saved.request.version,
        p_values: {
          manifest_id: manifest,
          selection: { [family]: [a.job] },
          review_note: "Synthetic exact PDF including its embedded history",
        },
      });
      const list = await rpc(a.staff, "list_record_request_packages", {
        p_request_id: request,
        p_manifest_id: manifest,
        p_after: 0,
        p_limit: 20,
      });
      assert.equal(list.items.length, 1);
      checks++;
      const packet = await rpc(a.staff, "read_record_request_package", {
        p_request_id: request,
        p_package_id: list.items[0].id,
      });
      assert.equal(packet.preview.snapshot.schema_version, 14);
      assert.equal(packet.preview.snapshot.attachments.length, 1);
      assert.equal(
        packet.preview.snapshot.diagnostic_pdfs[0].binding.mode,
        a.mode,
      );
      checks += 3;
      let version = prepared.request.version;
      let authorization = "";
      if (third) {
        authorization = randomUUID();
        const allowed = await rpc(
          a.staff,
          "authorize_record_request_recipient",
          {
            p_action_id: randomUUID(),
            p_request_id: request,
            p_expected_version: version,
            p_values: {
              authorization_id: authorization,
              manifest_hash: prepared.fingerprint,
              client_authority: "Synthetic owner authorizes exact selected PDF",
              destination_verification:
                "Synthetic independently verified clinic destination",
              evidence_document_id: null,
              evidence_document_version: null,
              expires_on: new Date(Date.now() + 86400000)
                .toISOString()
                .slice(0, 10),
              attest_client_authority: true,
              attest_destination: true,
              attest_source_scope: true,
            },
          },
        );
        version = allowed.request.version;
      }
      const confirmArgs = {
        p_action_id: randomUUID(),
        p_request_id: request,
        p_expected_version: version,
        p_values: {
          package_id: packet.id,
          manifest_hash: prepared.fingerprint,
          attest_review: true,
          attest_scope_expansion: true,
        },
      };
      const confirmed = await rpc(
        a.staff,
        "confirm_record_request_package",
        confirmArgs,
      );
      assert.deepEqual(
        await rpc(a.staff, "confirm_record_request_package", confirmArgs),
        confirmed,
      );
      checks++;
      const b = (await rpc(a.staff, "read_record_release", {
        p_id: packet.release_id,
      })) as ReleaseBundle;
      assert.equal(b.eligible, true);
      assert.equal(b.package_context?.ordinal, 1);
      checks += 2;
      const html = renderRecordRelease({
        preview: b.release,
        package_context: b.package_context,
      });
      assert.ok(
        html.includes(
          a.mode === "current"
            ? "Current reviewed selection"
            : "Explicit historical selection",
        ),
      );
      checks++;
      const conversation = await rpc(a.staff, "ensure_active_conversation", {
        p_client_id: client.id,
      });
      let captureName: string,
        captureArgs: Record<string, unknown>,
        frozen: string,
        contextName: string,
        contextArgs: Record<string, unknown>;
      let afterCapture = async () => {};
      if (channel === "EMAIL") {
        const email = randomUUID();
        const intent = await rpc(a.staff, "prepare_release_email", {
          p_request_id: email,
          p_release_id: packet.release_id,
          p_conversation_id: conversation.id,
          p_subject: "Synthetic diagnostic records",
          p_body: "Synthetic reviewed original",
          p_release_hash: b.release.source_hash,
        });
        const payload = await buildReleaseEmailPayload(
          intent.request,
          b,
          {
            from: "Synthetic practice <synthetic-practice@example.test>",
            replyTo: "synthetic-practice@example.test",
          },
          download,
        );
        const parsed = JSON.parse(payload.payload_text);
        assert.deepEqual(
          Buffer.from(parsed.attachments[1].content, "base64"),
          Buffer.from(a.bytes),
        );
        assert.deepEqual(parsed.to, [b.release.recipient]);
        checks += 2;
        const changed = JSON.parse(payload.payload_text);
        const altered = new Uint8Array(a.bytes);
        altered[altered.length - 1] ^= 1;
        changed.attachments[1].content =
          Buffer.from(altered).toString("base64");
        captureName = "capture_release_email_payload";
        captureArgs = {
          p_request_id: email,
          p_actor_id: a.actor,
          p_payload_text: payload.payload_text,
        };
        frozen = payload.payload_text;
        contextName = "release_email_capture_context";
        contextArgs = { p_request_id: email, p_actor_id: a.actor };
        await denied(
          a.admin,
          captureName,
          { ...captureArgs, p_payload_text: JSON.stringify(changed) },
          "23514",
        );
        const actual = await fetch(a.url+"/functions/v1/prepare-release-email",{
          method:"POST",headers:{apikey:a.anon,Authorization:"Bearer "+a.accessToken,"Content-Type":"application/json"},
          body:JSON.stringify({p_request_id:email,p_release_id:packet.release_id,p_conversation_id:conversation.id,p_subject:"Synthetic diagnostic records",p_body:"Synthetic reviewed original",p_release_hash:b.release.source_hash})
        });
        const response=await actual.json();
        assert.equal(actual.status,200,JSON.stringify(response));assert.match(response.payload_hash,/^[a-f0-9]{64}$/);checks+=2;
        frozen=a.sql(`select payload_text from release_email_payloads where request_id=${q(email)}`);
        assert.deepEqual(Buffer.from(JSON.parse(frozen).attachments[1].content,"base64"),Buffer.from(a.bytes));checks++;
        captureArgs.p_payload_text=frozen;

      } else {
        await rpc(a.staff, "record_sms_consent", {
          p_actor_id: a.actor,
          p_client_id: client.id,
          p_phone: client.phone,
          p_opted_in: true,
          p_method: "WRITTEN",
          p_details: "Synthetic protected-link consent only",
          p_expected_updated_at:
            a.sql(
              `select coalesce(max(updated_at)::text,'') from sms_consent where client_id=${q(client.id)} and phone_number=${q(client.phone)}`,
            ) || null,
        });
        const linkPreview = await rpc(a.staff, "preview_document_link", {
          p_family: "record_release",
          p_source_id: packet.release_id,
          p_client_id: client.id,
        });
        const link = randomUUID();
        const expires = new Date(Date.now() + 86400000).toISOString();
        await rpc(a.staff, "prepare_document_link", {
          p_request_id: link,
          p_family: "record_release",
          p_source_id: packet.release_id,
          p_client_id: client.id,
          p_conversation_id: conversation.id,
          p_recipient: b.release.recipient,
          p_source_hash: linkPreview.source_hash,
          p_expires_at: expires,
          p_message_template: "Synthetic records: {{document_link}}",
          p_origin: "https://thelivingroom.vet",
          p_key_version: process.env.LRV_SYNTHETIC_LINK_VERSION,
        });
        const context = await rpc(a.admin, "document_link_capture_context", {
          p_id: link,
          p_actor_id: a.actor,
        });
        const config = documentLinkConfig({
          origin: "https://thelivingroom.vet",
          activeKeyVersion: process.env.LRV_SYNTHETIC_LINK_VERSION,
          keys: JSON.stringify({
            [process.env.LRV_SYNTHETIC_LINK_VERSION!]: process.env.LRV_SYNTHETIC_LINK_KEY! ,
          }),
          publicEnabled: "true",
        });
        const capability = await materializeDocumentLink(context.grant, config);
        const artifacts = await buildDocumentLinkArtifacts(
          context.grant,
          { name: "Synthetic", address: "Synthetic", domain: null },
          download,
        );
        const parsed = JSON.parse(artifacts.payload_text);
        assert.deepEqual(
          Buffer.from(parsed.artifacts[1].content, "base64"),
          Buffer.from(a.bytes),
        );
        checks++;
        captureName = "capture_document_link";
        captureArgs = {
          p_id: link,
          p_actor_id: a.actor,
          p_token_hash: capability.token_hash,
          p_message_hash: capability.message_hash,
          p_payload_text: artifacts.payload_text,
        };
        frozen = artifacts.payload_text;
        contextName = "document_link_capture_context";
        contextArgs = { p_id: link, p_actor_id: a.actor };
        afterCapture = async () => {
          await rpc(a.staff, "attest_document_link", {
            p_request_id: link,
            p_reviewed_artifact_hash: artifacts.artifact_hash,
            p_reviewed_message_hash: capability.message_hash,
            p_attest: true,
          });
          contextName = "retrieve_document_link";
          contextArgs = {
            p_id: link,
            p_token_hash: capability.token_hash,
            p_artifact_index: 1,
          };
          const retrieved = await rpc(a.admin, contextName, contextArgs);
          assert.deepEqual(
            Buffer.from(retrieved.content, "base64"),
            Buffer.from(a.bytes),
          );
          checks++;
        };
        const changed = JSON.parse(frozen);
        const altered = new Uint8Array(a.bytes);
        altered[altered.length - 1] ^= 1;
        changed.artifacts[1].content = Buffer.from(altered).toString("base64");
        await denied(
          a.admin,
          captureName,
          { ...captureArgs, p_payload_text: JSON.stringify(changed) },
          "23514",
        );
        const actual = await fetch(a.url+"/functions/v1/prepare-document-link",{
          method:"POST",headers:{apikey:a.anon,Authorization:"Bearer "+a.accessToken,"Content-Type":"application/json"},
          body:JSON.stringify({p_request_id:link,p_family:"record_release",p_source_id:packet.release_id,p_client_id:client.id,p_conversation_id:conversation.id,p_recipient:b.release.recipient,p_source_hash:linkPreview.source_hash,p_expires_at:expires,p_message_template:"Synthetic records: {{document_link}}"})
        });
        const response=await actual.json();assert.equal(actual.status,200,JSON.stringify(response));checks++;
        frozen=a.sql(`select payload_text from document_link_payloads where grant_id=${q(link)}`);
        assert.deepEqual(Buffer.from(JSON.parse(frozen).artifacts[1].content,"base64"),Buffer.from(a.bytes));checks++;
        captureArgs.p_payload_text=frozen;
        artifacts.artifact_hash=a.sql(`select artifact_hash from document_link_payloads where grant_id=${q(link)}`);
        const rpcAfterCapture=afterCapture;
        afterCapture=async()=>{
          await rpcAfterCapture();
          const retrieved=await fetch(a.url+"/functions/v1/retrieve-document-link",{method:"POST",headers:{apikey:a.anon,"Content-Type":"application/json"},body:JSON.stringify({grant_id:link,token:capability.token,artifact_index:1})});
          assert.equal(retrieved.status,200);assert.deepEqual(new Uint8Array(await retrieved.arrayBuffer()),new Uint8Array(a.bytes));checks+=2;
        };


      }
      const capture = await rpc(a.admin, captureName, captureArgs);
      assert.deepEqual(await rpc(a.admin, captureName, captureArgs), capture);
      checks++;
      assert.ok(frozen.length > a.bytes.length);
      checks++;
      await rpc(a.admin, contextName, contextArgs);
      checks++;
      await afterCapture();
      // This freezes bytes only; no enqueue/send. Final current-recipient wrappers still apply.
      if (third) {
        await rpc(a.staff,"revoke_record_request_authorization",{
          p_action_id:randomUUID(),p_request_id:request,p_expected_version:confirmed.request.version,
          p_values:{authorization_id:authorization,review_note:"Synthetic hosted revocation"}
        }); checks++;
      } else
        await rpc(a.staff, "transition_record_request", {
          p_action_id: randomUUID(),
          p_request_id: request,
          p_expected_version: confirmed.request.version,
          p_values: {
            status: "cancelled",
            review_note: "Synthetic cancellation after capture",
          },
        });
      assert.equal(
        (await rpc(a.staff, "read_record_release", { p_id: packet.release_id }))
          .eligible,
        false,
      );
      checks++;
      await denied(a.admin, contextName, contextArgs, "42501");
      assert.deepEqual(
        await rpc(a.staff, "confirm_record_request_package", confirmArgs),
        confirmed,
      );
      checks++;
    }
    assert.equal(
      a.sql("select count(*) from communication_outbox"),
      originalOutbox,
    );
    checks++;
  } finally {
    a.sql(
      `delete from record_release_policy where accepted_by=${q(a.actor)};delete from record_request_disclosure_policy where review_reference='Synthetic owned recipient workflow ${a.actor}';`,
    );
  }
  writeFileSync(
    `tmp/pdf-packages-rollout/${a.project}/record-packages-${a.mode}-proof.json`,
    JSON.stringify(
      {
        checks,
        mode: a.mode,
        genuine_auth: true,
        genuine_private_storage: true,
        native_admitted_pdf: true,
        byte_equality: true,
        sql_capture: true,
        altered_bytes_denied: true,
        numbered_packages: true,
        third_party_revocation: true,
        client_cancellation: true,
        exact_receipt_recovery: true,
        provider_requests: 0,
        hosted_synthetic_writes: true, deployed_email_http: true, deployed_protected_link_http: true, observed_hosted_concurrency: false,
      },
      null,
      2,
    ) + "\n",
  );
  return checks;
}
