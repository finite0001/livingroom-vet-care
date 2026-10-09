import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, PawPrint } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  choosePhoto,
  type PendingPhoto,
  pendingPhotoSchema,
  readPhoto,
  reservePhoto,
} from "./photo-api";
import { normalizePhoto } from "./photo-file";
interface PatientPhotoProps {
  petId: string;
  name: string;
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}
export function PatientPhoto(props: PatientPhotoProps) {
  const { session } = useAuth();
  return session
    ? (
      <PhotoWorkspace
        key={`${session.user.id}:${props.petId}`}
        {...props}
        actor={session.user.id}
      />
    )
    : null;
}
interface PhotoWorkspaceProps extends PatientPhotoProps {
  actor: string;
}
function PhotoWorkspace(
  { petId, name, actor, disabled, onDirtyChange }: PhotoWorkspaceProps,
) {
  const cache = useQueryClient(),
    key = `lrv-patient-photo-v1:${actor}:${petId}`;
  const [pending, setPending] = useState<PendingPhoto | null>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const p = pendingPhotoSchema.parse(JSON.parse(raw));
      return p.actorId === actor && p.petId === petId
        ? p as PendingPhoto
        : null;
    } catch {
      return null;
    }
  });
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const file = useRef<File | null>(null),
    lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onDirtyChange?.(Boolean(pending) || busy);
    return () => onDirtyChange?.(false);
  }, [pending, busy, onDirtyChange]);
  const photo = useQuery({
    queryKey: ["patient-photo", actor, petId],
    queryFn: () => readPhoto(petId),
    retry: 1,
  });
  const document = photo.data?.document;
  const signed = useQuery({
    queryKey: ["patient-photo-url", actor, petId, document?.id],
    enabled: Boolean(document),
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 45000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("patient-documents")
        .createSignedUrl(document!.file_path, 60);
      if (error) throw error;
      return { id: document!.id, url: data.signedUrl };
    },
  });
  const src = signed.data?.id === document?.id ? signed.data?.url : undefined;
  function remember(p: PendingPhoto | null) {
    if (p) localStorage.setItem(key, JSON.stringify(p));
    else localStorage.removeItem(key);
    setPending(p);
  }
  const refresh = () =>
    Promise.all([
      photo.refetch(),
      document ? signed.refetch() : Promise.resolve(),
      cache.invalidateQueries({ queryKey: ["patient-documents", petId] }),
    ]);
  async function action(work: () => Promise<void>) {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (failure) {
      if (alive.current) {
        setError(
          failure instanceof Error
            ? failure.message
            : failure && typeof failure === "object" && "message" in failure
            ? String(failure.message)
            : "Photo save could not be confirmed. Retry the same photo.",
        );
        await refresh();
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function stillHere() {
    if (!alive.current) {
      throw new Error(
        "Patient workspace changed; recover this photo on its own chart.",
      );
    }
  }
  async function save(p: PendingPhoto) {
    if (p.kind === "upload") {
      const reserved = await reservePhoto(p);
      stillHere();
      if (reserved.status === "uploading") {
        const split = reserved.file_path.lastIndexOf("/");
        const { data, error } = await supabase.storage.from("patient-documents")
          .list(reserved.file_path.slice(0, split), {
            search: "original",
            limit: 10,
          });
        if (error) throw error;
        stillHere();
        if (!data.some((object) => object.name === "original")) {
          if (!file.current) {
            throw new Error(
              "The file was not uploaded. Discard this draft and choose the image again.",
            );
          }
          const { error } = await supabase.storage.from("patient-documents")
            .upload(reserved.file_path, file.current, {
              contentType: p.mime,
              upsert: false,
            });
          if (error) throw error;
          stillHere();
        }
      }
      const { error: verifyError } = await supabase.functions.invoke(
        "verify-patient-photo",
        { body: { id: p.id } },
      );
      if (verifyError) throw verifyError;
      stillHere();
      const { error } = await supabase.rpc("finalize_patient_document", {
        p_id: p.id,
      });
      if (error) throw error;
      stillHere();
    }
    await choosePhoto(p);
    stillHere();
    remember(null);
    file.current = null;
    setNotice("Photo action confirmed.");
    await refresh();
  }
  async function choose(input: File) {
    await action(async () => {
      if (!photo.data) {
        throw new Error("Load the current photo before choosing another.");
      }
      const normalized = await normalizePhoto(input);
      stillHere();
      file.current = normalized.file;
      const p: PendingPhoto = {
        id: crypto.randomUUID(),
        actionId: crypto.randomUUID(),
        actorId: actor,
        petId,
        expectedVersion: photo.data.version,
        sha256: normalized.sha256,
        size: normalized.file.size,
        mime: "image/png",
        kind: "upload",
      };
      remember(p);
      await save(p);
    });
  }
  const unavailable = photo.isError || signed.isError ||
    Boolean(src && failedSrc === src);
  return (
    <div className="shrink-0" aria-label={`Photo for ${name}`}>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogTrigger asChild>
          <Button
            variant="outline"
            className="relative h-14 w-14 overflow-hidden rounded-xl p-0"
            aria-label={`Photo options for ${name}`}
          >
            {src && failedSrc !== src
              ? (
                <img
                  src={src}
                  alt={name}
                  onError={() => setFailedSrc(src)}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              )
              : (
                <PawPrint
                  className="h-6 w-6 text-primary"
                  aria-hidden="true"
                />
              )}
            <Camera
              className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded bg-background text-foreground"
              aria-hidden="true"
            />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Photo for {name}</DialogTitle>
            <DialogDescription>
              Private patient photo. JPEG or PNG up to 10 MiB. File history is
              retained when you change or remove a photo.
            </DialogDescription>
          </DialogHeader>
          {src && failedSrc !== src && (
            <img
              src={src}
              alt={name}
              onError={() => setFailedSrc(src)}
              referrerPolicy="no-referrer"
              className="mx-auto max-h-48 max-w-full rounded-lg object-contain"
            />
          )}
          {unavailable && (
            <div role="status">
              <p>
                Photo could not be loaded. The patient chart is still available.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setFailedSrc(null);
                  void refresh();
                }}
              >
                Retry photo
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          {notice && <p role="status" className="text-sm">{notice}</p>}
          <Label htmlFor={`patient-photo-${petId}`}>
            {document ? "Change photo" : "Upload photo"}
          </Label>
          <Input
            id={`patient-photo-${petId}`}
            type="file"
            accept="image/jpeg,image/png"
            disabled={busy || Boolean(pending) || !photo.data || disabled}
            onChange={(event) => {
              const input = event.target.files?.[0];
              event.target.value = "";
              if (input) void choose(input);
            }}
          />
          {pending && (
            <div className="space-y-2">
              <p className="text-sm">
                Retry to confirm this action before starting another. Discarding
                a retry draft does not undo a saved change.
              </p>
              <Button
                disabled={busy || disabled}
                onClick={() => void action(() => save(pending))}
              >
                Retry photo save
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  remember(null);
                  file.current = null;
                  setError("");
                  setNotice(
                    "Retry draft discarded. Any uploaded file remains in private document history.",
                  );
                  void refresh();
                }}
              >
                Discard photo draft
              </Button>
            </div>
          )}
          <Button
            variant="outline"
            disabled={busy || Boolean(pending) || !photo.data?.document_id ||
              disabled}
            onClick={() =>
              void action(async () => {
                const p: PendingPhoto = {
                  id: crypto.randomUUID(),
                  actionId: crypto.randomUUID(),
                  petId,
                  actorId: actor,
                  expectedVersion: photo.data!.version,
                  sha256: "0".repeat(64),
                  size: 1,
                  mime: "image/png",
                  kind: "remove",
                };
                remember(p);
                await save(p);
              })}
          >
            Remove current photo
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
