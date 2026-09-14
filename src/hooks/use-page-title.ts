import { useEffect } from "react";

const BASE_TITLE = "The Living Room Vet";
const SITE_URL = "https://livingroom-vet-care.lovable.app";

function setMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function setCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

export function usePageTitle(title?: string, description?: string) {
  useEffect(() => {
    const fullTitle = title ? `${title} — ${BASE_TITLE}` : BASE_TITLE;
    document.title = fullTitle;
    setMeta('meta[property="og:title"]', "property", "og:title", fullTitle);
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", fullTitle);

    if (description) {
      setMeta('meta[name="description"]', "name", "description", description);
      setMeta('meta[property="og:description"]', "property", "og:description", description);
      setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
    }

    const url = `${SITE_URL}${window.location.pathname}`;
    setMeta('meta[property="og:url"]', "property", "og:url", url);
    setCanonical(url);

    return () => {
      document.title = BASE_TITLE;
    };
  }, [title, description]);
}

export const usePageMeta = usePageTitle;
