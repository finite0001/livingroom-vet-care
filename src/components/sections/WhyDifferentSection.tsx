import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { DoorOpen, Sofa, ShieldCheck, Heart, Dog, Sparkles } from "lucide-react";
import ScrollReveal, { StaggerContainer, StaggerItem } from "@/components/ScrollReveal";

const features = [
  {
    icon: DoorOpen,
    title: "No Waiting Room",
    description: "Text when you arrive and walk straight into your private exam space. Your pet never encounters other animals—eliminating 100% of waiting room stress.",
    highlight: "Only practice in Boulder with this model",
  },
  {
    icon: Sofa,
    title: "Living Room Exam Spaces",
    description: "Forget sterile exam tables. Our rooms feature comfortable sofas, warm lighting, and calming decor—designed to feel like your living room at home.",
    highlight: "Home-like comfort, not clinical anxiety",
  },
  {
    icon: ShieldCheck,
    title: "Fear Free Certified",
    description: "Our entire team is trained in Fear Free handling methods—nationally recognized techniques that minimize anxiety and maximize comfort for every pet.",
    highlight: "Professional certification",
  },
  {
    icon: Heart,
    title: "Wellness-First Philosophy",
    description: "We focus on preventive care and proactive health management, keeping your pet healthier longer through education and early intervention.",
    highlight: "Prevention over reaction",
  },
  {
    icon: Dog,
    title: "Senior Care Experts",
    description: "Dedicated expertise for aging pets including mobility support, pain management, and quality of life assessments for their golden years.",
    highlight: "Extended quality of life",
  },
  {
    icon: Sparkles,
    title: "Laser Therapy",
    description: "Advanced therapeutic laser for drug-free pain relief, arthritis treatment, post-surgical healing, and chronic pain management.",
    highlight: "Drug-free pain relief",
  },
];

const WhyDifferentSection = React.forwardRef<HTMLElement>((_, ref) => {
  return (
    <section className="py-24 bg-background">
      <div className="container">
        {/* Section Header */}
        <ScrollReveal className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-primary font-medium mb-3">Why We're Different</p>
          <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Veterinary Care, Reimagined
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            We've rethought every aspect of the vet visit to prioritize what matters most: 
            your pet's comfort and your peace of mind.
          </p>
        </ScrollReveal>

        {/* Features Grid */}
        <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature) => (
            <StaggerItem key={feature.title}>
              <Card variant="feature" className="group h-full">
                <CardContent className="p-8">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-warm flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                    <feature.icon className="h-7 w-7 text-primary-foreground" />
                  </div>
                  <h3 className="font-heading text-xl font-semibold text-foreground mb-3">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed mb-4">
                    {feature.description}
                  </p>
                  <span className="inline-block px-3 py-1 rounded-full bg-sage/20 text-sage-dark text-sm font-medium">
                    {feature.highlight}
                  </span>
                </CardContent>
              </Card>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
};

export default WhyDifferentSection;
