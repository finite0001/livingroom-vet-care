import { z } from "zod";
import type { PrescriptionRpc } from "../prescriptions/prescription-api.ts";
import { correctionEqual as equal } from "../prescriptions/fulfillment-corrections-api.ts";
import {
  estimateFieldsSchema,
  estimateTotalCents,
  type EstimateDraft,
} from "./estimate-api.ts";
import {
  estimatePublicationSnapshotSchema,
  estimatePublicationFilename,
  type EstimatePublicationSnapshot,
  type EstimatePublicationArtifact,
} from "../../../../supabase/functions/_shared/estimate-publication-document.ts";
export interface PublicationTarget {
  estimate_id: string;
  client_id: string;
  pet_id: string;
}
export interface PublicationHead {
  event_id: string | null;
  version: number;
  record_hash: string | null;
}
export interface PublicationContext {
  target: PublicationTarget;
  draft: EstimateDraft;
  draft_record_hash: string;
  publication_head: PublicationHead;
  current_publication_id: string | null;
  practice: EstimatePublicationSnapshot["practice"];
  client: EstimatePublicationSnapshot["client"];
  patient: EstimatePublicationSnapshot["patient"];
}
export interface PublicationPreview {
  version: 1;
  actor_id: string;
  context: PublicationContext;
  source_hash: string;
}
export interface PublicationPrepareRequest {
  target: PublicationTarget;
  draft_version: number;
  expected_source_hash: string;
  expected_publication_head: PublicationHead;
  replaces_publication_id: string | null;
}
export interface PublicationPrepareOperation {
  id: string;
  request: PublicationPrepareRequest;
}
export interface PublicationPreparation {
  version: 1;
  id: string;
  actor_id: string;
  request: PublicationPrepareRequest;
  request_hash: string;
  context: PublicationContext;
  source_hash: string;
  snapshot: EstimatePublicationSnapshot;
  content_hash: string;
  artifact: EstimatePublicationArtifact | null;
  created_at: string;
}
export interface PublishEstimateRequest {
  target: PublicationTarget;
  preparation_id: string;
  expected_draft_version: number;
  expected_publication_head: PublicationHead;
  expected_content_hash: string;
  expected_artifact_hash: string;
  replaces_publication_id: string | null;
  attest_document_review: true;
  attest_pricing_review: true;
  attest_terms_review: true;
}
export interface WithdrawEstimateRequest {
  target: PublicationTarget;
  publication_id: string;
  expected_publication_head: PublicationHead;
  reason: string;
  attest_review: true;
}
export interface PublishMutation {
  kind: "publish";
  request: PublishEstimateRequest;
}
export interface WithdrawMutation {
  kind: "withdraw";
  request: WithdrawEstimateRequest;
}
export type PublicationMutation = PublishMutation | WithdrawMutation;
export interface PublicationOperation {
  id: string;
  kind: "record_estimate_publication";
  payload: PublicationMutation;
}
export interface EstimatePublication {
  id: string;
  target: PublicationTarget;
  preparation_id: string;
  draft_version: number;
  draft_record_hash: string;
  content_hash: string;
  artifact: EstimatePublicationArtifact;
  accept_by: string;
  expires_at: string;
  published_by: string;
  published_at: string;
  replaces_publication_id: string | null;
}
export interface PublicationEvent {
  id: string;
  target: PublicationTarget;
  version: number;
  previous_hash: string | null;
  kind: "published" | "withdrawn";
  actor_id: string;
  created_at: string;
  publication_id: string;
  publication: EstimatePublication | null;
  reason: string | null;
  record_hash: string;
}
export interface PublicationReceipt {
  version: 1;
  id: string;
  actor_id: string;
  mutation: PublicationMutation;
  request_hash: string;
  result: PublicationEvent;
  created_at: string;
}
export interface PublicationClosure {
  version: 1;
  id: string;
  actor_id: string;
  mutation: PublicationMutation;
  request_hash: string;
  closed_at: string;
  record_hash: string;
}
export interface PublicationRecordedResolution {
  version: 1;
  status: "recorded";
  receipt: PublicationReceipt;
}
export interface PublicationClosedResolution {
  version: 1;
  status: "closed_unrecorded";
  closure: PublicationClosure;
}
export type PublicationCloseResult =
  | PublicationRecordedResolution
  | PublicationClosedResolution;
