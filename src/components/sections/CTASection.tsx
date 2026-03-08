import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Phone, MessageCircle } from "lucide-react";
import ScrollReveal from "@/components/ScrollReveal";

const CTASection = () => {
  return (
    <section className="py-24 lg:py-32 bg-gradient-warm relative overflow-hidden">
      {/* Decorative Elements */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-cream-light/8 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-cream-light/8 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cream-light/5 rounded-full blur-3xl" />

      <div className="container relative">
        <ScrollReveal variant="scaleUp" className="max-w-3xl mx-auto text-center">
          <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-primary-foreground mb-6 tracking-tight">
            Ready to Experience the Difference?
          </h2>
          <p className="text-primary-foreground/75 text-lg sm:text-xl leading-relaxed mb-12 max-w-2xl mx-auto">
            Your pet deserves veterinary care that feels like home.
            Book your first appointment and see why Boulder families are making the switch.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <Link to="/contact">
              <Button
                size="xl"
                className="bg-cream-light text-charcoal hover:bg-white shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 font-semibold"
              >
                Book Your Visit
              </Button>
            </Link>
            <a href="tel:+13035551234">
              <Button
                variant="heroOutline"
                size="xl"
                className="border-cream-light/80 text-cream-light hover:bg-cream-light/10 hover:-translate-y-0.5 transition-all duration-300"
              >
                <Phone className="h-5 w-5 mr-2" />
                Call (303) 555-1234
              </Button>
            </a>
          </div>
          <p className="text-primary-foreground/50 text-sm flex items-center justify-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Or text us anytime at (303) 555-1234
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
};

export default CTASection;
