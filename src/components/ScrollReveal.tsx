import { motion, useInView } from "framer-motion";
import { useRef, type ReactNode } from "react";

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  variant?: "fadeUp" | "fadeDown" | "fadeLeft" | "fadeRight" | "scaleUp" | "fade";
  delay?: number;
  duration?: number;
  once?: boolean;
  amount?: number;
}

const variants = {
  fadeUp: {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0 },
  },
  fadeDown: {
    hidden: { opacity: 0, y: -40 },
    visible: { opacity: 1, y: 0 },
  },
  fadeLeft: {
    hidden: { opacity: 0, x: -40 },
    visible: { opacity: 1, x: 0 },
  },
  fadeRight: {
    hidden: { opacity: 0, x: 40 },
    visible: { opacity: 1, x: 0 },
  },
  scaleUp: {
    hidden: { opacity: 0, scale: 0.9 },
    visible: { opacity: 1, scale: 1 },
  },
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  },
};

const ScrollReveal = ({
  children,
  className,
  variant = "fadeUp",
  delay = 0,
  duration = 0.6,
  once = true,
  amount = 0.2,
}: ScrollRevealProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once, amount });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={variants[variant]}
      transition={{ duration, delay, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  );
};

export const StaggerContainer = ({
  children,
  className,
  staggerDelay = 0.1,
  once = true,
  amount = 0.15,
}: {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
  once?: boolean;
  amount?: number;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once, amount });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: staggerDelay } },
      }}
    >
      {children}
    </motion.div>
  );
};

export const StaggerItem = ({
  children,
  className,
  variant = "fadeUp",
}: {
  children: ReactNode;
  className?: string;
  variant?: keyof typeof variants;
}) => (
  <motion.div
    className={className}
    variants={variants[variant]}
    transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
  >
    {children}
  </motion.div>
);

export default ScrollReveal;
