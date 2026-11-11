import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "vite";
import { practice } from "../../src/config/practice.ts";
import { publicRoutes } from "../../src/config/public-site.ts";
import { renderDiscoveryFiles, renderPublicHead, withPublicHead } from "../../src/config/public-discovery.ts";
import { publicDiscoveryPlugin } from "../../scripts/public-discovery.ts";

test("one public source updates contact, launch status and new page discovery together", () => {
  const settings = structuredClone(practice);
  settings.domain = "changed.example";
  settings.phone = "(720) 555-0199";
  settings.launchStages = [{ serviceMode: "housecall", label: "Housecalls", status: "open", targetWindow: "Old estimate" }];
  const routes = [...publicRoutes, { path: "/new-guide", title: "New guide", description: "A new public guide.", changeFrequency: "monthly" as const, priority: 0.5 }];
  const files = renderDiscoveryFiles(settings, routes);
  assert.match(files["llms.txt"], /Housecalls: open/);
  assert.match(files["llms.txt"], /\(720\) 555-0199/);
  assert.doesNotMatch(files["llms.txt"], /Old estimate/);
  assert.match(files["llms-full.txt"], /A new public guide\./);
  assert.match(files["sitemap.xml"], /https:\/\/changed.example\/new-guide/);
  assert.match(files["robots.txt"], /Sitemap: https:\/\/changed.example\/sitemap.xml/);
  assert.doesNotMatch(files["sitemap.xml"], /lastmod|<priority>|<changefreq>/);
  for (const name of ["sitemap.xml", "llms.txt", "llms-full.txt"] as const) {
    assert.doesNotMatch(files[name], /https:\/\/[^\s<)]+\/(?:hub|shared|pay|payment)(?:\/|\s|<|\))/);
  }
});

test("OpenAI bots and general crawlers share all private route exclusions", () => {
  const robots = renderDiscoveryFiles()["robots.txt"];
  const group = robots.split(/\n\s*\n/)[0];
  for (const agent of ["*", "OAI-SearchBot", "GPTBot"]) assert.ok(group.includes(`User-agent: ${agent}\n`));
  const disallows = [...group.matchAll(/^Disallow:\s*(\S+)/gm)].map(match => match[1]);
  const blocked = (path: string) => disallows.some(rule => rule.endsWith('$') ? path === rule.slice(0, -1) : path.startsWith(rule));
  for (const route of publicRoutes) assert.equal(blocked(route.path), false, `${route.path} must remain crawlable`);
  for (const path of ['/hub', '/hub/login', '/shared/document', '/pay', '/pay/token', '/payment/return']) assert.equal(blocked(path), true);
  for (const path of ["/hub", "/shared/", "/pay$", "/pay/", "/payment/"]) assert.ok(group.includes(`Disallow: ${path}`));
});

test("metadata escapes public content and replaces home metadata on another route", () => {
  const oldName = practice.name;
  try {
    practice.name = '</script><script>alert("test")</script>';
    const head = renderPublicHead("/contact");
    assert.doesNotMatch(head, /<script>alert/);
    assert.match(head, /\\u003c\/script>/);
    assert.match(head, /&lt;\/script&gt;/);
  } finally { practice.name = oldName; }
  const template = '<head><!-- public-seo:start --><!-- public-seo:end --></head><body><div id="root"></div></body>';
  const changed = withPublicHead(withPublicHead(template, "/"), "/services/wellness");
  assert.equal((changed.match(/rel="canonical"/g) ?? []).length, 1);
  assert.match(changed, /rel="canonical" href="https:\/\/thelivingroom.vet\/services\/wellness"/);
  assert.match(changed, /Wellness Care/);
  assert.throws(() => withPublicHead("<head></head>", "/"), /template markers/);
});

test("a programmatic Vite build generates every public route and an unindexed private fallback", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lrv-public-discovery-")));
  try {
    await mkdir(join(root, "public"));
    await writeFile(join(root, "index.html"), '<html><head><!-- public-seo:start --><!-- public-seo:end --></head><body><div id="root"></div></body></html>');
    await build({ root, configFile: false, logLevel: "silent", plugins: [publicDiscoveryPlugin()] });
    const files = renderDiscoveryFiles();
    for (const [name, text] of Object.entries(files)) {
      assert.equal(await readFile(join(root, "dist", name), "utf8"), text);
    }
    for (const route of publicRoutes) {
      const path = route.path === "/" ? "index.html" : `${route.path.slice(1)}/index.html`;
      const html = await readFile(join(root, "dist", path), "utf8");
      assert.ok(html.includes(`rel="canonical" href="https://thelivingroom.vet${route.path}"`));
      assert.equal((html.match(/<title>/g) ?? []).length, 1);
      assert.ok(html.includes('data-seo-json-ld="route"'));
      assert.doesNotMatch(html, /late October 2026/);
    }
    const fallback = await readFile(join(root, "dist/spa.html"), "utf8");
    assert.match(fallback, /noindex, nofollow/);
    assert.doesNotMatch(fallback, /rel="canonical"|application\/ld\+json/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
