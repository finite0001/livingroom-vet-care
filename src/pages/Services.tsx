import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "react-router-dom";
import ScrollReveal from "@/components/ScrollReveal";
import { StaggerContainer, StaggerItem } from "@/components/ScrollReveal";
import { ArrowRight, Heart, Dog, Zap, Stethoscope, FlaskConical, Scissors, Syringe } from "lucide-react";
import vaccinationsImage from "@/assets/service-vaccinations.jpg";
import wellnessImage from "@/assets/service-wellness.jpg";
import seniorImage from "@/assets/service-senior.jpg";
import laserImage from "@/assets/service-laser.jpg";
import surgeryImage from "@/assets/service-surgery.jpg";
import diagnosticsImage from "@/assets/service-diagnostics.jpg";

const featuredServices = [
  {
    icon: Heart,
    title: "Wellness Care",
    description: "Comprehensive preventive care including annual exams, vaccinations, nutrition counseling, and health screenings to keep your pet thriving at every life stage.",
    href: "/services/wellness",
    image: wellnessImage,
  },
  {
    icon: Dog,
    title: "Senior Care",
    description: "Specialized care for aging pets including mobility support, pain management, cognitive health, and quality of life assessments for their golden years.",
    href: "/services/senior-care",
    image: seniorImage,
  },
  {
    icon: Zap,
    title: "Laser Therapy",
    description: "Non-invasive therapeutic laser treatment for drug-free pain relief, arthritis management, post-surgical healing, and chronic condition support.",
    href: "/services/laser-therapy",
    image: laserImage,
  },
  {
    icon: Scissors,
    title: "Surgery",
    description: "Compassionate soft tissue and routine surgical procedures with advanced anesthetic monitoring and personalized pain management protocols.",
    href: "/services/surgery",
    image: surgeryImage,
  },
  {
    icon: Stethoscope,
    title: "Diagnostics",
    description: "In-house laboratory testing, digital radiography, and ultrasound services for same-day results so we can start treatment sooner.",
    href: "/services/diagnostics",
    image: diagnosticsImage,
  },
];

const additionalServices = [
  {
    icon: Stethoscope,
    title: "Urgent Care",
    description: "Same-day appointments for injuries, sudden illness, and urgent health concerns.",
    href: "/contact",
  },
  {
    icon: Syringe,
    title: "Vaccinations",
    description: "Core and lifestyle vaccines customized to your pet's needs and risk factors.",
    href: "/services/vaccinations",
    image: vaccinationsImage,
  },
];

