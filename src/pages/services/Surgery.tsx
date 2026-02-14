import ServiceDetailLayout from "@/components/layout/ServiceDetailLayout";
import { Scissors, Dog, Heart, Zap, Stethoscope } from "lucide-react";
import surgeryImage from "@/assets/service-surgery.jpg";

const Surgery = () => {
  return (
    <ServiceDetailLayout
      title="Surgery"
      subtitle="Compassionate Surgical Care"
      description="When your pet needs surgery, you want a team that combines technical expertise with genuine compassion. Our surgical suite is equipped with modern monitoring technology, and every procedure is performed with the same care we'd give our own pets."
      heroImage={surgeryImage}
      heroImageAlt="Veterinary surgical team in a modern, well-equipped operating suite"
      icon={Scissors}
      benefits={[
        "Board-experienced surgical team",
        "Advanced anesthetic monitoring throughout",
        "Personalized pain management protocols",
        "Pre-surgical bloodwork for safety",
        "Warm, comfortable recovery environment",
        "Detailed post-operative care instructions",
        "Follow-up included with every procedure",
        "Fear Free approach before, during, and after",
      ]}
      whatToExpect={[
        {
          title: "Surgical Consultation",
          description:
            "We'll discuss your pet's condition, explain the procedure in plain language, review risks and benefits, and answer every question you have.",
        },
        {
          title: "Pre-Surgical Preparation",
          description:
            "Bloodwork and a physical exam ensure your pet is safe for anesthesia. We'll provide fasting instructions and any pre-op medications.",
        },
        {
          title: "Day of Surgery",
          description:
            "Your pet receives a calming pre-medication, IV fluids, and is monitored by a dedicated technician from induction through recovery.",
        },
        {
          title: "The Procedure",
          description:
            "Our surgeon performs the operation using sterile technique and modern equipment while vitals are continuously monitored.",
        },
        {
          title: "Recovery & Wake-Up",
          description:
            "Your pet wakes up in a quiet, warm recovery area with a technician by their side. Pain medication keeps them comfortable.",
        },
        {
          title: "Going Home",
          description:
            "We'll walk you through aftercare instructions, medications, and activity restrictions. We're always a phone call away.",
        },
      ]}
      faq={[
        {
          question: "What types of surgery do you perform?",
          answer:
            "We perform a wide range of soft tissue surgeries including spays, neuters, mass removals, exploratory surgery, bladder stone removal, and more. For orthopedic or highly specialized procedures, we'll refer you to a board-certified surgeon.",
        },
        {
          question: "Is anesthesia safe for my pet?",
          answer:
            "Modern veterinary anesthesia is very safe. We perform pre-anesthetic bloodwork, use the safest protocols available, and dedicate a technician to monitor your pet's vitals continuously throughout the procedure.",
        },
        {
          question: "How will you manage my pet's pain?",
          answer:
            "We use a multimodal approach—combining medications that work in different ways to provide the best pain relief with fewer side effects. Pain management begins before surgery and continues through recovery at home.",
        },
        {
          question: "When can I take my pet home?",
          answer:
            "Most pets go home the same day once they're fully awake, comfortable, and eating. We'll call you as soon as your pet is ready and schedule a convenient pickup time.",
        },
        {
          question: "What if there's an emergency after hours?",
          answer:
            "We provide an after-hours contact number for post-surgical concerns. For true emergencies, we'll direct you to the nearest emergency hospital and coordinate care with their team.",
        },
      ]}
      relatedServices={[
        { title: "Laser Therapy", href: "/services/laser-therapy", icon: Zap },
        { title: "Diagnostics", href: "/services/diagnostics", icon: Stethoscope },
        { title: "Wellness Care", href: "/services/wellness", icon: Heart },
      ]}
    >
      {/* Surgical Services List */}
      <section className="py-20 bg-sage/10">
        <div className="container">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-4">
              Our Surgical Services
            </h2>
            <p className="text-muted-foreground text-lg mb-8">
              From routine procedures to complex soft tissue surgeries, your pet is in experienced hands.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                {
                  category: "Routine",
                  items: ["Spay & Neuter", "Dental Extractions", "Mass / Lump Removal", "Laceration Repair"],
                },
                {
                  category: "Advanced",
                  items: ["Exploratory Surgery", "Bladder Stone Removal", "Foreign Body Removal", "Splenectomy"],
                },
              ].map((group) => (
                <div key={group.category} className="bg-cream-light rounded-2xl p-6 shadow-soft text-left">
                  <h3 className="font-heading font-bold text-foreground text-lg mb-4">
                    {group.category} Procedures
                  </h3>
                  <ul className="space-y-2">
                    {group.items.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-muted-foreground text-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        {item}
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

export default Surgery;
