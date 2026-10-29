import {publicUrl} from './preview';
import type {Files} from './model';
// The store's own links: where the captured pages (menu, footer, breadcrumbs, banners), the
// recorded public reads and the theme's own texts point. The capture follows them to the
// store's pages and to each product page; the send checks the theme's literal links against
// the storefront. Every list here is data read from the store or the theme, never an instruction.
export interface Route {url: string; key: string; product: boolean; sources: string[]; inferred?: boolean}
// A literal link of a text the send would take, checked against the storefront by the comparison:
// the route and the files that write it. broken: the store answers 404 there.
export interface LinkCheck {url: string; files: string[]}
export interface LinkReport {checked: number; broken: LinkCheck[]; unchecked: number; reason?: string}
const LINK_KEYS = new Set(['url_path', 'url', 'link', 'path', 'href']);
const ROUTE = /^\/[\w-]+(?:\/[\w-]+)*$/;
export const PRODUCT_ROUTE = /^\/[\w-]+\/p$/;
const MAX_SOURCES = 3;
// One capture per path: a category opens with any order or page (?sort_by=, ?page=). A search
// changes with the question, so each ?q= is its own capture.
export function routeKey(url: URL): string {
  const q = url.searchParams.get('q');
  return q === null ? url.pathname : url.pathname + '?q=' + encodeURIComponent(q.trim());
}
// "/path?query" of a link to the store itself, other than the home: same origin, a path of
// slugs (no file extension), and nothing publicUrl refuses (checkout, cart, account, secrets).
export function storeRoute(value: unknown, origin: string): Omit<Route, 'sources'> | undefined {
  if (typeof value !== 'string' || !/^(?:\/(?!\/)|https:\/\/)/i.test(value)) return undefined;
  let url: URL;
  try {url = new URL(publicUrl(value, origin));} catch {return undefined;}
  if (url.origin !== origin || !ROUTE.test(url.pathname) || url.searchParams.has('q') && !url.searchParams.get('q')!.trim()) return undefined;
  return {url: url.href, key: routeKey(url), product: PRODUCT_ROUTE.test(url.pathname)};
}
function add(found: Map<string, Route>, route: Omit<Route, 'sources'> | undefined, source: string, inferred = false): void {
  if (!route) return;
  const current = found.get(route.key);
  if (!current) {found.set(route.key, {...route, sources: [source], ...(inferred ? {inferred: true} : {})}); return;}
  if (!current.sources.includes(source) && current.sources.length < MAX_SOURCES) current.sources.push(source);
  // A literal link anywhere makes the route a real link, not only a guess from a slug.
  if (current.inferred && !inferred) delete current.inferred;
}
// Where a link sits in the data, without list positions: "merchant.categories.children".
const where = (trail: string[]) => trail.slice(0, -1).filter(part => !/^\d+$/.test(part) && part !== 'data').join('.') || trail.join('.');
// Links in url_path, url, link, path and href, at any depth of the public data.
export function dataRoutes(value: unknown, origin: string, root: string, found = new Map<string, Route>(), trail: string[] = [root], depth = 0): Map<string, Route> {
  if (depth > 32 || !value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {value.forEach((item, index) => dataRoutes(item, origin, root, found, [...trail, String(index)], depth + 1)); return found;}
  for (const [key, item] of Object.entries(value)) {
    if (LINK_KEYS.has(key) && typeof item === 'string') add(found, storeRoute(item, origin), where([...trail, key]));
    else dataRoutes(item, origin, root, found, [...trail, key], depth + 1);
  }
  return found;
}
const THEME_LINK = /\b(?:href|link|cta-url)['"]?\s*[:=]\s*['"](\/[^'"\s{}]*)['"]/g;
const THEME_PRODUCT = /['"](\/[\w-]+\/p)['"]/g;
const THEME_SLUG = /\bslug['"]?\s*:\s*['"]([\w-]+)['"]/g;
// Links written in the theme's own Twig and Vue texts, with the file as the source. A product
// named only by its slug ('slug': 'x') is a guess at /x/p: it is read, but a 404 there is not
// reported as a broken link of the theme.
export function themeRoutes(files: Files, origin: string, found = new Map<string, Route>(), options: {slugs?: boolean} = {}): Map<string, Route> {
  for (const [path, text] of Object.entries(files)) {
    if (!/\.(?:twig|vue)$/.test(path) || typeof text !== 'string') continue;
    for (const match of text.matchAll(THEME_LINK)) add(found, storeRoute(match[1], origin), path);
    for (const match of text.matchAll(THEME_PRODUCT)) add(found, storeRoute(match[1], origin), path);
    if (options.slugs !== false) for (const match of text.matchAll(THEME_SLUG)) add(found, storeRoute(`/${match[1]}/p`, origin), path, true);
  }
  return found;
}
// The literal internal links of the texts a send would take to the store, to check each one
// against the storefront before sending.
export function sendRoutes(files: Files, paths: string[], origin: string, limit = 80): Route[] {
  const chosen = new Set(paths), texts = Object.fromEntries(Object.entries(files).filter(([path]) => chosen.has(path)));
  return [...themeRoutes(texts, origin, new Map(), {slugs: false}).values()].slice(0, limit);
}
