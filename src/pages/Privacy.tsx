import { practice } from "@/config/practice";
import { usePublicRouteMetadata } from "@/hooks/use-page-title";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

interface LegalSection {
  title: string;
  body: readonly string[];
}

const privacySections: readonly LegalSection[] = [
  {
    title: "Information You Share With Us",
    body: [
      "When you submit the contact form, we collect the name, email address, optional phone number, subject, and message you provide so the practice can review and respond to your request.",
      "Please do not send payment details, full medical records, or urgent medical requests through the public website form.",
    ],
  },
  {
    title: "Website and Service Providers",
    body: [
      "The website may process basic technical information needed to load pages, protect the site, and receive form submissions through our hosting, database, and mapping providers.",
      "The contact form is a request for follow-up. It is not monitored as an emergency channel and does not create a confirmed appointment.",
    ],
  },
  {
    title: "How We Use Information",
    body: [
      "We use submitted information to respond to requests, prepare for launch, understand service interest, and maintain the public website.",
      "We do not sell personal information submitted through this website.",
    ],
  },
  {
    title: "Updates",
    body: [
      "This policy may be updated as the practice opens, confirms contact channels, and adds owner-approved services.",
      "Questions about this policy can be sent through the contact form until phone and email details are published.",
    ],
  },
];

const Privacy = () => {
  usePublicRouteMetadata("/privacy");

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main-content" className="flex-grow">
        <section className="pt-32 pb-16 bg-cream">
          <div className="container max-w-3xl">
            <p className="text-primary font-medium mb-3">Legal</p>
            <h1 className="font-heading text-4xl sm:text-5xl font-bold text-foreground mb-6">
              Privacy Policy
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              This privacy policy explains how {practice.name} handles information submitted through this public website while the practice prepares to open.
            </p>
            <p className="text-sm text-muted-foreground mt-6">
              Last updated September 22, 2026
            </p>
          </div>
        </section>

        <section className="py-16 bg-background">
          <div className="container max-w-3xl space-y-10">
            {privacySections.map((section) => (
              <section key={section.title} aria-labelledby={section.title.replace(/\s+/g, "-").toLowerCase()}>
                <h2 id={section.title.replace(/\s+/g, "-").toLowerCase()} className="font-heading text-2xl font-semibold text-foreground mb-4">
                  {section.title}
                </h2>
                <div className="space-y-4 text-muted-foreground leading-relaxed">
                  {section.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}

            <div className="pt-4 flex flex-col sm:flex-row gap-4">
              <Link to={practice.contactPath}>
                <Button variant="default" size="lg">Contact the Practice</Button>
              </Link>
              <Link to="/terms">
                <Button variant="outline" size="lg">View Terms</Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Privacy;