export interface PublicationCurrent {
  version: 1;
  actor_id: string;
  target: PublicationTarget;
  head: PublicationHead;
  current: EstimatePublication | null;
  current_status: "none" | "open" | "expired" | "withdrawn";
  latest_publication: EstimatePublication | null;
}
export interface PublicationHistory {
  version: 1;
  actor_id: string;
  target: PublicationTarget;
  head: PublicationHead;
  events: PublicationEvent[];
  has_more: boolean;
  next_before_version: number | null;
}
export interface PublishedEstimateRead {
  version: 1;
  actor_id: string;
  publication: EstimatePublication;
  snapshot: EstimatePublicationSnapshot;
  head: PublicationHead;
  status: "open" | "expired" | "withdrawn" | "superseded";
}
export interface PublicationArtifactRequest {
  preparation_id: string;
  client_id: string;
  expected_artifact_hash: string;
}
export interface EstimatePublicationEdge {
  json(
    name:
      | "prepare-estimate-publication"
      | "recover-estimate-publication-preparation",
    body: unknown,
  ): Promise<unknown>;
  artifact(body: PublicationArtifactRequest): Promise<Response>;
}
const uuid = z
    .string()
    .uuid()
    .refine((v) => v === v.toLowerCase()),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  revision = z.number().int().min(1).max(2147483647),
  instant = z
    .string()
    .datetime({ offset: true })
    .refine((v) => Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
const shape = estimatePublicationSnapshotSchema.innerType().shape,
  target = shape.target;
const reason = z.string().refine(
  (v) =>
    v === v.trim() &&
    Array.from(v).length >= 1 &&
    Array.from(v).length <= 2000 &&
    !Array.from(v).some((c) => {
      const n = c.charCodeAt(0);
      return n === 127 || (n < 32 && n !== 9 && n !== 10);
    }) &&
    !/[\uD800-\uDFFF]/u.test(v),
);
const head = z
  .object({
    event_id: uuid.nullable(),
    version: z.number().int().min(0).max(2147483647),
    record_hash: hash.nullable(),
  })
  .strict()
  .refine((h) =>
    h.version === 0
      ? h.event_id === null && h.record_hash === null
      : h.event_id !== null && h.record_hash !== null,
  );
const draft = z
  .object({
    id: uuid,
    client_id: uuid,
    pet_id: uuid,
    version: revision,
    fields: estimateFieldsSchema,
    total_cents: shape.total_cents,
    created_by: uuid,
    created_at: instant,
    updated_by: uuid,
    updated_at: instant,
  })
  .strict();
const context = z
  .object({
    target,
    draft,
    draft_record_hash: hash,
    publication_head: head,
    current_publication_id: uuid.nullable(),
    practice: shape.practice,
    client: shape.client,
    patient: shape.patient,
  })
  .strict();
export const publicationPrepareRequestSchema = z
  .object({
    target,
    draft_version: revision,
    expected_source_hash: hash,
    expected_publication_head: head,
    replaces_publication_id: uuid.nullable(),
  })
  .strict();
const artifact = z
  .object({
    filename: z.string(),
    mime_type: z.literal("text/html; charset=utf-8"),
    byte_length: z.number().int().min(1).max(2097152),
    sha256: hash,
    renderer_version: z.literal(1),
  })
  .strict();
const preparation = z
  .object({
    version: z.literal(1),
    id: uuid,
    actor_id: uuid,
    request: publicationPrepareRequestSchema,
    request_hash: hash,
    context,
    source_hash: hash,
    snapshot: estimatePublicationSnapshotSchema,
    content_hash: hash,
    artifact: artifact.nullable(),
    created_at: instant,
  })
  .strict();
export const publishEstimateRequestSchema = z
  .object({
    target,
    preparation_id: uuid,
    expected_draft_version: revision,
    expected_publication_head: head,
    expected_content_hash: hash,
    expected_artifact_hash: hash,
    replaces_publication_id: uuid.nullable(),
    attest_document_review: z.literal(true),
    attest_pricing_review: z.literal(true),
    attest_terms_review: z.literal(true),
  })
  .strict();
export const withdrawEstimateRequestSchema = z
  .object({
    target,
    publication_id: uuid,
    expected_publication_head: head,
    reason,
    attest_review: z.literal(true),
  })
  .strict();
const mutation = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("publish"),
      request: publishEstimateRequestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("withdraw"),
      request: withdrawEstimateRequestSchema,
    })
    .strict(),
]);
const publication = z
  .object({
    id: uuid,
    target,
    preparation_id: uuid,
    draft_version: revision,
    draft_record_hash: hash,
    content_hash: hash,
    artifact,
    accept_by: shape.acceptance.shape.accept_by,
    expires_at: instant,
    published_by: uuid,
    published_at: instant,
    replaces_publication_id: uuid.nullable(),
  })
  .strict();
