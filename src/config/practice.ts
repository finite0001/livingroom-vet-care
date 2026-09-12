export interface PracticeLaunchStage {
  serviceMode: "housecall" | "clinic";
  label: string;
  status: "planned" | "open";
  targetWindow: string;
}

export interface PracticeSettings {
  name: string;
  address: { street: string; city: string; state: string };
  timezone: string;
  phone: string | null;
  email: string | null;
  emergencyPhone: string | null;
  domain: string | null;
  hours: string | null;
  contactPath: string;
  launchStages: readonly PracticeLaunchStage[];
}

// Publish contacts and opening hours only after the practice confirms them.
// Target windows are planning estimates, not confirmed appointment availability.
export const practice: PracticeSettings = {
  name: "The Living Room Vet",
  address: { street: "2619 Spruce Street", city: "Boulder", state: "CO" },
  timezone: "America/Denver",
  phone: null,
  email: null,
  emergencyPhone: null,
  domain: "thelivingroom.vet",
  hours: "Monday–Saturday, 9 am–5 pm Mountain Time",
  contactPath: "/contact#contact-form",
  launchStages: [
    { serviceMode: "housecall", label: "Housecalls", status: "planned", targetWindow: "Late October 2026" },
    { serviceMode: "clinic", label: "Clinic", status: "planned", targetWindow: "Early 2027" },
  ],
};

export const practiceAddress = `${practice.address.street}, ${practice.address.city}, ${practice.address.state}`;
export const practiceMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(practiceAddress)}`;
export const practiceLaunchSummary = practice.launchStages
  .map((stage) => `${stage.label}: ${stage.status === "open" ? "open" : `targeting ${stage.targetWindow.toLowerCase()}`}`)
  .join(" · ");
