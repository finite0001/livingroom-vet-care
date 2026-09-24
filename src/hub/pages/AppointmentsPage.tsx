import { useEffect, useMemo, useState } from "react";
import type { ElementType } from "react";
import { addMinutes, format, isToday, parseISO } from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Home,
  PawPrint,
  Pencil,
  Plus,
  Search,
  Stethoscope,
  UserRound,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/hub/components/shared/EmptyState";
import { useClients, type ClientWithPets } from "@/hub/hooks/use-clients";
import { useDvms } from "@/hub/hooks/use-profiles";
import {
  APPOINTMENT_STATUSES,
  appointmentStatusLabel,
  useCancelAppointment,
  useCreateAppointment,
  useAppointmentsForDay,
  useUpdateAppointment,
  type AppointmentStatus,
  type AppointmentWithDetails,
} from "@/hub/hooks/use-appointments";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";

const NO_PET = "__no_pet__";
const UNASSIGNED = "__unassigned__";

const STATUS_VARIANTS: Record<AppointmentStatus, "default" | "secondary" | "destructive" | "outline"> = {
  SCHEDULED: "secondary",
  CONFIRMED: "default",
  CANCELLED: "destructive",
  COMPLETED: "outline",
  NO_SHOW: "destructive",
};

function dateInputValue(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

function parseDateInput(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function defaultDateTimeValue(day: Date): string {
  const value = new Date(day);
  value.setHours(9, 0, 0, 0);
  return format(value, "yyyy-MM-dd'T'HH:mm");
}

function dateTimeInputValue(value: string): string {
  return format(parseISO(value), "yyyy-MM-dd'T'HH:mm");
}

function dateTimeInputToIso(value: string): string {
  return new Date(value).toISOString();
}

interface AppointmentFormValues {
  appointmentType: string;
  assignedDvmId: string;
  clientId: string;
  durationMinutes: string;
  notes: string;
  petId: string;
  scheduledAt: string;
  status: AppointmentStatus;
}

function valuesFromAppointment(appointment: AppointmentWithDetails): AppointmentFormValues {
  return {
    appointmentType: appointment.appointment_type,
    assignedDvmId: appointment.assigned_dvm_id ?? UNASSIGNED,
    clientId: appointment.client_id,
    durationMinutes: String(appointment.duration_minutes),
    notes: appointment.notes ?? "",
    petId: appointment.pet_id ?? NO_PET,
    scheduledAt: dateTimeInputValue(appointment.scheduled_at),
    status: appointment.status,
  };
}

function emptyAppointmentValues(day: Date): AppointmentFormValues {
  return {
    appointmentType: "Housecall visit",
    assignedDvmId: UNASSIGNED,
    clientId: "",
    durationMinutes: "60",
    notes: "",
    petId: NO_PET,
    scheduledAt: defaultDateTimeValue(day),
    status: "SCHEDULED",
  };
}

export default function AppointmentsPage() {
  usePageTitle("Appointments");
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [formOpen, setFormOpen] = useState(false);
  const { data: appointments, isLoading, isError } = useAppointmentsForDay(selectedDay);

  const counts = useMemo(() => {
    const rows = appointments ?? [];
    return {
      total: rows.length,
      active: rows.filter((appointment) => appointment.status !== "CANCELLED").length,
      confirmed: rows.filter((appointment) => appointment.status === "CONFIRMED").length,
      completed: rows.filter((appointment) => appointment.status === "COMPLETED").length,
    };
  }, [appointments]);

  const moveDay = (offset: number) => {
    setSelectedDay((current) => {
      const next = new Date(current);
      next.setDate(current.getDate() + offset);
      return next;
    });
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b bg-card">
        <div className="flex h-14 items-center justify-between px-4">
          <div>
            <h1 className="text-lg font-semibold">Appointments</h1>
            <p className="text-xs text-muted-foreground">{format(selectedDay, "EEEE, MMMM d")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSelectedDay(new Date())}>
              Today
            </Button>
            <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 pb-3">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => moveDay(-1)} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            aria-label="Appointment date"
            type="date"
            value={dateInputValue(selectedDay)}
            onChange={(event) => {
              if (event.target.value) setSelectedDay(parseDateInput(event.target.value));
            }}
            className="h-9"
          />
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => moveDay(1)} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-2 border-b bg-muted/30 p-3 md:grid-cols-4" aria-label="Appointment summary">
        <SummaryStat label="Total" value={counts.total} />
        <SummaryStat label="Active" value={counts.active} />
        <SummaryStat label="Confirmed" value={counts.confirmed} />
        <SummaryStat label="Completed" value={counts.completed} />
      </section>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-2 p-4">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, index) => (
              <Skeleton key={index} className="h-32 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={CalendarDays}
            title="Failed to load appointments"
            description="Something went wrong while loading this day."
          />
        ) : !appointments || appointments.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={isToday(selectedDay) ? "No appointments today" : "No appointments scheduled"}
            description="Appointments from the existing schedule will appear here."
          />
        ) : (
          appointments.map((appointment) => (
            <AppointmentCard key={appointment.id} appointment={appointment} />
          ))
        )}
      </main>

      <AppointmentFormSheet open={formOpen} onOpenChange={setFormOpen} selectedDay={selectedDay} />
    </div>
  );
}

