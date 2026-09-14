// Runs before `vite dev` and `vite build` (predev/prebuild hooks); writes public/sitemap.xml.

import { writeFileSync } from "fs";
import { resolve } from "path";

const BASE_URL = "https://livingroom-vet-care.lovable.app";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

const entries: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/experience", changefreq: "monthly", priority: "0.8" },
  { path: "/services", changefreq: "monthly", priority: "0.9" },
  { path: "/services/wellness", changefreq: "monthly", priority: "0.7" },
  { path: "/services/senior-care", changefreq: "monthly", priority: "0.7" },
  { path: "/services/illness-care", changefreq: "monthly", priority: "0.7" },
  { path: "/services/diagnostics", changefreq: "monthly", priority: "0.7" },
  { path: "/services/surgery", changefreq: "monthly", priority: "0.7" },
  { path: "/services/laser-therapy", changefreq: "monthly", priority: "0.7" },
  { path: "/services/vaccinations", changefreq: "monthly", priority: "0.7" },
  { path: "/about", changefreq: "monthly", priority: "0.8" },
  { path: "/contact", changefreq: "monthly", priority: "0.8" },
];

function generateSitemap(items: SitemapEntry[]) {
  const urls = items.map((e) =>
    [
      `  <url>`,
      `    <loc>${BASE_URL}${e.path}</loc>`,
      e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
      e.priority ? `    <priority>${e.priority}</priority>` : null,
      `  </url>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}

writeFileSync(resolve("public/sitemap.xml"), generateSitemap(entries));
console.log(`sitemap.xml written (${entries.length} entries)`);
