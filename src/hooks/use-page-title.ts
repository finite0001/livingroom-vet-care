import { useEffect } from "react";
import {
  defaultOgImageUrl,
  getPublicRouteMetadata,
  publicSiteOrigin,
  type PageSeoMetadata,
  type PublicRoutePath,
} from "@/config/public-site";

const BASE_TITLE = "The Living Room Vet";
const DEFAULT_DESCRIPTION =
  "Comfort-focused veterinary care preparing to serve Boulder pets and families through planned housecalls and a future clinic home base.";

function formatTitle(title?: string) {
  return title ? `${title} | ${BASE_TITLE}` : BASE_TITLE;
}

function setMeta(attribute: "name" | "property", value: string, content?: string) {
  const selector = `meta[${attribute}="${value}"]`;
  let element = document.head.querySelector<HTMLMetaElement>(selector);

  if (!content) {
    element?.remove();
    return;
  }

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, value);
    document.head.appendChild(element);
  }

  element.setAttribute("content", content);
}

function setCanonical(url?: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');

  if (!url) {
    element?.remove();
    return;
  }

  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }

  element.setAttribute("href", url);
}

function clearRouteStructuredData() {
  document
    .querySelectorAll<HTMLScriptElement>('script[data-seo-json-ld="route"]')
    .forEach((element) => element.remove());
}

export function usePageMetadata(metadata: PageSeoMetadata) {
  const fullTitle = formatTitle(metadata.title);
  const description = metadata.description ?? DEFAULT_DESCRIPTION;
  const canonicalUrl = metadata.path ? `${publicSiteOrigin}${metadata.path}` : undefined;
  const image = metadata.image ?? defaultOgImageUrl;
  const structuredDataJson = JSON.stringify(metadata.structuredData ?? []);

  useEffect(() => {
    document.title = fullTitle;
    setMeta("name", "description", description);
    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", description);
    setMeta("property", "og:image", image);
    setMeta("property", "og:url", canonicalUrl);
    setMeta("property", "og:site_name", BASE_TITLE);
    setMeta("property", "og:type", "website");
    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", image);
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "robots", metadata.noIndex ? "noindex, nofollow" : "index, follow");
    setCanonical(canonicalUrl);

    return () => {
      document.title = BASE_TITLE;
    };
  }, [canonicalUrl, description, fullTitle, image, metadata.noIndex]);

  useEffect(() => {
    clearRouteStructuredData();

    const structuredData = JSON.parse(structuredDataJson) as PageSeoMetadata["structuredData"];
    structuredData?.forEach((item) => {
      const element = document.createElement("script");
      element.type = "application/ld+json";
      element.dataset.seoJsonLd = "route";
      element.textContent = JSON.stringify(item);
      document.head.appendChild(element);
    });

    return clearRouteStructuredData;
  }, [structuredDataJson]);
}

export function usePublicRouteMetadata(path: PublicRoutePath) {
  usePageMetadata(getPublicRouteMetadata(path));
}

export function usePageTitle(title?: string, description?: string) {
  useEffect(() => {
    const fullTitle = formatTitle(title);
    const resolvedDescription = description ?? DEFAULT_DESCRIPTION;
    const canonicalUrl = `${publicSiteOrigin}${window.location.pathname}`;

    document.title = fullTitle;
    setMeta("name", "description", resolvedDescription);
    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", resolvedDescription);
    setMeta("property", "og:url", canonicalUrl);
    setMeta("property", "og:site_name", BASE_TITLE);
    setMeta("property", "og:type", "website");
    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", resolvedDescription);
    setCanonical(canonicalUrl);

    return () => {
      document.title = BASE_TITLE;
    };
  }, [title, description]);
}
