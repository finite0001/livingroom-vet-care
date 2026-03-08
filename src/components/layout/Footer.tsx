import { Link } from "react-router-dom";
import { Phone, Mail, MapPin, Facebook, Instagram } from "lucide-react";

const quickLinks = [
  { label: "The Experience", href: "/experience" },
  { label: "Services", href: "/services" },
  { label: "About Us", href: "/about" },
  { label: "Contact", href: "/contact" },
];

const serviceLinks = [
  { label: "Wellness Care", href: "/services/wellness" },
  { label: "Senior Care", href: "/services/senior-care" },
  { label: "Laser Therapy", href: "/services/laser-therapy" },
  { label: "Diagnostics", href: "/services/diagnostics" },
  { label: "Vaccinations", href: "/services/vaccinations" },
  { label: "Surgery", href: "/services/surgery" },
];

const socialLinks = [
  { icon: Facebook, href: "https://facebook.com/livingroomvet", label: "Facebook" },
  { icon: Instagram, href: "https://instagram.com/livingroomvet", label: "Instagram" },
];

const Footer = () => {
  return (
    <footer className="bg-charcoal text-cream-light">
      <div className="container py-16 lg:py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8">
          {/* Brand Column */}
          <div className="space-y-5">
            <div className="flex flex-col">
              <span className="font-heading text-xl font-bold tracking-tight">
                The Living Room Vet
              </span>
              <span className="text-sm font-serif italic text-cream-light/60 mt-1">
                Where Wellness Feels Like Home
              </span>
            </div>
            <p className="text-sm text-cream-light/60 leading-relaxed max-w-xs">
              Fear Free certified veterinary care in Boulder, Colorado.
              No waiting room, no stress—just wellness.
            </p>
            <div className="flex items-center gap-3 pt-1">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl bg-cream-light/8 border border-cream-light/10 flex items-center justify-center text-cream-light/60 hover:bg-gradient-warm hover:text-cream-light hover:border-transparent transition-all duration-300"
                  aria-label={social.label}
                >
                  <social.icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-heading text-sm font-semibold tracking-wide uppercase text-cream-light/90 mb-5">
              Quick Links
            </h4>
            <nav className="flex flex-col gap-3">
              {quickLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className="text-sm text-cream-light/60 hover:text-cream-light hover:translate-x-1 transition-all duration-200"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Services */}
          <div>
            <h4 className="font-heading text-sm font-semibold tracking-wide uppercase text-cream-light/90 mb-5">
              Services
            </h4>
            <nav className="flex flex-col gap-3">
              {serviceLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className="text-sm text-cream-light/60 hover:text-cream-light hover:translate-x-1 transition-all duration-200"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-heading text-sm font-semibold tracking-wide uppercase text-cream-light/90 mb-5">
              Contact
            </h4>
            <div className="space-y-4">
              <a
                href="https://maps.google.com/?q=2619+Spruce+Street+Boulder+CO+80302"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 text-sm text-cream-light/60 hover:text-cream-light transition-colors group"
              >
                <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-cream-light/40 group-hover:text-primary transition-colors" />
                <span>2619 Spruce Street<br />Boulder, CO 80302</span>
              </a>
              <a
                href="tel:+13035551234"
                className="flex items-center gap-3 text-sm text-cream-light/60 hover:text-cream-light transition-colors group"
              >
                <Phone className="h-4 w-4 shrink-0 text-cream-light/40 group-hover:text-primary transition-colors" />
                (303) 555-1234
              </a>
              <a
                href="mailto:hello@livingroomvet.com"
                className="flex items-center gap-3 text-sm text-cream-light/60 hover:text-cream-light transition-colors group"
              >
                <Mail className="h-4 w-4 shrink-0 text-cream-light/40 group-hover:text-primary transition-colors" />
                hello@livingroomvet.com
              </a>
              <div className="pt-3 border-t border-cream-light/8 text-sm text-cream-light/60">
                <p className="font-heading text-xs font-semibold tracking-wide uppercase text-cream-light/80 mb-2">Hours</p>
                <div className="space-y-1">
                  <p>Mon–Fri: 8:00 AM – 6:00 PM</p>
                  <p>Sat: 9:00 AM – 2:00 PM</p>
                  <p>Sun: Closed</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-cream-light/8">
        <div className="container py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-cream-light/40">
            © {new Date().getFullYear()} The Living Room Vet. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <Link to="/contact" className="text-xs text-cream-light/40 hover:text-cream-light/70 transition-colors">
              Privacy Policy
            </Link>
            <Link to="/contact" className="text-xs text-cream-light/40 hover:text-cream-light/70 transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
