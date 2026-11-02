// Return safety shared by the extension and `npm run pack`. A file sent to Yampi
// must carry its dependencies and use the same paths and names as the platform.
import {resolveSectionFile, componentList, COMPONENTS_FILE, PAGE_KINDS} from './contract.mjs';

function join(directory, name) {
  const parts = [];
  for (const part of (directory ? directory + '/' + name : name).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {if (!parts.length) return undefined; parts.pop();} else parts.push(part);
  }
  return parts.join('/');
}
const dirname = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export const kebab = name => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
// Yampi installs these icons after the theme plugins, replacing same-named components.
// Observed in the platform's public dist/vendor/icons.js on 30/10/2026.
export const RESERVED_COMPONENTS = new Set(('IconBag IconBuyButton IconCart IconCategoryHighlight IconCollectionsGrid IconComments IconCta IconDelete IconDots IconEye IconEyeSlash IconFooter IconGrid IconHeader IconHighlights IconImage IconImageSlide IconLayoutCenter IconLayoutInline IconLayoutLeft IconNew IconPage IconParagraphCenter IconParagraphLeft IconParagraphRight IconPlus IconQuestion IconShirt IconSocial IconStar IconStarRating IconTextBanners IconTrash IconVideo').split(' ').map(kebab));
export function assetUrlProblem(value) {
  return String(value).startsWith('/assets/') ? undefined : 'assets_url precisa do caminho completo a partir do template, como "/assets/images/capa.png". A Yampi concatena o valor literalmente; "images/capa.png" gera um endereço quebrado.';
}
export function productionIssues(path, text) {
  const issues = [];
  if (path.startsWith('components/') && path.endsWith('.vue') && RESERVED_COMPONENTS.has(kebab(path.split('/').at(-1).slice(0, -4)))) issues.push('Nome reservado pela Yampi: este componente é substituído por um ícone interno. Crie uma cópia com um nome próprio e atualize as tags que a usam.');
  if (path.endsWith('.twig')) {
    const source = text.replace(/\{#[\s\S]*?#\}/g, '');
    const values = [
      ...source.matchAll(/(["'])([^"'{}]*)\1\s*\|\s*assets_url\b/g),
      ...source.matchAll(/\(\s*(["'])([^"'{}]*)\1\s*~[^{}\n]*\)\s*\|\s*assets_url\b/g),
    ];
    if (values.some(match => assetUrlProblem(match[2]))) issues.push(assetUrlProblem(''));
  }
  return issues;
}
function sassCandidates(from, name) {
  if (/^(?:[a-z]+:|\/|~)/i.test(name) || /\.css$/.test(name) && /^https?:/.test(name)) return [];
  const relative = join(dirname(from), name);
  if (!relative) return [];
  const directory = dirname(relative), base = relative.split('/').at(-1), prefix = directory ? directory + '/' : '';
  return [relative, relative + '.scss', relative + '.css', prefix + '_' + base, prefix + '_' + base + '.scss', relative + '/_index.scss', relative + '/index.scss'];
}
function strings(list) {return [...list.matchAll(/(["'])((?:(?!\1).)+)\1/g)].map(m => m[2]);}
function assetCandidates(name) {
  const clean = String(name).replace(/^\/+/, '').replace(/^assets\//, '');
  return clean ? ['assets/' + clean] : [];
}
// Each reference lists every path that would satisfy it.
export function references(path, text) {
  const refs = [];
  const add = (via, candidates, label) => {if (candidates.length) refs.push({via, candidates, label: label || candidates[0]});};
  if (/\.(?:s?css)$/.test(path)) {
    for (const m of text.matchAll(/@(?:import|use|forward)\s+([^;]+);/g)) for (const name of strings(m[1])) add('sass', sassCandidates(path, name), name);
  }
  if (/\.twig$/.test(path)) {
    for (const m of text.matchAll(/\{%-?\s*(?:include|embed|extends|import|from|use)\s+(["'])([^"']+)\1/g)) add('twig', [m[2]]);
    for (const m of text.matchAll(/\b(?:include|source)\(\s*(["'])([^"']+)\1/g)) add('twig', [m[2]]);
    const page = path.match(/^templates\/([^/]+)\.twig$/)?.[1];
    for (const m of text.matchAll(/\bget_section_file\(\s*(["'])([a-z0-9_-]+)\1(?:\s*,\s*(["'])([a-z0-9_-]+)\3)?/gi)) add('section', [{alias: m[2], pages: m[4] ? [m[4]] : page ? [page] : PAGE_KINDS}], m[2]);
  }
  if (/\.(?:twig|vue)$/.test(path)) {
    for (const m of text.matchAll(/(["'])([^"'{}]+)\1\s*\|\s*assets_url/g)) add('asset', assetCandidates(m[2]), m[2]);
    for (const m of text.matchAll(/\b(?:asset|mix)\(\s*(["'])([^"']+)\1/g)) add('asset', assetCandidates(m[2]), m[2]);
  }
  // CSS URLs and image paths in Vue props/Twig data objects also travel with the text.
  if (/\.(?:twig|vue|s?css)$/.test(path)) {
    for (const m of text.matchAll(/(["'])((?:\/?assets\/images\/|\/?images\/|\.\.\/images\/)[^"'{}]+\.(?:png|jpe?g|webp|svg))\1/gi)) {
      const name = m[2].replace(/^\.\.\//, '');
      add('asset', assetCandidates(name), m[2]);
    }
    // A literal image-name table combined with a literal asset prefix (not executable Twig).
    if (/(["'])\/assets\/images\/\1\s*~/.test(text)) for (const m of text.matchAll(/(["'])([A-Za-z0-9_.-]+\.(?:png|jpe?g|webp|svg))\1/gi)) add('asset', ['assets/images/' + m[2]], m[2]);
  }
  if (/\.(?:s?css)$/.test(path)) for (const m of text.matchAll(/url\(\s*(?:(["'])([^"']+)\1|([^\s)]+))\s*\)/gi)) {
    const name = m[2] || m[3];
    if (/^(?:[a-z]+:|\/\/|#|\$)/i.test(name) || /[{}]/.test(name)) continue;
    const target = name.startsWith('/') ? name.slice(1) : join(dirname(path), name);
    if (target?.startsWith('assets/images/')) add('asset', [target], name);
  }
  if (path.endsWith('.vue')) {
    for (const m of text.matchAll(/\bfrom\s+(["'])([^"']+\.vue)\1/g)) {
      const name = m[2].startsWith('@/') ? m[2].slice(2) : m[2].startsWith('.') ? join(dirname(path), m[2]) : undefined;
      if (name) add('vue', [name], m[2]);
    }
  }
  if (path === COMPONENTS_FILE) for (const component of componentList(text).components) add('component-list', [{component}], '/components/' + component + '.js');
  return refs;
}
function satisfied(candidate, paths) {
  if (typeof candidate === 'string') return paths.has(candidate) ? candidate : undefined;
  if (candidate.component) return [...paths].find(p => p.startsWith('components/') && p.split('/').at(-1) === candidate.component + '.vue');
  for (const page of candidate.pages) try {return resolveSectionFile(candidate.alias, page, paths);} catch {/* Try the other page folders. */}
  return undefined;
}
const usesTag = (text, tags) => tags.some(tag => new RegExp('<' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\s/>])').test(text));
const componentTags = path => {const name = path.split('/').at(-1).slice(0, -4); return [kebab(name), name];};
// Paths a file uses (includes, imports, sections, assets and components by tag).
export function resolvedReferences(path, text, paths) {
  const available = paths instanceof Set ? paths : new Set(paths), found = new Set();
  for (const ref of references(path, text)) for (const candidate of ref.candidates) {const target = satisfied(candidate, available); if (target) {found.add(target); break;}}
  if (/\.(?:twig|vue)$/.test(path)) for (const component of [...available].filter(p => p.startsWith('components/') && p.endsWith('.vue'))) if (component !== path && usesTag(text, componentTags(component))) found.add(component);
  found.delete(path);
  return [...found];
}
// targets: files to send. local/remote: every path present locally/in the store.
// texts: local text contents. Components used by tag also count as dependencies.
export function dependencyReport({targets, texts, local, remote}) {
  const localPaths = new Set(local), remotePaths = new Set(remote), blocked = [], warnings = [];
  const created = [...localPaths].filter(p => !remotePaths.has(p));
  const newComponents = created.filter(p => p.startsWith('components/') && p.endsWith('.vue')).map(p => ({path: p, tags: componentTags(p)}));
  for (const path of targets) {
    const text = texts[path];
    if (typeof text !== 'string') continue;
    const dependencies = [];
    for (const ref of references(path, text)) {
      if (ref.candidates.some(c => satisfied(c, remotePaths))) continue;
      const local = ref.candidates.map(c => satisfied(c, localPaths)).find(Boolean);
      if (local) dependencies.push({path: local, via: ref.via});
      else if (ref.via !== 'twig' || /^(?:assets|components|elements|sections|templates)\//.test(ref.label)) warnings.push({path, message: `Referência sem arquivo correspondente: ${ref.label}`});
    }
    if (/\.(?:twig|vue)$/.test(path)) for (const component of newComponents) if (component.path !== path && usesTag(text, component.tags)) dependencies.push({path: component.path, via: 'component'});
    const unique = [...new Map(dependencies.map(d => [d.path, d])).values()];
    if (unique.length) blocked.push({path, dependencies: unique});
  }
  const listed = new Set(componentList(texts[COMPONENTS_FILE] ?? '').components);
  if (texts[COMPONENTS_FILE] !== undefined) for (const component of newComponents) {
    const name = component.path.split('/').at(-1).slice(0, -4);
    if (!listed.has(name)) warnings.push({path: component.path, message: 'Componente novo fora de elements/scripts/components.twig: a prévia local só registra os componentes listados ali. Na loja, a Yampi o lista quando a extensão cria o arquivo pelo editor.'});
  }
  return {blocked, warnings};
}
