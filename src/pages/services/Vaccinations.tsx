import ServiceDetailLayout from "@/components/layout/ServiceDetailLayout";
import { Syringe, Heart, Dog, Stethoscope } from "lucide-react";
import vaccinationsImage from "@/assets/service-vaccinations.jpg";

const Vaccinations = () => {
  return (
    <ServiceDetailLayout
      title="Vaccinations"
      subtitle="Tailored Protection"
      description="Vaccines are one of the most effective ways to protect your pet from serious, preventable diseases. We create personalized vaccination plans based on your pet's age, breed, health status, and lifestyle—because no two pets are alike."
      heroImage={vaccinationsImage}
      heroImageAlt="Veterinarian gently vaccinating a calm puppy"
      icon={Syringe}
      benefits={[
        "Protection against life-threatening diseases",
        "Personalized schedules based on lifestyle risk",
        "Minimized unnecessary vaccinations",
        "Titer testing available to check immunity",
        "Fear Free trained injection techniques for comfort",
        "Bundled with wellness exams for convenience",
        "Puppy and kitten series guidance",
        "Travel and boarding vaccine certificates",
      ]}
      whatToExpect={[
        {
          title: "Lifestyle Assessment",
          description:
            "We discuss your pet's daily life—do they visit dog parks, hike in the mountains, board at kennels, or stay mostly indoors? This guides which vaccines they truly need.",
        },
        {
          title: "Health Check First",
          description:
            "A brief physical exam ensures your pet is healthy enough for vaccination. We'll check temperature, heart, lungs, and overall condition.",
        },
        {
          title: "Gentle Administration",
          description:
            "Using Fear Free techniques—treats, gentle handling, and distraction—we make the experience as stress-free as possible. Most pets barely notice!",
        },
        {
          title: "Post-Vaccine Monitoring",
          description:
            "We'll observe your pet briefly afterward and explain what mild reactions to watch for at home, plus when to call us.",
        },
        {
          title: "Schedule & Reminders",
          description:
            "You'll receive a clear vaccination schedule and we'll send friendly reminders when boosters are due so nothing slips through the cracks.",
        },
      ]}
      faq={[
        {
          question: "What are core vs. lifestyle vaccines?",
          answer:
            "Core vaccines are recommended for all pets regardless of lifestyle (e.g., rabies, distemper, parvovirus for dogs; rabies, FVRCP for cats). Lifestyle vaccines are given based on exposure risk—such as Bordetella for dogs that visit groomers or kennels, or Leptospirosis for dogs that hike near water.",
        },
        {
          question: "Can my pet be over-vaccinated?",
          answer:
            "We follow evidence-based guidelines and avoid unnecessary vaccines. For adult pets with a complete history, we may recommend titer testing—a blood test that measures existing immunity—before automatically re-vaccinating.",
        },
        {
          question: "What is a titer test?",
          answer:
            "A titer test measures the level of antibodies in your pet's blood for specific diseases. If antibody levels are adequate, your pet may not need a booster. We offer titers for distemper, parvovirus, and adenovirus.",
        },
        {
          question: "Are there side effects?",
          answer:
            "Most pets experience no side effects. Some may be mildly lethargic or have slight soreness at the injection site for a day or two. Serious reactions are extremely rare, but we'll explain what to watch for.",
        },
        {
          question: "My pet needs vaccines for boarding—can you help?",
          answer:
            "Absolutely! We provide all standard boarding and daycare vaccines (Bordetella, canine influenza, etc.) and can issue official vaccination certificates. Just let us know your timeline so we can plan ahead.",
        },
      ]}
      relatedServices={[
        { title: "Wellness Care", href: "/services/wellness", icon: Heart },
        { title: "Senior Care", href: "/services/senior-care", icon: Dog },
        { title: "Diagnostics", href: "/services/diagnostics", icon: Stethoscope },
      ]}
    >
      {/* Vaccine Schedules */}
      <section className="py-20 bg-sage/10">
        <div className="container">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-4 text-center">
              Recommended Vaccine Schedules
            </h2>
            <p className="text-muted-foreground text-lg mb-10 text-center max-w-2xl mx-auto">
              Every pet's plan is customized, but here's a general guide to what we recommend at each life stage.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Dogs */}
              <div className="bg-cream-light rounded-2xl p-6 sm:p-8 shadow-soft">
                <h3 className="font-heading font-bold text-foreground text-xl mb-5 flex items-center gap-2">
                  🐕 Dogs
                </h3>
                <div className="space-y-5">
                  {[
                    {
                      stage: "Puppies (6–16 weeks)",
                      vaccines: [
                        "DHPP series (every 3–4 weeks)",
                        "Bordetella",
                        "Rabies (16 weeks)",
                      ],
                    },
                    {
                      stage: "Adolescent (1 year)",
                      vaccines: [
                        "DHPP booster",
                        "Rabies booster",
                        "Leptospirosis (if lifestyle warrants)",
                        "Canine Influenza (if boarding/daycare)",
                      ],
                    },
                    {
                      stage: "Adult (every 1–3 years)",
                      vaccines: [
                        "DHPP (every 3 years)",
                        "Rabies (per state law)",
                        "Lifestyle vaccines annually",
                        "Titer testing as alternative",
                      ],
                    },
                  ].map((group) => (
                    <div key={group.stage}>
                      <h4 className="font-heading font-semibold text-primary text-sm mb-2">
                        {group.stage}
                      </h4>
                      <ul className="space-y-1">
                        {group.vaccines.map((v) => (
                          <li
                            key={v}
                            className="flex items-center gap-2 text-muted-foreground text-sm"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                            {v}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cats */}
              <div className="bg-cream-light rounded-2xl p-6 sm:p-8 shadow-soft">
                <h3 className="font-heading font-bold text-foreground text-xl mb-5 flex items-center gap-2">
                  🐈 Cats
                </h3>
                <div className="space-y-5">
                  {[
                    {
                      stage: "Kittens (6–16 weeks)",
                      vaccines: [
                        "FVRCP series (every 3–4 weeks)",
                        "FeLV (if outdoor or multi-cat)",
                        "Rabies (12–16 weeks)",
                      ],
                    },
                    {
                      stage: "Adolescent (1 year)",
                      vaccines: [
                        "FVRCP booster",
                        "Rabies booster",
                        "FeLV booster (if at risk)",
                      ],
                    },
                    {
                      stage: "Adult (every 1–3 years)",
                      vaccines: [
                        "FVRCP (every 3 years)",
                        "Rabies (per state law)",
                        "FeLV (outdoor cats annually)",
                        "Titer testing as alternative",
                      ],
                    },
                  ].map((group) => (
                    <div key={group.stage}>
                      <h4 className="font-heading font-semibold text-primary text-sm mb-2">
                        {group.stage}
                      </h4>
                      <ul className="space-y-1">
                        {group.vaccines.map((v) => (
                          <li
                            key={v}
                            className="flex items-center gap-2 text-muted-foreground text-sm"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                            {v}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Lifestyle Recommendations */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-4 text-center">
              Lifestyle-Based Recommendations
            </h2>
            <p className="text-muted-foreground text-lg mb-10 text-center max-w-2xl mx-auto">
              Your pet's daily activities determine which additional vaccines we recommend.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[
                {
                  lifestyle: "Dog Parks & Daycare",
                  icon: "🐾",
                  vaccines: ["Bordetella", "Canine Influenza", "Leptospirosis"],
                },
                {
                  lifestyle: "Hiking & Outdoors",
                  icon: "🏔️",
                  vaccines: ["Leptospirosis", "Rattlesnake (seasonal)", "Lyme Disease"],
                },
                {
                  lifestyle: "Boarding & Travel",
                  icon: "✈️",
                  vaccines: ["Bordetella", "Canine Influenza", "Rabies certificate"],
                },
                {
                  lifestyle: "Indoor-Only Cat",
                  icon: "🏠",
                  vaccines: ["FVRCP", "Rabies", "No lifestyle vaccines needed"],
                },
                {
                  lifestyle: "Outdoor / Barn Cat",
                  icon: "🌿",
                  vaccines: ["FVRCP", "Rabies", "FeLV annually"],
                },
                {
                  lifestyle: "Multi-Pet Household",
                  icon: "🐕‍🦺",
                  vaccines: ["All core vaccines", "FeLV for cats", "Bordetella for dogs"],
                },
              ].map((item) => (
                <div
                  key={item.lifestyle}
                  className="bg-cream-light rounded-xl p-5 shadow-soft"
                >
                  <span className="text-2xl mb-2 block">{item.icon}</span>
                  <h3 className="font-heading font-bold text-foreground text-sm mb-3">
                    {item.lifestyle}
                  </h3>
                  <ul className="space-y-1">
                    {item.vaccines.map((v) => (
                      <li
                        key={v}
                        className="flex items-center gap-2 text-muted-foreground text-xs"
                      >
                        <span className="w-1 h-1 rounded-full bg-sage-dark shrink-0" />
                        {v}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </ServiceDetailLayout>
  );
};

export default Vaccinations;
