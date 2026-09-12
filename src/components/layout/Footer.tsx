import { Logo } from "@/components/Logo";
import { practice, practiceAddress, practiceMapsUrl, practiceLaunchSummary } from "@/config/practice";
import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";

const Footer = forwardRef<HTMLElement>((_, ref) => {
  return (
    <footer ref={ref} className="bg-charcoal text-cream-light">
      <div className="container py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand Column */}
          <div className="space-y-4">
            <Logo stacked inverse />
            <p className="text-sm font-serif italic text-cream-light/70">
              Where Wellness Feels Like Home
            </p>
            <p className="text-sm text-cream-light/70 leading-relaxed">
              Housecall and clinic veterinary care planned for Boulder, Colorado.
            </p>

          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-heading font-semibold mb-4">Quick Links</h4>
            <nav aria-label="Quick links" className="flex flex-col gap-2">
              {[
                { label: "The Experience", href: "/experience" },
                { label: "Services", href: "/services" },
                { label: "About Us", href: "/about" },
                { label: "Contact", href: "/contact" },
              ].map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className="text-sm text-cream-light/70 hover:text-cream-light transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Services */}
          <div>
            <h4 className="font-heading font-semibold mb-4">Services</h4>
            <nav aria-label="Services" className="flex flex-col gap-2">
              {[
                { label: "Wellness Care", href: "/services/wellness" },
                { label: "Senior Care", href: "/services/senior-care" },
                { label: "Illness Care", href: "/services/illness-care" },
                { label: "Diagnostics", href: "/services/diagnostics" },
                { label: "Surgery", href: "/services/surgery" },
                { label: "Laser Therapy", href: "/services/laser-therapy" },
                { label: "Vaccinations", href: "/services/vaccinations" },
              ].map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className="text-sm text-cream-light/70 hover:text-cream-light transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-heading font-semibold mb-4">Contact</h4>
            <div className="space-y-4">
              <a
                href={practiceMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 text-sm text-cream-light/70 hover:text-cream-light transition-colors"
              >
                <MapPin className="h-5 w-5 shrink-0 mt-0.5" />
                <span>{practiceAddress}<br />Future clinic home base</span>
              </a>


              <div className="pt-2 text-sm text-cream-light/70">
                <p className="font-medium text-cream-light mb-1">{practice.launchStages.some((stage) => stage.status === "open") ? "Hours" : "Planned hours"}</p>
                <p>{practice.hours ?? "Hours will be announced before opening."}</p>
                <p className="mt-2">{practiceLaunchSummary}. Targets subject to change.</p>
                <Link to={practice.contactPath} className="inline-block mt-3 underline">Contact the practice</Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-cream-light/10">
        <div className="container py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-cream-light/50">
            © 2026 The Living Room Vet. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <Link to="/privacy" className="text-sm text-cream-light/50 hover:text-cream-light transition-colors">
              Privacy Policy
            </Link>
            <Link to="/terms" className="text-sm text-cream-light/50 hover:text-cream-light transition-colors">
              Terms
            </Link>
            <Link to="/hub/login" className="text-sm text-cream-light/50 hover:text-cream-light transition-colors">
              Admin Login
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = "Footer";

export default Footer;
