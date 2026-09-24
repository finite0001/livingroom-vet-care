import { practice, practiceAddress, practiceMapsUrl, practiceLaunchSummary } from "@/config/practice";
import { useState } from "react";
import { usePublicRouteMetadata } from "@/hooks/use-page-title";
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
import { Link } from "react-router-dom";
import {
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

interface ContactFormData {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

const Contact = () => {
  usePublicRouteMetadata("/contact");
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
        title: "Request received",
        description:
          "Your request has been saved for our team. This is not a confirmed appointment.",
      });
      setFormData({ name: "", email: "", phone: "", subject: "", message: "" });
      setErrors({});
    } catch {
      toast({
        title: "Something went wrong",
        description: "Your request was not saved. Please try again later.",
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
                {practiceLaunchSummary}. Tell us whether you are interested in a housecall or a visit to our future clinic. Opening targets are subject to change.
              </p>
            </div>
          </div>
        </section>

        {/* Contact Form + Info */}
        <section id="contact-form" className="py-20 bg-background scroll-mt-24">
          <div className="container">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
              {/* Form */}
              <ScrollReveal variant="fadeLeft" className="lg:col-span-3">
                <Card variant="warm" className="h-full">
                  <CardContent className="p-8 sm:p-10">
                    <h2 className="font-heading text-2xl font-bold text-foreground mb-6">
                      Request a Visit or Ask a Question
                    </h2>
                    <p className="text-sm text-muted-foreground mb-6">Submitting this form requests follow-up; it does not reserve an appointment. Please avoid including medical records or sensitive payment information.</p>
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
                            placeholder="Your phone number"
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
                            placeholder="Housecall, future clinic visit, or question"
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
                      Contact & Launch
                    </h3>


                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-sage/30 flex items-center justify-center shrink-0">
                        <MapPin className="h-5 w-5 text-sage-dark" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Future clinic home base</p>
                        <p className="font-medium text-foreground">
                          {practiceAddress}
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
                    <p className="text-sm text-muted-foreground">
                      {practice.hours ?? "Opening hours will be announced before launch."}
                    </p>
                    <p className="text-sm text-muted-foreground mt-4">
                      Phone and email details will be published once confirmed. Please use the request form to reach the practice.
                    </p>
                    <p className="text-sm text-muted-foreground mt-4">
                      This form is not monitored for emergencies. For urgent care, contact an open veterinary emergency hospital directly.
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
                        { label: "Request a Visit", href: practice.contactPath },
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
                  Our Future Clinic Home Base
                </h2>
                <p className="text-muted-foreground text-lg">
                  {practiceAddress}. Clinic opening targeted for {practice.launchStages.find((stage) => stage.serviceMode === "clinic")?.targetWindow.toLowerCase()}; visits are not yet available.
                </p>
              </div>
            </ScrollReveal>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Embedded Map */}
              <ScrollReveal variant="fadeLeft" className="lg:col-span-2">
                <div className="rounded-2xl overflow-hidden shadow-elevated aspect-[16/9]">
                  <iframe
                    title="The Living Room Vet location on Google Maps"
                    src={`https://maps.google.com/maps?q=${encodeURIComponent(practiceAddress)}&output=embed`}
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
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Our clinic at {practice.address.street} will be the home base for both clinic visits and housecalls. Housecall coverage and travel details will be confirmed before scheduling. Access and parking details will be shared before the clinic opens.
                    </p>
                    <a
                      href={practiceMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-6 inline-block"
                    >
                      <Button variant="outline" size="default">
                        View Future Clinic Location
                        <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </a>
                  </CardContent>
                </Card>
              </ScrollReveal>
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </div>
  );
};

export default Contact;
