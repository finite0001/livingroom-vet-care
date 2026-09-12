import { practice, practiceLaunchSummary } from "@/config/practice";
import React from "react";
import { Button } from "@/components/ui/button";
import { Badge, Heart, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import heroImage from "@/assets/hero-living-room.jpg";

const HeroSection = React.forwardRef<HTMLElement>((_, ref) => {
  return (
    <section ref={ref} className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0">
        <motion.img
          src={heroImage}
          alt="Concept image of a dog relaxing in a living room inspired exam space"
          className="w-full h-full object-cover"
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/50 via-charcoal/40 to-charcoal/70" />
      </div>

      {/* Content */}
      <div className="relative container pt-32 pb-20">
        <div className="max-w-3xl">
          <motion.p
            className="text-cream-light/80 font-medium mb-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            Boulder, Colorado
          </motion.p>

          <motion.h1
            className="font-heading text-5xl sm:text-6xl lg:text-7xl font-bold text-cream-light mb-4"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
          >
            The Living Room Vet
          </motion.h1>

          <motion.p
            className="font-serif text-2xl sm:text-3xl text-cream-light/90 italic mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
          >
            Where Wellness Feels Like Home
          </motion.p>

          <motion.p
            className="text-lg sm:text-xl text-cream-light/80 mb-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.65 }}
          >
            Housecalls first. A clinic to call home.
          </motion.p>

          <motion.p
            className="text-cream-light/70 text-base sm:text-lg max-w-xl mb-3 leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
          >
            {practiceLaunchSummary}. Our future clinic home base is {practice.address.street} in Boulder.
          </motion.p>

          <motion.p
            className="text-cream-light/70 text-sm sm:text-base max-w-xl mb-8 italic"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.85 }}
          >
            Opening targets are subject to change. Contact us to register your interest.
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row gap-4 mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.95 }}
          >
            <Link to={practice.contactPath}>
              <Button variant="hero" size="xl">
                Request a Visit
              </Button>
            </Link>
            <Link to="/experience">
              <Button variant="heroOutline" size="xl">
                Explore Our Vision
              </Button>
            </Link>
          </motion.div>

          <motion.div
            className="flex flex-wrap gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.1 }}
          >
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-cream-light/10 backdrop-blur-sm border border-cream-light/20">
              <Badge className="h-4 w-4 text-gold" />
              <span className="text-sm font-medium text-cream-light">Comfort-Focused Care</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-cream-light/10 backdrop-blur-sm border border-cream-light/20">
              <Heart className="h-4 w-4 text-terracotta-light" />
              <span className="text-sm font-medium text-cream-light">Housecall & Clinic Care</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-cream-light/10 backdrop-blur-sm border border-cream-light/20">
              <MapPin className="h-4 w-4 text-sage" />
              <span className="text-sm font-medium text-cream-light">Boulder, CO</span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce" aria-hidden="true">
        <div className="w-6 h-10 rounded-full border-2 border-cream-light/40 flex items-start justify-center p-2">
          <div className="w-1 h-2 rounded-full bg-cream-light/60" />
        </div>
      </div>
    </section>
  );
});

HeroSection.displayName = "HeroSection";

export default HeroSection;
