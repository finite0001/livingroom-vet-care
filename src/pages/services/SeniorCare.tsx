import ServiceDetailLayout from "@/components/layout/ServiceDetailLayout";
import { Dog, Heart, Zap, Stethoscope } from "lucide-react";
import seniorImage from "@/assets/service-senior.jpg";

const SeniorCare = () => {
  return (
    <ServiceDetailLayout
      title="Senior Care"
      subtitle="Golden Years Support"
      description="As pets age, their needs change. Our senior care program is designed to maximize quality of life, manage age-related conditions, and help your beloved companion enjoy their golden years with comfort and dignity."
      heroImage={seniorImage}
      heroImageAlt="Gentle senior dog receiving compassionate care"
      icon={Dog}
      benefits={[
        "Early detection of age-related diseases",
        "Personalized pain management strategies",
        "Mobility support and joint health optimization",
        "Cognitive health monitoring and support",
        "Nutrition adjustments for senior needs",
        "Quality of life assessments",
        "Compassionate end-of-life guidance when needed",
        "Extended comfort and vitality in their golden years",
      ]}
      whatToExpect={[
        {
          title: "Senior Wellness Exam",
          description: "A comprehensive exam focused on age-related changes including vision, hearing, mobility, and organ function assessment.",
        },
        {
          title: "Diagnostic Screening",
          description: "Bloodwork and urinalysis to detect early kidney, liver, thyroid, and other issues common in senior pets before symptoms appear.",
        },
        {
          title: "Quality of Life Discussion",
          description: "An open conversation about your pet's daily comfort, happiness, and any changes you've noticed at home.",
        },
        {
          title: "Customized Senior Plan",
          description: "A tailored care plan addressing pain management, supplements, diet modifications, and recommended follow-up care.",
        },
        {
          title: "Mobility Assessment",
          description: "Evaluation of joint health, muscle mass, and mobility with recommendations for exercise, therapy, or pain relief.",
        },
        {
          title: "Ongoing Partnership",
          description: "We're here for the journey. We'll schedule regular check-ins and adjust care as your pet's needs evolve.",
        },
      ]}
      conditions={[
        "Arthritis & Joint Pain",
        "Kidney Disease",
        "Heart Disease",
        "Diabetes",
        "Thyroid Disorders",
        "Cognitive Dysfunction",
        "Cancer",
        "Vision & Hearing Loss",
        "Dental Disease",
        "Mobility Issues",
        "Chronic Pain",
        "Incontinence",
      ]}
      faq={[
        {
          question: "When is my pet considered a senior?",
          answer: "Generally, dogs and cats are considered seniors around age 7, though this varies by breed and size. Large breed dogs may be seniors as early as 5-6, while small breeds may not show age-related changes until 10-12.",
        },
        {
          question: "How often should senior pets be examined?",
          answer: "We recommend semi-annual exams for senior pets. Since pets age faster than humans, six months is equivalent to 2-3 human years—a lot can change! Regular bloodwork helps us catch issues early.",
        },
        {
          question: "What are signs of pain in older pets?",
          answer: "Pets often hide pain. Watch for: reluctance to jump or climb stairs, decreased activity, changes in sleep patterns, decreased appetite, excessive panting, or changes in posture. If something seems 'off,' trust your instincts.",
        },
        {
          question: "Can you help with end-of-life decisions?",
          answer: "Yes, with compassion and without judgment. We provide quality of life assessments and can discuss hospice care, pain management, and when the time comes, peaceful in-home euthanasia options.",
        },
      ]}
      relatedServices={[
        { title: "Laser Therapy", href: "/services/laser-therapy", icon: Zap },
        { title: "Wellness Care", href: "/services/wellness", icon: Heart },
        { title: "Diagnostics", href: "/services/diagnostics", icon: Stethoscope },
      ]}
    >
      {/* Quality of Life Section */}
      <section className="py-20 bg-sage/10">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-4">
              Quality of Life: Our Guiding Principle
            </h2>
            <p className="text-muted-foreground text-lg mb-8">
              We use a holistic approach to assess your senior pet's wellbeing, considering these key factors:
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Comfort", description: "Pain-free daily life" },
                { label: "Hunger", description: "Good appetite & nutrition" },
                { label: "Hydration", description: "Adequate fluid intake" },
                { label: "Hygiene", description: "Clean & comfortable" },
                { label: "Happiness", description: "Joy & engagement" },
                { label: "Mobility", description: "Ability to move freely" },
                { label: "More Good Days", description: "Than difficult ones" },
                { label: "Family Bond", description: "Connection with you" },
              ].map((item) => (
                <div key={item.label} className="bg-cream-light rounded-xl p-4 shadow-soft text-center">
                  <h3 className="font-heading font-bold text-primary text-sm mb-1">{item.label}</h3>
                  <p className="text-muted-foreground text-xs">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </ServiceDetailLayout>
  );
};

export default SeniorCare;