const Services = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow">
        {/* Hero Section */}
        <section className="pt-32 pb-20 lg:pb-24 bg-cream">
          <div className="container">
            <div className="max-w-3xl">
              <p className="text-primary font-heading text-sm font-semibold tracking-wide uppercase mb-4 animate-fade-up">Our Services</p>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6 tracking-tight animate-fade-up" style={{ animationDelay: "0.1s" }}>
                Complete Care for{" "}
                <span className="text-gradient-warm">Every Stage of Life</span>
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed mb-10 max-w-2xl animate-fade-up" style={{ animationDelay: "0.2s" }}>
                From puppy vaccinations to senior wellness, we provide comprehensive
                veterinary services in our stress-free living room environment. Every visit
                is tailored to your pet's unique needs.
              </p>
              <Link to="/contact">
                <Button variant="default" size="lg" className="shadow-sm hover:shadow-md transition-shadow animate-fade-up" style={{ animationDelay: "0.3s" }}>
                  Book an Appointment
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Featured Services */}
        <section className="py-24 lg:py-32 bg-background">
          <div className="container">
            <ScrollReveal variant="fadeUp" className="text-center max-w-2xl mx-auto mb-20">
              <p className="text-primary font-heading text-sm font-semibold tracking-wide uppercase mb-3">Featured Services</p>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-4 tracking-tight">
                What We're Known For
              </h2>
              <p className="text-muted-foreground text-lg">
                Our most sought-after services, delivered with Fear Free certified care.
              </p>
            </ScrollReveal>

            <div className="space-y-20 lg:space-y-28">
              {featuredServices.map((service, index) => (
                <ScrollReveal key={service.title} variant="fadeUp">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
                    {/* Image */}
                    <div className={index % 2 === 1 ? "lg:order-2" : ""}>
                      <Link to={service.href} className="block group">
                        <div className="relative overflow-hidden rounded-2xl shadow-soft hover:shadow-elevated transition-shadow duration-500">
                          <img
                            src={service.image}
                            alt={service.title}
                            className="w-full aspect-[3/2] object-cover transition-transform duration-700 group-hover:scale-105"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-charcoal/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                        </div>
                      </Link>
                    </div>

                    {/* Content */}
                    <div className={index % 2 === 1 ? "lg:order-1" : ""}>
                      <div className="flex items-center gap-4 mb-5">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-warm flex items-center justify-center shadow-sm">
                          <service.icon className="h-7 w-7 text-primary-foreground" />
                        </div>
                        <h3 className="font-heading text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
                          {service.title}
                        </h3>
                      </div>
                      <p className="text-muted-foreground text-lg leading-relaxed mb-8">
                        {service.description}
                      </p>
                      <Link to={service.href}>
                        <Button variant="outline" size="lg" className="group/btn hover:shadow-sm transition-shadow">
                          Learn More
                          <ArrowRight className="h-4 w-4 group-hover/btn:translate-x-1 transition-transform" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        {/* Additional Services Grid */}
        <section className="py-24 lg:py-32 bg-cream">
          <div className="container">
            <ScrollReveal variant="fadeUp" className="text-center max-w-2xl mx-auto mb-16">
              <p className="text-primary font-heading text-sm font-semibold tracking-wide uppercase mb-3">More Services</p>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-4 tracking-tight">
                Complete Veterinary Care
              </h2>
              <p className="text-muted-foreground text-lg">
                Everything your pet needs under one roof.
              </p>
            </ScrollReveal>

            <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              {additionalServices.map((service) => (
                <StaggerItem key={service.title}>
                  <Link to={service.href}>
                    <Card variant="elevated" className="h-full group">
                      <CardContent className="p-8">
                        <div className="w-12 h-12 rounded-xl bg-sage/20 flex items-center justify-center mb-5 group-hover:bg-gradient-warm group-hover:shadow-sm transition-all duration-300">
                          <service.icon className="h-6 w-6 text-sage-dark group-hover:text-primary-foreground transition-colors duration-300" />
                        </div>
                        <h3 className="font-heading text-lg font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
                          {service.title}
                        </h3>
                        <p className="text-muted-foreground text-sm leading-relaxed mb-5">
                          {service.description}
                        </p>
                        <span className="flex items-center gap-2 text-primary font-medium text-sm opacity-80 group-hover:opacity-100 transition-opacity">
                          Learn more
                          <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                        </span>
                      </CardContent>
                    </Card>
                  </Link>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 lg:py-32 bg-gradient-warm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-cream-light/8 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3" />
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-cream-light/8 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3" />
          <div className="container relative">
            <ScrollReveal variant="scaleUp" className="max-w-3xl mx-auto text-center">
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-primary-foreground mb-6 tracking-tight">
                Not Sure What Your Pet Needs?
              </h2>
              <p className="text-primary-foreground/75 text-lg leading-relaxed mb-10">
                Schedule a wellness consultation and we'll create a personalized care plan
                tailored to your pet's age, breed, and lifestyle.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link to="/contact">
                  <Button
                    size="xl"
                    className="bg-cream-light text-charcoal hover:bg-white shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 font-semibold"
                  >
                    Schedule a Consultation
                  </Button>
                </Link>
                <Link to="/contact">
                  <Button
                    variant="heroOutline"
                    size="xl"
                    className="border-cream-light/80 text-cream-light hover:bg-cream-light/10 hover:-translate-y-0.5 transition-all duration-300"
                  >
                    Contact Us
                  </Button>
                </Link>
              </div>
            </ScrollReveal>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Services;
