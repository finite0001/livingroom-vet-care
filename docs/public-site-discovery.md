# Public site settings and crawler discovery

## Where to edit

| Information | Authoritative source |
| --- | --- |
| Practice name, canonical domain, contact details, business address, hours, emergency guidance, opening targets/status | `src/config/practice.ts` |
| Public page list, page titles/descriptions and structured data | `src/config/public-site.ts` |
| Page content | The corresponding public page/section components |
| Crawler exclusions and summary formatting | `src/config/public-discovery.ts` |

There is currently no in-app public settings editor. Changes to these sources take effect after the normal site build and deployment. Ondara's separate Admin → Public Site publication workflow is not present in this repository.

## What updates automatically

Every Vite dev/build entry point regenerates `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt`, and `public/llms-full.txt` from the public configuration. This includes `npm run build:deployment`, which invokes Vite programmatically and bypasses npm's old prebuild sitemap hook. `npm run generate:discovery` refreshes the checked-in copies without a build. Do not hand-edit these generated files.

Public pages use the same route metadata in the browser and initial HTML. Builds produce a separate HTML document for every configured public route, carrying its canonical URL, title, social metadata and practice/page JSON-LD. Vercel serves those directory index files before the catch-all rewrite. This generates metadata, not server-rendered page bodies: the React application still renders the visible page content.

The generic SPA fallback is `spa.html`, with no public canonical URL or structured data and a noindex directive. The staff Hub also has an explicit noindex response header. Existing authentication and private payment/document response protections remain in place.

OAI-SearchBot, GPTBot and general crawlers share a single robots group so private exclusions apply to each. OAI-SearchBot supports OpenAI search discovery; allowing GPTBot separately permits potential training use. Hub, shared document and payment routes are excluded. These files never query the database or enumerate patient/client records.

Sitemap URLs come from the public route registry. No invented modification dates are emitted; deployment/build time is not evidence that every page changed. Adding a public route still requires implementing/registering its React route and adding its public metadata. Its sitemap entry and built metadata document then follow automatically.

## Verification and search-engine registration

Run `npm run check` and the focused regression `node --experimental-strip-types --test tests/public-discovery/public-discovery.test.ts`. The latter checks configuration changes, private exclusions, escaping, and output from an actual programmatic Vite build without a live backend.

After deployment, verify `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/llms-full.txt`, and a direct public route such as `/services/wellness`. Submit `https://thelivingroom.vet/sitemap.xml` in the site's search-engine webmaster accounts if not already registered. Crawlers control their own indexing and crawl schedules; permission, accurate metadata and a sitemap do not guarantee ranking or faster crawling than another site.
