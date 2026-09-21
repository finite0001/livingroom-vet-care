import { Link } from "react-router-dom";
import { practice, practiceLaunchSummary } from "@/config/practice";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import catRoomImage from "@/assets/experience-cat-room.jpg";

const ExperienceHero = () => {
  return (
    <section className="relative pt-32 pb-20 lg:pb-32 overflow-hidden bg-cream">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Content */}
          <div className="order-2 lg:order-1">
            <motion.p
              className="text-primary font-medium mb-3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              The Experience
            </motion.p>
            <motion.h1
              className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              Veterinary Care,{" "}
              <span className="text-gradient-warm">Reimagined</span>
            </motion.h1>
            <motion.p
              className="text-lg text-muted-foreground leading-relaxed mb-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
            >
              We're planning a more comfortable vet visit, from housecalls to private, living room inspired clinic spaces.
            </motion.p>
            <motion.p
              className="text-lg text-muted-foreground leading-relaxed mb-8"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
            >
              {practiceLaunchSummary}. These images illustrate our vision for the future clinic; final spaces and services may change.
            </motion.p>
            <motion.div
              className="flex flex-col sm:flex-row gap-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.65 }}
            >
              <Button variant="default" size="lg" asChild>
                <Link to={practice.contactPath}>Request a Visit</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link to="/services">Explore Planned Services</Link>
              </Button>
            </motion.div>
          </div>

          {/* Image */}
          <motion.div
            className="order-1 lg:order-2"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-warm rounded-3xl opacity-20 blur-2xl" />
              <img
                src={catRoomImage}
                alt="Concept of a calm cat in a living-room-style exam room"
                className="relative w-full rounded-2xl shadow-elevated object-cover aspect-square"
              />
              <motion.div
                className="absolute -bottom-4 -left-4 bg-cream-light rounded-xl shadow-warm p-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.9 }}
              >
                <p className="font-heading font-semibold text-foreground">Designed for Comfort</p>
                <p className="text-sm text-muted-foreground">Future clinic concept</p>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent" />
    </section>
  );
};

export default ExperienceHero;
