import { practice, practiceLaunchSummary } from "@/config/practice";
import React from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import ScrollReveal from "@/components/ScrollReveal";

const CTASection = React.forwardRef<HTMLElement>((_, ref) => {
  return (
    <section ref={ref} className="py-24 bg-gradient-warm relative overflow-hidden">
      {/* Decorative Elements */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-cream-light/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-cream-light/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

      <div className="container relative">
        <ScrollReveal variant="scaleUp" className="max-w-3xl mx-auto text-center">
          <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-primary-foreground mb-6">
            Care That Feels Like Home, Coming Soon
          </h2>
          <p className="text-primary-foreground/80 text-lg sm:text-xl leading-relaxed mb-10 max-w-2xl mx-auto">
            {practiceLaunchSummary}. Share your interest in housecalls or clinic care. Opening targets are subject to change.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <Link to={practice.contactPath}>
              <Button 
                size="xl" 
                className="bg-cream-light text-charcoal hover:bg-cream-light/90 shadow-elevated hover:-translate-y-1 transition-all duration-300 font-semibold"
              >
                Request a Visit
              </Button>
            </Link>

          </div>
          <p className="text-primary-foreground/70 text-sm">Requests are not confirmed appointments.</p>
        </ScrollReveal>
      </div>
    </section>
  );
});

CTASection.displayName = "CTASection";

export default CTASection;
