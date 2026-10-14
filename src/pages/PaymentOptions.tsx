import { Link } from "react-router-dom";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { usePublicRouteMetadata } from "@/hooks/use-page-title";
import { practice } from "@/config/practice";

export default function PaymentOptions() {
  usePublicRouteMetadata("/payment-options");

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main-content" className="flex-grow">
        <section className="pt-32 pb-14 bg-cream">
          <div className="container max-w-3xl">
            <p className="text-primary font-medium mb-3">Planning for your pet’s care</p>
            <h1 className="font-heading text-4xl sm:text-5xl font-bold text-foreground mb-6">Payment options</h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Understanding the cost is part of choosing care. We’ll walk through your
              pet’s recommended treatment and a written estimate, with time for your questions.
            </p>
          </div>
        </section>

        <div className="container max-w-3xl py-12 space-y-12">
          <section aria-labelledby="payment-planning">
            <h2 id="payment-planning" className="font-heading text-2xl font-semibold mb-4">Before your visit</h2>
            <p className="text-muted-foreground leading-relaxed">
              We’re preparing secure online payments and an optional way to pay over time
              with Affirm. Payment options will be confirmed before appointments open.
              Please ask our team about availability for your visit.
            </p>
          </section>

          <section aria-labelledby="affirm-heading" className="rounded-2xl border border-border bg-cream-light p-6 sm:p-8">
            <h2 id="affirm-heading" className="font-heading text-2xl font-semibold mb-4">About paying over time with Affirm</h2>
            <p className="text-muted-foreground leading-relaxed">
              Affirm lets eligible clients spread the cost of a purchase over time.
              Financing is optional. You can review any offer’s interest, payment schedule,
              and total repayment amount before deciding whether to accept it.
            </p>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Approval and available plans are determined by Affirm. An offer may include
              interest or require an initial payment, and availability depends on the
              purchase and your eligibility. Our team cannot guarantee approval or a particular plan.
            </p>
            <p className="mt-5 text-sm text-foreground leading-relaxed">
              Subject to eligibility. See lending terms at{" "}
              <a href="https://www.affirm.com/disclosures" className="underline underline-offset-4">affirm.com/disclosures</a>.
            </p>
          </section>

          <section aria-labelledby="payment-questions">
            <h2 id="payment-questions" className="font-heading text-2xl font-semibold mb-6">A few common questions</h2>
            <div className="space-y-6">
              <div>
                <h3 className="font-heading text-lg font-semibold mb-2">How would I choose Affirm?</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Once online payments are available, eligible purchases may show Affirm
                  as an option at checkout. If you choose it, you’ll complete the application
                  directly with Affirm and review the terms there.
                </p>
              </div>
              <div>
                <h3 className="font-heading text-lg font-semibold mb-2">Do I need financing to receive care?</h3>
                <p className="text-muted-foreground leading-relaxed">
                  No. Financing is a choice, not a requirement. We’ll confirm payment
                  arrangements with you before your visit. If cost is a concern, please
                  tell us so we can discuss your pet’s care options and estimate together.
                </p>
              </div>
              <div>
                <h3 className="font-heading text-lg font-semibold mb-2">Who can answer my questions?</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Our team can help with estimates, invoices, and availability.
                  For questions about a financing application or an existing loan, visit{" "}
                  <a href="https://www.affirm.com/help" className="text-primary underline underline-offset-4">Affirm’s help center</a>.
                  Please keep financial application details out of our contact form.
                </p>
              </div>
            </div>
            <Link to={practice.contactPath} className="inline-block mt-8 text-primary underline underline-offset-4">
              Ask us about payment options
            </Link>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
