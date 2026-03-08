import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { Phone, Mail, MapPin, Facebook, Instagram } from "lucide-react";

const Footer = forwardRef<HTMLElement>((_, ref) => {
  return (
    <footer ref={ref} className="bg-charcoal text-cream-light">
      <div className="container py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand Column */}
          <div className="space-y-4">
            <div className="flex flex-col">
              <span className="font-heading text-xl font-bold tracking-tight">
                The Living Room Vet
              </span>
              <span className="text-sm font-serif italic text-cream-light/70">
                Where Wellness Feels Like Home
              </span>
            </div>
            <p className="text-sm text-cream-light/70 leading-relaxed">
              Fear Free certified veterinary care in Boulder, Colorado. 
              No waiting room, no stress—just wellness.
            </p>
            <div className="flex items-center gap-4 pt-2">
              <a
                href="https://facebook.com/livingroomvet"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-full bg-cream-light/10 hover:bg-cream-light/20 transition-colors"
                aria-label="Facebook"
              >
                <Facebook className="h-5 w-5" />
              </a>
              <a
                href="https://instagram.com/livingroomvet"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-full bg-cream-light/10 hover:bg-cream-light/20 transition-colors"
                aria-label="Instagram"
              >
                <Instagram className="h-5 w-5" />
              </a>
            </div>
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
                { label: "Laser Therapy", href: "/services/laser-therapy" },
                { label: "Diagnostics", href: "/services/diagnostics" },
                { label: "Vaccinations", href: "/services/vaccinations" },
                { label: "Surgery", href: "/services/surgery" },
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
                href="https://maps.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 text-sm text-cream-light/70 hover:text-cream-light transition-colors"
              >
                <MapPin className="h-5 w-5 shrink-0 mt-0.5" />
                <span>2619 Spruce Street<br />Boulder, CO 80302</span>
              </a>
              <a
                href="tel:+13035551234"
                className="flex items-center gap-3 text-sm text-cream-light/70 hover:text-cream-light transition-colors"
              >
                <Phone className="h-5 w-5 shrink-0" />
                (303) 555-1234
              </a>
              <a
                href="mailto:hello@livingroomvet.com"
                className="flex items-center gap-3 text-sm text-cream-light/70 hover:text-cream-light transition-colors"
              >
                <Mail className="h-5 w-5 shrink-0" />
                hello@livingroomvet.com
              </a>
              <div className="pt-2 text-sm text-cream-light/70">
                <p className="font-medium text-cream-light mb-1">Hours</p>
                <p>Mon-Fri: 8:00 AM - 6:00 PM</p>
                <p>Sat: 9:00 AM - 2:00 PM</p>
                <p>Sun: Closed</p>
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
          </div>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = "Footer";

export default Footer;