const event = z
  .object({
    id: uuid,
    target,
    version: revision,
    previous_hash: hash.nullable(),
    kind: z.enum(["published", "withdrawn"]),
    actor_id: uuid,
    created_at: instant,
    publication_id: uuid,
    publication: publication.nullable(),
    reason: reason.nullable(),
    record_hash: hash,
  })
  .strict();
const receipt = z
  .object({
    version: z.literal(1),
    id: uuid,
    actor_id: uuid,
    mutation,
    request_hash: hash,
    result: event,
    created_at: instant,
  })
  .strict();
const closure = z
  .object({
    version: z.literal(1),
    id: uuid,
    actor_id: uuid,
    mutation,
    request_hash: hash,
    closed_at: instant,
    record_hash: hash,
  })
  .strict();
const resolution = z.discriminatedUnion("status", [
  z
    .object({ version: z.literal(1), status: z.literal("recorded"), receipt })
    .strict(),
  z
    .object({
      version: z.literal(1),
      status: z.literal("closed_unrecorded"),
      closure,
    })
    .strict(),
]);
const operation = z
  .object({
    id: uuid,
    kind: z.literal("record_estimate_publication"),
    payload: mutation,
  })
  .strict();
const current = z
  .object({
    version: z.literal(1),
    actor_id: uuid,
    target,
    head,
    current: publication.nullable(),
    current_status: z.enum(["none", "open", "expired", "withdrawn"]),
    latest_publication: publication.nullable(),
  })
  .strict();
const history = z
  .object({
    version: z.literal(1),
    actor_id: uuid,
    target,
    head,
    events: z.array(event),
    has_more: z.boolean(),
    next_before_version: revision.nullable(),
  })
  .strict();
const published = z
  .object({
    version: z.literal(1),
    actor_id: uuid,
    publication,
    snapshot: estimatePublicationSnapshotSchema,
    head,
    status: z.enum(["open", "expired", "withdrawn", "superseded"]),
  })
  .strict();
function check(value: unknown): asserts value {
  if (!value)
    throw new Error(
      "Estimate publication evidence differs from the exact household, revision or reviewed request.",
    );
}
function micros(v: string) {
  const f = v.match(/\.(\d+)/)?.[1] ?? "";
  return BigInt(Date.parse(v)) * 1000n + BigInt(f.padEnd(6, "0").slice(3, 6));
}
const filename = (estimateId: string, version: number, preparationId: string) =>
  `estimate-${estimateId}-draft-${version}-publication-${preparationId}.html`;
