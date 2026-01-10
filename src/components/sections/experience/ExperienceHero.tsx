import { Button } from "@/components/ui/button";
import catRoomImage from "@/assets/experience-cat-room.jpg";

const ExperienceHero = () => {
  return (
    <section className="relative pt-32 pb-20 lg:pb-32 overflow-hidden bg-cream">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Content */}
          <div className="order-2 lg:order-1">
            <p className="text-primary font-medium mb-3 animate-fade-up">
              The Experience
            </p>
            <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6 animate-fade-up" style={{ animationDelay: "0.1s" }}>
              Veterinary Care,{" "}
              <span className="text-gradient-warm">Reimagined</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed mb-6 animate-fade-up" style={{ animationDelay: "0.2s" }}>
              We've completely redesigned the vet visit to eliminate stress before it starts. 
              No crowded waiting rooms, no anxious encounters with other animals, no cold exam tables.
            </p>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8 animate-fade-up" style={{ animationDelay: "0.3s" }}>
              Just a calm, direct path from your car to a private living room space where 
              your pet can relax—and actually enjoy their visit.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 animate-fade-up" style={{ animationDelay: "0.4s" }}>
              <Button variant="default" size="lg">
                Book Your First Visit
              </Button>
              <Button variant="outline" size="lg">
                Watch How It Works
              </Button>
            </div>
          </div>

          {/* Image */}
          <div className="order-1 lg:order-2 animate-fade-up" style={{ animationDelay: "0.2s" }}>
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-warm rounded-3xl opacity-20 blur-2xl" />
              <img
                src={catRoomImage}
                alt="A calm cat relaxing in our cozy exam room with mountain views"
                className="relative w-full rounded-2xl shadow-elevated object-cover aspect-square"
              />
              {/* Floating badge */}
              <div className="absolute -bottom-4 -left-4 bg-cream-light rounded-xl shadow-warm p-4 animate-float">
                <p className="font-heading font-semibold text-foreground">100% Stress-Free</p>
                <p className="text-sm text-muted-foreground">Pets never see each other</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Decorative element */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent" />
    </section>
  );
};

export default ExperienceHero;
