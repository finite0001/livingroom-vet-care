import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ArrowRight, Heart, Dog, Zap, Stethoscope, FlaskConical, Scissors, Syringe } from "lucide-react";
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
    href: "/services/urgent-care",
  },
  {
    icon: Syringe,
    title: "Vaccinations",
    description: "Core and lifestyle vaccines customized to your pet's needs and risk factors.",
    href: "/services/vaccinations",
  },
];

const Services = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow">
        {/* Hero Section */}
        <section className="pt-32 pb-20 bg-cream">
          <div className="container">
            <div className="max-w-3xl">
              <p className="text-primary font-medium mb-3 animate-fade-up">Our Services</p>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6 animate-fade-up" style={{ animationDelay: "0.1s" }}>
                Complete Care for{" "}
                <span className="text-gradient-warm">Every Stage of Life</span>
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed mb-8 animate-fade-up" style={{ animationDelay: "0.2s" }}>
                From puppy vaccinations to senior wellness, we provide comprehensive 
                veterinary services in our stress-free living room environment. Every visit 
                is tailored to your pet's unique needs.
              </p>
              <Button variant="default" size="lg" className="animate-fade-up" style={{ animationDelay: "0.3s" }}>
                Book an Appointment
              </Button>
            </div>
          </div>
        </section>

        {/* Featured Services */}
        <section className="py-24 bg-background">
          <div className="container">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <p className="text-primary font-medium mb-3">Featured Services</p>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-4">
                What We're Known For
              </h2>
              <p className="text-muted-foreground text-lg">
                Our most sought-after services, delivered with Fear Free certified care.
              </p>
            </div>

            <div className="space-y-16">
              {featuredServices.map((service, index) => (
                <div
                  key={service.title}
                  className={`grid grid-cols-1 lg:grid-cols-2 gap-12 items-center ${
                    index % 2 === 1 ? "" : ""
                  }`}
                >
                  {/* Image */}
                  <div className={index % 2 === 1 ? "lg:order-2" : ""}>
                    <Link to={service.href} className="block group">
                      <div className="relative overflow-hidden rounded-2xl shadow-soft">
                        <img
                          src={service.image}
                          alt={service.title}
                          className="w-full aspect-[3/2] object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-charcoal/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </Link>
                  </div>

                  {/* Content */}
                  <div className={index % 2 === 1 ? "lg:order-1" : ""}>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-warm flex items-center justify-center">
                        <service.icon className="h-7 w-7 text-primary-foreground" />
                      </div>
                      <h3 className="font-heading text-2xl sm:text-3xl font-bold text-foreground">
                        {service.title}
                      </h3>
                    </div>
                    <p className="text-muted-foreground text-lg leading-relaxed mb-6">
                      {service.description}
                    </p>
                    <Link to={service.href}>
                      <Button variant="outline" size="lg" className="group">
                        Learn More
                        <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Additional Services Grid */}
        <section className="py-24 bg-cream">
          <div className="container">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <p className="text-primary font-medium mb-3">More Services</p>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-4">
                Complete Veterinary Care
              </h2>
              <p className="text-muted-foreground text-lg">
                Everything your pet needs under one roof.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {additionalServices.map((service) => (
                <Link key={service.title} to={service.href}>
                  <Card variant="elevated" className="h-full group">
                    <CardContent className="p-8">
                      <div className="w-12 h-12 rounded-xl bg-sage/30 flex items-center justify-center mb-5 group-hover:bg-gradient-warm transition-colors duration-300">
                        <service.icon className="h-6 w-6 text-sage-dark group-hover:text-primary-foreground transition-colors duration-300" />
                      </div>
                      <h3 className="font-heading text-lg font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
                        {service.title}
                      </h3>
                      <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                        {service.description}
                      </p>
                      <span className="flex items-center gap-2 text-primary font-medium text-sm">
                        Learn more
                        <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 bg-gradient-warm">
          <div className="container">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-primary-foreground mb-6">
                Not Sure What Your Pet Needs?
              </h2>
              <p className="text-primary-foreground/80 text-lg leading-relaxed mb-8">
                Schedule a wellness consultation and we'll create a personalized care plan 
                tailored to your pet's age, breed, and lifestyle.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button 
                  size="xl" 
                  className="bg-cream-light text-charcoal hover:bg-cream-light/90 shadow-elevated font-semibold"
                >
                  Schedule a Consultation
                </Button>
                <Link to="/contact">
                  <Button 
                    variant="heroOutline" 
                    size="xl"
                    className="border-cream-light text-cream-light hover:bg-cream-light/10"
                  >
                    Contact Us
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Services;
