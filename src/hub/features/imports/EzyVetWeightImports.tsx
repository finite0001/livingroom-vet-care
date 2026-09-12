import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { initialWeightFields } from "./weight-fields";
import { z } from "zod";
const candidateSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  external_id: z.string(),
  payload_hash: z.string(),
  payload: z.record(z.unknown()),
  head_version: z.number(),
  current_snapshot_id: z.string(),
  approval_id: z.string().nullable(),
  approved_snapshot_id: z.string().nullable(),
  weight_id: z.string().nullable(),
  patient_version: z.number(),
});
const intentSchema = z.object({
  snapshot_id: z.string(),
  expected_hash: z.string(),
  head_version: z.number(),
  animal_link_id: z.string(),
  patient_version: z.number(),
  action: z.enum(["create", "link"]),
  weight_id: z.string().nullable(),
  weight: z.number(),
  unit: z.enum(["kg", "lb"]),
  measured_at: z.string(),
  reason: z.string(),
});
interface Props {
  actor: string;
}
interface Mapping {
  link_id: string;
  pet_id: string;
  patient_name: string;
  household_name: string;
  source_origin: string;
  source_site_uid: string;
  external_id: string;
  patient_version: number;
}
function pointer(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function errorText(error: unknown) {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Operation not confirmed. Recheck before retrying.";
}
export function EzyVetWeightImports({ actor }: Props) {
  const [search, setSearch] = useState(""),
    [mapping, setMapping] = useState<Mapping | null>(null);
  const maps = useQuery({
    queryKey: ["ezyvet-weight", actor, "search", search],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "search_ezyvet_weight_patients",
        { p_search: search, p_limit: 20 },
      );
      if (error) throw error;
      return data;
    },
  });
  return (
    <section
      className="space-y-3 rounded border p-4"
      aria-label="Historical weight import"
    >
      <h2 className="text-xl font-semibold">Reviewed historical weights</h2>
      <p className="text-sm text-muted-foreground">
        Fetch through an approved patient mapping. Source observations do not
        change the chart until explicitly reviewed. Imports remain disabled
        until commissioned.
      </p>
      <label>
        Find mapped patient
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={200}
        />
      </label>
      {maps.isError && <p role="alert">Mapped patient search unavailable.</p>}
      {maps.data?.map((m) => (
        <Button variant="outline" key={m.link_id} onClick={() => setMapping(m)}>
          {m.patient_name} · {m.household_name} · {m.source_site_uid}
        </Button>
      ))}
      {mapping && (
        <PatientWeights key={mapping.link_id} mapping={mapping} actor={actor} />
      )}
    </section>
  );
}
interface PatientProps extends Props {
  mapping: Mapping;
}
function PatientWeights({ mapping, actor }: PatientProps) {
  const cache = useQueryClient(),
    key = `lrv-ezyvet-weight-run:${actor}:${mapping.link_id}`;
  const [runId, setRunId] = useState(() => pointer(key)),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<z.infer<typeof candidateSchema> | null>(
      null,
    );
  const lock = useRef(false);
  const candidates = useInfiniteQuery({
    queryKey: ["ezyvet-weight", actor, mapping.link_id, "candidates"],
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc(
        "list_ezyvet_weight_candidates",
        {
          p_animal_link_id: mapping.link_id,
          p_before_at: pageParam?.at,
          p_before_id: pageParam?.id,
          p_limit: 20,
        },
      );
      if (error) throw error;
      return data.map((v) => candidateSchema.parse(v));
    },
    getNextPageParam: (last) =>
      last.length === 20
        ? { at: last.at(-1)!.created_at, id: last.at(-1)!.id }
        : undefined,
  });
  const run = useQuery({
    queryKey: ["ezyvet-weight", actor, runId, "run"],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ezyvet_import_runs")
        .select("*")
        .eq("id", runId!)
        .eq("requested_by", actor)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 15000,
  });
  const fetchPage = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const id = runId ?? crypto.randomUUID();
      sessionStorage.setItem(key, id);
      setRunId(id);
      const { data, error } = await supabase.functions.invoke("ezyvet-import", {
        body: {
          run_id: id,
          resource: "healthstatus",
          animal_link_id: mapping.link_id,
        },
      });
      if (error) throw error;
      setNotice(
        `Source run: ${data.status}. Page cursor: ${data.next_page}. No chart weight was created.`,
      );
      await cache.invalidateQueries({ queryKey: ["ezyvet-weight", actor] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3">
      <p className="font-semibold">
        Selected patient: {mapping.patient_name} · {mapping.household_name}
      </p>
      <p className="break-words text-sm">
        {mapping.source_origin} · {mapping.source_site_uid} · animal #
        {mapping.external_id}
      </p>
      {runId && (
        <p className="text-sm">
          Saved run {runId}:{" "}
          {run.isError
            ? "status unavailable"
            : (run.data?.status ?? "not confirmed")}{" "}
          · next page {run.data?.next_page ?? "unknown"}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Button disabled={busy} onClick={() => void fetchPage()}>
        {runId
          ? "Continue or recheck source run"
          : "Fetch patient weight observations"}
      </Button>
      {run.data?.status === "review_ready" && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            sessionStorage.removeItem(key);
            setRunId(null);
            setNotice(
              "A new source scan can now be started. Approved chart weights remain unchanged.",
            );
          }}
        >
          Start a new scan
        </Button>
      )}
      {candidates.isError && (
        <p role="alert">
          Weight observations unavailable.{" "}
          <Button onClick={() => void candidates.refetch()}>Retry</Button>
        </p>
      )}
      {candidates.data?.pages.flat().map((c) => (
        <Button variant="outline" key={c.id} onClick={() => setSelected(c)}>
          Source weight #{c.external_id} ·{" "}
          {String(c.payload.weight ?? "unknown")}{" "}
          {String(c.payload.weight_unit ?? "unknown unit")} ·{" "}
          {c.approval_id ? "approved source identity" : "needs review"}
          {c.id !== c.current_snapshot_id ? " · older observation" : ""}
        </Button>
      ))}
      {candidates.hasNextPage && (
        <Button
          disabled={candidates.isFetchingNextPage}
          onClick={() => void candidates.fetchNextPage()}
        >
          Load more weight observations
        </Button>
      )}
      {selected && (
        <WeightReview
          key={selected.id}
          actor={actor}
          mapping={mapping}
          candidate={selected}
          onRefresh={async () => {
            setSelected(null);
            await cache.invalidateQueries({
              queryKey: ["ezyvet-weight", actor],
            });
            await cache.invalidateQueries({
              queryKey: ["patient-weights", mapping.pet_id],
            });
          }}
        />
      )}
    </section>
  );
}
interface ReviewProps extends PatientProps {
  candidate: z.infer<typeof candidateSchema>;
  onRefresh: () => Promise<void>;
}
function WeightReview({
  actor,
  mapping,
  candidate: c,
  onRefresh,
}: ReviewProps) {
  const key = `lrv-ezyvet-weight-approval:${actor}:${c.id}`;
  const [fields, setFields] = useState(() => initialWeightFields(c.payload)),
    [action, setAction] = useState<"create" | "link">("create"),
    [target, setTarget] = useState(""),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [requestId, setRequestId] = useState(() => pointer(key)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [changeReason, setChangeReason] = useState("");
  const lock = useRef(false);
  const saved = useQuery({
    queryKey: ["ezyvet-weight", actor, "request", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ezyvet_weight_requests")
        .select("*")
        .eq("request_id", requestId!)
        .eq("actor_id", actor)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const receipt = useQuery({
    queryKey: ["ezyvet-weight", actor, "receipt", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ezyvet_weight_approvals")
        .select("*")
        .eq("request_id", requestId!)
        .eq("approved_by", actor)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const reviews = useQuery({
    queryKey: ["ezyvet-weight", actor, "source-reviews", c.id],
    enabled: !!c.approval_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ezyvet_weight_source_reviews")
        .select("request_id,reason,created_at,reviewed_by")
        .eq("snapshot_id", c.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });
  const existing = useInfiniteQuery({
    queryKey: ["ezyvet-weight", actor, mapping.pet_id, "existing"],
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: async ({ pageParam }) => {
      let q = supabase
        .from("patient_weights")
        .select("*")
        .eq("pet_id", mapping.pet_id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(20);
      if (pageParam)
        q = q.or(
          `created_at.lt.${pageParam.at},and(created_at.eq.${pageParam.at},id.lt.${pageParam.id})`,
        );
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    getNextPageParam: (last) =>
      last.length === 20
        ? { at: last.at(-1)!.created_at, id: last.at(-1)!.id }
        : undefined,
  });
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const invoke = async (id: string, intent: z.infer<typeof intentSchema>) => {
    const { error } = await supabase.rpc("approve_ezyvet_weight", {
      p_request_id: id,
      p_actor_id: actor,
      p_snapshot_id: intent.snapshot_id,
      p_expected_hash: intent.expected_hash,
      p_head_version: intent.head_version,
      p_animal_link_id: intent.animal_link_id,
      p_patient_version: intent.patient_version,
      p_action: intent.action,
      p_weight_id: intent.weight_id,
      p_weight: intent.weight,
      p_unit: intent.unit,
      p_measured_at: intent.measured_at,
      p_confirmed: true,
      p_reason: intent.reason,
    });
    if (error) throw error;
    sessionStorage.removeItem(key);
    setRequestId(null);
    await onRefresh();
  };
  const approve = () =>
    run(async () => {
      const intent = intentSchema.parse({
        snapshot_id: c.id,
        expected_hash: c.payload_hash,
        head_version: c.head_version,
        animal_link_id: mapping.link_id,
        patient_version: c.patient_version,
        action,
        weight_id: action === "link" ? target || null : null,
        weight: Number(fields.weight),
        unit: fields.unit,
        measured_at: fields.measuredAt,
        reason: reason.trim(),
      });
      const id = requestId ?? crypto.randomUUID();
      sessionStorage.setItem(key, id);
      setRequestId(id);
      const { error } = await supabase.rpc("prepare_ezyvet_weight_request", {
        p_request_id: id,
        p_snapshot_id: c.id,
        p_payload: intent,
      });
      if (error) throw error;
      await invoke(id, intent);
    });
  const resolve = (discard: boolean) =>
    run(async () => {
      const { data, error } = await supabase.rpc(
        "resolve_ezyvet_weight_request",
        { p_request_id: requestId!, p_snapshot_id: c.id, p_discard: discard },
      );
      if (error) throw error;
      sessionStorage.removeItem(key);
      setRequestId(null);
      if ((data as { approved?: boolean }).approved) {
        await onRefresh();
      } else
        setNotice(
          "Preparation discarded. A late preparation cannot revive it. Review a new request explicitly.",
        );
    });
  const changed = c.approval_id && c.approved_snapshot_id !== c.id;
  return (
    <section
      className="space-y-3 rounded border p-4"
      aria-label="Review source weight"
    >
      <h3 className="text-lg font-semibold">
        Review source weight #{c.external_id}
      </h3>
      <dl className="text-sm">
        <dt>Original weight / unit / timestamp / active</dt>
        <dd>
          {String(c.payload.weight ?? "missing")} /{" "}
          {String(c.payload.weight_unit ?? "missing")} /{" "}
          {String(c.payload.timestamp ?? "missing")} /{" "}
          {String(c.payload.active ?? "missing")}
        </dd>
      </dl>
      <p className="text-sm">
        Unknown units or dates are not inferred. Suggested dates use
        America/Denver; independently verify the original measurement date.
        Review records identify you as importer, not as the source clinician.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {c.id !== c.current_snapshot_id && (
        <p role="alert">
          This is an older source observation. Select the current observation
          before approval.
        </p>
      )}
      {requestId && (
        <section className="space-y-2 border p-3">
          <p>
            Saved approval request {requestId}. Recovery never approves
            automatically.
          </p>
          {(saved.isError || receipt.isError) && (
            <p role="alert">
              Recovery unavailable. Retain this request and recheck.
            </p>
          )}
          {receipt.data ? (
            <>
              <p>Approval already completed: weight {receipt.data.weight_id}</p>
              <Button disabled={busy} onClick={() => void resolve(false)}>
                Acknowledge completed approval
              </Button>
            </>
          ) : saved.data?.status === "prepared" ? (
            <>
              <pre className="overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(saved.data.payload, null, 2)}
              </pre>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    invoke(requestId, intentSchema.parse(saved.data!.payload)),
                  )
                }
              >
                Approve exact saved request
              </Button>
            </>
          ) : (
            <p>
              Preparation is not confirmed. Recheck before deciding to discard.
            </p>
          )}
          <Button
            disabled={busy || saved.isFetching || receipt.isFetching}
            variant="outline"
            onClick={() => {
              void saved.refetch();
              void receipt.refetch();
            }}
          >
            Recheck approval status
          </Button>
          {!receipt.data && (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => {
                if (
                  window.confirm(
                    "Discard this unconfirmed preparation? No new weight will be created by this request. If approval already committed, its receipt will be retained.",
                  )
                )
                  void resolve(true);
              }}
            >
              Discard unconfirmed preparation
            </Button>
          )}
        </section>
      )}
      {c.approval_id ? (
        <>
          <p>
            Local weight {c.weight_id} is already linked. Existing clinical
            history will not be overwritten.
          </p>
          {reviews.isError && (
            <p role="alert">Source review history unavailable.</p>
          )}
          {reviews.data?.map((review) => (
            <p key={review.request_id}>
              Source discrepancy reviewed: {review.reason} (
              {new Date(review.created_at).toLocaleString()}). Local weight
              retained.
            </p>
          ))}
          {changed && (
            <fieldset disabled={busy}>
              <p>
                Source values changed after approval. Review the discrepancy;
                this action retains the existing local weight.
              </p>
              <label>
                Source change review reason
                <Textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  maxLength={2000}
                />
              </label>
              <Button
                disabled={
                  changeReason.trim().length < 5 ||
                  c.id !== c.current_snapshot_id
                }
                onClick={() =>
                  void run(async () => {
                    const reviewKey = `lrv-ezyvet-weight-change:${actor}:${c.id}`;
                    const id = pointer(reviewKey) ?? crypto.randomUUID();
                    sessionStorage.setItem(reviewKey, id);
                    const { error } = await supabase.rpc(
                      "review_ezyvet_weight_change",
                      {
                        p_request_id: id,
                        p_approval_id: c.approval_id!,
                        p_snapshot_id: c.id,
                        p_head_version: c.head_version,
                        p_reason: changeReason.trim(),
                      },
                    );
                    if (error) throw error;
                    sessionStorage.removeItem(reviewKey);
                    await reviews.refetch();
                    setNotice(
                      "Source discrepancy reviewed. Local weight retained.",
                    );
                  })
                }
              >
                Record source review, retain local weight
              </Button>
            </fieldset>
          )}
        </>
      ) : (
        <>
          <fieldset disabled={busy || !!requestId} className="space-y-2">
            <label>
              Reviewed weight
              <Input
                value={fields.weight}
                onChange={(e) =>
                  setFields({ ...fields, weight: e.target.value })
                }
              />
            </label>
            <label>
              Reviewed unit
              <select
                className="block rounded border bg-background p-2"
                value={fields.unit}
                onChange={(e) => setFields({ ...fields, unit: e.target.value })}
              >
                <option value="">Unknown — review required</option>
                <option value="kg">kg</option>
                <option value="lb">lb</option>
              </select>
            </label>
            <label>
              Measurement date
              <Input
                type="date"
                value={fields.measuredAt}
                onChange={(e) =>
                  setFields({ ...fields, measuredAt: e.target.value })
                }
              />
            </label>
            <label>
              Approval action
              <select
                className="block rounded border bg-background p-2"
                value={action}
                onChange={(e) => setAction(e.target.value as "create" | "link")}
              >
                <option value="create">Create historical weight</option>
                <option value="link">Link existing identical weight</option>
              </select>
            </label>
            {action === "link" && (
              <>
                <label>
                  Existing local weight
                  <select
                    className="block w-full rounded border bg-background p-2"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">Choose an existing weight</option>
                    {existing.data?.pages.flat().map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.measured_at} · {w.weight} {w.unit} · {w.id}
                      </option>
                    ))}
                  </select>
                </label>
                {existing.isError && (
                  <p role="alert">Existing weights unavailable.</p>
                )}
                {existing.hasNextPage && (
                  <Button
                    onClick={() => void existing.fetchNextPage()}
                    disabled={existing.isFetchingNextPage}
                  >
                    Load older local weights
                  </Button>
                )}
              </>
            )}
            <label>
              Review reason
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={2000}
              />
            </label>
            <label className="block">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              I reviewed patient identity, duplicates, value, unit and original
              measurement date.
            </label>
          </fieldset>
          {!requestId && (
            <Button
              disabled={
                busy ||
                !confirmed ||
                reason.trim().length < 5 ||
                !fields.weight ||
                !fields.unit ||
                !fields.measuredAt ||
                c.id !== c.current_snapshot_id
              }
              onClick={() => void approve()}
            >
              Approve reviewed historical weight
            </Button>
          )}
        </>
      )}
    </section>
  );
}
