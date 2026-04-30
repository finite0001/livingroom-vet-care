import { usePageTitle } from "@/hooks/use-page-title";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import CTASection from "@/components/sections/CTASection";
import ScrollReveal, { StaggerContainer, StaggerItem } from "@/components/ScrollReveal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, Heart, Leaf, Users, CreditCard, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import aboutPracticeImage from "@/assets/about-practice.jpg";
import drSarahImage from "@/assets/team-dr-sarah.jpg";
import drJamesImage from "@/assets/team-dr-james.jpg";
import emilyImage from "@/assets/team-emily.jpg";
import marcusImage from "@/assets/team-marcus.jpg";

const values = [
  {
    icon: Heart,
    title: "Compassion First",
    description: "Every decision we make starts with one question: what's best for the pet and their family?",
  },
  {
    icon: ShieldCheck,
    title: "Low Stress Handling",
    description: "We're trained in low-stress handling techniques that minimize fear and anxiety from the moment your pet arrives.",
  },
  {
    icon: Leaf,
    title: "Wellness Over Illness",
    description: "We believe in preventing problems, not just treating them. Proactive care keeps pets healthier longer.",
  },
  {
    icon: Users,
    title: "Partnership With You",
    description: "You know your pet best. We work alongside you as partners in your pet's lifelong health journey.",
  },
];

const team = [
  {
    name: "Dr. Sarah Mitchell",
    role: "Founder & Lead Veterinarian",
    image: drSarahImage,
    credentials: ["DVM, Colorado State University", "Fear Free Trained", "AAHA Member"],
    bio: "With 15 years of experience in small animal medicine, Dr. Mitchell founded The Living Room Vet to create the practice she always wished existed—one where pets actually enjoy coming in.",
    funFact: "Mom to two rescue dogs and a very opinionated cat named Biscuit.",
  },
  {
    name: "Dr. James Chen",
    role: "Associate Veterinarian",
    image: drJamesImage,
    credentials: ["DVM, UC Davis", "Fear Free Certified", "Special Interest: Senior Care"],
    bio: "Dr. Chen brings a gentle, methodical approach to every patient. His passion for geriatric medicine and pain management makes him a perfect fit for our senior care program.",
    funFact: "Avid trail runner who can often be found on Boulder's Flatirons with his border collie, Scout.",
  },
  {
    name: "Emily Torres",
    role: "Lead Veterinary Technician",
    image: emilyImage,
    credentials: ["CVT, Licensed Vet Tech", "Fear Free Certified", "Laser Therapy Specialist"],
    bio: "Emily's calm presence and expert handling skills put even the most anxious pets at ease. She oversees our laser therapy program and Fear Free protocols.",
    funFact: "Volunteers at Boulder Humane Society every weekend and fosters kittens year-round.",
  },
  {
    name: "Marcus Rivera",
    role: "Veterinary Technician",
    image: marcusImage,
    credentials: ["CVT, Licensed Vet Tech", "Fear Free Certified", "Dental Care Specialist"],
    bio: "Marcus brings warmth and humor to every visit. His expertise in dental care and patient comfort makes him a favorite among our regular families.",
    funFact: "Amateur chef who bakes homemade dog treats for all our patients on their birthdays.",
  },
];

const certifications = [
  {
    icon: Award,
    title: "Fear Free Certified Practice",
    description: "Our entire team—from veterinarians to front desk staff—has completed Fear Free certification. This nationally recognized program trains professionals in techniques that minimize fear, anxiety, and stress in pets during veterinary visits.",
    details: [
      "Gentle handling techniques that reduce restraint",
      "Environmental modifications to reduce sensory stress",
      "Treats, pheromones, and positive reinforcement",
      "Separate pathways for cats and dogs",
      "Anxiety-reduction protocols for every visit",
    ],
  },
  {
    icon: GraduationCap,
    title: "Continuing Education Leaders",
    description: "Our team doesn't just meet continuing education requirements—we exceed them. Every team member completes twice the required hours annually, staying current on the latest advances in veterinary medicine and low-stress care.",
    details: [
      "Advanced pain management training",
      "Therapeutic laser certification",
      "Senior pet wellness specialization",
      "Behavior and anxiety management",
      "Nutrition and preventive care updates",
    ],
  },
];

