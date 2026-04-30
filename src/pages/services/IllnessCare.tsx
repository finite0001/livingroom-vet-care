import ServiceDetailLayout from "@/components/layout/ServiceDetailLayout";
import { Activity, Heart, Dog, Stethoscope, Scissors } from "lucide-react";
import diagnosticsImage from "@/assets/service-diagnostics.jpg";

const IllnessCare = () => {
  return (
    <ServiceDetailLayout
      title="Illness Care"
      subtitle="Same-Day Care When Your Pet Isn't Feeling Well"
      description="When something feels off with your pet, you need answers and a plan—without the long wait. Our illness visits combine careful listening, thorough exams, and in-house diagnostics so we can identify what's going on and get treatment started the same day."
      heroImage={diagnosticsImage}
      heroImageAlt="Veterinarian gently examining a pet during a sick visit"
      icon={Activity}
      benefits={[
        "Same-day appointments for sick pets when possible",
        "Thoughtful, unhurried exams that let us listen first",
        "In-house labs and imaging for fast answers",
        "Clear treatment plans with tiered options",
        "Written estimates before any major treatment",
        "Low-stress handling throughout every visit",
        "Direct follow-up so you're never wondering what's next",
        "Coordinated referrals when specialty care is needed",
      ]}
      whatToExpect={[
        {
          title: "Tell Us What's Going On",
          description:
            "We start by listening. What changed, when did it start, and what have you noticed at home? Your observations guide our exam.",
        },
        {
          title: "Hands-On Exam",
          description:
            "A complete physical exam—done at your pet's pace, on the floor or sofa when that helps them stay comfortable.",
        },
        {
          title: "Targeted Diagnostics",
          description:
            "Bloodwork, urinalysis, X-rays, or ultrasound as needed—run in-house so we can review results together the same visit.",
        },
        {
          title: "Treatment Plan with Options",
          description:
            "We'll explain what we found and walk through treatment options with written estimates so you can choose what fits your pet and your budget.",
        },
        {
          title: "Same-Day Treatment When Possible",
          description:
            "Most plans start that day—medications, fluids, or supportive care—so your pet can begin feeling better right away.",
        },
        {
          title: "Follow-Up & Recheck",
          description:
            "We'll schedule any rechecks and stay in touch to make sure things are heading in the right direction.",
        },
      ]}
      faq={[
        {
          question: "How quickly can I get a sick visit?",
          answer:
            "We hold daily appointment slots for sick pets and do our best to see urgent concerns the same day. Call or text us as soon as you notice something off and we'll find the soonest opening.",
        },
        {
          question: "What should I bring to a sick visit?",
          answer:
            "Bring any medications and supplements your pet is currently taking, a list of symptoms with timing, and—if relevant—a fresh stool sample or photos/videos of the behavior you're seeing at home.",
        },
        {
          question: "Will I get an estimate before treatment starts?",
          answer:
            "Yes. For anything beyond a basic exam, we'll provide a written estimate with tiered options so you can make an informed decision before we proceed.",
        },
        {
          question: "What if my pet needs emergency or specialty care?",
          answer:
            "We'll stabilize your pet, communicate directly with the emergency hospital or specialist, and share all records and imaging so the next team can pick up right where we left off.",
        },
        {
          question: "Is this different from a wellness visit?",
          answer:
            "Yes—wellness visits focus on prevention, while illness visits focus on identifying and treating a current concern. Both are unhurried, but illness visits often include same-day diagnostics and treatment.",
        },
      ]}
      relatedServices={[
        { title: "Diagnostics", href: "/services/diagnostics", icon: Stethoscope },
        { title: "Wellness Care", href: "/services/wellness", icon: Heart },
        { title: "Senior Care", href: "/services/senior-care", icon: Dog },
        { title: "Surgery", href: "/services/surgery", icon: Scissors },
      ]}
    />
  );
};

export default IllnessCare;
