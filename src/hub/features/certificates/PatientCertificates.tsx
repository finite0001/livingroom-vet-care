import { denverLocal } from "../scheduling/time";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  certificates,
  readCertificate,
  attestations,
  type CertificateBundle,
  type IssueArgs,
  type PreviewArgs,
} from "./api";
import { renderVaccineCertificate, type CertificateSnapshot } from "./print";

interface PatientCertificatesProps {
  petId: string;
  onDirtyChange?: (dirty: boolean) => void;
}
function SnapshotReview({ snapshot: s }: { snapshot: CertificateSnapshot }) {
  return (
    <div className="space-y-4 rounded-md border p-4">
      <h4 className="font-semibold">
        {s.kind === "rabies"
          ? "Rabies certificate review"
          : "Vaccine history review"}
      </h4>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {Object.entries(s.patient)
          .filter(([key]) => key !== "id")
          .map(([key, value]) => (
            <div key={key}>
              <dt className="text-muted-foreground">
                {key.replace(/_/g, " ")}
              </dt>
              <dd>{value || "Not recorded"}</dd>
            </div>
          ))}
        {Object.entries(s.owner)
          .filter(([key]) => key !== "id")
          .map(([key, value]) => (
            <div key={`owner-${key}`}>
              <dt className="text-muted-foreground">Owner {key}</dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        {Object.entries(s.issuer)
          .filter(([key]) => key !== "user_id")
          .map(([key, value]) => (
            <div key={`issuer-${key}`}>
              <dt className="text-muted-foreground">
                Issuer {key.replace(/_/g, " ")}
              </dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
      </dl>
      {s.vaccinations.map((v) => (
        <section key={v.treatment_id} className="border-t pt-3">
          <h5 className="font-medium">{v.product_name}</h5>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries(v).map(([key, value]) => (
              <div key={key}>
                <dt className="text-muted-foreground">
                  {key.replace(/_/g, " ")}
                </dt>
                <dd>
                  {key === "next_due_on" && !value
                    ? "Not recorded — no due date certified"
                    : typeof value === "boolean"
                      ? value
                        ? "Yes"
                        : "No"
                      : value || "Not recorded"}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {Object.keys(s.details).length > 0 && (
        <section className="border-t pt-3">
          <h5 className="font-medium">Reviewed rabies details</h5>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries(s.details).map(([key, value]) => (
              <div key={key}>
                <dt className="text-muted-foreground">
                  {key.replace(/_/g, " ")}
                </dt>
                <dd>
                  {typeof value === "boolean"
                    ? value
                      ? "Confirmed"
                      : "No"
                    : value || "Not recorded"}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
export function PatientCertificates({
  petId,
  onDirtyChange,
}: PatientCertificatesProps) {
  const { user, profile, hasRole } = useAuth();
  const cache = useQueryClient();
  const [kind, setKind] = useState<PreviewArgs["p_kind"]>("vaccine_history");
  const [treatment, setTreatment] = useState("");
  const [details, setDetails] = useState<CertificateSnapshot["details"]>({});
  const [preview, setPreview] = useState<CertificateSnapshot | null>(null);
  const [signature, setSignature] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<CertificateBundle | null>(null);
  const [replacement, setReplacement] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const [pending, setPending] = useState<IssueArgs | null>(null);
  const requestRef = useRef<IssueArgs | null>(null);
  const voidRef = useRef<{
    p_id: string;
    p_certificate_id: string;
    p_reason: string;
  } | null>(null);
  const dirty =
    !!preview ||
    !!pending ||
    !!signature ||
    !!reason ||
    !!voidReason ||
    !!treatment ||
    Object.keys(details).length > 0 ||
    busy;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const issuer = useQuery({
    queryKey: ["certificate-issuer", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await certificates
        .from("certificate_issuers")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const history = useQuery({
    queryKey: ["patient-certificates", petId, historyPage],
    queryFn: async () => {
      const { data, error } = await certificates
        .from("vaccine_certificates")
        .select("id")
        .eq("pet_id", petId)
        .order("issued_at", { ascending: false })
        .order("id", { ascending: false })
        .range(historyPage * 25, historyPage * 25 + 24);
      if (error) throw error;
      return Promise.all((data || []).map((c) => readCertificate(c.id)));
    },
  });
  const vaccines = useQuery({
    queryKey: ["certificate-vaccines", petId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_treatments")
        .select("id,product_name,administered_at,historical,next_due_on")
        .eq("pet_id", petId)
        .eq("kind", "vaccine")
        .order("administered_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });
  const today = denverLocal(new Date()).slice(0, 10);
  const eligible = !!(
    user &&
    profile?.is_active &&
    hasRole("DVM") &&
    issuer.data?.active &&
    issuer.data.license_expires_on >= today &&
    Date.parse(issuer.data.verified_at) <= Date.now() &&
    Date.parse(issuer.data.clinical_acceptance_at) <= Date.now()
  );
  const run = async (action: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : (e as { message?: string })?.message ||
              "Request failed. Retry without changing the reviewed request.",
      );
    } finally {
      setBusy(false);
    }
  };
  const edit = () => {
    if (pending) return;
    setPreview(null);
    setSignature("");
    setAttested(false);
  };
  const previewArgs = (): PreviewArgs => ({
    p_pet_id: petId,
    p_kind: kind,
    p_rabies_treatment_id: kind === "rabies" ? treatment || null : null,
    p_details: kind === "rabies" ? details : {},
  });
  const loadPreview = () =>
    run(async () => {
      const { data, error } = await certificates.rpc(
        "preview_vaccine_certificate",
        previewArgs(),
      );
      if (error) throw error;
      setPreview(data);
      setSignature("");
      setAttested(false);
    });
  const issue = () =>
    run(async () => {
      if (!user || !eligible || !preview)
        throw new Error(
          "A verified veterinarian and reviewed preview are required.",
        );
      const args = requestRef.current ?? {
        ...previewArgs(),
        p_id: crypto.randomUUID(),
        p_reviewed_snapshot: preview,
        p_signature_name: signature,
        p_attest_review: attested,
        p_replaces_id: replacement,
        p_reason: replacement ? reason : null,
      };
      requestRef.current = args;
      setPending(args);
      const { data, error } = await certificates.rpc(
        "issue_vaccine_certificate",
        args,
      );
      if (error) {
        if (["40001", "23514", "42501"].includes(error.code)) {
          requestRef.current = null;
          setPending(null);
          setPreview(null);
          setAttested(false);
        }
        throw error;
      }
      requestRef.current = null;
      setPending(null);
      setPreview(null);
      setSignature("");
      setAttested(false);
      setReplacement(null);
      setReason("");
      setDetails({});
      setTreatment("");
      await cache.invalidateQueries({
        queryKey: ["patient-certificates", petId],
      });
      setOpened(await readCertificate(data.id));
    });
  const open = (id: string) =>
    run(async () => {
      setOpened(null);
      setVoidReason("");
      voidRef.current = null;
      setOpened(await readCertificate(id));
    });
  const print = () => {
    if (!opened) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError("Allow popups to open the printable certificate.");
      return;
    }
    popup.opener = null;
    void run(async () => {
      try {
        const fresh = await readCertificate(opened.certificate.id);
        setOpened(fresh);
        popup.document.open();
        popup.document.write(
          renderVaccineCertificate(fresh.certificate, fresh.events),
        );
        popup.document.close();
        popup.focus();
        popup.print();
      } catch (e) {
        popup.close();
        throw e;
      }
    });
  };
  const voidCertificate = () =>
    run(async () => {
      if (!opened || !user) throw new Error("Open a certificate first.");
      const args = voidRef.current ?? {
        p_id: crypto.randomUUID(),
        p_certificate_id: opened.certificate.id,
        p_reason: voidReason,
      };
      voidRef.current = args;
      const { error } = await certificates.rpc(
        "void_vaccine_certificate",
        args,
      );
      if (error) throw error;
      voidRef.current = null;
      setVoidReason("");
      setOpened(await readCertificate(args.p_certificate_id));
      await cache.invalidateQueries({
        queryKey: ["patient-certificates", petId],
      });
    });
  const setDetail = (
    key: keyof CertificateSnapshot["details"],
    value: string | boolean,
  ) => {
    edit();
    setDetails((v) => ({ ...v, [key]: value }));
  };
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-4"
      aria-label="Patient certificates"
    >
      <h3 className="font-serif text-xl">Vaccine certificates</h3>
      <p className="text-sm text-muted-foreground">
        Issued copies preserve reviewed identity and recorded dates. General
        history does not calculate the current vaccine schedule.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {(history.isError || issuer.isError || vaccines.isError) && (
        <p role="alert">
          Certificate data could not be loaded.{" "}
          <Button
            variant="outline"
            onClick={() => {
              void history.refetch();
              void issuer.refetch();
              void vaccines.refetch();
            }}
          >
            Retry loading certificates
          </Button>
        </p>
      )}
      <div className="space-y-2">
        <h4 className="font-semibold">Issued certificates</h4>
        {history.isLoading ? (
          <p role="status">Loading certificates…</p>
        ) : history.data?.length === 0 ? (
          <p>
            {historyPage
              ? "No certificates on this page."
              : "No certificates issued yet."}
          </p>
        ) : (
          history.data?.map((bundle) => (
            <div
              key={bundle.certificate.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <div>
                <p>
                  {bundle.certificate.kind === "rabies"
                    ? "Rabies"
                    : "Vaccine history"}{" "}
                  ·{" "}
                  {denverLocal(bundle.certificate.issued_at).replace("T", " ")}{" "}
                  America/Denver
                </p>
                <p className="text-xs text-muted-foreground">
                  {bundle.certificate.id}
                </p>
                <p>
                  {bundle.events.length
                    ? "Invalidated — retained history"
                    : "No invalidation recorded"}
                </p>
                {bundle.events.map((e) => (
                  <p key={e.id} className="text-sm">
                    {e.kind}: {e.reason}
                  </p>
                ))}
              </div>
              <Button
                variant="outline"
                disabled={busy || !!voidRef.current}
                onClick={() => void open(bundle.certificate.id)}
              >
                Open certificate
              </Button>
            </div>
          ))
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={busy || history.isFetching || historyPage === 0}
            onClick={() => setHistoryPage((v) => v - 1)}
          >
            Newer certificates
          </Button>
          <span className="text-sm">Page {historyPage + 1}</span>
          <Button
            variant="outline"
            disabled={busy || history.isFetching || history.data?.length !== 25}
            onClick={() => setHistoryPage((v) => v + 1)}
          >
            Older certificates
          </Button>
        </div>
      </div>
      {opened && (
        <div className="space-y-3 rounded-lg border p-3">
          <h4 className="font-semibold">
            Opened certificate {opened.certificate.id}
          </h4>
          {opened.events.length > 0 && (
            <p role="status">
              Invalidated — this copy is retained for historical reference.
            </p>
          )}
          <SnapshotReview snapshot={opened.certificate.snapshot} />
          <p className="text-sm">{opened.certificate.attestation}</p>
          <p>
            Signed by {opened.certificate.signature_name} ·{" "}
            {denverLocal(opened.certificate.issued_at).replace("T", " ")}{" "}
            America/Denver
          </p>
          <Button disabled={busy} onClick={print}>
            Open print dialog
          </Button>
          {eligible && (
            <>
              <Button
                variant="outline"
                disabled={busy || !!pending}
                onClick={() => {
                  edit();
                  setKind(opened.certificate.kind);
                  setTreatment(
                    opened.certificate.kind === "rabies"
                      ? opened.certificate.snapshot.vaccinations[0].treatment_id
                      : "",
                  );
                  setDetails(opened.certificate.snapshot.details);
                  setReplacement(opened.certificate.id);
                  setReason("");
                }}
              >
                Prepare corrected reissue
              </Button>
              <Label htmlFor={`void-${petId}`}>
                Reason to void this certificate
              </Label>
              <Input
                id={`void-${petId}`}
                maxLength={2000}
                value={voidReason}
                disabled={busy || !!voidRef.current}
                onChange={(e) => setVoidReason(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={busy || !!pending || !voidReason.trim()}
                onClick={() => void voidCertificate()}
              >
                {voidRef.current
                  ? "Retry same void request"
                  : "Void certificate"}
              </Button>
            </>
          )}
        </div>
      )}
      {!eligible ? (
        <p className="rounded-md bg-muted p-3 text-sm">
          Issuance requires an active DVM account with operator-verified
          Colorado credentials and recorded clinical acceptance. Ask the
          practice administrator to arrange verification; this screen cannot
          verify or activate credentials.
        </p>
      ) : (
        <div className="space-y-3 border-t pt-4">
          <h4 className="font-semibold">
            {replacement ? "Corrected reissue" : "Prepare a certificate"}
          </h4>
          <Button
            variant="outline"
            disabled={busy || !!pending}
            onClick={() => {
              edit();
              setDetails({});
              setTreatment("");
              setReplacement(null);
              setReason("");
            }}
          >
            Clear certificate form
          </Button>
          <fieldset
            disabled={busy || !!preview || !!pending}
            className="space-y-3"
          >
            <Label htmlFor={`cert-kind-${petId}`}>Certificate type</Label>
            <select
              id={`cert-kind-${petId}`}
              className="w-full rounded-md border bg-background p-2"
              value={kind}
              onChange={(e) => {
                edit();
                setKind(e.target.value as PreviewArgs["p_kind"]);
                setReplacement(null);
              }}
            >
              <option value="vaccine_history">
                All recorded vaccine history and due dates
              </option>
              <option value="rabies">Rabies vaccination certificate</option>
            </select>
            {kind === "rabies" && (
              <>
                <Label htmlFor={`cert-dose-${petId}`}>
                  Rabies administration to certify
                </Label>
                <select
                  id={`cert-dose-${petId}`}
                  className="w-full rounded-md border bg-background p-2"
                  value={treatment}
                  onChange={(e) => {
                    edit();
                    setTreatment(e.target.value);
                  }}
                >
                  <option value="">
                    Choose a reviewed rabies administration
                  </option>
                  {treatment &&
                    !vaccines.data?.some((v) => v.id === treatment) && (
                      <option value={treatment}>
                        Previously certified administration {treatment}
                      </option>
                    )}
                  {vaccines.data
                    ?.filter((v) => !v.historical)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.product_name} ·{" "}
                        {denverLocal(v.administered_at).replace("T", " ")}{" "}
                        America/Denver · Due {v.next_due_on || "not recorded"}
                      </option>
                    ))}
                </select>
                <p className="text-sm text-muted-foreground">
                  Select only an actual rabies administration. Corrected records
                  and missing required metadata are rejected during preview.
                  External certificates remain attached originals. The selector
                  shows the 100 most recent vaccine entries; an older reissue
                  retains its original source identifier.
                </p>
                {(
                  [
                    "administrator",
                    "rabies_tag_number",
                    "vaccine_type",
                    "size_description",
                    "owner_business_phone",
                  ] as const
                ).map((key) => (
                  <div key={key}>
                    <Label htmlFor={`${petId}-${key}`}>
                      {
                        {
                          administrator: "Actual administrator",
                          rabies_tag_number: "Rabies tag number",
                          vaccine_type: "Vaccine formulation / type",
                          size_description: "Reviewed size or weight",
                          owner_business_phone: "Owner business phone",
                        }[key]
                      }
                    </Label>
                    <Input
                      id={`${petId}-${key}`}
                      maxLength={1000}
                      value={details[key] || ""}
                      onChange={(e) => setDetail(key, e.target.value)}
                    />
                  </div>
                ))}
                <Label htmlFor={`duration-${petId}`}>
                  USDA licensed product duration
                </Label>
                <select
                  id={`duration-${petId}`}
                  value={details.usda_duration || ""}
                  className="w-full rounded-md border bg-background p-2"
                  onChange={(e) => setDetail("usda_duration", e.target.value)}
                >
                  <option value="">Select from the product label</option>
                  <option>1 year</option>
                  <option>3 years</option>
                  <option>other licensed duration</option>
                </select>
                <p className="text-sm">
                  For another licensed duration, enter the exact duration in
                  vaccine formulation/type. This does not calculate the due
                  date.
                </p>
                <Label htmlFor={`sequence-${petId}`}>
                  Initial vaccination or booster
                </Label>
                <select
                  id={`sequence-${petId}`}
                  value={details.initial_or_booster || ""}
                  className="w-full rounded-md border bg-background p-2"
                  onChange={(e) =>
                    setDetail("initial_or_booster", e.target.value)
                  }
                >
                  <option value="">Select reviewed sequence</option>
                  <option value="initial">Initial</option>
                  <option value="booster">Booster</option>
                </select>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={!!details.owner_business_phone_unavailable}
                    onChange={(e) =>
                      setDetail(
                        "owner_business_phone_unavailable",
                        e.target.checked,
                      )
                    }
                  />
                  Owner business phone confirmed unavailable
                </label>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={!!details.supervision_attested}
                    onChange={(e) =>
                      setDetail("supervision_attested", e.target.checked)
                    }
                  />
                  I confirm the named administrator, applicable supervision and
                  training.
                </label>
              </>
            )}
            {replacement && (
              <>
                <p>Replacing {replacement}</p>
                <Label htmlFor={`reissue-${petId}`}>Correction reason</Label>
                <Input
                  id={`reissue-${petId}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={2000}
                />
              </>
            )}
          </fieldset>
          {!preview ? (
            <Button
              disabled={busy || !!pending || (!!replacement && !reason.trim())}
              onClick={() => void loadPreview()}
            >
              Review certificate preview
            </Button>
          ) : (
            <>
              <SnapshotReview snapshot={preview} />
              <Button
                variant="outline"
                disabled={busy || !!pending}
                onClick={edit}
              >
                Edit and review again
              </Button>
              <p className="text-sm">{attestations[preview.kind]}</p>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={attested}
                  disabled={busy || !!pending}
                  onChange={(e) => setAttested(e.target.checked)}
                />
                I reviewed every displayed field and date and explicitly sign
                this certificate.
              </label>
              <Label htmlFor={`signature-${petId}`}>
                Type your verified name: {issuer.data?.full_name}
              </Label>
              <Input
                id={`signature-${petId}`}
                autoComplete="off"
                value={signature}
                disabled={busy || !!pending}
                onChange={(e) => setSignature(e.target.value)}
              />
              <Button
                disabled={
                  busy ||
                  (!pending &&
                    (!attested || signature !== issuer.data?.full_name))
                }
                onClick={() => void issue()}
              >
                {pending
                  ? "Retry same signed request"
                  : "Sign and issue certificate"}
              </Button>
              {pending && (
                <p role="status">
                  The result is uncertain. Keep this page open and retry the
                  identical signed request; do not start another certificate.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