const About = () => {
  usePageTitle("About Us");
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main-content" className="flex-grow">
        {/* Hero */}
        <section className="relative pt-32 pb-20 lg:pb-28 bg-cream overflow-hidden">
          <div className="container">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              <ScrollReveal variant="fadeRight">
                <p className="text-primary font-medium mb-3">About Us</p>
                <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
                  Built by Pet Lovers,{" "}
                  <span className="text-gradient-warm">For Pet Lovers</span>
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                  The Living Room Vet was born from a simple frustration: why do vet visits have to be 
                  so stressful? We knew there had to be a better way—so we built it.
                </p>
                <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                  Located in Boulder, Colorado, we're an independently owned practice that has 
                  reimagined every detail of veterinary care around one goal: making your pet 
                  actually enjoy coming to the vet.
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Link to="/experience">
                    <Button variant="default" size="lg">See The Experience</Button>
                  </Link>
                  <Link to="/services">
                    <Button variant="outline" size="lg">View Our Services</Button>
                  </Link>
                </div>
              </ScrollReveal>

              <ScrollReveal variant="fadeLeft" delay={0.15}>
                <div className="relative">
                  <div className="absolute -inset-4 bg-gradient-warm rounded-3xl opacity-20 blur-2xl" />
                  <img
                    src={aboutPracticeImage}
                    alt="The Living Room Vet practice interior with comfortable sofa and mountain views"
                    className="relative w-full rounded-2xl shadow-elevated object-cover aspect-[16/10]"
                  />
                </div>
              </ScrollReveal>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent" />
        </section>

        {/* Our Story */}
        <section className="py-24 bg-background">
          <div className="container">
            <ScrollReveal className="max-w-3xl mx-auto text-center">
              <p className="text-primary font-medium mb-3">Our Story</p>
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-8">
                A Better Way to Care
              </h2>
              <div className="text-muted-foreground text-lg leading-relaxed space-y-6 text-left">
                <p>
                  After years of watching pets tremble in crowded waiting rooms—and owners 
                  apologize for their pet's anxiety—Dr. Sarah Mitchell decided something had to 
                  change. Not just a little. Everything.
                </p>
                <p>
                  She studied Fear Free practices, visited innovative clinics around the country, 
                  and talked to hundreds of pet parents about what they wished veterinary care 
                  could be. The answer was always the same: <em className="text-foreground font-medium">they wanted it to feel like home.</em>
                </p>
                <p>
                  So that's exactly what we built. From the ground up, The Living Room Vet was 
                  designed with no traditional waiting room, private living room exam spaces, 
                  separate pathways for cats and dogs, and a team certified in gentle, 
                  stress-free handling.
                </p>
                <p className="text-foreground font-medium">
                  The result? Pets who walk in wagging their tails. Cats who purr through their 
                  exams. And families who no longer dread the vet visit.
                </p>
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* Values */}
        <section className="py-24 bg-cream">
          <div className="container">
            <ScrollReveal className="text-center max-w-2xl mx-auto mb-16">
              <p className="text-primary font-medium mb-3">Our Values</p>
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
                What Guides Us Every Day
              </h2>
            </ScrollReveal>

            <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {values.map((value) => (
                <StaggerItem key={value.title}>
                  <Card variant="feature" className="h-full">
                    <CardContent className="p-8 flex gap-6">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-warm flex items-center justify-center shrink-0">
                        <value.icon className="h-7 w-7 text-primary-foreground" />
                      </div>
                      <div>
                        <h3 className="font-heading text-xl font-semibold text-foreground mb-2">
                          {value.title}
                        </h3>
                        <p className="text-muted-foreground leading-relaxed">
                          {value.description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        {/* Team */}
        <section className="py-24 bg-background">
          <div className="container">
            <ScrollReveal className="text-center max-w-2xl mx-auto mb-16">
              <p className="text-primary font-medium mb-3">Our Team</p>
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
                Meet the People Behind the Care
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Every member of our team shares a deep love for animals and a commitment 
                to making veterinary care a positive experience.
              </p>
            </ScrollReveal>

            <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 gap-8" staggerDelay={0.12}>
              {team.map((member) => (
                <StaggerItem key={member.name}>
                  <Card variant="elevated" className="overflow-hidden h-full">
                    <CardContent className="p-0">
                      <div className="flex flex-col sm:flex-row">
                        <div className="sm:w-48 shrink-0">
                          <img
                            src={member.image}
                            alt={`${member.name} - ${member.role}`}
                            className="w-full h-48 sm:h-full object-cover"
                          />
                        </div>
                        <div className="p-6 flex-grow">
                          <h3 className="font-heading text-lg font-semibold text-foreground">
                            {member.name}
                          </h3>
                          <p className="text-primary font-medium text-sm mb-3">
                            {member.role}
                          </p>
                          <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                            {member.bio}
                          </p>
                          <div className="flex flex-wrap gap-2 mb-3">
                            {member.credentials.map((cred) => (
                              <span
                                key={cred}
                                className="px-2 py-1 rounded-md bg-sage/20 text-sage-dark text-xs font-medium"
                              >
                                {cred}
                              </span>
                            ))}
                          </div>
                          <p className="text-muted-foreground text-xs italic">
                            🐾 {member.funFact}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        {/* Certifications */}
        <section className="py-24 bg-cream">
          <div className="container">
            <ScrollReveal className="text-center max-w-2xl mx-auto mb-16">
              <p className="text-primary font-medium mb-3">Certifications & Training</p>
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
                Credentials You Can Trust
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Our commitment to excellence is backed by nationally recognized 
                certifications and ongoing professional development.
              </p>
            </ScrollReveal>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {certifications.map((cert, index) => (
                <ScrollReveal key={cert.title} variant={index === 0 ? "fadeRight" : "fadeLeft"} delay={index * 0.1}>
                  <Card variant="warm" className="h-full">
                    <CardContent className="p-8">
                      <div className="flex items-center gap-4 mb-6">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-warm flex items-center justify-center">
                          <cert.icon className="h-7 w-7 text-primary-foreground" />
                        </div>
                        <h3 className="font-heading text-xl font-semibold text-foreground">
                          {cert.title}
                        </h3>
                      </div>
                      <p className="text-muted-foreground leading-relaxed mb-6">
                        {cert.description}
                      </p>
                      <ul className="space-y-3">
                        {cert.details.map((detail) => (
                          <li key={detail} className="flex items-start gap-3">
                            <span className="w-2 h-2 rounded-full bg-sage shrink-0 mt-2" />
                            <span className="text-foreground text-sm">{detail}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        <CTASection />
      </main>
      <Footer />
    </div>
  );
};

export default About;
