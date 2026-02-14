import { Button } from "@/components/ui/button";
import { Phone, MessageCircle } from "lucide-react";
import ScrollReveal from "@/components/ScrollReveal";

const CTASection = () => {
  return (
    <section className="py-24 bg-gradient-warm relative overflow-hidden">
      {/* Decorative Elements */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-cream-light/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-cream-light/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

      <div className="container relative">
        <ScrollReveal variant="scaleUp" className="max-w-3xl mx-auto text-center">
          <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-primary-foreground mb-6">
            Ready to Experience the Difference?
          </h2>
          <p className="text-primary-foreground/80 text-lg sm:text-xl leading-relaxed mb-10 max-w-2xl mx-auto">
            Your pet deserves veterinary care that feels like home. 
            Book your first appointment and see why Boulder families are making the switch.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <Button 
              size="xl" 
              className="bg-cream-light text-charcoal hover:bg-cream-light/90 shadow-elevated hover:-translate-y-1 transition-all duration-300 font-semibold"
            >
              Book Your Visit
            </Button>
            <a href="tel:+13035551234">
              <Button 
                variant="heroOutline" 
                size="xl"
                className="border-cream-light text-cream-light hover:bg-cream-light/10"
              >
                <Phone className="h-5 w-5 mr-2" />
                Call (303) 555-1234
              </Button>
            </a>
          </div>
          <p className="text-primary-foreground/70 text-sm flex items-center justify-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Or text us anytime at (303) 555-1234
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
};

export default CTASection;
