import { ReactNode } from "react";
import { Link } from "react-router-dom";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, CheckCircle, ArrowRight, LucideIcon } from "lucide-react";

interface ServiceDetailLayoutProps {
  title: string;
  subtitle: string;
  description: string;
  heroImage: string;
  heroImageAlt: string;
  icon: LucideIcon;
  benefits: string[];
  whatToExpect: {
    title: string;
    description: string;
  }[];
  conditions?: string[];
  faq?: {
    question: string;
    answer: string;
  }[];
  relatedServices: {
    title: string;
    href: string;
    icon: LucideIcon;
  }[];
  children?: ReactNode;
}

const ServiceDetailLayout = ({
  title,
  subtitle,
  description,
  heroImage,
  heroImageAlt,
  icon: Icon,
  benefits,
  whatToExpect,
  conditions,
  faq,
  relatedServices,
  children,
}: ServiceDetailLayoutProps) => {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main-content" className="flex-grow">
        {/* Hero Section */}
        <section className="pt-32 pb-16 bg-cream">
          <div className="container">
            {/* Breadcrumb */}
            <Link
              to="/services"
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors mb-8"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Services
            </Link>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              {/* Content */}
              <div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-warm flex items-center justify-center">
                    <Icon className="h-7 w-7 text-primary-foreground" />
                  </div>
                </div>
                <p className="text-primary font-medium mb-2">{subtitle}</p>
                <h1 className="font-heading text-4xl sm:text-5xl font-bold text-foreground mb-6">
                  {title}
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                  {description}
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Link to="/contact">
                    <Button variant="default" size="lg">
                      Book This Service
                    </Button>
                  </Link>
                  <Link to="/contact">
                    <Button variant="outline" size="lg">
                      Ask a Question
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Image */}
              <div className="relative">
                <div className="absolute -inset-4 bg-gradient-warm rounded-3xl opacity-20 blur-2xl" />
                <img
                  src={heroImage}
                  alt={heroImageAlt}
                  className="relative w-full rounded-2xl shadow-elevated object-cover aspect-[4/3]"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="py-20 bg-background">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-8 text-center">
                Why This Matters for Your Pet
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {benefits.map((benefit, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-4 rounded-xl bg-cream-light"
                  >
                    <CheckCircle className="h-5 w-5 text-sage-dark shrink-0 mt-0.5" />
                    <span className="text-foreground">{benefit}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* What to Expect */}
        <section className="py-20 bg-cream">
          <div className="container">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-12 text-center">
              What to Expect
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {whatToExpect.map((item, index) => (
                <Card key={index} variant="warm" className="h-full">
                  <CardContent className="p-8">
                    <div className="w-10 h-10 rounded-full bg-gradient-warm flex items-center justify-center mb-4 text-primary-foreground font-heading font-bold">
                      {index + 1}
                    </div>
                    <h3 className="font-heading text-lg font-semibold text-foreground mb-2">
                      {item.title}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Conditions Treated (if provided) */}
        {conditions && conditions.length > 0 && (
          <section className="py-20 bg-background">
            <div className="container">
              <div className="max-w-4xl mx-auto">
                <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-8 text-center">
                  Conditions We Treat
                </h2>
                <div className="flex flex-wrap justify-center gap-3">
                  {conditions.map((condition, index) => (
                    <span
                      key={index}
                      className="px-4 py-2 rounded-full bg-sage/20 text-sage-dark font-medium text-sm"
                    >
                      {condition}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Custom content slot */}
        {children}

        {/* FAQ (if provided) */}
        {faq && faq.length > 0 && (
          <section className="py-20 bg-cream">
            <div className="container">
              <div className="max-w-3xl mx-auto">
                <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-8 text-center">
                  Frequently Asked Questions
                </h2>
                <div className="space-y-4">
                  {faq.map((item, index) => (
                    <Card key={index} variant="default">
                      <CardContent className="p-6">
                        <h3 className="font-heading font-semibold text-foreground mb-2">
                          {item.question}
                        </h3>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                          {item.answer}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Related Services */}
        <section className="py-20 bg-background">
          <div className="container">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-8 text-center">
              Related Services
            </h2>
            <div className="flex flex-wrap justify-center gap-4">
              {relatedServices.map((service) => (
                <Link key={service.title} to={service.href}>
                  <Card variant="elevated" className="group">
                    <CardContent className="p-6 flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-sage/30 flex items-center justify-center group-hover:bg-gradient-warm transition-colors">
                        <service.icon className="h-5 w-5 text-sage-dark group-hover:text-primary-foreground transition-colors" />
                      </div>
                      <span className="font-heading font-semibold text-foreground group-hover:text-primary transition-colors">
                        {service.title}
                      </span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-gradient-warm">
          <div className="container">
            <div className="max-w-2xl mx-auto text-center">
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-primary-foreground mb-4">
                Ready to Get Started?
              </h2>
              <p className="text-primary-foreground/80 text-lg mb-8">
                Schedule your appointment today and experience Fear Free trained care in our 
                comfortable living room environment.
              </p>
              <Link to="/contact">
                <Button 
                  size="xl" 
                  className="bg-cream-light text-charcoal hover:bg-cream-light/90 shadow-elevated font-semibold"
                >
                  Book Your Appointment
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default ServiceDetailLayout;
