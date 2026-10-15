// Platform contract shared by the capture, `npm run check`, `npm run dev` and tests.
// Pure module: no Node, DOM or network access. Raw captures stay immutable; this
// adapter derives the Twig context the theme expects from them.
export const CONTRACT_VERSION = 2;
export const PAGE_KINDS = ['home', 'category', 'product', 'pages', 'promotion'];
// Institutional pages use sections/content/ in the exported themes.
const FOLDERS = {home: ['home'], category: ['category'], product: ['product'], pages: ['pages', 'content'], promotion: ['promotion']};
export const OVERRIDES_FORMAT = 'yampi-local-overrides';
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
// Twig/PHP truthiness: "0", "", 0, null and empty arrays are false.
export const truthy = value => !(value === undefined || value === null || value === false || value === 0 || value === '' || value === '0' || Array.isArray(value) && !value.length);

export function sectionCandidates(alias, page) {
  const names = [alias, ...(alias.startsWith('main_') ? [alias.slice(5)] : [])];
  return [...(FOLDERS[page] || [page]), 'global'].flatMap(folder => names.map(name => `sections/${folder}/${name}.twig`));
}
// sections/<page>/<alias>.twig, then without main_, then sections/global/, then a
// unique file with that name. A missing file is an explicit error, never a guess.
export function resolveSectionFile(alias, page, paths, configured = {}) {
  if (typeof alias !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(alias)) throw new Error(`Alias de seção inválido na página "${page}": ${String(alias)}`);
  const explicit = configured[`${page}/${alias}`] ?? configured[alias];
  if (typeof explicit === 'string') return explicit;
  const available = paths instanceof Set ? paths : new Set(paths);
  const candidates = sectionCandidates(alias, page), direct = candidates.find(p => available.has(p));
  if (direct) return direct;
  const names = new Set([alias, alias.replace(/^main_/, '')].map(name => name + '.twig'));
  const unique = [...available].filter(p => p.startsWith('sections/') && names.has(p.split('/').at(-1)));
  if (unique.length === 1) return unique[0];
  throw new Error(`Seção sem arquivo: alias "${alias}" na página "${page}". Procurado em ${candidates.join(', ')}.`);
}

function stableOrder(sections) {
  const rank = s => Number.isFinite(Number(s.order)) && s.order !== null && s.order !== '' ? Number(s.order) : Infinity;
  return sections.map((section, index) => ({section, index})).sort((a, b) => rank(a.section) - rank(b.section) || a.index - b.index).map(item => item.section);
}
// window.data.config is the main section of category/product/search/institutional
// pages. It takes precedence over the themeConfig entry with the same alias.
export function mergeSection(base, config) {
  return {...base, ...config, params: {...(plain(base?.params) ? base.params : {}), ...(plain(config?.params) ? config.params : {})}};
}
export function pageSections(raw) {
  const themeConfig = plain(raw?.themeConfig) ? raw.themeConfig : {}, data = plain(raw?.data) ? raw.data : {};
  const sections = Array.isArray(themeConfig.sections) ? themeConfig.sections.filter(plain) : [];
  const config = plain(data.config) && typeof data.config.section_alias === 'string' ? data.config : undefined;
  let main = sections.filter(s => Number(s.position) === 1);
  if (config) {
    const index = main.findIndex(s => s.section_alias === config.section_alias);
    main = index >= 0 ? main.map((s, i) => i === index ? mergeSection(s, config) : s) : [...main, mergeSection({position: 1, visible: true}, config)];
  }
  const edge = (position, alias) => sections.find(s => Number(s.position) === position && s.section_alias === alias) ?? sections.find(s => Number(s.position) === position);
  return {sections, header: edge(0, 'header'), footer: edge(2, 'footer'), main: stableOrder(main), config: config && main.find(s => s.section_alias === config.section_alias)};
}
export function expectedSections(raw) {
  return pageSections(raw).main.filter(section => truthy(section.visible)).map(section => ({alias: section.section_alias, order: section.order ?? null}));
}
// Single versioned adapter: raw {themeConfig, data, merchant} -> Twig variables.
export function platformContext(raw, {kind = 'home'} = {}) {
  const themeConfig = plain(raw?.themeConfig) ? raw.themeConfig : {}, data = plain(raw?.data) ? raw.data : {}, merchant = plain(raw?.merchant) ? raw.merchant : {};
  const {sections, header, footer, main, config} = pageSections(raw);
  const theme = plain(themeConfig.theme) ? themeConfig.theme : {};
  const categories = Array.isArray(data.categories) ? data.categories : Array.isArray(merchant.categories) ? merchant.categories : [];
  return {
    ...data,
    page: kind, environment: 'local', isPreview: true,
    merchantData: merchant,
    pageConfig: {page: kind, data: {...themeConfig, theme, sections}, theme},
    sections, header: header ?? null, footer: footer ?? null, mainSections: main,
    context: typeof data.context === 'string' ? data.context : kind,
    customData: {...data, config: config ?? data.config ?? null},
    categories,
    featured_categories: Array.isArray(data.featured_categories) ? data.featured_categories : categories.filter(c => truthy(c?.featured)),
    sorted_categories: Array.isArray(data.sorted_categories) ? data.sorted_categories : categories,
  };
}

