import ServiceDetailLayout from "@/components/layout/ServiceDetailLayout";
import { Heart, Dog, Zap, Stethoscope } from "lucide-react";
import wellnessImage from "@/assets/service-wellness.jpg";

const WellnessCare = () => {
  return (
    <ServiceDetailLayout
      title="Wellness Care"
      subtitle="Preventive Health"
      description="Comprehensive preventive care is the foundation of a long, healthy life for your pet. Our wellness programs are designed to catch potential issues early, keep vaccinations current, and ensure your pet thrives at every life stage."
      heroImage={wellnessImage}
      heroImageAlt="Veterinarian examining happy puppies during wellness checkup"
      icon={Heart}
      benefits={[
        "Early detection of health issues before they become serious",
        "Personalized vaccination schedules based on lifestyle",
        "Nutrition guidance for optimal health and weight",
        "Dental health assessments at every visit",
        "Parasite prevention tailored to Boulder's environment",
        "Baseline health records for future comparison",
        "Peace of mind knowing your pet is healthy",
        "Cost savings by preventing expensive treatments",
      ]}
      whatToExpect={[
        {
          title: "Comprehensive Physical Exam",
          description: "A thorough nose-to-tail examination checking eyes, ears, heart, lungs, abdomen, skin, coat, joints, and dental health.",
        },
        {
          title: "Health Discussion",
          description: "We'll discuss your pet's diet, exercise, behavior, and any concerns you have. We believe in partnership with pet parents.",
        },
        {
          title: "Personalized Care Plan",
          description: "Based on our findings, we'll create a customized wellness plan including vaccinations, preventatives, and follow-up recommendations.",
        },
      ]}
      faq={[
        {
          question: "How often should my pet have a wellness exam?",
          answer: "We recommend annual wellness exams for adult pets and semi-annual exams for seniors (7+ years) and puppies/kittens. Pets age faster than humans, so regular check-ups help us catch changes early.",
        },
        {
          question: "What vaccinations does my pet need?",
          answer: "Core vaccines are recommended for all pets, while lifestyle vaccines depend on your pet's exposure risk. We'll discuss your pet's activities and environment to create a personalized vaccination plan.",
        },
        {
          question: "Do you offer wellness packages?",
          answer: "Yes! We offer wellness packages that bundle common preventive services at a savings. Ask us about our puppy, adult, and senior wellness packages.",
        },
        {
          question: "What should I bring to the appointment?",
          answer: "Bring any medical records from previous vets, a list of current medications or supplements, and a fresh stool sample if possible. Also bring your questions—we love them!",
        },
      ]}
      relatedServices={[
        { title: "Senior Care", href: "/services/senior-care", icon: Dog },
        { title: "Vaccinations", href: "/services/vaccinations", icon: Heart },
        { title: "Diagnostics", href: "/services/diagnostics", icon: Stethoscope },
      ]}
    >
      {/* Wellness Packages Section */}
      <section className="py-20 bg-sage/10">
        <div className="container">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-4">
              Wellness Packages
            </h2>
            <p className="text-muted-foreground text-lg mb-8">
              Save on preventive care with our bundled wellness packages, designed for every life stage.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { name: "Puppy/Kitten", age: "Under 1 year", description: "Complete vaccine series, deworming, and growth monitoring" },
                { name: "Adult", age: "1-6 years", description: "Annual exam, vaccines, heartworm test, and preventatives" },
                { name: "Senior", age: "7+ years", description: "Semi-annual exams, bloodwork, and age-appropriate screenings" },
              ].map((pkg) => (
                <div key={pkg.name} className="bg-cream-light rounded-2xl p-6 shadow-soft">
                  <h3 className="font-heading font-bold text-foreground text-lg mb-1">{pkg.name}</h3>
                  <p className="text-primary text-sm font-medium mb-3">{pkg.age}</p>
                  <p className="text-muted-foreground text-sm">{pkg.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </ServiceDetailLayout>
  );
};

export default WellnessCare;
