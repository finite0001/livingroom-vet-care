import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Heart, Dog, Zap, Stethoscope, Smile, FlaskConical } from "lucide-react";
import { Link } from "react-router-dom";

const services = [
  {
    icon: Heart,
    title: "Wellness Care",
    description: "Comprehensive preventive care including annual exams, vaccinations, nutrition counseling, and health screenings.",
    href: "/services/wellness",
    featured: true,
  },
  {
    icon: Dog,
    title: "Senior Care",
    description: "Specialized care for aging pets including mobility support, pain management, and quality of life assessments.",
    href: "/services/senior-care",
    featured: true,
  },
  {
    icon: Zap,
    title: "Laser Therapy",
    description: "Non-invasive therapeutic laser treatment for pain relief, arthritis, post-surgical healing, and chronic conditions.",
    href: "/services/laser-therapy",
    featured: true,
  },
  {
    icon: Stethoscope,
    title: "Urgent Care",
    description: "Same-day appointments for injuries, sudden illness, and urgent health concerns that need immediate attention.",
    href: "/services/urgent-care",
    featured: false,
  },
  {
    icon: Smile,
    title: "Dental Care",
    description: "Complete dental services including cleanings, extractions, and oral health assessments under safe anesthesia.",
    href: "/services/dental",
    featured: false,
  },
  {
    icon: FlaskConical,
    title: "Diagnostics",
    description: "In-house laboratory testing, digital radiography, and ultrasound for accurate and timely diagnoses.",
    href: "/services/diagnostics",
    featured: false,
  },
];

const ServicesSection = () => {
  return (
    <section className="py-24 bg-cream">
      <div className="container">
        {/* Section Header */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-16">
          <div className="max-w-xl">
            <p className="text-primary font-medium mb-3">Our Services</p>
            <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
              Complete Care for Every Stage
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              From puppy vaccinations to senior wellness, we provide comprehensive 
              veterinary services in a stress-free environment.
            </p>
          </div>
          <Link to="/services">
            <Button variant="outline" size="lg" className="group">
              View All Services
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Button>
          </Link>
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service, index) => (
            <Link key={service.title} to={service.href}>
              <Card
                variant={service.featured ? "warm" : "elevated"}
                className="h-full group cursor-pointer"
              >
                <CardContent className="p-8 h-full flex flex-col">
                  {/* Icon */}
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110 ${
                    service.featured 
                      ? "bg-gradient-warm" 
                      : "bg-sage/30"
                  }`}>
                    <service.icon className={`h-6 w-6 ${
                      service.featured 
                        ? "text-primary-foreground" 
                        : "text-sage-dark"
                    }`} />
                  </div>

                  {/* Content */}
                  <h3 className="font-heading text-lg font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
                    {service.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed flex-grow">
                    {service.description}
                  </p>

                  {/* Link */}
                  <div className="flex items-center gap-2 mt-4 text-primary font-medium text-sm">
                    Learn more
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ServicesSection;