// 0.2.x local.data.json and 0.3.x preview/data.json use the Twig variable shape.
export function legacyToRaw(data, kind) {
  const source = plain(data) ? {...data, ...(plain(data.pages?.[kind]) ? data.pages[kind] : {})} : {};
  const pageConfig = plain(source.pageConfig) ? source.pageConfig : {};
  const theme = plain(pageConfig.data?.theme) ? pageConfig.data.theme : plain(pageConfig.theme) ? pageConfig.theme : {};
  let sections;
  if (Array.isArray(source.sections)) sections = source.sections.filter(plain);
  else {
    const object = plain(source.sections) ? source.sections : {};
    const header = plain(source.header) ? source.header : object.header, footer = plain(source.footer) ? source.footer : object.footer;
    const main = [source.mainSectionsByPage?.[kind], object.main, object[kind], source.mainSections].find(Array.isArray) || [];
    sections = [
      ...(plain(header) ? [{section_alias: 'header', ...header, position: 0}] : []),
      ...main.filter(plain).map((s, i) => ({order: i, visible: true, ...s, position: 1})),
      ...(plain(footer) ? [{section_alias: 'footer', ...footer, position: 2}] : []),
    ];
  }
  const {merchantData, merchant, pageConfig: _config, sections: _sections, mainSectionsByPage: _byPage, mainSections: _main, header: _header, footer: _footer, pages: _pages, bodyClasses, section: _section, page: _page, ...rest} = source;
  return {themeConfig: {...(plain(pageConfig.data) ? pageConfig.data : {}), theme, sections}, merchant: plain(merchantData) ? merchantData : plain(merchant) ? merchant : {}, data: rest, ...(Array.isArray(bodyClasses) ? {bodyClasses} : {})};
}

// RFC 7396 JSON Merge Patch. Arrays and scalars replace; null deletes.
export function mergePatch(target, patch) {
  if (!plain(patch)) return patch;
  const output = plain(target) ? {...target} : {};
  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (value === null) delete output[key]; else output[key] = mergePatch(output[key], value);
  }
  return output;
}
export function emptyOverrides() {return {format: OVERRIDES_FORMAT, version: 1, global: {}, pages: {}};}
export const isOverrides = value => plain(value) && value.format === OVERRIDES_FORMAT;
const SCOPE_KEYS = new Set(['theme', 'sections', 'merchant', 'data']);
export function validateOverrides(value) {
  if (!isOverrides(value) || value.version !== 1 || !plain(value.global ?? {}) || !plain(value.pages ?? {})) throw new Error('local.data.json inválido: use {"format":"yampi-local-overrides","version":1,"global":{},"pages":{}}.');
  const scopes = [['global', value.global ?? {}], ...Object.entries(value.pages ?? {}).map(([name, scope]) => ['pages.' + name, scope])];
  for (const [name, scope] of scopes) {
    if (!plain(scope)) throw new Error(`local.data.json: ${name} deve ser um objeto.`);
    for (const key of Object.keys(scope)) if (!SCOPE_KEYS.has(key)) throw new Error(`local.data.json: chave desconhecida ${name}.${key}. Use theme, sections, merchant ou data.`);
    if (scope.sections !== undefined && !plain(scope.sections)) throw new Error(`local.data.json: ${name}.sections usa "alias" ou "alias@ordem" como chave.`);
  }
  return value;
}
function patchSection(section, patches) {
  let output = section;
  for (const key of [section.section_alias, `${section.section_alias}@${section.order}`]) if (patches[key] !== undefined) output = mergePatch(output, patches[key]);
  return output;
}
function applyScope(raw, scope) {
  const themeConfig = plain(raw.themeConfig) ? {...raw.themeConfig} : {};
  let data = plain(raw.data) ? raw.data : {};
  if (scope.theme !== undefined) themeConfig.theme = mergePatch(themeConfig.theme, scope.theme);
  if (plain(scope.sections)) {
    themeConfig.sections = (Array.isArray(themeConfig.sections) ? themeConfig.sections : []).map(s => plain(s) ? patchSection(s, scope.sections) : s);
    if (plain(data.config) && typeof data.config.section_alias === 'string') data = {...data, config: patchSection(data.config, scope.sections)};
  }
  if (scope.data !== undefined) data = mergePatch(data, scope.data);
  return {...raw, themeConfig, data, merchant: scope.merchant !== undefined ? mergePatch(raw.merchant, scope.merchant) : raw.merchant};
}
// Overrides apply global -> page kind -> capture id. Sections are addressed by
// alias (all instances) or alias@order, never by list index.
export function applyOverrides(raw, overrides, {kind, id} = {}) {
  if (!overrides) return raw;
  return [overrides.global, overrides.pages?.[kind], id ? overrides.pages?.[id] : undefined].filter(plain).reduce(applyScope, raw);
}

