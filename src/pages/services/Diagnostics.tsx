import ServiceDetailLayout from "@/components/layout/ServiceDetailLayout";
import { usePublicRouteMetadata } from "@/hooks/use-page-title";
import { Stethoscope, Dog, Heart, Zap, Scissors } from "lucide-react";
import diagnosticsImage from "@/assets/service-diagnostics.jpg";

const Diagnostics = () => {
  usePublicRouteMetadata("/services/diagnostics");

  return (
    <ServiceDetailLayout
      title="Diagnostics"
      subtitle="Answers When You Need Them"
      description="When your pet isn't feeling well, getting answers quickly matters. We are planning diagnostic workflows to support clear next steps, with final equipment, timing, and visit suitability to be confirmed before scheduling opens."
      heroImage={diagnosticsImage}
      heroImageAlt="Veterinarian reviewing diagnostic imaging results in a modern lab"
      icon={Stethoscope}
      benefits={[
        "Planned lab workflows for timely answers",
        "Imaging availability to be confirmed",
        "Internal views when clinically appropriate and available",
        "Comprehensive bloodwork panels",
        "Faster diagnosis means faster treatment",
        "Reduced stress with fewer visits",
        "Baseline records for future comparison",
        "Clear, jargon-free explanation of results",
      ]}
      whatToExpect={[
        {
          title: "Discussion & Exam",
          description:
            "We start by listening to your concerns and performing a thorough physical exam to guide which diagnostics are most appropriate.",
        },
        {
          title: "Sample Collection",
          description:
            "Our gentle handling techniques keep your pet calm during blood draws, urine collection, or other sampling. Most pets barely notice.",
        },
        {
          title: "Testing & Imaging",
          description:
            "Sample processing and imaging details will depend on the final launch equipment, visit type, and clinical plan.",
        },
        {
          title: "Results Review",
          description:
            "We walk you through every result in plain language, explain what's normal and what needs attention, and answer all your questions.",
        },
        {
          title: "Treatment Plan",
          description:
            "Based on findings, we'll create a clear plan—whether that's medication, a diet change, further testing, or simply monitoring.",
        },
        {
          title: "Follow-Up",
          description:
            "We'll schedule any needed recheck tests and ensure you have a clear timeline for monitoring your pet's progress.",
        },
      ]}
      faq={[
        {
          question: "How quickly will I get results?",
          answer:
            "Result timing will be confirmed before appointments open. Some tests may be reviewed during a visit, while others may need outside-lab processing.",
        },
        {
          question: "Does my pet need to fast before blood work?",
          answer:
            "For routine wellness bloodwork, we recommend a 12-hour fast (water is fine). If your pet is ill, we'll run tests immediately regardless of fasting status—getting answers is the priority.",
        },
        {
          question: "What is digital radiography?",
          answer:
            "Digital X-rays produce high-resolution images without film development. When imaging is available and clinically appropriate, records can be reviewed and shared with specialists if a second opinion is needed.",
        },
        {
          question: "When would my pet need an ultrasound?",
          answer:
            "Ultrasound gives us real-time views of internal organs, helping diagnose conditions like kidney disease, bladder stones, liver issues, or abdominal masses. It's painless and rarely requires sedation.",
        },
        {
          question: "Can you send results to a specialist?",
          answer:
            "When specialist input or referral is appropriate, reviewed diagnostic records can be securely shared with the receiving veterinary team.",
        },
      ]}
      relatedServices={[
        { title: "Wellness Care", href: "/services/wellness", icon: Heart },
        { title: "Senior Care", href: "/services/senior-care", icon: Dog },
        { title: "Surgery", href: "/services/surgery", icon: Scissors },
      ]}
    >
      {/* Diagnostic Capabilities */}
      <section className="py-20 bg-sage/10">
        <div className="container">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-4">
              Planned Diagnostic Capabilities
            </h2>
            <p className="text-muted-foreground text-lg mb-8">
              Diagnostic capabilities will be finalized before appointments open.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  name: "Laboratory",
                  items: ["Complete Blood Count", "Chemistry Panel", "Urinalysis", "Thyroid Testing", "Parasite Screening"],
                },
                {
                  name: "Imaging",
                  items: ["Digital Radiography", "Abdominal Ultrasound", "Cardiac Ultrasound", "Dental Radiographs"],
                },
                {
                  name: "Specialty Tests",
                  items: ["Cytology", "Allergy Testing", "Infectious Disease Panels", "Endocrine Testing"],
                },
              ].map((group) => (
                <div key={group.name} className="bg-cream-light rounded-2xl p-6 shadow-soft text-left">
                  <h3 className="font-heading font-bold text-foreground text-lg mb-4">{group.name}</h3>
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

export default Diagnostics;
