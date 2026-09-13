import { practiceLaunchSummary } from "@/config/practice";
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

const values = [
  {
    icon: Heart,
    title: "Compassion First",
    description: "Every decision we make starts with one question: what's best for the pet and their family?",
  },
  {
    icon: ShieldCheck,
    title: "Low Stress Handling",
    description: "Comfort and gentle handling guide the care experience we are building for pets and their families.",
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


const paymentInfo = [
  {
    icon: CreditCard,
    title: "Payment Options",
    description:
      "Payment options will be confirmed before appointments open. Our planned approach includes:",
    details: [
      "Secure online payment through Stripe",
      "Clear invoices and estimates",
      "Payment details shared before your visit",
    ],
  },
  {
    icon: FileText,
    title: "Our Philosophy on Estimates",
    description:
      "We value transparency. Recommended treatment plans come with written estimates and tiered options so you can make informed decisions for your pet and your budget.",
    details: [
      "Essential — addresses the most pressing needs",
      "Recommended — our balanced, best-value plan",
      "Comprehensive — the most thorough workup or treatment",
      "We'll walk through every option together",
    ],
  },
];

const About = () => {
  usePageTitle("About Us", "Meet Dr. Susan Edler and the team behind The Living Room Vet — an independent, female-owned practice in Boulder built around low-stress handling.");
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
                  so stressful? We knew there had to be a better way—we are building one.
                </p>
                <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                  Located in Boulder, Colorado, we're building a practice around one goal: making trips to
                  the vet much less stressful.
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
                    alt="Concept image for a living room inspired veterinary clinic"
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
                <p>We are building The Living Room Vet around comfortable care and a lasting relationship with each pet and family. Housecalls will bring that approach into your home, with our future Boulder clinic as the practice home base.</p>
                <p>{practiceLaunchSummary}. These are target windows, and we will share confirmed availability before scheduling visits.</p>
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
                We are preparing a team focused on thoughtful care for pets and clear communication with their families.
              </p>
            </ScrollReveal>

            <p className="text-center text-muted-foreground">Team introductions and verified professional credentials will be shared as we prepare to open.</p>
          </div>
        </section>

        {/* Payment Options & Philosophy */}
        <section className="py-24 bg-cream">
          <div className="container">
            <ScrollReveal className="text-center max-w-2xl mx-auto mb-16">
              <p className="text-primary font-medium mb-3">Payment Options & Our Philosophy</p>
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
                Transparent Care, Transparent Costs
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                We believe great care starts with clear communication—about your pet's health
                and what it costs.
              </p>
            </ScrollReveal>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {paymentInfo.map((item, index) => (
                <ScrollReveal key={item.title} variant={index === 0 ? "fadeRight" : "fadeLeft"} delay={index * 0.1}>
                  <Card variant="warm" className="h-full">
                    <CardContent className="p-8">
                      <div className="flex items-center gap-4 mb-6">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-warm flex items-center justify-center">
                          <item.icon className="h-7 w-7 text-primary-foreground" />
                        </div>
                        <h3 className="font-heading text-xl font-semibold text-foreground">
                          {item.title}
                        </h3>
                      </div>
                      <p className="text-muted-foreground leading-relaxed mb-6">
                        {item.description}
                      </p>
                      <ul className="space-y-3">
                        {item.details.map((detail) => (
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
