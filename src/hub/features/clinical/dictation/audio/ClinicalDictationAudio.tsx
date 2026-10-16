import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hub/contexts/auth-context";
import type { Tables } from "@/integrations/supabase/types";
import {
  AUDIO_MAX_BYTES,
  AUDIO_RATE,
  audioDigest,
  audioIntentSchema,
  audioJobSchema,
  inspectAudioWav,
} from "../../../../../../supabase/functions/_shared/clinical-audio-model.ts";
import { processAudio, readAudio, readAudioJob, reserveAudio } from "./api";
import { ClinicalPcmRecorder } from "./recorder";
interface AudioProps {
  encounter: Tables<"clinical_encounters">;
  blocked: boolean;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
}
interface Clip {
  bytes: Uint8Array;
  sha256: string;
  frames: number;
  byte_size: number;
  url: string;
  version: number;
}
type Job = z.infer<typeof audioJobSchema>;
type Intent = z.infer<typeof audioIntentSchema>;
type Phase = "idle" | "starting" | "recording" | "paused" | "finalizing";
const clock = (frames: number) =>
  `${Math.floor(frames / AUDIO_RATE / 60)}:${String(Math.floor(frames / AUDIO_RATE) % 60).padStart(2, "0")}`;
export function ClinicalDictationAudio(props: AudioProps) {
  const { session } = useAuth();
  return session ? (
    <AudioSession
      key={`${session.user.id}:${props.encounter.id}`}
      {...props}
      actor={session.user.id}
    />
  ) : null;
}
interface SessionProps extends AudioProps {
  actor: string;
}
function AudioSession({
  actor,
  encounter,
  blocked,
  onDirtyChange,
  onBusyChange,
}: SessionProps) {
  const prefix = useId(),
    cache = useQueryClient();
  const data = useQuery({
    queryKey: ["clinical-audio", actor, encounter.pet_id, encounter.id],
    queryFn: () => readAudio(actor, encounter.pet_id, encounter.id),
  });
  const [phase, setPhase] = useState<Phase>("idle"),
    [frames, setFrames] = useState(0),
    [clip, setClip] = useState<Clip | null>(null),
    [busy, setBusy] = useState(false);
  const [note, setNote] = useState(""),
    [authorized, setAuthorized] = useState(false),
    [job, setJob] = useState<Job | null>(null);
  const [reservePending, setReservePending] = useState<{
      id: string;
      request: Record<string, unknown>;
    } | null>(null),
    [pending, setPending] = useState<Intent | null>(null);
  const [reason, setReason] = useState(""),
    [ack, setAck] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const recorder = useRef<ClinicalPcmRecorder | null>(null),
    active = useRef(true),
    locked = useRef(false),
    stopRef = useRef<() => Promise<void>>(async () => undefined),
    captureVersion = useRef(encounter.version);
  const dirty = Boolean(
    clip ||
      phase !== "idle" ||
      busy ||
      pending ||
      reservePending ||
      note ||
      authorized,
  );
  const unavailable =
    blocked || busy || phase !== "idle" || !data.data || data.isError;
  const nextStage = job?.transcript ? "generate" : "transcribe";
  const last = job?.attempts.find((a) => a.stage === nextStage);
  const expired = last
    ? new Date(last.lease_until).getTime() <= Date.now()
    : false;
  const retryAllowed = Boolean(
    last &&
      (last.state === "failed" ||
        last.state === "uncertain" ||
        last.state === "superseded" ||
        (expired && ["claimed", "sending"].includes(last.state))),
  );
  const ready = Boolean(
    encounter.status === "draft" &&
      !unavailable &&
      data.data?.policy.status === "approved" &&
      (!job || job.actor_id === actor) &&
      !job?.proposal_id,
  );
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      void recorder.current?.dispose();
    };
  }, []);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy || phase !== "idle");
    return () => onBusyChange(false);
  }, [busy, phase, onBusyChange]);
  useEffect(
    () => () => {
      if (clip) URL.revokeObjectURL(clip.url);
    },
    [clip],
  );
  useEffect(() => {
    const changed = () => {
      if (document.hidden && phase === "recording") {
        void recorder.current
          ?.pause()
          .then(() => {
            if (active.current) {
              setPhase("paused");
              setNotice(
                "Recording paused when this page went into the background. Return here and resume deliberately.",
              );
            }
          })
          .catch(() => {
            if (active.current)
              setError(
                "Recording was interrupted. Stop and preview it before processing.",
              );
          });
      }
    };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, [phase]);
  async function prepare(bytes: Uint8Array, version: number) {
    const info = inspectAudioWav(bytes),
      hash = await audioDigest(bytes);
    if (!active.current) return;
    if (job && job.sha256 !== hash)
      throw Error(
        "This file differs from the saved recording. Select the original WAV or start a new source.",
      );
    setClip({
      bytes,
      sha256: hash,
      frames: info.frames,
      byte_size: info.byte_size,
      url: URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
      ),
      version,
    });
    setFrames(info.frames);
  }
  async function finishRecording() {
    if (locked.current || !recorder.current) return;
    locked.current = true;
    setPhase("finalizing");
    setError("");
    try {
      const bytes = await recorder.current.stop();
      if (active.current) {
        await prepare(bytes, captureVersion.current);
        setNotice(
          "Recording finalized locally. Preview or download it before processing.",
        );
      }
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error
            ? e.message
            : "Recording could not be finalized. No audio was uploaded.",
        );
    } finally {
      recorder.current = null;
      locked.current = false;
      if (active.current) setPhase("idle");
    }
  }
  stopRef.current = finishRecording;
  async function start() {
    if (
      unavailable ||
      locked.current ||
      clip ||
      job ||
      !authorized ||
      !note.trim() ||
      encounter.status !== "draft"
    )
      return;
    locked.current = true;
    setPhase("starting");
    setError("");
    setNotice("");
    setFrames(0);
    captureVersion.current = encounter.version;
    try {
      const instance = new ClinicalPcmRecorder({
        onFrames: (n) => {
          if (active.current) setFrames(n);
        },
        onLimit: () => {
          void stopRef.current();
        },
        onError: () => {
          if (active.current) {
            setError(
              "Microphone capture was interrupted. No audio was uploaded. Record again or choose a compatible WAV.",
            );
            setPhase("idle");
          }
          recorder.current = null;
        },
      });
      recorder.current = instance;
      await instance.start();
      if (active.current) setPhase("recording");
    } catch {
      if (active.current) {
        setPhase("idle");
        setError(
          "Microphone capture is unavailable or permission was denied. Choose a compatible WAV, or allow microphone access and try again.",
        );
      }
      recorder.current = null;
    } finally {
      locked.current = false;
    }
  }
  async function togglePause() {
    if (locked.current || !recorder.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (phase === "paused") {
        await recorder.current.resume();
        if (active.current) setPhase("recording");
      } else {
        await recorder.current.pause();
        if (active.current) setPhase("paused");
      }
    } catch {
      if (active.current)
        setError(
          "Microphone state changed unexpectedly. Stop and preview before processing.",
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function clear() {
    if (busy) return;
    if (
      dirty &&
      !window.confirm(
        "Discard local audio and unfinished controls? Saved processing history stays. Download the WAV first if you want to keep it. In-flight provider work may still finish.",
      )
    )
      return;
    void recorder.current?.dispose();
    recorder.current = null;
    setPhase("idle");
    setClip(null);
    setJob(null);
    setPending(null);
    setReservePending(null);
    setNote("");
    setAuthorized(false);
    setReason("");
    setAck(false);
    setFrames(0);
    setError("");
    setNotice("");
  }
  async function fileChanged(file: File | undefined) {
    if (!file || unavailable) return;
    if (file.size > AUDIO_MAX_BYTES) {
      setError("Recording exceeds the ten-minute PCM WAV limit.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await prepare(
        new Uint8Array(await file.arrayBuffer()),
        job?.expected_version ?? encounter.version,
      );
      if (active.current)
        setNotice("Compatible WAV loaded locally. No audio has been sent.");
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error ? e.message : "Recording could not be read.",
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function adopt(value: Job) {
    if (
      value.pet_id !== encounter.pet_id ||
      value.encounter_id !== encounter.id
    )
      throw Error("Recording belongs to another encounter.");
    setJob(value);
    void data.refetch();
    void cache.invalidateQueries({
      queryKey: ["clinical-dictation", actor, encounter.pet_id, encounter.id],
    });
  }
  async function recover() {
    if (locked.current || !job) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await readAudioJob(actor, job.id);
      if (active.current) {
        adopt(value.job);
        const a = pending
          ? value.job.attempts.find((v) => v.id === pending.attempt_id)
          : null;
        if (a && !["claimed", "sending"].includes(a.state)) setPending(null);
        setNotice(
          value.job.proposal_id
            ? "AI draft is saved. Download or discard local audio, then review the draft below."
            : value.job.transcript
              ? "Transcript is saved. Review it before generating SOAP."
              : "Saved status recovered. A sending or uncertain attempt must not be repeated under a new ID without explicit retry review.",
        );
      }
    } catch {
      if (active.current)
        setError(
          "Saved processing state could not be recovered. Keep the original recording and request.",
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function recoverReservation() {
    if (locked.current || !reservePending) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await reserveAudio(
        actor,
        reservePending.id,
        reservePending.request,
      );
      if (active.current) {
        adopt(value);
        setReservePending(null);
        setNotice(
          "Recording source metadata confirmed. No provider request was made by recovery.",
        );
      }
    } catch {
      if (active.current)
        setError(
          "Source save is still unconfirmed. Recover this same source request before processing.",
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function process() {
    if (
      locked.current ||
      !ready ||
      reservePending ||
      (job?.actor_id && job.actor_id !== actor)
    )
      return;
    if (nextStage === "transcribe" && !clip) {
      setError("Choose the original compatible WAV before transcription.");
      return;
    }
    if (!job && (!authorized || !note.trim())) return;
    if (retryAllowed && (!ack || !reason.trim())) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let current = job;
      if (!current) {
        const request = {
          pet_id: encounter.pet_id,
          encounter_id: encounter.id,
          expected_version: clip!.version,
          policy_version: data.data!.policy.version,
          sha256: clip!.sha256,
          frames: clip!.frames,
          byte_size: clip!.byte_size,
          source_note: note,
          attest_authorized: true,
        };
        const reservation = { id: crypto.randomUUID(), request };
        setReservePending(reservation);
        current = await reserveAudio(actor, reservation.id, request);
        if (!active.current) return;
        adopt(current);
        setReservePending(null);
      }
      let intent = pending;
      if (!intent) {
        const previous = current.attempts.find((a) => a.stage === nextStage);
        if (previous && !retryAllowed) {
          intent = { ...previous.intent, attempt_id: previous.id };
        } else
          intent = {
            job_id: current.id,
            attempt_id: crypto.randomUUID(),
            stage: nextStage,
            retry_of: previous?.id ?? null,
            reason: previous ? reason : "",
            ack_cost: previous ? ack : false,
          };
        setPending(intent);
      }
      const value = await processAudio(
        intent,
        intent.stage === "transcribe" ? clip?.bytes : undefined,
      );
      if (!active.current) return;
      adopt(value.job);
      const a = value.job.attempts.find((v) => v.id === intent!.attempt_id);
      if (a && !["claimed", "sending"].includes(a.state)) setPending(null);
      setReason("");
      setAck(false);
      setNotice(
        value.job.proposal_id
          ? "AI draft saved for clinician review. The encounter has not changed. Download or discard local audio, then review the draft below."
          : value.job.transcript
            ? "Transcript saved. Review it before generating SOAP."
            : "Original attempt is still running or unconfirmed. Use Recover processing status.",
      );
    } catch (e) {
      if (active.current) {
        setError(
          e instanceof Error
            ? e.message
            : "Processing could not be confirmed. Recover the original attempt.",
        );
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Audio dictation"
      className="min-w-0 space-y-4 rounded-md border border-border p-4"
    >
      <h3 className="font-semibold">Record dictation and draft SOAP</h3>
      <p className="text-sm text-muted-foreground">
        One patient and saved encounter at a time. Audio stays in this page
        until sent for OpenAI processing; the app does not save a server-side
        audio file. Download it before discarding or closing this page if you
        need to keep it.
      </p>
      {data.isPending && <p role="status">Loading recording settings…</p>}
      {data.isError && (
        <p role="alert">
          Recording settings could not load.{" "}
          <Button variant="outline" onClick={() => void data.refetch()}>
            Retry recording settings
          </Button>
        </p>
      )}
      {data.data && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Recording policy ·{" "}
            {data.data.policy.status === "draft"
              ? "Draft for Susan — processing off"
              : "Approved"}
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
            {data.data.policy.consent_text}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
            {data.data.policy.transcript_retention}
          </p>
        </details>
      )}
      {data.data?.policy.status !== "approved" && (
        <p role="status" className="text-sm">
          OpenAI processing is off until the practice approves the recording
          policy and configures the provider. Local recording and preview do not
          send audio.
        </p>
      )}
      {blocked && (
        <p className="text-sm">
          Save or discard other clinical edits before using these controls.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap break-words text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="whitespace-pre-wrap break-words text-sm">
          {notice}
        </p>
      )}
      {!job && (
        <fieldset disabled={unavailable || !!clip} className="space-y-3">
          <legend className="sr-only">Recording authorization</legend>
          <Label htmlFor={`${prefix}-source`}>
            Dictation source and permission
          </Label>
          <Textarea
            id={`${prefix}-source`}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Who is dictating, and what permission applies?"
          />
          <label className="flex min-h-11 items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
            />
            I verified this patient and have permission to record and process
            this clinician dictation.
          </label>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!clip && phase === "idle" && !job && (
          <Button
            disabled={
              unavailable ||
              !authorized ||
              !note.trim() ||
              encounter.status !== "draft"
            }
            onClick={() => void start()}
          >
            Start dictation recording
          </Button>
        )}
        {(phase === "recording" || phase === "paused") && (
          <>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void togglePause()}
            >
              {phase === "paused" ? "Resume recording" : "Pause recording"}
            </Button>
            <Button disabled={busy} onClick={() => void finishRecording()}>
              Stop and preview recording
            </Button>
          </>
        )}
        {phase !== "idle" && (
          <span role="status" className="text-sm">
            {phase === "paused"
              ? "Paused"
              : phase === "starting"
                ? "Requesting microphone…"
                : phase === "finalizing"
                  ? "Finalizing…"
                  : "Recording"}{" "}
            · {clock(frames)}
          </span>
        )}
        {dirty && (
          <Button
            disabled={busy || phase === "starting" || phase === "finalizing"}
            variant="outline"
            onClick={clear}
          >
            {phase === "recording" || phase === "paused"
              ? "Cancel local recording"
              : "Discard local audio and controls"}
          </Button>
        )}
      </div>
      {phase === "idle" && !clip && (
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-file`}>
            {job
              ? "Original WAV for recording recovery"
              : "Or choose a compatible recording"}
          </Label>
          <Input
            id={`${prefix}-file`}
            type="file"
            accept="audio/wav,.wav"
            disabled={
              unavailable ||
              encounter.status !== "draft" ||
              (!!job && job.actor_id !== actor) ||
              (!job && (!authorized || !note.trim()))
            }
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void fileChanged(file);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Mono16kHz16-bit PCM WAV, one second to ten minutes. Other formats
            are not converted in this release.
          </p>
        </div>
      )}
      {clip && (
        <div className="space-y-2">
          <p className="text-sm">
            Finalized local recording · {clock(clip.frames)}
          </p>
          <audio
            aria-label="Local dictation preview"
            controls
            src={clip.url}
          ></audio>
          <a
            className="inline-flex min-h-11 items-center text-sm underline"
            href={clip.url}
            download="clinical-dictation.wav"
          >
            Download local WAV
          </a>
          <p className="text-xs text-muted-foreground">
            The transcript will appear after processing. No transcript is
            available for this local preview yet.
          </p>
        </div>
      )}
      {reservePending && (
        <Button
          disabled={busy}
          variant="outline"
          onClick={() => void recoverReservation()}
        >
          Recover source save
        </Button>
      )}
      {job && (
        <div className="space-y-3">
          <p className="text-sm">Saved source: {job.source_note}</p>
          {last && (
            <p className="text-sm">
              Latest {nextStage === "transcribe" ? "transcription" : "SOAP"}{" "}
              attempt: {last.state}
              {expired && ["claimed", "sending"].includes(last.state)
                ? " — response not confirmed before the deadline"
                : ""}
              . No provider call is repeated automatically.
            </p>
          )}
          {job.transcript && (
            <div>
              <h4 className="font-medium">
                Saved transcript — review before generating
              </h4>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border p-3 font-sans text-sm">
                {job.transcript}
              </pre>
            </div>
          )}
          <Button
            disabled={busy || phase !== "idle"}
            variant="outline"
            onClick={() => void recover()}
          >
            Recover processing status
          </Button>
        </div>
      )}
      {retryAllowed && (
        <fieldset disabled={busy || blocked} className="space-y-2">
          <legend className="font-medium">Explicit processing retry</legend>
          <Label htmlFor={`${prefix}-retry`}>Why retry this attempt?</Label>
          <Textarea
            id={`${prefix}-retry`}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <label className="flex min-h-11 items-start gap-2">
            <input
              className="mt-1"
              type="checkbox"
              checked={ack}
              onChange={(e) => {
                setAck(e.target.checked);
                setPending(null);
              }}
            />
            I checked the saved outcome and understand a new provider attempt
            may create an additional charge. Earlier late results will be fenced
            out.
          </label>
        </fieldset>
      )}
      {!job?.proposal_id && (
        <Button
          className="h-auto min-h-11 max-w-full whitespace-normal"
          disabled={
            !ready ||
            !!reservePending ||
            (nextStage === "transcribe" && !clip) ||
            (!job && (!authorized || !note.trim())) ||
            (!!last && !retryAllowed && !pending && last.state !== "claimed") ||
            (retryAllowed && (!reason.trim() || !ack))
          }
          onClick={() => void process()}
        >
          {busy
            ? "Processing…"
            : retryAllowed
              ? `Retry ${nextStage === "transcribe" ? "transcription" : "SOAP generation"} explicitly`
              : pending || (last?.state === "claimed" && !expired)
                ? "Resume original processing request"
                : nextStage === "transcribe"
                  ? "Transcribe recording with OpenAI"
                  : "Generate SOAP draft with OpenAI"}
        </Button>
      )}
      {!!data.data?.jobs.length && (
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-history`}>
            Saved recording processing history (latest10)
          </Label>
          <select
            id={`${prefix}-history`}
            className="flex min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
            value={job?.id ?? ""}
            disabled={
              busy ||
              phase !== "idle" ||
              !!clip ||
              !!pending ||
              !!reservePending
            }
            onChange={(e) => {
              const selected = data.data!.jobs.find(
                (j) => j.id === e.target.value,
              );
              setJob(selected ?? null);
              setReason("");
              setAck(false);
              setError("");
              setNotice("");
            }}
          >
            <option value="">New recording source</option>
            {data.data.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {new Date(j.created_at).toLocaleString()} ·{" "}
                {j.proposal_id
                  ? "SOAP draft saved"
                  : j.transcript
                    ? "transcript saved"
                    : "transcription pending"}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Audio itself is not retained here. Re-select the original WAV if
            transcription needs recovery. Existing transcript, draft and review
            history remain saved.
          </p>
        </div>
      )}
    </section>
  );
}
