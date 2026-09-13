import { refreshPatientReleases } from "../record-releases/refresh";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { useClinicalEncounters } from "@/hub/features/clinical/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { documentCategories, validateDocumentFile } from "./file-validation";
import type { Tables } from "@/integrations/supabase/types";

interface PatientDocumentsProps {
  petId: string;
}
type DocumentRow = Tables<"patient_documents">;
const bucket = "patient-documents";
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const practiceDate = (value: string) =>
  new Date(value).toLocaleDateString("en-US", { timeZone: "America/Denver" });
const labelFor = (value: string) => value.replace(/_/g, " ");
export function PatientDocuments({ petId }: PatientDocumentsProps) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["patient-documents", petId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_documents")
        .select("*")
        .eq("pet_id", petId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const encounters = useClinicalEncounters(petId);
  const authors = useQuery({
    queryKey: ["document-authors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name");
      if (error) throw error;
      return data;
    },
  });
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("medical_record");
  const [source, setSource] = useState("");
  const [date, setDate] = useState("");
  const [visibility, setVisibility] = useState("internal");
  const [encounter, setEncounter] = useState("");
  const [pending, setPending] = useState<DocumentRow | null>(null);
  const uploadId = useRef<string | null>(null);
  const uploaded = useRef(false);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [voiding, setVoiding] = useState<DocumentRow | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ["patient-documents", petId] }),
      refreshPatientReleases(cache, petId),
    ]);
  async function action(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!session?.user.id)
        throw new Error("Sign in again before changing documents.");
      await work();
    } catch (failure) {
      if (
        failure &&
        typeof failure === "object" &&
        "code" in failure &&
        failure.code === "40001"
      )
        await refresh();
      setError(
        failure && typeof failure === "object" && "message" in failure
          ? String(failure.message)
          : "Document operation failed. Your selections are retained; retry when connected.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function resetUpload() {
    setPending(null);
    uploadId.current = null;
    uploaded.current = false;
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }
  async function upload() {
    await action(async () => {
      if (!file) throw new Error("Choose a file first.");
      await validateDocumentFile(file);
      if (
        encounter &&
        !encounters.data?.some(
          (row) => row.id === encounter && row.pet_id === petId,
        )
      )
        throw new Error("Select an encounter belonging to this patient.");
      uploadId.current ??= crypto.randomUUID();
      let row = pending;
      if (!row) {
        const { data, error } = await supabase.rpc("prepare_patient_document", {
          p_id: uploadId.current,
          p_pet_id: petId,
          p_encounter_id: encounter || null,
          p_file_name: file.name,
          p_mime_type: file.type,
          p_file_size: file.size,
          p_category: category,
          p_source: source.trim(),
          p_document_date: date || null,
          p_visibility: visibility,
        });
        if (error) throw error;
        row = data;
        setPending(row);
      }
      if (row.created_by !== session.user.id || row.pet_id !== petId)
        throw new Error("Document ownership does not match this session.");
      if (!uploaded.current) {
        const split = row.file_path.lastIndexOf("/");
        const { data: objects, error: lookupError } = await supabase.storage
          .from(bucket)
          .list(row.file_path.slice(0, split), {
            search: row.file_path.slice(split + 1),
            limit: 100,
          });
        if (lookupError) throw lookupError;
        const existing = objects.find(
          (object) => object.name === row.file_path.slice(split + 1),
        );
        if (!existing) {
          const { error } = await supabase.storage
            .from(bucket)
            .upload(row.file_path, file, {
              upsert: false,
              contentType: file.type,
            });
          if (error) throw error;
        }
        uploaded.current = true;
      }
      const { error } = await supabase.rpc("finalize_patient_document", {
        p_id: row.id,
      });
      if (error) throw error;
      resetUpload();
      setNotice("Document saved privately to the patient record.");
      await refresh();
    });
  }
  async function abandon(row: DocumentRow) {
    await action(async () => {
      if (row.created_by !== session.user.id)
        throw new Error("Only the uploader can discard a pending upload.");
      const { error: storageError } = await supabase.storage
        .from(bucket)
        .remove([row.file_path]);
      if (storageError) throw storageError;
      const { error } = await supabase.rpc("abandon_patient_document", {
        p_id: row.id,
      });
      if (error) throw error;
      if (pending?.id === row.id) resetUpload();
      setNotice("Pending upload discarded.");
      await refresh();
    });
  }
  async function download(row: DocumentRow) {
    await action(async () => {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(row.file_path, 60, { download: row.file_name });
      if (error) throw error;
      const link = document.createElement("a");
      link.href = data.signedUrl;
      link.download = row.file_name;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
      setNotice("Private download requested. Its link expires in one minute.");
    });
  }
  const displayAuthor = (id: string) =>
    authors.data?.find((author) => author.id === id)?.full_name ||
    `Staff ${id}`;
  function documentCard(row: DocumentRow) {
    return (
      <li key={row.id} className="space-y-2 rounded-md border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all font-medium">{row.file_name}</span>
          <Badge variant="secondary">{labelFor(row.category)}</Badge>
          <Badge variant={row.status === "void" ? "destructive" : "outline"}>
            {row.status === "void"
              ? "Void — retained history"
              : row.visibility === "internal"
                ? "Internal"
                : "Eligible for client sharing"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {row.document_date || "Document date not recorded"} · Source:{" "}
          {row.source || "Not recorded"} · Uploaded by{" "}
          {displayAuthor(row.created_by)} on {practiceDate(row.created_at)} ·{" "}
          {(row.file_size / 1024).toFixed(1)} KiB
        </p>
        {row.encounter_id && (
          <p className="text-xs text-muted-foreground">
            Encounter: {row.encounter_id}
          </p>
        )}
        {row.status === "void" && (
          <p className="text-sm">
            Voided by {displayAuthor(row.voided_by)}: {row.void_reason}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void download(row)}
          >
            Download {row.file_name}
          </Button>
          {row.status === "ready" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setVoiding(row);
                setReason("");
              }}
            >
              Void {row.file_name}
            </Button>
          )}
        </div>
      </li>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Patient documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Private PDF, JPEG and PNG files up to 20 MiB. Original files are
          retained; upload a new document for replacements. Marking a file
          eligible for sharing does not send it to a client.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void upload();
          }}
          className="space-y-3"
        >
          <fieldset
            disabled={busy || Boolean(uploadId.current)}
            className="grid gap-3 md:grid-cols-2"
          >
            <div className="space-y-1">
              <Label htmlFor="patient-document-file">Document file</Label>
              <Input
                ref={fileInput}
                id="patient-document-file"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="document-category">Document category</Label>
              <select
                id="document-category"
                className={selectClass}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {documentCategories.map((value) => (
                  <option key={value} value={value}>
                    {labelFor(value)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="document-source">Document source</Label>
              <Input
                id="document-source"
                maxLength={500}
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="Lab, previous clinic or staff"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="document-date">Document date</Label>
              <Input
                id="document-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="document-encounter">Related encounter</Label>
              <select
                id="document-encounter"
                className={selectClass}
                value={encounter}
                onChange={(event) => setEncounter(event.target.value)}
              >
                <option value="">Patient record only</option>
                {encounters.data
                  ?.filter((row) => row.pet_id === petId)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {practiceDate(row.visit_at)} · {row.visit_type} ·{" "}
                      {row.status}
                    </option>
                  ))}
              </select>
              {encounters.isError && (
                <p role="alert">
                  Encounters could not be loaded.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void encounters.refetch()}
                  >
                    Retry encounters
                  </button>
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="document-visibility">Document visibility</Label>
              <select
                id="document-visibility"
                className={selectClass}
                value={visibility}
                onChange={(event) => setVisibility(event.target.value)}
              >
                <option value="internal">Internal</option>
                <option value="client_shareable">
                  Eligible for client sharing
                </option>
              </select>
            </div>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            File type checking is not a malware scan. Only upload trusted
            documents.
          </p>
          <Button type="submit" disabled={busy || !file}>
            {busy
              ? "Working…"
              : uploadId.current
                ? "Retry document upload"
                : "Save document"}
          </Button>
          {pending && (
            <Button
              type="button"
              variant="outline"
              className="ml-2"
              disabled={busy}
              onClick={() => void abandon(pending)}
            >
              Discard pending upload
            </Button>
          )}
          {uploadId.current && !pending && (
            <Button
              type="button"
              variant="outline"
              className="ml-2"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const { data, error } = await supabase
                    .from("patient_documents")
                    .select("*")
                    .eq("id", uploadId.current)
                    .eq("pet_id", petId)
                    .eq("created_by", session.user.id)
                    .maybeSingle();
                  if (error) throw error;
                  if (data) {
                    setPending(data);
                    setNotice(
                      "Reserved upload recovered. Retry or discard it.",
                    );
                  } else {
                    resetUpload();
                    setNotice(
                      "No document was reserved. You can select another file.",
                    );
                  }
                })
              }
            >
              Recover upload status
            </Button>
          )}
        </form>
        {query.isLoading && <p role="status">Loading documents…</p>}
        {query.isError && (
          <p role="alert">
            Documents could not be loaded.{" "}
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry documents
            </Button>
          </p>
        )}
        {!query.isLoading &&
          !query.isError &&
          !query.data?.some((row) => row.status === "ready") && (
            <p className="text-sm text-muted-foreground">
              No saved documents yet.
            </p>
          )}
        {authors.isError && (
          <div role="alert" className="space-y-2 text-sm">
            <p>
              Staff names could not be loaded. Recorded staff IDs are shown
              instead.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void authors.refetch()}
            >
              Retry staff names
            </Button>
          </div>
        )}
        <ul className="space-y-3">
          {query.data
            ?.filter((row) => row.status === "ready")
            .map(documentCard)}
        </ul>
        {query.data?.some(
          (row) =>
            row.status === "uploading" &&
            row.created_by === session?.user.id &&
            row.id !== pending?.id,
        ) && (
          <div className="space-y-2">
            <h3 className="font-medium">Unfinished uploads</h3>
            <p className="text-sm">
              These files were not finalized. Discard them before uploading a
              replacement.
            </p>
            {query.data
              .filter(
                (row) =>
                  row.status === "uploading" &&
                  row.created_by === session?.user.id &&
                  row.id !== pending?.id,
              )
              .map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-2">
                  <span>{row.file_name}</span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void abandon(row)}
                  >
                    Discard unfinished {row.file_name}
                  </Button>
                </div>
              ))}
          </div>
        )}
        {query.data?.some((row) => row.status === "void") && (
          <details>
            <summary className="cursor-pointer font-medium">
              Voided document history
            </summary>
            <ul className="mt-3 space-y-3">
              {query.data
                .filter((row) => row.status === "void")
                .map(documentCard)}
            </ul>
          </details>
        )}
        <AlertDialog
          open={Boolean(voiding)}
          onOpenChange={(open) => {
            if (!busy && !open) setVoiding(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Void document?</AlertDialogTitle>
              <AlertDialogDescription>
                The original file and history will remain available. Record why{" "}
                {voiding?.file_name} should no longer be used.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Label htmlFor="document-void-reason">
              Reason for voiding document
            </Label>
            <Input
              id="document-void-reason"
              value={reason}
              maxLength={2000}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>
                Keep document
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={busy || !reason.trim()}
                onClick={(event) => {
                  event.preventDefault();
                  void action(async () => {
                    const { error } = await supabase.rpc(
                      "void_patient_document",
                      {
                        p_id: voiding.id,
                        p_expected_version: voiding.version,
                        p_reason: reason.trim(),
                      },
                    );
                    if (error) throw error;
                    setVoiding(null);
                    setNotice("Document voided; original retained in history.");
                    await refresh();
                  });
                }}
              >
                Confirm void
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
