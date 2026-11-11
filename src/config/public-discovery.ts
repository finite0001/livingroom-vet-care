import { getPracticeLaunchSummary, practice, type PracticeSettings } from "./practice.ts";
import { absolutePublicUrl, getPublicRouteMetadata, publicRoutes, type PublicRouteMetadata, type PublicRoutePath } from "./public-site.ts";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);
const oneLine = (value: string) => value.replace(/[\r\n]/g, " ").trim();

/** Public configuration only: never import hub, patient, payment, or backend data. */
export function renderDiscoveryFiles(settings: PracticeSettings = practice, routes: readonly PublicRouteMetadata[] = publicRoutes) {
  if (!settings.domain || !/^[a-z0-9.-]+$/i.test(settings.domain)) throw new Error("A public canonical domain is required.");
  const origin = `https://${settings.domain}`;
  const urls = routes.map(route => `${origin}${route.path}`);
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(url => `  <url><loc>${escapeHtml(url)}</loc></url>`),
    '</urlset>', '',
  ].join("\n");
  // Specific crawler groups do not inherit wildcard exclusions: share one group.
  const robots = [
    'User-agent: *', 'User-agent: OAI-SearchBot', 'User-agent: GPTBot', 'Allow: /',
    'Disallow: /hub', 'Disallow: /shared/', 'Disallow: /pay$', 'Disallow: /pay/', 'Disallow: /payment/',
    '', `Sitemap: ${origin}/sitemap.xml`, '',
    '# Public AI summaries: /llms.txt and /llms-full.txt', '',
  ].join("\n");
  const summary = [
    `# ${oneLine(settings.name)}`, '',
    `Website: ${origin}`, `Location: ${oneLine([settings.address.street, settings.address.city, settings.address.state, settings.address.postalCode].join(', '))}`,
    `Service status: ${getPracticeLaunchSummary(settings)}. Target dates are estimates; contact the practice for current availability.`,
    settings.phone ? `Phone: ${oneLine(settings.phone)}` : '',
    settings.email ? `Email: ${oneLine(settings.email)}` : '',
    settings.hours ? `${settings.launchStages.some(stage => stage.status === 'open') ? 'Hours' : 'Planned hours'} (${oneLine(settings.timezone)}): ${oneLine(settings.hours)}` : '',
    `Contact: ${origin}${settings.contactPath}`, '',
    `Emergency guidance: ${oneLine(settings.emergencyInstructions)}`,
    'Website inquiries request follow-up and are not confirmed appointments. The contact form is not monitored for emergencies.', '',
    '## Public pages', ...routes.map((route, index) => `- [${oneLine(route.title)}](${urls[index]})`), '',
  ].filter(line => line !== null).join("\n");
  const full = `${summary}\n## Page summaries\n${routes.map(route => `\n### ${oneLine(route.title)}\n${origin}${route.path}\n${oneLine(route.description)}\n`).join('')}`;
  return { 'robots.txt': robots, 'sitemap.xml': sitemap, 'llms.txt': `${summary}\nFull public reference: ${origin}/llms-full.txt\n`, 'llms-full.txt': full };
}

/** Used by both initial HTML and the existing browser metadata hook. */
export function renderPublicHead(path: PublicRoutePath): string {
  const metadata = getPublicRouteMetadata(path);
  const title = `${metadata.title} | ${practice.name}`;
  const canonical = absolutePublicUrl(path);
  const attribute = escapeHtml;
  const json = JSON.stringify(metadata.structuredData).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${attribute(metadata.description ?? '')}">`,
    '<meta name="robots" content="index, follow">',
    `<link rel="canonical" href="${attribute(canonical)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${attribute(practice.name)}">`,
    `<meta property="og:title" content="${attribute(title)}">`,
    `<meta property="og:description" content="${attribute(metadata.description ?? '')}">`,
    `<meta property="og:url" content="${attribute(canonical)}">`,
    `<meta property="og:image" content="${attribute(metadata.image ?? '')}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${attribute(title)}">`,
    `<meta name="twitter:description" content="${attribute(metadata.description ?? '')}">`,
    `<meta name="twitter:image" content="${attribute(metadata.image ?? '')}">`,
    `<script type="application/ld+json" data-seo-json-ld="route">${json}</script>`,
  ].join("\n");
}

export function withPublicHead(html: string, path?: PublicRoutePath): string {
  const pattern = /<!-- public-seo:start -->[\s\S]*?<!-- public-seo:end -->/;
  if (!pattern.test(html)) throw new Error("Missing public SEO template markers.");
  const head = path ? renderPublicHead(path) : `<title>${escapeHtml(practice.name)}</title>\n<meta name="robots" content="noindex, nofollow">`;
  return html.replace(pattern, () => `<!-- public-seo:start -->\n${head}\n<!-- public-seo:end -->`);
}