interface SummaryStatProps {
  label: string;
  value: number;
}

function SummaryStat({ label, value }: SummaryStatProps) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

interface AppointmentCardProps {
  appointment: AppointmentWithDetails;
}

function AppointmentCard({ appointment }: AppointmentCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancelAppointment = useCancelAppointment();
  const startsAt = parseISO(appointment.scheduled_at);
  const endsAt = addMinutes(startsAt, appointment.duration_minutes);
  const contact = appointment.client?.primary_phone ?? appointment.client?.primary_email ?? "No contact on file";
  const canCancel = appointment.status !== "CANCELLED" && appointment.status !== "COMPLETED";

  const handleCancel = () => {
    cancelAppointment.mutate({ id: appointment.id, expected_version: appointment.version }, {
      onSuccess: () => {
        toast.success("Appointment cancelled");
        setConfirmCancel(false);
      },
      onError: () => toast.error("Failed to cancel appointment"),
    });
  };

  return (
    <>
      <Card className={cn(appointment.status === "CANCELLED" && "opacity-75")}>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold">{appointment.appointment_type}</p>
                <Badge variant={STATUS_VARIANTS[appointment.status]}>{appointmentStatusLabel(appointment.status)}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {format(startsAt, "h:mm a")} to {format(endsAt, "h:mm a")}
                </span>
                <span>{appointment.duration_minutes} min</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              {appointment.ezyvet_appointment_id && (
                <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                  ezyVet {appointment.ezyvet_appointment_id}
                </p>
              )}
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
              {canCancel && (
                <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setConfirmCancel(true)}>
                  <XCircle className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <RecordLink
              icon={UserRound}
              label="Client"
              value={appointment.client?.full_name ?? "Unknown client"}
              to={appointment.client ? `/hub/client/${appointment.client.id}` : undefined}
              detail={contact}
            />
            <RecordLink
              icon={PawPrint}
              label="Patient"
              value={appointment.pet?.name ?? "No patient linked"}
              to={appointment.pet ? `/hub/patient/${appointment.pet.id}` : undefined}
              detail={appointment.pet ? [appointment.pet.species, appointment.pet.breed].filter(Boolean).join(" · ") : undefined}
            />
            <RecordLink
              icon={Stethoscope}
              label="DVM"
              value={appointment.assigned_dvm?.full_name ?? "Unassigned"}
            />
          </div>

          {(appointment.client?.housecall_address || appointment.notes) && (
            <div className="space-y-2 border-t pt-3 text-sm">
              {appointment.client?.housecall_address && (
                <p className="flex gap-2 text-muted-foreground">
                  <Home className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{appointment.client.housecall_address}</span>
                </p>
              )}
              {appointment.notes && <p className="text-muted-foreground">{appointment.notes}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <AppointmentFormSheet appointment={appointment} open={editing} onOpenChange={setEditing} selectedDay={startsAt} />

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks the appointment for {appointment.client?.full_name ?? "this client"} as cancelled. It will stay visible in the schedule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelAppointment.isPending}>Keep appointment</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleCancel();
              }}
              disabled={cancelAppointment.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelAppointment.isPending ? "Cancelling..." : "Cancel appointment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface AppointmentFormSheetProps {
  appointment?: AppointmentWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDay: Date;
}

function AppointmentFormSheet({ appointment, open, onOpenChange, selectedDay }: AppointmentFormSheetProps) {
  const createAppointment = useCreateAppointment();
  const updateAppointment = useUpdateAppointment();
  const [clientSearch, setClientSearch] = useState("");
  const { data: clients } = useClients(clientSearch);
  const { data: dvms } = useDvms();
  const [selectedClient, setSelectedClient] = useState<ClientWithPets | null>(null);
  const [values, setValues] = useState<AppointmentFormValues>(() => (
    appointment ? valuesFromAppointment(appointment) : emptyAppointmentValues(selectedDay)
  ));
  const selectedDayTime = selectedDay.getTime();

  useEffect(() => {
    if (!open) return;
    setValues(appointment ? valuesFromAppointment(appointment) : emptyAppointmentValues(new Date(selectedDayTime)));
    setClientSearch(appointment?.client?.full_name ?? "");
    setSelectedClient(null);
  }, [appointment, open, selectedDayTime]);

  const loadedClient = selectedClient ?? clients?.find((client) => client.id === values.clientId) ?? null;
  const q = clientSearch.trim().toLowerCase();
  const matches = (clients ?? [])
    .filter((client) => !q || client.full_name.toLowerCase().includes(q))
    .slice(0, 8);
  const saving = createAppointment.isPending || updateAppointment.isPending;

  const changeOpen = (next: boolean) => {
    if (saving) return;
    if (!next) {
      setClientSearch("");
      setSelectedClient(null);
    }
    onOpenChange(next);
  };

  const setValue = <K extends keyof AppointmentFormValues>(key: K, value: AppointmentFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const pickClient = (client: ClientWithPets) => {
    setSelectedClient(client);
    setClientSearch(client.full_name);
    setValues((current) => ({
      ...current,
      clientId: client.id,
      petId: client.pets[0]?.id ?? NO_PET,
    }));
  };

  const submit = () => {
    const duration = Number(values.durationMinutes);
    if (!values.clientId) {
      toast.error("Pick a client");
      return;
    }
    if (!values.appointmentType.trim()) {
      toast.error("Enter an appointment type");
      return;
    }
    if (!values.scheduledAt || Number.isNaN(new Date(values.scheduledAt).getTime())) {
      toast.error("Pick a valid appointment time");
      return;
    }
    if (!Number.isFinite(duration) || duration < 15) {
      toast.error("Duration must be at least 15 minutes");
      return;
    }

    const input = {
      appointment_type: values.appointmentType.trim(),
      assigned_dvm_id: values.assignedDvmId === UNASSIGNED ? null : values.assignedDvmId,
      client_id: values.clientId,
      duration_minutes: duration,
      notes: values.notes.trim() || null,
      pet_id: values.petId === NO_PET ? null : values.petId,
      scheduled_at: dateTimeInputToIso(values.scheduledAt),
      status: values.status,
    };

    if (appointment) {
      updateAppointment.mutate(
        { id: appointment.id, expected_version: appointment.version, ...input },
        {
          onSuccess: () => {
            toast.success("Appointment saved");
            setClientSearch("");
            setSelectedClient(null);
            onOpenChange(false);
          },
          onError: () => toast.error("Failed to save appointment"),
        },
      );
      return;
    }

    createAppointment.mutate(input, {
      onSuccess: () => {
        toast.success("Appointment created");
        setClientSearch("");
        setSelectedClient(null);
        onOpenChange(false);
      },
      onError: () => toast.error("Failed to create appointment"),
    });
  };

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{appointment ? "Edit appointment" : "New appointment"}</SheetTitle>
        </SheetHeader>
        <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <fieldset disabled={saving} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">Client *</Label>
              {loadedClient ? (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{loadedClient.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{loadedClient.pets.map((pet) => pet.name).join(", ") || "No pets on file"}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={() => {
                      setSelectedClient(null);
                      setValue("clientId", "");
                      setValue("petId", NO_PET);
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search clients..." className="pl-9" />
                  </div>
                  <div className="max-h-52 space-y-1 overflow-y-auto">
                    {matches.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => pickClient(client)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="min-w-0 truncate font-medium">{client.full_name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{client.pets.length} pet{client.pets.length === 1 ? "" : "s"}</span>
                      </button>
                    ))}
                    {q && matches.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No clients found.</p>}
                  </div>
                </>
              )}
            </div>

            {loadedClient && (
              <div className="space-y-1.5">
                <Label className="text-sm">Patient</Label>
                <Select value={values.petId} onValueChange={(value) => setValue("petId", value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PET}>No patient linked</SelectItem>
                    {loadedClient.pets.map((pet) => (
                      <SelectItem key={pet.id} value={pet.id}>{pet.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="appointment-type" className="text-sm">Appointment type *</Label>
                <Input id="appointment-type" value={values.appointmentType} onChange={(event) => setValue("appointmentType", event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="appointment-duration" className="text-sm">Duration minutes *</Label>
                <Input id="appointment-duration" type="number" min={15} step={15} value={values.durationMinutes} onChange={(event) => setValue("durationMinutes", event.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="appointment-time" className="text-sm">Date and time *</Label>
                <Input id="appointment-time" type="datetime-local" value={values.scheduledAt} onChange={(event) => setValue("scheduledAt", event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Assigned DVM</Label>
                <Select value={values.assignedDvmId} onValueChange={(value) => setValue("assignedDvmId", value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {(dvms ?? []).map((dvm) => (
                      <SelectItem key={dvm.id} value={dvm.id}>{dvm.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {appointment && (
              <div className="space-y-1.5">
                <Label className="text-sm">Status</Label>
                <Select value={values.status} onValueChange={(value) => setValue("status", value as AppointmentStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {APPOINTMENT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>{appointmentStatusLabel(status)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="appointment-notes" className="text-sm">Notes</Label>
              <Textarea id="appointment-notes" value={values.notes} onChange={(event) => setValue("notes", event.target.value)} rows={3} />
            </div>

            <Button type="submit" className="w-full">
              {saving ? "Saving..." : appointment ? "Save appointment" : "Create appointment"}
            </Button>
          </fieldset>
        </form>
      </SheetContent>
    </Sheet>
  );
}

interface RecordLinkProps {
  icon: ElementType;
  label: string;
  value: string;
  detail?: string;
  to?: string;
}

function RecordLink({ icon: Icon, label, value, detail, to }: RecordLinkProps) {
  const content = (
    <>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
        {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
      </div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className="flex min-w-0 items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent">
        {content}
      </Link>
    );
  }

  return <div className="flex min-w-0 items-center gap-3 rounded-lg border p-3">{content}</div>;
}
