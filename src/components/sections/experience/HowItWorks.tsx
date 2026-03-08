import { MessageCircle, DoorOpen, Sofa, Heart, CheckCircle } from "lucide-react";
import ScrollReveal from "@/components/ScrollReveal";
import textArrivalImage from "@/assets/experience-text-arrival.jpg";
import vetFloorImage from "@/assets/experience-vet-floor.jpg";
import heroImage from "@/assets/hero-living-room.jpg";

const steps = [
  {
    number: "01",
    icon: MessageCircle,
    title: "Text When You Arrive",
    description: "Pull into our parking lot and send a quick text. We'll immediately prepare your private exam room and let you know when it's ready.",
    details: [
      "No need to come inside and wait",
      "Your pet stays calm in familiar surroundings",
      "We prepare the room specifically for your pet",
    ],
    image: textArrivalImage,
    imageAlt: "Pet parent texting from their car with happy dog",
  },
  {
    number: "02",
    icon: DoorOpen,
    title: "Walk Straight In",
    description: "When we text you back, walk directly from your car to your assigned living room. Separate entrances for cats and dogs ensure no stressful encounters.",
    details: [
      "Dedicated cat entrance on one side",
      "Dedicated dog entrance on the other",
      "Zero waiting room time",
    ],
    image: heroImage,
    imageAlt: "Welcoming entrance to private exam room",
  },
  {
    number: "03",
    icon: Sofa,
    title: "Settle Into Your Space",
    description: "Your private exam room looks and feels like a living room—complete with a comfortable sofa, warm lighting, and calming décor. Your pet can explore at their own pace.",
    details: [
      "Comfortable seating for you",
      "Cozy spots for your pet to relax",
      "No cold metal exam tables",
    ],
    image: vetFloorImage,
    imageAlt: "Veterinarian sitting at floor level with relaxed dog",
  },
  {
    number: "04",
    icon: Heart,
    title: "Experience Fear Free Care",
    description: "Our Fear Free certified team meets your pet at their level—often on the floor. We use gentle handling, treats, and patience to make every moment comfortable.",
    details: [
      "Treats and positive reinforcement",
      "Low-stress handling techniques",
      "Your pet's comfort comes first",
    ],
    image: vetFloorImage,
    imageAlt: "Gentle veterinary care in comfortable setting",
  },
];

const HowItWorks = () => {
  return (
    <section className="py-24 bg-background">
      <div className="container">
        {/* Section Header */}
        <ScrollReveal className="text-center max-w-2xl mx-auto mb-20">
          <p className="text-primary font-medium mb-3">How It Works</p>
          <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Your Visit, Step by Step
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            From parking lot to peaceful exam—here's exactly what to expect 
            when you visit The Living Room Vet.
          </p>
        </ScrollReveal>

        {/* Steps */}
        <div className="space-y-24 lg:space-y-32">
          {steps.map((step, index) => (
            <div
              key={step.number}
              className={`grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center ${
                index % 2 === 1 ? "lg:flex-row-reverse" : ""
              }`}
            >
              {/* Content */}
              <ScrollReveal
                variant={index % 2 === 0 ? "fadeRight" : "fadeLeft"}
                className={index % 2 === 1 ? "lg:order-2" : ""}
              >
                <div className="flex items-center gap-4 mb-6">
                  <span className="text-6xl font-heading font-bold text-terracotta/20">
                    {step.number}
                  </span>
                  <div className="w-14 h-14 rounded-2xl bg-gradient-warm flex items-center justify-center">
                    <step.icon className="h-7 w-7 text-primary-foreground" />
                  </div>
                </div>
                <h3 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-4">
                  {step.title}
                </h3>
                <p className="text-muted-foreground text-lg leading-relaxed mb-6">
                  {step.description}
                </p>
                <ul className="space-y-3">
                  {step.details.map((detail, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-sage-dark shrink-0 mt-0.5" />
                      <span className="text-foreground">{detail}</span>
                    </li>
                  ))}
                </ul>
              </ScrollReveal>

              {/* Image */}
              <ScrollReveal
                variant={index % 2 === 0 ? "fadeLeft" : "fadeRight"}
                delay={0.15}
                className={index % 2 === 1 ? "lg:order-1" : ""}
              >
                <div className="relative group">
                  <div className="absolute -inset-4 bg-sage/30 rounded-3xl opacity-0 group-hover:opacity-100 blur-2xl transition-opacity duration-500" />
                  <img
                    src={step.image}
                    alt={step.imageAlt}
                    className="relative w-full rounded-2xl shadow-soft object-cover aspect-[4/3] transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                </div>
              </ScrollReveal>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
