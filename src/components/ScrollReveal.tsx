import { motion, useInView } from "framer-motion";
import { forwardRef, useRef, type ReactNode } from "react";

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

const ScrollReveal = forwardRef<HTMLDivElement, ScrollRevealProps>(({
  children,
  className,
  variant = "fadeUp",
  delay = 0,
  duration = 0.6,
  once = true,
  amount = 0.2,
}, _ref) => {
  const internalRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(internalRef, { once, amount });

  return (
    <motion.div
      ref={internalRef}
      className={className}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={variants[variant]}
      transition={{ duration, delay, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  );
});

ScrollReveal.displayName = "ScrollReveal";

export const StaggerContainer = forwardRef<HTMLDivElement, {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
  once?: boolean;
  amount?: number;
}>(({
  children,
  className,
  staggerDelay = 0.1,
  once = true,
  amount = 0.15,
}, _ref) => {
  const internalRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(internalRef, { once, amount });

  return (
    <motion.div
      ref={internalRef}
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
});

StaggerContainer.displayName = "StaggerContainer";

export const StaggerItem = forwardRef<HTMLDivElement, {
  children: ReactNode;
  className?: string;
  variant?: keyof typeof variants;
}>(({
  children,
  className,
  variant = "fadeUp",
}, ref) => (
  <motion.div
    ref={ref}
    className={className}
    variants={variants[variant]}
    transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
  >
    {children}
  </motion.div>
));

StaggerItem.displayName = "StaggerItem";

export default ScrollReveal;
