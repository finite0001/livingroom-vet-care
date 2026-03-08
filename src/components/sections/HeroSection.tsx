import { Button } from "@/components/ui/button";
import { Badge, Heart, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import heroImage from "@/assets/hero-living-room.jpg";

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
            No Waiting Room. No Stress. Just Wellness.
          </motion.p>

          <motion.p
            className="text-cream-light/70 text-base sm:text-lg max-w-xl mb-8 leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
          >
            Direct-to-exam-room care in comfortable living room spaces designed 
            to make every visit feel like a house call.
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row gap-4 mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.95 }}
          >
            <Link to="/contact">
              <Button variant="hero" size="xl">
                Book Appointment
              </Button>
            </Link>
            <Link to="/experience">
              <Button variant="heroOutline" size="xl">
                Take a Virtual Tour
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
              <span className="text-sm font-medium text-cream-light">Fear Free Certified</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-cream-light/10 backdrop-blur-sm border border-cream-light/20">
              <Heart className="h-4 w-4 text-terracotta-light" />
              <span className="text-sm font-medium text-cream-light">Locally Owned</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-cream-light/10 backdrop-blur-sm border border-cream-light/20">
              <MapPin className="h-4 w-4 text-sage" />
              <span className="text-sm font-medium text-cream-light">Boulder, CO</span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <div className="w-6 h-10 rounded-full border-2 border-cream-light/40 flex items-start justify-center p-2">
          <div className="w-1 h-2 rounded-full bg-cream-light/60" />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
