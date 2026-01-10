import ServiceDetailLayout from "@/components/layout/ServiceDetailLayout";
import { Zap, Dog, Heart, Stethoscope } from "lucide-react";
import laserImage from "@/assets/service-laser.jpg";

const LaserTherapy = () => {
  return (
    <ServiceDetailLayout
      title="Laser Therapy"
      subtitle="Drug-Free Pain Relief"
      description="Therapeutic laser therapy uses light energy to reduce inflammation, accelerate healing, and provide drug-free pain relief. It's non-invasive, painless, and many pets find the treatment relaxing—some even fall asleep during sessions."
      heroImage={laserImage}
      heroImageAlt="Dog receiving comfortable laser therapy treatment"
      icon={Zap}
      benefits={[
        "Drug-free pain relief for chronic conditions",
        "Reduced inflammation and swelling",
        "Accelerated healing after surgery or injury",
        "Improved mobility and range of motion",
        "No known side effects",
        "Relaxing, spa-like experience for pets",
        "Can reduce need for pain medications",
        "Cumulative benefits with regular treatments",
      ]}
      whatToExpect={[
        {
          title: "Initial Consultation",
          description: "We'll assess your pet's condition and determine if laser therapy is appropriate. We'll explain the treatment plan and expected outcomes.",
        },
        {
          title: "Comfortable Treatment",
          description: "Your pet relaxes on a soft bed while we apply the therapeutic laser. Sessions typically last 5-20 minutes depending on the area treated.",
        },
        {
          title: "Warm, Soothing Sensation",
          description: "Most pets feel gentle warmth during treatment. Many relax deeply, and some even fall asleep! There's no pain, sedation, or shaving required.",
        },
        {
          title: "Treatment Series",
          description: "For best results, we typically recommend a series of treatments. Chronic conditions may benefit from ongoing maintenance sessions.",
        },
        {
          title: "At-Home Care Guidance",
          description: "We'll provide recommendations for exercises, supplements, and home care to maximize the benefits of laser therapy.",
        },
        {
          title: "Progress Monitoring",
          description: "We track your pet's improvement and adjust the treatment protocol as needed to ensure optimal results.",
        },
      ]}
      conditions={[
        "Arthritis & Joint Pain",
        "Hip Dysplasia",
        "Post-Surgical Healing",
        "Soft Tissue Injuries",
        "Sprains & Strains",
        "Intervertebral Disc Disease",
        "Chronic Pain",
        "Wound Healing",
        "Ear Infections",
        "Hot Spots",
        "Lick Granulomas",
        "Gingivitis & Dental Pain",
      ]}
      faq={[
        {
          question: "How does laser therapy work?",
          answer: "The laser emits light energy that penetrates tissue and is absorbed by cells. This stimulates cellular metabolism, increases blood flow, reduces inflammation, and promotes natural healing processes.",
        },
        {
          question: "Is laser therapy safe?",
          answer: "Yes! Therapeutic laser therapy has been used in veterinary medicine for decades with an excellent safety profile. There are no known side effects when performed by trained professionals. We use protective eyewear for everyone in the room.",
        },
        {
          question: "How many treatments will my pet need?",
          answer: "This depends on the condition. Acute injuries may improve in 3-6 sessions, while chronic conditions like arthritis typically benefit from 6-10 initial treatments followed by maintenance sessions every 2-4 weeks.",
        },
        {
          question: "Will my pet feel anything during treatment?",
          answer: "Most pets feel a gentle, soothing warmth. The treatment is painless and many pets become so relaxed they fall asleep. No sedation is needed, and your pet can go home immediately after.",
        },
        {
          question: "Can laser therapy replace medications?",
          answer: "In some cases, laser therapy can reduce or eliminate the need for pain medications, which is especially beneficial for pets who can't tolerate certain drugs. However, we'll develop a comprehensive pain management plan tailored to your pet.",
        },
      ]}
      relatedServices={[
        { title: "Senior Care", href: "/services/senior-care", icon: Dog },
        { title: "Wellness Care", href: "/services/wellness", icon: Heart },
        { title: "Diagnostics", href: "/services/diagnostics", icon: Stethoscope },
      ]}
    >
      {/* How It Works Section */}
      <section className="py-20 bg-sage/10">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-8 text-center">
              The Science Behind the Healing
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {[
                {
                  title: "Photobiomodulation",
                  description: "Light energy is absorbed by cells, stimulating the mitochondria to produce more ATP (cellular energy), which accelerates healing and repair.",
                },
                {
                  title: "Reduced Inflammation",
                  description: "Laser therapy decreases inflammatory markers and swelling, providing relief from pain and stiffness without medications.",
                },
                {
                  title: "Increased Circulation",
                  description: "The laser promotes vasodilation, bringing more oxygen and nutrients to the treated area while removing waste products.",
                },
                {
                  title: "Nerve Function",
                  description: "Laser therapy can help normalize nerve signals, reducing pain perception and promoting proper nerve healing.",
                },
              ].map((item) => (
                <div key={item.title} className="bg-cream-light rounded-2xl p-6 shadow-soft">
                  <h3 className="font-heading font-bold text-foreground text-lg mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing/Packages */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-4">
              Treatment Packages
            </h2>
            <p className="text-muted-foreground text-lg mb-8">
              We offer package pricing for laser therapy to make ongoing care more affordable.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { name: "Single Session", sessions: "1 treatment", best: "Trial or minor issues" },
                { name: "Starter Package", sessions: "6 treatments", best: "Acute injuries" },
                { name: "Wellness Package", sessions: "10 treatments", best: "Chronic conditions", popular: true },
              ].map((pkg) => (
                <div 
                  key={pkg.name} 
                  className={`rounded-2xl p-6 shadow-soft ${
                    pkg.popular 
                      ? "bg-gradient-warm text-primary-foreground ring-2 ring-primary" 
                      : "bg-cream-light"
                  }`}
                >
                  {pkg.popular && (
                    <span className="inline-block px-3 py-1 rounded-full bg-cream-light/20 text-xs font-medium mb-3">
                      Most Popular
                    </span>
                  )}
                  <h3 className={`font-heading font-bold text-lg mb-1 ${pkg.popular ? "text-primary-foreground" : "text-foreground"}`}>
                    {pkg.name}
                  </h3>
                  <p className={`text-sm font-medium mb-2 ${pkg.popular ? "text-primary-foreground/80" : "text-primary"}`}>
                    {pkg.sessions}
                  </p>
                  <p className={`text-sm ${pkg.popular ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    Best for: {pkg.best}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-sm mt-6">
              Contact us for current pricing. Package sessions can be shared among pets in the same household.
            </p>
          </div>
        </div>
      </section>
    </ServiceDetailLayout>
  );
};

export default LaserTherapy;
