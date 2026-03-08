import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Award, Heart, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import heroImage from "@/assets/hero-living-room.jpg";

const badges = [
  { icon: Award, label: "Fear Free Certified", color: "text-gold" },
  { icon: Heart, label: "Locally Owned", color: "text-terracotta-light" },
  { icon: MapPin, label: "Boulder, CO", color: "text-sage" },
];

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0">
        <motion.img
          src={heroImage}
          alt="A happy golden retriever relaxing on a comfortable sofa in our living room exam space"
          className="w-full h-full object-cover"
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.8, ease: "easeOut" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/60 via-charcoal/40 to-charcoal/70" />
      </div>

      {/* Content */}
      <div className="relative container pt-32 pb-24">
        <div className="max-w-3xl">
          <motion.p
            className="text-cream-light/70 font-heading text-sm tracking-widest uppercase mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            Boulder, Colorado
          </motion.p>

          <motion.h1
            className="font-heading text-5xl sm:text-6xl lg:text-7xl font-bold text-cream-light mb-5 tracking-tight"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
          >
            The Living Room Vet
          </motion.h1>

          <motion.p
            className="font-serif text-2xl sm:text-3xl text-cream-light/90 italic mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
          >
            Where Wellness Feels Like Home
          </motion.p>

          <motion.p
            className="text-lg sm:text-xl text-cream-light/80 font-medium mb-2 tracking-wide"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.65 }}
          >
            No Waiting Room. No Stress. Just Wellness.
          </motion.p>

          <motion.p
            className="text-cream-light/60 text-base sm:text-lg max-w-xl mb-10 leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
          >
            Direct-to-exam-room care in comfortable living room spaces designed
            to make every visit feel like a house call.
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row gap-4 mb-14"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.95 }}
          >
            <Link to="/contact">
              <Button variant="hero" size="xl" className="shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300">
                Book Appointment
              </Button>
            </Link>
            <Link to="/experience">
              <Button variant="heroOutline" size="xl" className="hover:-translate-y-0.5 transition-all duration-300">
                Take a Virtual Tour
              </Button>
            </Link>
          </motion.div>

          <motion.div
            className="flex flex-wrap gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.1 }}
          >
            {badges.map((badge) => (
              <div
                key={badge.label}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-cream-light/10 backdrop-blur-md border border-cream-light/15 hover:bg-cream-light/15 transition-colors duration-300"
              >
                <badge.icon className={`h-4 w-4 ${badge.color}`} />
                <span className="text-sm font-medium text-cream-light/90">{badge.label}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.8 }}
      >
        <div className="w-7 h-11 rounded-full border-2 border-cream-light/30 flex items-start justify-center p-2">
          <motion.div
            className="w-1.5 h-2.5 rounded-full bg-cream-light/50"
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </section>
  );
};

export default HeroSection;
