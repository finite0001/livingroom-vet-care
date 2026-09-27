import { practice, practiceLaunchSummary } from "@/config/practice";
import { usePublicRouteMetadata } from "@/hooks/use-page-title";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

interface LegalSection {
  title: string;
  body: readonly string[];
}

const termsSections: readonly LegalSection[] = [
  {
    title: "Website Information",
    body: [
      "This website provides general information about the veterinary care experience and services {practiceName} is preparing to offer.",
      "Service descriptions, launch timing, hours, and availability may change before appointments open.",
    ],
  },
  {
    title: "No Emergency Monitoring",
    body: [
      "The public website and contact form are not emergency or urgent-care channels.",
      "If your pet needs urgent help, contact an open veterinary emergency hospital directly.",
    ],
  },
  {
    title: "Requests and Appointments",
    body: [
      "Submitting the contact form requests follow-up only. It does not create a veterinarian-client-patient relationship, reserve an appointment, or guarantee service availability.",
      "Appointments, payment expectations, and visit details are confirmed only after direct communication from the practice.",
    ],
  },
  {
    title: "Text Message Program",
    body: [
      "The {practiceName} client text message program is operated by The Living Room Vet PLLC. We send text messages only to clients who agree to receive them. Messages cover appointment confirmations and reminders, visit follow-ups, prescription and refill notices, and replies to questions you send us. We do not send marketing messages through this program.",
      "You can agree to receive text messages by entering your mobile number on our website contact form and checking the optional text message consent box. Consent to receive text messages is not a condition of any purchase or service.",
      "Message frequency varies. Message and data rates may apply. Reply STOP to any message to opt out; you will receive one confirmation and no further messages. Reply HELP for help, or call us at (720) 764-6677.",
      "Mobile carriers are not liable for delayed or undelivered messages. Your mobile information is handled as described in our Privacy Policy and is never shared with third parties or affiliates for marketing purposes.",
    ],
  },
  {
    title: "Content and Links",
    body: [
      "Website content is provided for general planning and informational purposes. It should not replace individualized veterinary advice.",
      "External links, including maps, are provided for convenience and may be governed by the linked provider's own terms.",
    ],
  },
];

const Terms = () => {
  usePublicRouteMetadata("/terms");

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main-content" className="flex-grow">
        <section className="pt-32 pb-16 bg-cream">
          <div className="container max-w-3xl">
            <p className="text-primary font-medium mb-3">Legal</p>
            <h1 className="font-heading text-4xl sm:text-5xl font-bold text-foreground mb-6">
              Terms
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              These terms cover the public website and text message program for {practice.name}. {practiceLaunchSummary}. Targets are subject to change.
            </p>
            <p className="text-sm text-muted-foreground mt-6">
              Last updated September 27, 2026
            </p>
          </div>
        </section>

        <section className="py-16 bg-background">
          <div className="container max-w-3xl space-y-10">
            {termsSections.map((section) => (
              <section key={section.title} aria-labelledby={section.title.replace(/\s+/g, "-").toLowerCase()}>
                <h2 id={section.title.replace(/\s+/g, "-").toLowerCase()} className="font-heading text-2xl font-semibold text-foreground mb-4">
                  {section.title}
                </h2>
                <div className="space-y-4 text-muted-foreground leading-relaxed">
                  {section.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph.replace("{practiceName}", practice.name)}</p>
                  ))}
                </div>
              </section>
            ))}

            <div className="pt-4 flex flex-col sm:flex-row gap-4">
              <Link to={practice.contactPath}>
                <Button variant="default" size="lg">Contact the Practice</Button>
              </Link>
              <Link to="/privacy">
                <Button variant="outline" size="lg">View Privacy Policy</Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Terms;
