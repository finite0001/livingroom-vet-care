import { Link } from "react-router-dom";
import { Phone, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "The Experience", href: "/experience" },
  { label: "Services", href: "/services" },
  { label: "About Us", href: "/about" },
  { label: "Contact", href: "/contact" },
];

const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-cream-light/95 backdrop-blur-md border-b border-border">
      <div className="container flex items-center justify-between h-20">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <div className="flex flex-col">
            <span className="font-heading text-xl font-bold text-charcoal tracking-tight">
              The Living Room Vet
            </span>
            <span className="text-xs text-muted-foreground font-serif italic">
              Where Wellness Feels Like Home
            </span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              className="text-sm font-medium text-charcoal hover:text-primary transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop Actions */}
        <div className="hidden lg:flex items-center gap-4">
          <a
            href="tel:+13035551234"
            className="flex items-center gap-2 text-sm font-medium text-charcoal hover:text-primary transition-colors"
          >
            <Phone className="h-4 w-4" />
            (303) 555-1234
          </a>
          <Button variant="default" size="default">
            Book Appointment
          </Button>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="lg:hidden p-2 text-charcoal"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-cream-light border-t border-border animate-fade-in">
          <nav className="container py-6 flex flex-col gap-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className="text-base font-medium text-charcoal hover:text-primary transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <hr className="border-border my-2" />
            <a
              href="tel:+13035551234"
              className="flex items-center gap-2 text-base font-medium text-charcoal py-2"
            >
              <Phone className="h-5 w-5" />
              (303) 555-1234
            </a>
            <Button variant="default" size="lg" className="mt-2">
              Book Appointment
            </Button>
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