// Static scan of the exported code. Dynamic access is not resolved.
export function referencedKeys(files) {
  const keys = {theme: new Set(), section: new Set(), merchant: new Set()};
  for (const [path, text] of Object.entries(files)) {
    if (!/\.(?:twig|vue)$/.test(path) || typeof text !== 'string') continue;
    for (const m of text.matchAll(/\b(?:pageConfig\.data\.theme\.params|pageConfig\.theme\.params|themeStyle)\.([A-Za-z_]\w*)/g)) keys.theme.add(m[1]);
    for (const m of text.matchAll(/\b(?:section|header|footer|config)\.params\.([A-Za-z_]\w*)/g)) keys.section.add(m[1]);
    for (const m of text.matchAll(/\bmerchant(?:Data)?\.([A-Za-z_]\w*)/g)) keys.merchant.add(m[1]);
  }
  return Object.fromEntries(Object.entries(keys).map(([name, set]) => [name, [...set].sort()]));
}
export function capturedKeys(pages) {
  const keys = {theme: new Set(), section: new Set(), merchant: new Set()};
  for (const raw of pages) {
    for (const key of Object.keys(plain(raw?.themeConfig?.theme?.params) ? raw.themeConfig.theme.params : {})) keys.theme.add(key);
    for (const section of [...(Array.isArray(raw?.themeConfig?.sections) ? raw.themeConfig.sections : []), raw?.data?.config]) for (const key of Object.keys(plain(section?.params) ? section.params : {})) keys.section.add(key);
    for (const key of Object.keys(plain(raw?.merchant) ? raw.merchant : {})) keys.merchant.add(key);
  }
  return keys;
}

// elements/scripts/components.twig loads one module per component. Yampi marks
// this file as generated; local registration follows the exported list.
export function componentList(source) {
  const entries = [...String(source || '').matchAll(/["']([^"']+?\.js)["']\s*\|\s*components_url/g)].map(m => m[1]);
  const components = entries.map(entry => entry.match(/^\/?components\/(?:.*\/)?([^/]+)\.js$/)?.[1]).filter(Boolean);
  return {entries, components: [...new Set(components)]};
}
export const COMPONENTS_FILE = 'elements/scripts/components.twig';

// Published theme sheets, in the order used by elements/scripts/head.twig.
export function themeSheet(url, pages = PAGE_KINDS) {
  let pathname;
  try {pathname = new URL(url, 'https://local.invalid').pathname;} catch {return undefined;}
  if (/\/css\/global\.css$/.test(pathname)) return {group: 'styles'};
  const name = pathname.match(/\/css\/themes\/([^/]+)\.css$/)?.[1];
  if (!name) return undefined;
  for (const page of pages) {
    if (name.endsWith('-' + page + '-mobile')) return {group: 'mobilePageStyles', page};
    if (name.endsWith('-' + page)) return {group: 'pageStyles', page};
  }
  return name.endsWith('-mobile') ? {group: 'mobileStyles'} : undefined;
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Map captured remote URLs to local files at runtime. The raw capture keeps the
// original URLs; links and unknown URLs are left for the server/router.
export function urlRewriter(map) {
  const urls = Object.keys(map).filter(url => /^https:\/\//.test(url) && map[url]).sort((a, b) => b.length - a.length);
  const pattern = urls.length ? new RegExp(urls.flatMap(url => [escapeRegExp(url), escapeRegExp(url.slice(6))]).join('|'), 'g') : undefined;
  const lookup = text => map[text] || (text.startsWith('//') ? map['https:' + text] : undefined);
  const visit = value => {
    if (typeof value === 'string') {
      const exact = lookup(value);
      if (exact) return exact;
      return pattern && value.includes('//') ? value.replace(pattern, found => lookup(found) || found) : value;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (plain(value)) {const output = {}; for (const [key, item] of Object.entries(value)) if (!UNSAFE_KEYS.has(key)) output[key] = visit(item); return output;}
    return value;
  };
  return visit;
}

// Thumbor variants and -large/-small originals share one underlying image.
// Signed thumbor URLs are never built; captured variants are reused instead.
export function underlyingImage(url) {
  let parsed;
  try {parsed = new URL(url);} catch {return url;}
  let host = parsed.host.toLowerCase(), path = parsed.pathname;
  const thumbor = path.match(/^\/(?:unsafe|[A-Za-z0-9_-]{27}=|[A-Za-z0-9_-]{28})\/(?:trim\/)?(?:(?:adaptive-)?(?:full-)?fit-in\/)?(?:-?\d*x-?\d*\/)?(?:(?:left|right|center)\/)?(?:(?:top|bottom|middle)\/)?(?:smart\/)?(?:filters:[^/]*\/)?(.+)$/);
  if (thumbor) {
    const inner = decodeURIComponent(thumbor[1]);
    try {const target = new URL(/^https?:/.test(inner) ? inner : /^\/\//.test(inner) ? 'https:' + inner : 'https://' + host + '/' + inner.replace(/^\/+/, '')); host = target.host.toLowerCase(); path = target.pathname;} catch {path = '/' + inner;}
  }
  return host + path.replace(/-(?:large|medium|small|thumb|thumbnail|xlarge|original|\d+x\d+)(\.[a-z0-9]+)$/i, '$1');
}
