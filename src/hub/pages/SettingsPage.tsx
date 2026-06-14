import { useState, useEffect } from "react";
import { Pen, Database, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/hub/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { useSignature, useUpdateSignature } from "@/hub/hooks/use-signature";
import { useAppSettings, useUpdateAppSetting } from "@/hub/hooks/use-app-settings";

export default function SettingsPage() {
  usePageTitle("Settings");
  const { hasRole } = useAuth();
  const isAdmin = hasRole("ADMIN");

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        <SignatureSection />
        {isAdmin ? (
          <ClinicSettings />
        ) : (
          <p className="px-1 text-xs text-muted-foreground">
            Clinic-wide settings are managed by administrators.
          </p>
        )}
      </div>
    </div>
  );
}

function SignatureSection() {
  const { data: signature, isLoading } = useSignature();
  const update = useUpdateSignature();
  const [value, setValue] = useState("");
  useEffect(() => { if (signature !== undefined && signature !== null) setValue(signature); }, [signature]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Pen className="h-4 w-4 text-primary" /> Email signature</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Appended to your outgoing emails (used once email sending is enabled).</p>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={"e.g.\nDr. Jane Smith, DVM\nLiving Room Vet Care"}
          rows={4}
          className="text-sm"
          disabled={isLoading}
        />
        <Button
          size="sm" variant="outline" className="w-full"
          disabled={update.isPending}
          onClick={() => update.mutate(value, {
            onSuccess: () => toast.success("Signature saved"),
            onError: () => toast.error("Failed to save signature"),
          })}
        >
          {update.isPending ? "Saving…" : "Save signature"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ClinicSettings() {
  const { data: settings, isLoading } = useAppSettings();
  const update = useUpdateAppSetting();

  // Local mirror of the editable numeric fields (booleans toggle immediately).
  const [archiveDays, setArchiveDays] = useState("365");
  const [purgeDays, setPurgeDays] = useState("730");
  const [wellnessDays, setWellnessDays] = useState("30");
  useEffect(() => {
    if (!settings) return;
    if (settings.retention_archive_days) setArchiveDays(settings.retention_archive_days);
    if (settings.retention_purge_days) setPurgeDays(settings.retention_purge_days);
    if (settings.wellness_reminder_days_before) setWellnessDays(settings.wellness_reminder_days_before);
  }, [settings]);

  const isOn = (key: string) => settings?.[key] === "true";

  const toggle = (key: string, label: string) => (next: boolean) => {
    update.mutate({ key, value: String(next) }, {
      onSuccess: () => toast.success(`${label} ${next ? "enabled" : "disabled"}`),
      onError: () => toast.error(`Failed to update ${label.toLowerCase()}`),
    });
  };

  const saveValue = (key: string, value: string, label: string) => {
    update.mutate({ key, value }, {
      onSuccess: () => toast.success(`${label} saved`),
      onError: () => toast.error(`Failed to save ${label.toLowerCase()}`),
    });
  };

  if (isLoading) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading clinic settings…</CardContent></Card>;
  }

  return (
    <>
      {/* Data retention */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4 text-primary" /> Data retention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Auto archive &amp; purge</p>
              <p className="text-xs text-muted-foreground">Archive inactive conversations, then purge old archived ones.</p>
            </div>
            <Switch checked={isOn("retention_enabled")} onCheckedChange={toggle("retention_enabled", "Data retention")} aria-label="Enable data retention" />
          </div>
          {isOn("retention_enabled") && (
            <div className="space-y-3 border-t pt-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm text-muted-foreground">Archive after</Label>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={30} value={archiveDays} onChange={(e) => setArchiveDays(e.target.value)} className="h-8 w-20 text-right text-sm" />
                  <span className="text-xs text-muted-foreground">days</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm text-muted-foreground">Purge after</Label>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={30} value={purgeDays} onChange={(e) => setPurgeDays(e.target.value)} className="h-8 w-20 text-right text-sm" />
                  <span className="text-xs text-muted-foreground">days</span>
                </div>
              </div>
              <Button size="sm" variant="outline" className="w-full" disabled={update.isPending} onClick={() => {
                saveValue("retention_archive_days", archiveDays, "Archive period");
                saveValue("retention_purge_days", purgeDays, "Purge period");
              }}>Save retention periods</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wellness reminders */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Wellness reminders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Send reminders</p>
              <p className="text-xs text-muted-foreground">Notify clients when vaccinations or checkups are coming due.</p>
            </div>
            <Switch checked={isOn("wellness_reminders_enabled")} onCheckedChange={toggle("wellness_reminders_enabled", "Wellness reminders")} aria-label="Enable wellness reminders" />
          </div>
          {isOn("wellness_reminders_enabled") && (
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <Label className="text-sm text-muted-foreground">Send reminder</Label>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={1} max={90} value={wellnessDays} onChange={(e) => setWellnessDays(e.target.value)} className="h-8 w-20 text-right text-sm" />
                <span className="text-xs text-muted-foreground">days before</span>
              </div>
              <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => saveValue("wellness_reminder_days_before", wellnessDays, "Reminder lead time")}>Save</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* NOTE: AI triage and after-hours toggles are intentionally omitted until
          their backend handlers are ported from vet-connect-hub — a persisted
          toggle with no consumer would mislead admins into thinking it does
          something. They return with those features. */}
    </>
  );
}
