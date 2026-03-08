import { Link, useLocation } from "react-router-dom";
import { Phone, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "The Experience", href: "/experience" },
  { label: "Services", href: "/services" },
  { label: "About Us", href: "/about" },
  { label: "Contact", href: "/contact" },
];

const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { pathname } = useLocation();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-cream-light/95 backdrop-blur-md border-b border-border/50 shadow-sm">
      <div className="container flex items-center justify-between h-20">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group" aria-label="The Living Room Vet - Home">
          <div className="flex flex-col">
            <span className="font-heading text-xl font-bold text-charcoal tracking-tight group-hover:text-primary transition-colors duration-300">
              The Living Room Vet
            </span>
            <span className="text-xs text-muted-foreground font-serif italic">
              Where Wellness Feels Like Home
            </span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={cn(
                "relative text-sm font-medium transition-colors px-4 py-2 rounded-lg",
                isActive(link.href)
                  ? "text-primary bg-primary/5"
                  : "text-charcoal hover:text-primary hover:bg-primary/5"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop Actions */}
        <div className="hidden lg:flex items-center gap-4">
          <a
            href="tel:+13035551234"
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
          >
            <Phone className="h-4 w-4" />
            (303) 555-1234
          </a>
          <Link to="/contact">
            <Button variant="default" size="default" className="shadow-sm hover:shadow-md transition-shadow">
              Book Appointment
            </Button>
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="lg:hidden p-2 text-charcoal hover:text-primary transition-colors rounded-lg hover:bg-primary/5"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-cream-light/98 backdrop-blur-lg border-t border-border/50 animate-fade-in">
          <nav className="container py-6 flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={cn(
                  "text-base font-medium transition-all py-3 px-4 rounded-xl",
                  isActive(link.href)
                    ? "text-primary bg-primary/5"
                    : "text-charcoal hover:text-primary hover:bg-primary/5"
                )}
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <hr className="border-border/50 my-3" />
            <a
              href="tel:+13035551234"
              className="flex items-center gap-3 text-base font-medium text-muted-foreground hover:text-primary py-3 px-4 rounded-xl transition-colors"
            >
              <Phone className="h-5 w-5" />
              (303) 555-1234
            </a>
            <Link to="/contact" onClick={() => setMobileMenuOpen(false)} className="mt-2">
              <Button variant="default" size="lg" className="w-full shadow-sm">
                Book Appointment
              </Button>
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
