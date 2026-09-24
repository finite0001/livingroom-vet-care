import { practice } from "@/config/practice";

export interface JsonLdObject {
  [key: string]: unknown;
}

export interface PageSeoMetadata {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  noIndex?: boolean;
  structuredData?: readonly JsonLdObject[];
}

export interface PublicRouteMetadata {
  path: string;
  title: string;
  description: string;
  changeFrequency: "weekly" | "monthly" | "yearly";
  priority: number;
}

export const publicSiteOrigin = practice.domain
  ? `https://${practice.domain}`
  : "https://thelivingroom.vet";

export const defaultOgImagePath = "/og-living-room-vet.jpg";
export const defaultOgImageUrl = `${publicSiteOrigin}${defaultOgImagePath}`;

export const publicRoutes = [
  {
    path: "/",
    title: "Housecall & Clinic Veterinary Care Coming to Boulder",
    description:
      "Comfort-focused veterinary care preparing for Boulder, with housecalls targeted for late October 2026 and a future clinic home base on Spruce Street.",
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    path: "/experience",
    title: "The Experience",
    description:
      "Learn how The Living Room Vet is planning a calmer, relationship-centered veterinary care experience for Boulder pets and families.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/services",
    title: "Planned Veterinary Services",
    description:
      "Explore planned wellness, senior, illness, diagnostics, surgery, laser therapy, and vaccination services for the future housecall and clinic practice.",
    changeFrequency: "monthly",
    priority: 0.9,
  },
  {
    path: "/services/wellness",
    title: "Wellness Care",
    description:
      "Planned preventive veterinary care for Boulder pets, including exams, vaccines, nutrition guidance, and health screening once appointments open.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/services/senior-care",
    title: "Senior Pet Care",
    description:
      "Planned senior pet care focused on comfort, mobility, quality of life, and ongoing health monitoring for aging pets.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/services/illness-care",
    title: "Illness Care",
    description:
      "Planned illness visits for Boulder pets, with service availability and urgent-care boundaries to be confirmed before scheduling opens.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/services/diagnostics",
    title: "Diagnostics",
    description:
      "Planned veterinary diagnostic services for the future practice, with equipment, availability, and visit suitability to be confirmed before launch.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/services/surgery",
    title: "Surgery",
    description:
      "Planned surgical care information for The Living Room Vet, pending owner-approved service scope, equipment, and scheduling details.",
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    path: "/services/laser-therapy",
    title: "Laser Therapy",
    description:
      "Planned therapeutic laser care information for pets, pending confirmed treatment availability and owner-approved pricing.",
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    path: "/services/vaccinations",
    title: "Vaccinations",
    description:
      "Planned vaccination care information for Boulder pets, with exact service menu, certificates, and availability to be confirmed before launch.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/about",
    title: "About Us",
    description:
      "Meet the practice vision for The Living Room Vet, a comfort-focused veterinary practice preparing to serve Boulder pets and families.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/contact",
    title: "Contact",
    description:
      "Share interest in future housecall or clinic veterinary care from The Living Room Vet. Form submissions request follow-up and are not confirmed appointments.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/privacy",
    title: "Privacy Policy",
    description:
      "Read how The Living Room Vet handles information submitted through the public website while the practice prepares to open.",
    changeFrequency: "yearly",
    priority: 0.3,
  },
  {
    path: "/terms",
    title: "Terms",
    description:
      "Read the public website terms for The Living Room Vet, including limits around launch timing, emergency monitoring, and appointment requests.",
    changeFrequency: "yearly",
    priority: 0.3,
  },
] as const satisfies readonly PublicRouteMetadata[];

export type PublicRoutePath = (typeof publicRoutes)[number]["path"];

export function absolutePublicUrl(path: string) {
  return `${publicSiteOrigin}${path}`;
}

function getWebPageStructuredData(route: PublicRouteMetadata): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: route.title,
    description: route.description,
    url: absolutePublicUrl(route.path),
    isPartOf: {
      "@type": "WebSite",
      name: practice.name,
      url: publicSiteOrigin,
    },
  };
}

function getPracticeStructuredData(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "VeterinaryCare",
    name: practice.name,
    url: publicSiteOrigin,
    image: defaultOgImageUrl,
    description: publicRoutes[0].description,
    address: {
      "@type": "PostalAddress",
      streetAddress: practice.address.street,
      addressLocality: practice.address.city,
      addressRegion: practice.address.state,
      addressCountry: "US",
    },
    areaServed: {
      "@type": "City",
      name: `${practice.address.city}, ${practice.address.state}`,
    },
  };
}

export function getPublicRouteMetadata(path: PublicRoutePath): PageSeoMetadata {
  const route = publicRoutes.find((candidate) => candidate.path === path);

  if (!route) {
    throw new Error(`Missing public route metadata for ${path}`);
  }

  return {
    title: route.title,
    description: route.description,
    path: route.path,
    image: defaultOgImageUrl,
    structuredData: [getPracticeStructuredData(), getWebPageStructuredData(route)],
  };
}
