import { z } from "zod";
const uuid = z.string().uuid(),
  instant = z.iso.datetime({ offset: true }),
  day = z.iso.date();
const clean = (max: number) => z.string().trim().min(1).max(max);
export const teamSchema = z.object({
  can_manage: z.boolean(),
  staff: z.array(z.object({ id: uuid, name: z.string() })),
  posts: z.array(
    z.object({
      id: uuid,
      author: uuid,
      body: z.string(),
      pinned: z.boolean(),
      version: z.number(),
      created_at: instant,
      acknowledged: z.boolean(),
      acknowledgments: z.number(),
    }),
  ),
  tasks: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      note: z.string(),
      assignee: uuid.nullable(),
      due_at: instant,
      done: z.boolean(),
      version: z.number(),
      rotation_id: uuid.nullable(),
    }),
  ),
  events: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      description: z.string(),
      starts_at: instant,
      deadline: instant,
      capacity: z.number(),
      cancelled: z.boolean(),
      version: z.number(),
      created_by: uuid,
      my_answer: z.enum(["YES", "NO", "MAYBE", "WAITLIST"]).nullable(),
      going: z.number(),
      waiting: z.number(),
    }),
  ),
  my_milestones: z
    .object({
      birthday_month: z.number().nullable(),
      birthday_day: z.number().nullable(),
      anniversary: day.nullable(),
      share_birthday: z.boolean(),
      share_anniversary: z.boolean(),
    })
    .nullable(),
  milestones: z.array(
    z.object({
      staff_id: uuid,
      kind: z.enum(["birthday", "anniversary"]),
      source_key: z.string(),
      years: z.number().nullable(),
    }),
  ),
  rotations: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      staff_ids: z.array(uuid),
      starts_on: day,
      ends_on: day,
      local_time: z.string(),
    }),
  ),
});
export interface Team extends z.infer<typeof teamSchema> {}
export const teamCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("post"),
    data: z.object({ body: clean(5000) }),
  }),
  z.object({
    action: z.literal("pin"),
    data: z.object({ pinned: z.boolean(), version: z.number().int() }),
  }),
  z.object({ action: z.literal("acknowledge"), data: z.object({}) }),
  z.object({
    action: z.literal("task"),
    data: z.object({
      title: clean(200),
      note: z.string().max(2000),
      assignee: uuid.nullable(),
      due_at: instant,
    }),
  }),
  z.object({
    action: z.literal("task_status"),
    data: z.object({ done: z.boolean(), version: z.number().int() }),
  }),
  z.object({
    action: z.literal("assign_task"),
    data: z.object({ assignee: uuid.nullable(), version: z.number().int() }),
  }),
  z.object({
    action: z.literal("rotation"),
    data: z.object({
      title: clean(200),
      staff_ids: z.array(uuid).min(1).max(100),
      starts_on: day,
      ends_on: day,
      local_time: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  }),
  z.object({ action: z.literal("generate_rotation"), data: z.object({}) }),
  z.object({
    action: z.literal("event"),
    data: z.object({
      title: clean(200),
      description: z.string().max(2000),
      starts_at: instant,
      deadline: instant,
      capacity: z.number().int().positive().max(10000),
    }),
  }),
  z.object({
    action: z.literal("cancel_event"),
    data: z.object({ version: z.number().int() }),
  }),
  z.object({
    action: z.literal("rsvp"),
    data: z.object({ answer: z.enum(["YES", "NO", "MAYBE"]) }),
  }),
  z.object({
    action: z.literal("milestones"),
    data: z.object({
      birthday_month: z.number().int().min(1).max(12).nullable(),
      birthday_day: z.number().int().min(1).max(31).nullable(),
      anniversary: day.nullable(),
      share_birthday: z.boolean(),
      share_anniversary: z.boolean(),
    }),
  }),
  z.object({
    action: z.literal("dismiss_milestone"),
    data: z.object({ source_key: z.string().max(100), snooze: z.boolean() }),
  }),
]);
