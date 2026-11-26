// Prerenders the public, crawlable pages after `vite build`: the marketing pages, the tutor
// catalogue, each approved profile, a sitemap and robots.txt. Output is ordinary static files;
// the SPA replaces them on load and revalidates against the API, so a withdrawn tutor stops being
// shown the moment the page runs. Rendering goes through Vite's SSR loader so it uses exactly the
// aliases and stylesheet handling of the browser build.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import { subjectLabel } from "../../packages/contracts/src/subjects";
import type { PublicTutor, TutorCatalogue } from "../../packages/contracts/src/tutors";

const dist = process.env.PRERENDER_DIST ?? new URL("../../apps/web/dist/", import.meta.url).pathname;
const api = process.env.PRERENDER_API_ORIGIN?.replace(/\/$/, "");
const site = process.env.PUBLIC_SITE_ORIGIN?.replace(/\/$/, "");
if (!api || !site) {
  if (process.env.PRERENDER_REQUIRED === "1") throw new Error("PRERENDER_API_ORIGIN and PUBLIC_SITE_ORIGIN are required");
  console.info("Prerender skipped: PRERENDER_API_ORIGIN / PUBLIC_SITE_ORIGIN not set (the SPA still renders these pages client-side).");
  process.exit(0);
}
const get = async <T,>(path: string) => {
  const response = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Prerender data request failed (${response.status}) for ${path}`);
  return response.json() as Promise<T>;
};
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** `<` is escaped so tutor-written text can never close the data script. */
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const template = await readFile(join(dist, "index.html"), "utf8");

function page(input: { title: string; description: string; path: string; body: string; data: object; ld?: object }) {
  const url = `${site}${input.path}`;
  const head = `<title>${escape(input.title)}</title><meta name="description" content="${escape(input.description)}"/><link rel="canonical" href="${url}"/>
<meta property="og:title" content="${escape(input.title)}"/><meta property="og:description" content="${escape(input.description)}"/><meta property="og:url" content="${url}"/><meta property="og:type" content="website"/>
${input.ld ? `<script type="application/ld+json">${json(input.ld)}</script>` : ""}<script>window.__PUBLIC_DATA__=${json(input.data)}</script>`;
  return template.replace(/<title>[^<]*<\/title>/, head).replace('<div id="root"></div>', `<div id="root">${input.body}</div>`);
}
async function write(path: string, html: string) {
  const directory = join(dist, path);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), html);
}

const catalogue = await get<TutorCatalogue>("/v1/public/tutors");
const vite = await createServer({ configFile: new URL("../../apps/web/vite.config.ts", import.meta.url).pathname, server: { middlewareMode: true }, appType: "custom", logLevel: "warn" });
try {
  const views = await vite.ssrLoadModule("/src/prerender-views.tsx") as typeof import("../../apps/web/src/prerender-views");
  const pages: string[] = [];
  for (const { slug, title, description, html } of views.marketingPages(catalogue)) {
    const path = slug ? `/${slug}` : "/";
    pages.push(path);
    // Only the home page shows tutors, so only it embeds the catalogue.
    await write(slug, page({ title, description, path, body: html, data: slug ? {} : { catalogue } }));
  }
  pages.push("/tutors");
  await write("tutors", page({ title: "Find a tutor | Hybridtutors", description: `Browse ${catalogue.total} approved A-Level STEM tutors and request a free first lesson.`, path: "/tutors", body: views.catalogueHtml(catalogue), data: { catalogue } }));
  for (const summary of catalogue.tutors) {
    const { tutor } = await get<{ tutor: PublicTutor }>(`/v1/public/tutors/${summary.id}`);
    const subjects = tutor.subjects.map(subjectLabel).join(", ");
    const path = `/tutors/${tutor.id}`;
    pages.push(path);
    await write(`tutors/${tutor.id}`, page({ title: `${tutor.fullName}, ${subjects} tutor | Hybridtutors`, description: (tutor.headline ?? tutor.bio ?? `${subjects} tutoring`).slice(0, 160), path,
      body: views.profileHtml(tutor), data: { tutor },
      ld: { "@context": "https://schema.org", "@type": "ProfilePage", mainEntity: { "@type": "Person", name: tutor.fullName, description: tutor.headline ?? undefined, knowsAbout: tutor.subjects.map(subjectLabel) } } }));
  }
  await writeFile(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `<url><loc>${site}${p}</loc></url>`).join("\n")}\n</urlset>\n`);
  await writeFile(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /session\nDisallow: /v1/\nSitemap: ${site}/sitemap.xml\n`);
  console.info(`Prerendered ${pages.length} public pages and a sitemap.`);
} finally { await vite.close(); }
