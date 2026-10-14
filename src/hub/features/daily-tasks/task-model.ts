import { z } from "zod";
import { bindingSchema } from "../scheduling/catalog-model.ts";

const uuid = z.string().uuid();
const version = z.number().int().positive().max(2147483647);
const instant = z.string().datetime({ offset: true });
const clean = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        value === value.trim() &&
        Array.from(value).every((character) => {
          const code = character.charCodeAt(0);
          return code === 9 || code === 10 || (code >= 32 && code !== 127);
        }),
      "Use clean reviewed text",
    );
const distinct = (values: string[]) => new Set(values).size === values.length;
export const operationalRoleSchema = z.enum(["STAFF", "TECH", "DVM", "ADMIN"]);
export const operationalOperationSchema = z.enum([
  "template",
  "use",
  "task",
  "policy",
]);
const selector = z.object({ entry_id: uuid, version_id: uuid }).strict();
const selectors = (min: number) =>
  z
    .array(selector)
    .min(min)
    .max(100)
    .refine(
      (values) => distinct(values.map((value) => value.entry_id)),
      "Select each catalog identity once",
    );
export const taskDefinitionSchema = z
  .object({
    name: clean(150),
    category: z.enum(["turnover", "preparation", "restock", "housecall"]),
    trigger: z.enum([
      "after_use",
      "before_visit",
      "resource_day",
      "before_departure",
    ]),
    selectors: z
      .object({ types: selectors(0), resources: selectors(1) })
      .strict(),
    due: z
      .object({
        offset_minutes: z.number().int().min(0).max(1440),
        local_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .nullable(),
        dst_resolution: z.enum(["reject", "earlier", "later"]),
      })
      .strict(),
    eligible_roles: z
      .array(operationalRoleSchema)
      .min(1)
      .max(4)
      .refine(distinct),
    assignment: z.enum(["unassigned", "named"]),
    assignee_id: uuid.nullable(),
    checklist: z
      .array(
        z
          .object({ id: uuid, label: clean(1000), required: z.boolean() })
          .strict(),
      )
      .min(1)
      .max(50)
      .refine((values) => distinct(values.map((value) => value.id))),
    sop_reference: clean(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const triggers = {
      turnover: "after_use",
      preparation: "before_visit",
      restock: "resource_day",
      housecall: "before_departure",
    };
    if (triggers[value.category] !== value.trigger)
      ctx.addIssue({
        code: "custom",
        path: ["trigger"],
        message: "Choose the trigger for this operational category",
      });
    if (
      ["before_visit", "before_departure"].includes(value.trigger) &&
      !value.selectors.types.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["selectors", "types"],
        message: "Choose explicit reviewed appointment types",
      });
    if (
      value.trigger === "resource_day"
        ? value.due.local_time === null || value.due.offset_minutes !== 0
        : value.due.local_time !== null
    )
      ctx.addIssue({
        code: "custom",
        path: ["due"],
        message:
          "Use a local time for daily restocking and a minute offset for other tasks",
      });
    if ((value.assignment === "named") !== (value.assignee_id !== null))
      ctx.addIssue({
        code: "custom",
        path: ["assignee_id"],
        message: "Named assignments require one eligible staff member",
      });
  });
export interface TaskDefinition extends z.infer<typeof taskDefinitionSchema> {}
export const templateRequestSchema = z
  .object({
    id: uuid,
    expected_version: version.nullable(),
    action: z.enum(["draft", "publish", "retire"]),
    definition: taskDefinitionSchema,
    review_note: clean(2000),
    attest_review: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.expected_version !== null || value.action === "draft",
    "Save a new draft before publication",
  );
export interface TemplateRequest extends z.infer<
  typeof templateRequestSchema
> {}
export const useRequestSchema = z
  .object({
    id: uuid,
    expected_version: version.nullable(),
    action: z.enum(["start", "end", "correct"]),
    appointment_id: uuid,
    appointment_version: version,
    resource_version_id: uuid,
    started_at: instant,
    ended_at: instant.nullable(),
    reason: clean(2000),
    allow_overlap: z.boolean(),
    attest_closed_source: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.action === "start") !== (value.expected_version === null))
      ctx.addIssue({
        code: "custom",
        path: ["expected_version"],
        message: "Match the exact use version",
      });
    if (
      (value.action === "start" && value.ended_at !== null) ||
      (value.action === "end" && value.ended_at === null) ||
      (value.ended_at &&
        Date.parse(value.ended_at) < Date.parse(value.started_at))
    )
      ctx.addIssue({
        code: "custom",
        path: ["ended_at"],
        message: "Use an actual ordered interval",
      });
  });