async function limited(response: Response, limit: number) {
  check(response.body);
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Estimate response exceeds its expected size.");
      }
      chunks.push(r.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export function createEstimatePublicationEdge(
  baseUrl: string,
  getAccessToken: () => Promise<string | null>,
  publishableKey: string,
  fetcher: typeof fetch = fetch,
): EstimatePublicationEdge {
  check(publishableKey.length > 0);
  const origin = new URL(baseUrl);
  check(
    origin.origin === baseUrl &&
      (origin.protocol === "https:" ||
        (origin.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(origin.hostname))),
  );
  async function post(name: string, body: unknown) {
    const token = await getAccessToken();
    check(token);
    const response = await fetcher(`${baseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        "Estimate publication request could not be verified. Recover the original request before replacing it.",
      );
    return response;
  }
  return {
    async json(name, body) {
      const response = await post(name, body);
      check(
        response.headers.get("Content-Type")?.split(";")[0].trim() ===
          "application/json",
      );
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await limited(response, 2097152),
        ),
      );
    },
    artifact(body) {
      return post("read-estimate-publication-artifact", body);
    },
  };
}
export function createEstimatePublicationApi(
  db: PrescriptionRpc,
  actorId: string,
  t: PublicationTarget,
  edge: EstimatePublicationEdge,
) {
  uuid.parse(actorId);
  target.parse(t);
  const previews = new Map<string, PublicationContext>(),
    prepared = new Map<string, PublicationPreparation>();
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw error;
    return data;
  }
  function validateContext(c: PublicationContext) {
    check(
      equal(c.target, t) &&
        c.draft.id === t.estimate_id &&
        c.draft.client_id === t.client_id &&
        c.draft.pet_id === t.pet_id &&
        c.client.id === t.client_id &&
        c.patient.id === t.pet_id &&
        c.draft.total_cents === estimateTotalCents(c.draft.fields.lines) &&
        micros(c.draft.created_at) <= micros(c.draft.updated_at),
    );
    check(
      c.publication_head.version !== 0 || c.current_publication_id === null,
    );
  }
  function validatePreparation(
    value: unknown,
    id: string,
    request?: PublicationPrepareRequest,
  ): PublicationPreparation {
    const p = preparation.parse(value) as PublicationPreparation;
    validateContext(p.context);
    const s = p.snapshot,
      c = p.context,
      q = p.request;
    check(
      p.id === id &&
        p.actor_id === actorId &&
        (!request || equal(q, request)) &&
        equal(q.target, t) &&
        equal(s.target, t) &&
        s.preparation_id === id &&
        micros(s.prepared_at) === micros(p.created_at) &&
        p.source_hash === q.expected_source_hash &&
        q.draft_version === c.draft.version &&
        s.draft_version === q.draft_version &&
        equal(q.expected_publication_head, c.publication_head) &&
        q.replaces_publication_id === c.current_publication_id &&
        s.draft_record_hash === c.draft_record_hash &&
        equal(s.practice, c.practice) &&
        equal(s.client, c.client) &&
        equal(s.patient, c.patient) &&
        s.title === c.draft.fields.title &&
        s.notes === c.draft.fields.notes &&
        s.terms === c.draft.fields.terms &&
        s.acceptance.accept_by === c.draft.fields.accept_by &&
        s.total_cents === c.draft.total_cents &&
        equal(
          s.lines.map((l) => l.line),
          c.draft.fields.lines,
        ) &&
        (!p.artifact || p.artifact.filename === estimatePublicationFilename(s)),
    );
    const preview = previews.get(p.source_hash);
    if (preview) check(equal(c, preview));
    const prior = prepared.get(id);
    if (prior)
      check(
        equal({ ...p, artifact: null }, { ...prior, artifact: null }) &&
          (!prior.artifact || equal(p.artifact, prior.artifact)),
      );
    prepared.set(id, p);
    return p;
  }
  function validatePublication(p: EstimatePublication) {
    const expectedDay = new Date(
      Date.parse(`${p.accept_by}T00:00:00Z`) + 86400000,
    )
      .toISOString()
      .slice(0, 10);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Denver",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(p.expires_at))
        .map((part) => [part.type, part.value]),
    );
    check(
      `${parts.year}-${parts.month}-${parts.day}` === expectedDay &&
        parts.hour === "00" &&
        parts.minute === "00" &&
        parts.second === "00" &&
        micros(p.expires_at) % 1000000n === 0n,
    );

    check(
      equal(p.target, t) &&
        p.artifact.filename ===
          filename(t.estimate_id, p.draft_version, p.preparation_id) &&
        p.replaces_publication_id !== p.id &&
        micros(p.published_at) < micros(p.expires_at),
    );
    const known = prepared.get(p.preparation_id);
    if (known)
      check(
        equal(p.artifact, known.artifact) &&
          p.content_hash === known.content_hash &&
          p.draft_record_hash === known.snapshot.draft_record_hash &&
          p.draft_version === known.snapshot.draft_version &&
          p.accept_by === known.snapshot.acceptance.accept_by &&
          micros(p.expires_at) ===
            micros(known.snapshot.acceptance.expires_at) &&
          p.published_by === known.actor_id,
      );
  }
  function validateEvent(e: PublicationEvent) {
    check(
      equal(e.target, t) &&
        (e.version === 1 ? e.previous_hash === null : e.previous_hash !== null),
    );
    if (e.kind === "published") {
      check(e.publication && e.reason === null);
      validatePublication(e.publication);
      check(
        e.publication.id === e.id &&
          e.publication_id === e.id &&
          e.publication.published_by === e.actor_id &&
          micros(e.publication.published_at) === micros(e.created_at),
      );
    } else check(e.publication === null && e.reason !== null && e.version > 1);
    if (e.version === 1 && e.publication)
      check(e.publication.replaces_publication_id === null);
  }
  function parseOperation(value: unknown): PublicationOperation {
    const op = operation.parse(value) as PublicationOperation;
    check(equal(op.payload.request.target, t));
    return op;
  }
  function parseReceipt(
    value: unknown,
    op: PublicationOperation,
  ): PublicationReceipt {
    const r = receipt.parse(value) as PublicationReceipt,
      e = r.result,
      q = op.payload.request;
    validateEvent(e);
    check(
      r.id === op.id &&
        r.actor_id === actorId &&
        equal(r.mutation, op.payload) &&
        e.id === op.id &&
        e.actor_id === actorId &&
        micros(e.created_at) === micros(r.created_at) &&
        e.version === q.expected_publication_head.version + 1 &&
        e.previous_hash === q.expected_publication_head.record_hash,
    );
    if (op.payload.kind === "publish") {
      const q = op.payload.request,
        p = e.publication;
      check(
        e.kind === "published" &&
          p &&
          p.preparation_id === q.preparation_id &&
          p.draft_version === q.expected_draft_version &&
          p.content_hash === q.expected_content_hash &&
          p.artifact.sha256 === q.expected_artifact_hash &&
          p.replaces_publication_id === q.replaces_publication_id,
      );
    } else
      check(
        e.kind === "withdrawn" &&
          e.publication_id === op.payload.request.publication_id &&
          e.reason === op.payload.request.reason,
      );
    return r;
  }
  return {
    parseOperation,
    async preview(draftVersion: number): Promise<PublicationPreview> {
      revision.parse(draftVersion);
      const r = z
        .object({
          version: z.literal(1),
          actor_id: uuid,
          context,
          source_hash: hash,
        })
        .strict()
        .parse(
          await rpc("preview_native_estimate_publication", {
            p_estimate_id: t.estimate_id,
            p_client_id: t.client_id,
            p_draft_version: draftVersion,
          }),
        ) as PublicationPreview;
      check(r.actor_id === actorId && r.context.draft.version === draftVersion);
      validateContext(r.context);
      previews.set(r.source_hash, r.context);
      return r;
    },
    async prepare(input: PublicationPrepareOperation) {
      const q = z
        .object({ id: uuid, request: publicationPrepareRequestSchema })
        .strict()
        .parse(input) as PublicationPrepareOperation;
      check(equal(q.request.target, t));
      const r = z
        .object({ version: z.literal(1), preparation })
        .strict()
        .parse(await edge.json("prepare-estimate-publication", q));
      const p = validatePreparation(r.preparation, q.id, q.request);
      check(p.artifact);
      return p;
    },
    async recoverPreparation(
      id: string,
      expectedRequest?: PublicationPrepareRequest,
    ) {
      uuid.parse(id);
      if (expectedRequest) {
        publicationPrepareRequestSchema.parse(expectedRequest);
        check(equal(expectedRequest.target, t));
      }
      const r = z
        .object({ version: z.literal(1), preparation: preparation.nullable() })
        .strict()
        .parse(
          await edge.json("recover-estimate-publication-preparation", { id }),
        );
      if (r.preparation === null) return null;
      const p = validatePreparation(r.preparation, id, expectedRequest);
      check(p.artifact);
      return p;
    },
    async download(
      preparationId: string,
      expected: EstimatePublicationArtifact,
    ) {
      uuid.parse(preparationId);
      artifact.parse(expected);
      check(
        new RegExp(
          `^estimate-${t.estimate_id}-draft-[1-9][0-9]*-publication-${preparationId}\\.html$`,
        ).test(expected.filename),
      );
      const known = prepared.get(preparationId);
      if (known) check(equal(expected, known.artifact));
      const response = await edge.artifact({
        preparation_id: preparationId,
        client_id: t.client_id,
        expected_artifact_hash: expected.sha256,
      });
      check(
        response.ok &&
          response.headers.get("Content-Type") === expected.mime_type &&
          response.headers.get("Content-Disposition") ===
            `attachment; filename="${expected.filename}"`,
      );
      const bytes = await limited(response, expected.byte_length);
      check(bytes.length === expected.byte_length);
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      check(digest === expected.sha256);
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return new Blob([bytes], { type: expected.mime_type });
    },
    async execute(value: PublicationOperation) {
      const op = parseOperation(value);
      return parseReceipt(
        await rpc(
          op.payload.kind === "publish"
            ? "publish_native_estimate"
            : "withdraw_native_estimate",
          { p_id: op.id, p_request: op.payload.request },
        ),
        op,
      );
    },
    async recover(value: PublicationOperation) {
      const op = parseOperation(value),
        r = await rpc("recover_native_estimate_publication_operation", {
          p_id: op.id,
        });
      return r === null ? null : parseReceipt(r, op);
    },
    async close(value: PublicationOperation): Promise<PublicationCloseResult> {
      const op = parseOperation(value),
        r = resolution.parse(
          await rpc("close_native_estimate_publication_operation", {
            p_id: op.id,
            p_mutation: op.payload,
          }),
        );
      if (r.status === "recorded")
        return {
          version: 1,
          status: "recorded",
          receipt: parseReceipt(r.receipt, op),
        };
      check(
        r.closure.id === op.id &&
          r.closure.actor_id === actorId &&
          equal(r.closure.mutation, op.payload),
      );
      return r as PublicationClosedResolution;
    },
    async read(): Promise<PublicationCurrent> {
      const r = current.parse(
        await rpc("read_native_estimate_publication", {
          p_estimate_id: t.estimate_id,
          p_client_id: t.client_id,
        }),
      ) as PublicationCurrent;
      check(r.actor_id === actorId && equal(r.target, t));
      if (r.current) validatePublication(r.current);
      if (r.latest_publication) validatePublication(r.latest_publication);
      if (r.current_status === "none")
        check(
          r.head.version === 0 &&
            r.current === null &&
            r.latest_publication === null,
        );
      else {
        check(r.head.version > 0 && r.latest_publication);
        if (r.current_status === "withdrawn")
          check(
            r.current === null && r.head.event_id !== r.latest_publication.id,
          );
        else
          check(
            r.current &&
              equal(r.current, r.latest_publication) &&
              r.head.event_id === r.current.id,
          );
      }
      return r;
    },
    async history(
      beforeVersion: number | null = null,
      limit = 20,
    ): Promise<PublicationHistory> {
      if (beforeVersion !== null) revision.parse(beforeVersion);
      z.number().int().min(1).max(100).parse(limit);
      const r = history.parse(
        await rpc("read_native_estimate_publication_history", {
          p_estimate_id: t.estimate_id,
          p_client_id: t.client_id,
          p_before_version: beforeVersion,
          p_limit: limit,
        }),
      ) as PublicationHistory;
      check(
        r.actor_id === actorId &&
          equal(r.target, t) &&
          r.events.length <= limit,
      );
      const seen = new Set<string>();
      r.events.forEach((e, i) => {
        validateEvent(e);
        check(
          !seen.has(e.id) &&
            e.version <= r.head.version &&
            (beforeVersion === null || e.version < beforeVersion),
        );
        seen.add(e.id);
        if (i) {
          const newer = r.events[i - 1];
          check(
            newer.version === e.version + 1 &&
              newer.previous_hash === e.record_hash &&
              micros(newer.created_at) >= micros(e.created_at),
          );
        } else {
          check(
            e.version ===
              Math.min(
                r.head.version,
                beforeVersion === null ? r.head.version : beforeVersion - 1,
              ),
          );
          if (e.version === r.head.version)
            check(
              e.id === r.head.event_id && e.record_hash === r.head.record_hash,
            );
        }
      });
      const last = r.events.at(-1);
      check(
        r.has_more
          ? last &&
              r.events.length === limit &&
              last.version > 1 &&
              r.next_before_version === last.version
          : r.next_before_version === null && (!last || last.version === 1),
      );
      check(r.events.length > 0 || r.head.version === 0 || beforeVersion === 1);
      return r;
    },
    async published(publicationId: string): Promise<PublishedEstimateRead> {
      uuid.parse(publicationId);
      const r = published.parse(
        await rpc("read_native_estimate_published_revision", {
          p_publication_id: publicationId,
          p_client_id: t.client_id,
        }),
      ) as PublishedEstimateRead;
      check(r.actor_id === actorId && r.publication.id === publicationId);
      validatePublication(r.publication);
      const p = r.publication,
        s = r.snapshot;
      check(
        equal(s.target, t) &&
          s.preparation_id === p.preparation_id &&
          s.draft_version === p.draft_version &&
          s.draft_record_hash === p.draft_record_hash &&
          s.acceptance.accept_by === p.accept_by &&
          micros(s.acceptance.expires_at) === micros(p.expires_at) &&
          estimatePublicationFilename(s) === p.artifact.filename &&
          micros(s.prepared_at) <= micros(p.published_at) &&
          r.head.version > 0,
      );
      if (r.status === "open" || r.status === "expired")
        check(r.head.event_id === p.id);
      else check(r.head.event_id !== p.id);
      return r;
    },
  };
}
