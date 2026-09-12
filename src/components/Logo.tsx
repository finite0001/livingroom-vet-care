import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface LogoProps {
  stacked?: boolean;
  inverse?: boolean;
  className?: string;
}

/** Live wordmark text stays readable independently of the raster review mark. */
export function Logo({ stacked = false, inverse = false, className }: LogoProps) {
  return (
    <Link
      to="/"
      aria-label="The Living Room Veterinary Care — home"
      className={cn(
        "inline-flex max-w-full gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        stacked ? "flex-col items-start" : "items-center",
        inverse ? "text-cream-light" : "text-charcoal",
        className,
      )}
    >
      <img
        src="/brand/living-room-medical-mark-v1.png"
        alt=""
        aria-hidden="true"
        width={56}
        height={56}
        className={cn(
          "h-12 w-12 shrink-0 object-contain md:h-14 md:w-14",
          inverse && "rounded-md bg-cream-light",
        )}
      />
      <span className="flex min-w-0 flex-col">
        <span className="font-heading text-lg font-bold leading-tight tracking-tight md:text-xl">
          The Living Room
        </span>
        <span className="text-xs font-medium leading-relaxed tracking-wide">
          Veterinary Care
        </span>
      </span>
    </Link>
  );
}