export interface UseRequest extends z.infer<typeof useRequestSchema> {}
export const taskRequestSchema = z
  .object({
    id: uuid,
    expected_version: version,
    context_hash: z.string().regex(/^[a-f0-9]{32}$/),
    action: z.enum([
      "claim",
      "assign",
      "start",
      "block",
      "complete",
      "resolve",
      "replace",
    ]),
    assignee_id: uuid.nullable(),
    checked_ids: z.array(uuid).max(50).refine(distinct),
    note: clean(2000),
    due_at: instant.nullable(),
    template_version_id: uuid.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action !== "complete" && value.checked_ids.length)
      ctx.addIssue({
        code: "custom",
        path: ["checked_ids"],
        message: "Checklist evidence accompanies completion",
      });
    if (
      !["claim", "assign"].includes(value.action) &&
      value.assignee_id !== null
    )
      ctx.addIssue({
        code: "custom",
        path: ["assignee_id"],
        message: "Assignment changes require an assignment action",
      });
    if ((value.action === "resolve") !== (value.due_at !== null))
      ctx.addIssue({
        code: "custom",
        path: ["due_at"],
        message: "Resolve with an explicit reviewed due time",
      });
    if ((value.action === "replace") !== (value.template_version_id !== null))
      ctx.addIssue({
        code: "custom",
        path: ["template_version_id"],
        message: "Replacement requires an explicit published version",
      });
  });
export interface TaskRequest extends z.infer<typeof taskRequestSchema> {}
export const policyRequestSchema = z
  .object({
    expected_version: version.nullable(),
    enabled: z.boolean(),
    effective_from: instant.nullable(),
    effective_until: instant.nullable(),
    review_note: clean(2000),
    attest_review: z.literal(true),
  })
  .strict()
  .refine(
    (value) =>
      value.enabled
        ? value.effective_from !== null &&
          value.effective_until !== null &&
          Date.parse(value.effective_until) >
            Date.parse(value.effective_from) &&
          Date.parse(value.effective_until) <=
            Date.parse(value.effective_from) + 366 * 86400000
        : value.effective_from === null && value.effective_until === null,
    "Use a reviewed effective interval of at most 366 days",
  );
export interface PolicyRequest extends z.infer<typeof policyRequestSchema> {}
export type OperationalRequest =
  TemplateRequest | UseRequest | TaskRequest | PolicyRequest;
const requestSchemas = {
  template: templateRequestSchema,
  use: useRequestSchema,
  task: taskRequestSchema,
  policy: policyRequestSchema,
};
export function validateOperationalRequest(
  operation: z.infer<typeof operationalOperationSchema>,
  request: unknown,
): OperationalRequest {
  return requestSchemas[operation].parse(request);
}

const templateVersionSchema = z
  .object({
    id: uuid,
    template_id: uuid,
    version,
    state: z.enum(["draft", "published", "retired"]),
    definition: taskDefinitionSchema,
    review_note: clean(2000),
    actor_id: uuid,
    recorded_at: instant,
  })
  .strict();
