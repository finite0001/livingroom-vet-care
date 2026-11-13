import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { renderDiscoveryFiles, withPublicHead } from "../src/config/public-discovery.ts";
import { publicRoutes } from "../src/config/public-site.ts";

export function generatePublicDiscovery(root: string) {
  for (const [name, content] of Object.entries(renderDiscoveryFiles())) {
    writeFileSync(resolve(root, "public", name), content);
  }
}

/** Runs for CLI builds AND the programmatic production deployment build. */
export function publicDiscoveryPlugin(): Plugin {
  let appEntry: string;
  return {
    name: "public-discovery",
    configResolved(config) {
      appEntry = resolve(config.root, "index.html");
      generatePublicDiscovery(config.root);
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        // Vite also transforms independent HTML entries, including browser fixtures.
        // Only the app entry owns the SEO template; SPA fallbacks retain this filename.
        if (resolve(context.filename) !== appEntry) return html;
        const requestedPath = (context.originalUrl ?? context.path).split("?")[0];
        const path = requestedPath.replace(/\/+$/, "") || "/";
        const route = publicRoutes.find(route => route.path === path);
        return withPublicHead(html, route?.path ?? (requestedPath === '/index.html' ? '/' : undefined));
      },
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const index = bundle['index.html'];
        if (!index || index.type !== 'asset' || typeof index.source !== 'string') throw new Error('Missing built HTML template.');
        const template = index.source;
        index.source = withPublicHead(template, '/');
        for (const route of publicRoutes.filter(route => route.path !== '/')) {
          this.emitFile({ type: 'asset', fileName: `${route.path.slice(1)}/index.html`, source: withPublicHead(template, route.path) });
        }
        // Hub/private/unknown routes keep the SPA and never inherit home canonical data.
        this.emitFile({ type: 'asset', fileName: 'spa.html', source: withPublicHead(template) });
      },
    },
  };
}
