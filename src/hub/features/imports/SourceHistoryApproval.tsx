import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ClinicalHistoryReview } from "./ClinicalHistoryReview";
import { listClinicalCandidates } from "./clinical-api";
import type {
  ClinicalMapping,
  ClinicalCandidate,
  ClinicalCursor,
} from "./clinical-api";
import { sourceApprovalPayload } from "./history-state";
import { refreshPatientReleases } from "../record-releases/refresh";
interface Props {
  actor: string;
  mapping: ClinicalMapping;
  selected: ClinicalCandidate | null;
  disabled: boolean;
  onDirtyChange: (v: boolean) => void;
}
export function SourceHistoryApproval({
  actor,
  mapping,
  selected,
  disabled,
  onDirtyChange,
}: Props) {
  const cache = useQueryClient();
  const [mode, setMode] = useState(""),
    [consult, setConsult] = useState<ClinicalCandidate | null>(null),
    [reason, setReason] = useState(""),
    [cursor, setCursor] = useState<ClinicalCursor | null>(null);
  const candidates = useQuery({
    queryKey: [
      "ezyvet-clinical",
      actor,
      mapping.link_id,
      "consult",
      "approval",
      cursor,
    ],
    queryFn: () => listClinicalCandidates(mapping, "consult", cursor),
    enabled: mode === "verified",
    retry: false,
  });
  const history = selected?.resource === "history" ? selected : null;
  return (
    <ClinicalHistoryReview
      actor={actor}
      petId={mapping.pet_id}
      kind="history_approval"
      disabled={disabled}
      draftDirty={!!mode || !!reason || !!consult}
      canPrepare={
        !!history?.is_current &&
        reason.trim().length >= 5 &&
        !!mode &&
        (mode !== "verified" || !!consult?.is_current)
      }
      payload={() =>
        sourceApprovalPayload.parse({
          animal_link_id: mapping.link_id,
          snapshot_id: history!.id,
          payload_hash: history!.payload_hash,
          observed_head_version: history!.observed_head_version,
          patient_version: mapping.patient_version,
          consult_mode: mode,
          consult_snapshot_id: mode === "verified" ? consult!.id : null,
          consult_payload_hash:
            mode === "verified" ? consult!.payload_hash : null,
          consult_head_version:
            mode === "verified" ? consult!.observed_head_version : null,
          reason,
        })
      }
      onDirtyChange={onDirtyChange}
      onReset={() => {
        setMode("");
        setConsult(null);
        setReason("");
      }}
      onCommitted={() => {
        void cache.invalidateQueries({
          queryKey: ["patient-imported-history"],
        });
        void refreshPatientReleases(cache, mapping.pet_id);
      }}
    >
      <p>
        Read a current patient-scoped history observation above. Administrator
        approval preserves the source narrative; it does not create a local
        finding or signature.
      </p>
      {history && (
        <p>
          Selected source history {history.external_id} · observed head{" "}
          {history.observed_head_version}
          {!history.is_current
            ? " — source changed; scan and review its current observation"
            : ""}
        </p>
      )}
      <label className="block">
        Consult context decision
        <select
          className="block w-full rounded border bg-background p-2"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            setConsult(null);
          }}
        >
          <option value="">
            Choose how this source consult reference was reviewed
          </option>
          <option value="not_referenced">
            No consult context is referenced
          </option>
          <option value="unresolved">
            Preserve unresolved consult reference without verified context
          </option>
          <option value="verified">
            Verify exact same-patient scoped consult
          </option>
        </select>
      </label>
      {mode === "verified" && (
        <div>
          {candidates.isError && (
            <p role="alert">Scoped consult evidence unavailable.</p>
          )}
          {candidates.data?.candidates.map((c) => (
            <Button
              key={c.id}
              type="button"
              variant="outline"
              disabled={
                !c.is_current ||
                String(history?.payload.consult_id) !== c.external_id
              }
              onClick={() => setConsult(c)}
            >
              Use scoped consult {c.external_id}
            </Button>
          ))}
          {consult && (
            <p>
              Selected consult {consult.external_id} · observed head{" "}
              {consult.observed_head_version}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!cursor || candidates.isFetching}
            onClick={() => setCursor(null)}
          >
            Newest scoped consults
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!candidates.data?.next_cursor || candidates.isFetching}
            onClick={() => setCursor(candidates.data!.next_cursor)}
          >
            Older scoped consults
          </Button>
        </div>
      )}
      <label className="block">
        Source approval reason (5–2,000 characters)
        <Textarea
          value={reason}
          maxLength={2000}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
    </ClinicalHistoryReview>
  );
}