export const operationalTemplateSchema = z
  .object({
    id: uuid,
    version,
    current: templateVersionSchema,
    published: templateVersionSchema.nullable(),
    reviewer_name: z.string().nullable(),
    published_reviewer_name: z.string().nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.current.template_id === value.id &&
      value.current.version === value.version &&
      (!value.published ||
        (value.published.template_id === value.id &&
          value.published.state === "published" &&
          value.published.version <= value.version)),
    "Template attribution and revisions must match",
  );
export interface OperationalTemplate extends z.infer<
  typeof operationalTemplateSchema
> {}
export const useFactsSchema = z
  .object({
    state: z.enum(["open", "ended"]),
    started_at: instant,
    ended_at: instant.nullable(),
    resource_version_id: uuid,
    type_version_id: uuid.nullable(),
    appointment_version: version,
    reason: clean(2000),
    overlap_reviewed: z.boolean(),
    closed_source_attested: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      (value.state === "open") === (value.ended_at === null) &&
      (!value.ended_at ||
        Date.parse(value.ended_at) >= Date.parse(value.started_at)),
    "Physical-use state and interval must match",
  );
const useEventSchema = z
  .object({
    id: uuid,
    use_id: uuid,
    version,
    action: z.enum(["start", "end", "correct"]),
    facts: useFactsSchema,
    actor_id: uuid,
    recorded_at: instant,
  })
  .strict();
export const operationalUseSchema = z
  .object({
    id: uuid,
    appointment_id: uuid,
    resource_id: uuid,
    version,
    current: useEventSchema,
    actor_name: z.string().nullable(),
    resource_name: z.string().nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.current.use_id === value.id &&
      value.current.version === value.version,
    "Physical-use attribution must match",
  );
export interface OperationalUse extends z.infer<typeof operationalUseSchema> {}
const appointmentContextSchema = z
  .object({
    id: uuid,
    version,
    status: z.enum([
      "SCHEDULED",
      "CONFIRMED",
      "COMPLETED",
      "CANCELLED",
      "NO_SHOW",
    ]),
    scheduled_at: instant,
    visit_type: z.enum(["clinic", "housecall"]),
    travel_before_minutes: z.number().int().min(0).max(240),
    binding: bindingSchema.nullable(),
  })
  .strict();
const coverageSchema = z
  .object({
    use_id: uuid,
    covered_version: version,
    current: operationalUseSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.use_id === value.current.id &&
      value.covered_version <= value.current.version,
    "Coverage must refer to its actual-use history",
  );
const contextSchema = z
  .object({
    appointment: appointmentContextSchema.nullable(),
    appointment_uses: z.array(operationalUseSchema),
    use: operationalUseSchema.nullable(),
    coverage: z.array(coverageSchema),
  })
  .strict();
const useSourceSchema = z
  .object({
    use_id: uuid,
    use_version: version,
    resource_id: uuid,
    facts: useFactsSchema,
  })
  .strict();
const sourceAdditions = {
  review_context: contextSchema.optional(),
  corrected_use: useSourceSchema.optional(),
};
const sourceSchema = z.union([
  z
    .object({
      appointment_id: uuid,
      appointment_version: version,
      scheduled_at: instant,
      status: appointmentContextSchema.shape.status,
      type_version_id: uuid.nullable(),
      resource_version_id: uuid.nullable(),
      visit_type: appointmentContextSchema.shape.visit_type,
      travel_before_minutes:
        appointmentContextSchema.shape.travel_before_minutes,
      ...sourceAdditions,
    })
    .strict(),
  useSourceSchema.extend(sourceAdditions).strict(),
  z
    .object({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      resource_id: uuid,
      ...sourceAdditions,
    })
    .strict(),
  contextSchema,
]);
const enrollmentSchema = z
  .object({
    id: uuid,
    template_id: uuid,
    template_version_id: uuid,
    definition: taskDefinitionSchema,
    source_snapshot: sourceSchema,
    recorded_at: instant,
  })
  .strict();
export const operationalTaskStateSchema = z.enum([
  "pending",
  "started",
  "blocked",
  "needs_review",
  "completed",
  "superseded",
]);
const revisionSchema = z
  .object({
    id: uuid,
    task_id: uuid,
    enrollment_id: uuid,
    version,
    event: z.enum([
      "generated",
      "source_changed",
      "claim",
      "assign",
      "start",
      "block",
      "complete",
      "resolve",
      "replace",
    ]),
    state: operationalTaskStateSchema,
    due_at: instant.nullable(),
    assignee_id: uuid.nullable(),
    checked_ids: z.array(uuid).max(50).refine(distinct),
    note: clean(2000),
    source_snapshot: sourceSchema,
    actor_id: uuid.nullable(),
    recorded_at: instant,
  })
  .strict()
  .refine(
    (value) =>
      value.due_at !== null ||
      ["needs_review", "superseded"].includes(value.state),
  );
export const operationalTaskSchema = z
  .object({
    id: uuid,
    version,
    template_id: uuid,
    resource_id: uuid,
    source_key: clean(200),
    appointment_id: uuid.nullable(),
    use_id: uuid.nullable(),
    day_key: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    batch: z.number().int().nonnegative().nullable(),
    enrollment: enrollmentSchema,
    current: revisionSchema,
    actor_name: z.string().nullable(),
    assignee_name: z.string().nullable(),
    assignee_eligible: z.boolean().nullable(),
    resource_name: z.string().nullable(),
    context: contextSchema,
    context_hash: z.string().regex(/^[a-f0-9]{32}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.current.task_id !== value.id ||
      value.current.enrollment_id !== value.enrollment.id ||
      value.current.version !== value.version ||
      value.enrollment.template_id !== value.template_id ||
      (value.day_key === null) !== (value.batch === null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Task identity and immutable revision must match",
      });
    if (
      value.current.checked_ids.some(
        (id) =>
          !value.enrollment.definition.checklist.some((item) => item.id === id),
      ) ||
      (value.current.state === "completed" &&
        value.enrollment.definition.checklist.some(
          (item) =>
            item.required && !value.current.checked_ids.includes(item.id),
        ))
    )
      ctx.addIssue({
        code: "custom",
        message: "Completion must attest the frozen checklist",
      });
  });
export interface OperationalTask extends z.infer<
  typeof operationalTaskSchema
> {}
export const operationalPolicySchema = z
  .object({
    version,
    enabled: z.boolean(),
    effective_from: instant.nullable(),
    effective_until: instant.nullable(),
    review_note: clean(2000),
    actor_id: uuid,
    recorded_at: instant,
  })
  .strict();
export type OperationalReceipt =
  | OperationalTemplate
  | OperationalUse
  | OperationalTask
  | z.infer<typeof operationalPolicySchema>;
export function parseOperationalReceipt(
  operation: z.infer<typeof operationalOperationSchema>,
  data: unknown,
): OperationalReceipt {
  return {
    template: operationalTemplateSchema,
    use: operationalUseSchema,
    task: operationalTaskSchema,
    policy: operationalPolicySchema,
  }[operation].parse(data);
}
export const operationalMetadataSchema = z
  .object({ id: uuid, actor_id: uuid, operation: operationalOperationSchema })
  .strict();
export interface OperationalMetadata extends z.infer<
  typeof operationalMetadataSchema
> {}
const key = (actor: string) => "lrv:operational-reviews:" + uuid.parse(actor);
export function storedOperationalReviews(
  storage: Pick<Storage, "getItem">,
  actor: string,
): OperationalMetadata[] {
  try {
    return z
      .array(operationalMetadataSchema)
      .max(128)
      .parse(JSON.parse(storage.getItem(key(actor)) ?? "[]"))
      .filter((value) => value.actor_id === actor);
  } catch {
    return [];
  }
}
export function rememberOperationalReview(
  storage: Pick<Storage, "getItem" | "setItem">,
  metadata: OperationalMetadata,
) {
  const value = operationalMetadataSchema.parse(metadata);
  const entries = [
    ...storedOperationalReviews(storage, value.actor_id).filter(
      (item) => item.id !== value.id,
    ),
    value,
  ];
  if (entries.length > 128)
    throw new Error(
      "Check and release outstanding operational reviews before preparing another action",
    );
  storage.setItem(key(value.actor_id), JSON.stringify(entries));
}
export function forgetOperationalReview(
  storage: Pick<Storage, "getItem" | "setItem">,
  metadata: OperationalMetadata,
) {
  storage.setItem(
    key(metadata.actor_id),
    JSON.stringify(
      storedOperationalReviews(storage, metadata.actor_id).filter(
        (value) => value.id !== metadata.id,
      ),
    ),
  );
}

export const operationalAppointmentSchema = z
  .object({
    id: uuid,
    version,
    status: appointmentContextSchema.shape.status,
    scheduled_at: instant,
    appointment_type: z.string(),
    visit_type: appointmentContextSchema.shape.visit_type,
    patient_name: z.string().nullable(),
  })
  .strict();
export interface OperationalAppointment extends z.infer<
  typeof operationalAppointmentSchema
> {}
export const operationalHistoryItemSchema = z
  .object({
    revision: revisionSchema,
    enrollment: enrollmentSchema,
    actor_name: z.string().nullable(),
  })
  .strict()
  .refine(
    (value) => value.revision.enrollment_id === value.enrollment.id,
    "History must retain its frozen checklist",
  );
export function canonicalOperationalValue(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalOperationalValue).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([key, item]) =>
            JSON.stringify(key) + ":" + canonicalOperationalValue(item),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function verifyOperationalReceipt(
  meta: OperationalMetadata,
  request: OperationalRequest,
  data: unknown,
): OperationalReceipt {
  const value = parseOperationalReceipt(meta.operation, data);
  const q = validateOperationalRequest(meta.operation, request);
  if (meta.operation !== "policy") {
    const entity = q as TemplateRequest | UseRequest | TaskRequest;
    const receipt = value as
      OperationalTemplate | OperationalUse | OperationalTask;
    if (entity.id !== receipt.id)
      throw new Error("Saved operational work belongs to another record");
    const expected = entity.expected_version ?? 0;
    if (receipt.version !== expected + 1)
      throw new Error("Saved operational revision mismatch");
  }
  if (meta.operation === "template") {
    const a = q as TemplateRequest,
      v = value as OperationalTemplate;
    if (
      v.current.actor_id !== meta.actor_id ||
      canonicalOperationalValue(a.definition) !==
        canonicalOperationalValue(v.current.definition) ||
      v.current.state !==
        ({ draft: "draft", publish: "published", retire: "retired" } as const)[
          a.action
        ]
    )
      throw new Error("Saved template review mismatch");
  }
  if (meta.operation === "use") {
    const a = q as UseRequest,
      v = value as OperationalUse;
    if (
      v.current.actor_id !== meta.actor_id ||
      v.appointment_id !== a.appointment_id ||
      v.current.action !== a.action ||
      v.current.facts.resource_version_id !== a.resource_version_id ||
      v.current.facts.appointment_version !== a.appointment_version ||
      v.current.facts.reason !== a.reason ||
      (a.action === "start" &&
        (v.current.facts.closed_source_attested !== a.attest_closed_source ||
          v.current.facts.overlap_reviewed !== a.allow_overlap)) ||
      Date.parse(v.current.facts.started_at) !== Date.parse(a.started_at) ||
      (v.current.facts.ended_at === null) !== (a.ended_at === null) ||
      (a.ended_at !== null &&
        Date.parse(v.current.facts.ended_at!) !== Date.parse(a.ended_at))
    )
      throw new Error("Saved physical use mismatch");
  }
  if (meta.operation === "task") {
    const a = q as TaskRequest,
      v = value as OperationalTask;
    if (
      v.current.actor_id !== meta.actor_id ||
      v.current.event !== a.action ||
      v.current.note !== a.note
    )
      throw new Error("Saved task action mismatch");
    if (
      (a.action === "claim" || a.action === "assign") &&
      v.current.assignee_id !== a.assignee_id
    )
      throw new Error("Saved task assignment mismatch");
    if (
      a.action === "resolve" &&
      (v.current.state !== "pending" ||
        Date.parse(v.current.due_at!) !== Date.parse(a.due_at!))
    )
      throw new Error("Saved task resolution mismatch");
    if (
      a.action === "replace" &&
      v.enrollment.template_version_id !== a.template_version_id
    )
      throw new Error("Saved task replacement mismatch");
    if (
      a.action === "complete" &&
      (v.current.state !== "completed" ||
        v.current.actor_id !== meta.actor_id ||
        canonicalOperationalValue(a.checked_ids) !==
          canonicalOperationalValue(v.current.checked_ids))
    )
      throw new Error("Saved checklist completion mismatch");
  }
  if (meta.operation === "policy") {
    const a = q as PolicyRequest,
      v = value as z.infer<typeof operationalPolicySchema>;
    if (
      v.version !== (a.expected_version ?? 0) + 1 ||
      v.actor_id !== meta.actor_id ||
      v.enabled !== a.enabled ||
      (v.effective_from === null) !== (a.effective_from === null) ||
      (a.effective_from !== null &&
        Date.parse(v.effective_from!) !== Date.parse(a.effective_from)) ||
      (v.effective_until === null) !== (a.effective_until === null) ||
      (a.effective_until !== null &&
        Date.parse(v.effective_until!) !== Date.parse(a.effective_until)) ||
      v.review_note !== a.review_note
    )
      throw new Error("Saved generation review mismatch");
  }
  return value;
}
