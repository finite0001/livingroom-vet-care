import { useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import ScrollReveal from "@/components/ScrollReveal";
import { StaggerContainer, StaggerItem } from "@/components/ScrollReveal";
import { Link } from "react-router-dom";
import {
  Phone,
  Mail,
  MapPin,
  Clock,
  Send,
  Car,
  ArrowRight,
} from "lucide-react";
import { z } from "zod";

const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be under 100 characters"),
  email: z
    .string()
    .trim()
    .email("Please enter a valid email address")
    .max(255, "Email must be under 255 characters"),
  phone: z
    .string()
    .trim()
    .max(20, "Phone number is too long")
    .optional()
    .or(z.literal("")),
  subject: z
    .string()
    .trim()
    .min(1, "Subject is required")
    .max(200, "Subject must be under 200 characters"),
  message: z
    .string()
    .trim()
    .min(1, "Message is required")
    .max(2000, "Message must be under 2000 characters"),
});

type ContactFormData = z.infer<typeof contactSchema>;

const hours = [
  { day: "Monday – Friday", time: "8:00 AM – 6:00 PM" },
  { day: "Saturday", time: "9:00 AM – 2:00 PM" },
  { day: "Sunday", time: "Closed" },
];

const Contact = () => {
  usePageTitle("Contact Us");
  const { toast } = useToast();
  const [formData, setFormData] = useState<ContactFormData>({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ContactFormData, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof ContactFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const result = contactSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof ContactFormData, string>> = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path[0] as keyof ContactFormData;
        if (!fieldErrors[field]) fieldErrors[field] = issue.message;
      });
      setErrors(fieldErrors);
      setIsSubmitting(false);
      return;
    }

    try {
      const { error } = await supabase.from("contact_submissions").insert({
        name: result.data.name,
        email: result.data.email,
        phone: result.data.phone || null,
        subject: result.data.subject,
        message: result.data.message,
      });
      if (error) throw error;

      toast({
        title: "Message sent!",
        description:
          "Thank you for reaching out. We'll get back to you within one business day.",
      });
      setFormData({ name: "", email: "", phone: "", subject: "", message: "" });
      setErrors({});
    } catch {
      toast({
        title: "Something went wrong",
        description: "Please try again or call us directly.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main-content" className="flex-grow">
        {/* Hero */}
        <section className="pt-32 pb-16 bg-cream">
          <div className="container">
            <div className="max-w-3xl">
              <p className="text-primary font-medium mb-3 animate-fade-up">
                Get in Touch
              </p>
              <h1
                className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6 animate-fade-up"
                style={{ animationDelay: "0.1s" }}
              >
                We'd Love to{" "}
                <span className="text-gradient-warm">Hear From You</span>
              </h1>
              <p
                className="text-lg text-muted-foreground leading-relaxed animate-fade-up"
                style={{ animationDelay: "0.2s" }}
              >
                Whether you have questions about our services, want to schedule
                an appointment, or just want to say hello—we're here for you and
                your furry family.
              </p>
            </div>
          </div>
        </section>

        {/* Contact Form + Info */}
        <section className="py-20 bg-background">
          <div className="container">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
              {/* Form */}
              <ScrollReveal variant="fadeLeft" className="lg:col-span-3">
                <Card variant="warm" className="h-full">
                  <CardContent className="p-8 sm:p-10">
                    <h2 className="font-heading text-2xl font-bold text-foreground mb-6">
                      Send Us a Message
                    </h2>
                    <form onSubmit={handleSubmit} className="space-y-5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div className="space-y-2">
                          <Label htmlFor="name">
                            Name <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id="name"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="Your name"
                            aria-invalid={!!errors.name}
                            aria-describedby={errors.name ? "name-error" : undefined}
                            className={errors.name ? "border-destructive" : ""}
                          />
                          {errors.name && (
                            <p id="name-error" className="text-destructive text-xs" role="alert">
                              {errors.name}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="email">
                            Email <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id="email"
                            name="email"
                            type="email"
                            value={formData.email}
                            onChange={handleChange}
                            placeholder="you@email.com"
                            aria-invalid={!!errors.email}
                            aria-describedby={errors.email ? "email-error" : undefined}
                            className={errors.email ? "border-destructive" : ""}
                          />
                          {errors.email && (
                            <p id="email-error" className="text-destructive text-xs" role="alert">
                              {errors.email}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div className="space-y-2">
                          <Label htmlFor="phone">Phone (optional)</Label>
                          <Input
                            id="phone"
                            name="phone"
                            type="tel"
                            value={formData.phone}
                            onChange={handleChange}
                            placeholder="(303) 555-1234"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="subject">
                            Subject <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id="subject"
                            name="subject"
                            value={formData.subject}
                            onChange={handleChange}
                            placeholder="Appointment, question, etc."
                            aria-invalid={!!errors.subject}
                            aria-describedby={errors.subject ? "subject-error" : undefined}
                            className={
                              errors.subject ? "border-destructive" : ""
                            }
                          />
                          {errors.subject && (
                            <p id="subject-error" className="text-destructive text-xs" role="alert">
                              {errors.subject}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="message">
                          Message <span className="text-destructive">*</span>
                        </Label>
                        <Textarea
                          id="message"
                          name="message"
                          value={formData.message}
                          onChange={handleChange}
                          placeholder="Tell us how we can help…"
                          rows={5}
                          aria-invalid={!!errors.message}
                          aria-describedby={errors.message ? "message-error" : undefined}
                          className={
                            errors.message ? "border-destructive" : ""
                          }
                        />
                        {errors.message && (
                          <p id="message-error" className="text-destructive text-xs" role="alert">
                            {errors.message}
                          </p>
                        )}
                      </div>

                      <Button
                        type="submit"
                        size="lg"
                        disabled={isSubmitting}
                        className="w-full sm:w-auto"
                      >
                        {isSubmitting ? "Sending…" : "Send Message"}
                        <Send className="h-4 w-4 ml-2" />
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </ScrollReveal>

              {/* Contact Info Sidebar */}
              <ScrollReveal
                variant="fadeRight"
                className="lg:col-span-2 space-y-6"
              >
                {/* Phone & Email */}
                <Card variant="elevated">
                  <CardContent className="p-6 space-y-5">
                    <h3 className="font-heading text-lg font-semibold text-foreground">
                      Contact Info
                    </h3>
                    <a
                      href="tel:+13035551234"
                      className="flex items-center gap-3 group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-sage/30 flex items-center justify-center group-hover:bg-gradient-warm transition-colors">
                        <Phone className="h-5 w-5 text-sage-dark group-hover:text-primary-foreground transition-colors" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Phone</p>
                        <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                          (303) 555-1234
                        </p>
                      </div>
                    </a>
                    <a
                      href="mailto:hello@livingroomvet.com"
                      className="flex items-center gap-3 group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-sage/30 flex items-center justify-center group-hover:bg-gradient-warm transition-colors">
                        <Mail className="h-5 w-5 text-sage-dark group-hover:text-primary-foreground transition-colors" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Email</p>
                        <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                          hello@livingroomvet.com
                        </p>
                      </div>
                    </a>
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-sage/30 flex items-center justify-center shrink-0">
                        <MapPin className="h-5 w-5 text-sage-dark" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Address</p>
                        <p className="font-medium text-foreground">
                          2619 Spruce Street
                          <br />
                          Boulder, CO 80302
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Hours */}
                <Card variant="elevated">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-sage/30 flex items-center justify-center">
                        <Clock className="h-5 w-5 text-sage-dark" />
                      </div>
                      <h3 className="font-heading text-lg font-semibold text-foreground">
                        Hours of Operation
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {hours.map((h) => (
                        <div
                          key={h.day}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="font-medium text-foreground">
                            {h.day}
                          </span>
                          <span
                            className={
                              h.time === "Closed"
                                ? "text-destructive font-medium"
                                : "text-muted-foreground"
                            }
                          >
                            {h.time}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-4">
                      For after-hours emergencies, please call{" "}
                      <a
                        href="tel:+13035559999"
                        className="text-primary hover:underline"
                      >
                        (303) 555-9999
                      </a>
                    </p>
                  </CardContent>
                </Card>

                {/* Quick Links */}
                <Card variant="elevated">
                  <CardContent className="p-6">
                    <h3 className="font-heading text-lg font-semibold text-foreground mb-3">
                      Quick Links
                    </h3>
                    <div className="space-y-2">
                      {[
                        { label: "Book an Appointment", href: "/contact" },
                        { label: "Our Services", href: "/services" },
                        { label: "The Experience", href: "/experience" },
                      ].map((link) => (
                        <Link
                          key={link.label}
                          to={link.href}
                          className="flex items-center gap-2 text-sm text-primary font-medium hover:underline"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </ScrollReveal>
            </div>
          </div>
        </section>

        {/* Map & Directions */}
        <section className="py-20 bg-cream">
          <div className="container">
            <ScrollReveal variant="fadeUp">
              <div className="text-center max-w-2xl mx-auto mb-12">
                <p className="text-primary font-medium mb-3">Find Us</p>
                <h2 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-4">
                  Visit Our Practice
                </h2>
                <p className="text-muted-foreground text-lg">
                  Conveniently located on Spruce Street in the heart of Boulder.
                </p>
              </div>
            </ScrollReveal>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Embedded Map */}
              <ScrollReveal variant="fadeLeft" className="lg:col-span-2">
                <div className="rounded-2xl overflow-hidden shadow-elevated aspect-[16/9]">
                  <iframe
                    title="The Living Room Vet location on Google Maps"
                    src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3055.6!2d-105.2749!3d40.0176!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zNDDCsDAxJzAzLjQiTiAxMDXCsDE2JzI5LjYiVw!5e0!3m2!1sen!2sus!4v1690000000000"
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    className="w-full h-full"
                  />
                </div>
              </ScrollReveal>

              {/* Directions */}
              <ScrollReveal variant="fadeRight">
                <Card variant="warm" className="h-full">
                  <CardContent className="p-8">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-10 h-10 rounded-xl bg-gradient-warm flex items-center justify-center">
                        <Car className="h-5 w-5 text-primary-foreground" />
                      </div>
                      <h3 className="font-heading text-lg font-semibold text-foreground">
                        Getting Here
                      </h3>
                    </div>
                    <div className="space-y-5 text-sm">
                      <div>
                        <h4 className="font-heading font-semibold text-foreground mb-1">
                          From Denver / US-36
                        </h4>
                        <p className="text-muted-foreground leading-relaxed">
                          Take US-36 West to Boulder. Exit at Baseline Road,
                          head north on Broadway, then turn left on Spruce Street.
                          We're on the right near 26th Street.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-heading font-semibold text-foreground mb-1">
                          From Longmont / US-287
                        </h4>
                        <p className="text-muted-foreground leading-relaxed">
                          Take US-287 South into Boulder. Turn right on Spruce
                          Street. Continue west past Folsom. We're on the left
                          near 26th Street.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-heading font-semibold text-foreground mb-1">
                          Parking
                        </h4>
                        <p className="text-muted-foreground leading-relaxed">
                          Free 2-hour street parking is available on Spruce
                          Street and surrounding blocks.
                        </p>
                      </div>
                    </div>
                    <a
                      href="https://www.google.com/maps/dir/?api=1&destination=2619+Spruce+Street+Boulder+CO+80302"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-6 inline-block"
                    >
                      <Button variant="outline" size="default">
                        Get Directions
                        <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </a>
                  </CardContent>
                </Card>
              </ScrollReveal>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-gradient-warm">
          <div className="container">
            <ScrollReveal variant="scaleUp">
              <div className="max-w-2xl mx-auto text-center">
                <h2 className="font-heading text-3xl sm:text-4xl font-bold text-primary-foreground mb-4">
                  Prefer to Call?
                </h2>
                <p className="text-primary-foreground/80 text-lg mb-8">
                  Our friendly team is ready to help you schedule an appointment
                  or answer any questions about your pet's care.
                </p>
                <a href="tel:+13035551234">
                  <Button
                    size="xl"
                    className="bg-cream-light text-charcoal hover:bg-cream-light/90 shadow-elevated font-semibold"
                  >
                    <Phone className="h-5 w-5 mr-2" />
                    Call (303) 555-1234
                  </Button>
                </a>
              </div>
            </ScrollReveal>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Contact;
