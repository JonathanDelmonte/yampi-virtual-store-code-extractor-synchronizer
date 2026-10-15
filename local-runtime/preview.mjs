import path from 'node:path';
import {readdir, stat} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {safeRead, digest, readProject} from './engine.mjs';
import {platformContext, applyOverrides, legacyToRaw, isOverrides, validateOverrides, emptyOverrides, expectedSections, urlRewriter, plain, PAGE_KINDS} from './contract.mjs';
const MIMES = {png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', css: 'text/css; charset=utf-8'};
const KINDS = new Set(PAGE_KINDS), MAX_RESOURCES = 240, MAX_ASSET = 2 * 1024 * 1024, MAX_ASSETS = 32 * 1024 * 1024, MAX_JSON = 4 * 1024 * 1024;
export const PLACEHOLDER = '/__local/placeholder.svg';
export function assetPath(value) {if (!/^assets\/[a-f0-9]{64}\.(png|jpg|webp|svg|woff2?|ttf|otf|css)$/.test(value)) throw new Error('Asset de prévia com caminho inseguro.'); return value;}
function validAsset(bytes, ext) {
  const hex = bytes.subarray(0, 12).toString('hex');
  if (ext === 'png') return hex.startsWith('89504e470d0a1a0a'); if (ext === 'jpg') return hex.startsWith('ffd8ff');
  if (ext === 'webp') return hex.startsWith('52494646') && hex.slice(16, 24) === '57454250';
  if (ext === 'woff2') return hex.startsWith('774f4632'); if (ext === 'woff') return hex.startsWith('774f4646');
  if (ext === 'ttf') return hex.startsWith('00010000'); if (ext === 'otf') return hex.startsWith('4f54544f');
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  if (ext === 'css') return !/<\/?(?:script|html)\b/i.test(text);
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text) && !/<(?:script|foreignObject|iframe)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']?(?:https?:|\/\/|javascript:|data:)/i.test(text);
}
function safeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || [...url.searchParams.keys()].some(k => /token|secret|auth|session|password|key|signature/i.test(k))) throw new Error('URL de recurso visual inválida.');
  return url;
}
async function verifiedJson(root, file, record, label) {
  if (!record || typeof record.file !== 'string' || !/^raw\/[a-z0-9-]+\.json$/.test(record.file) || record.file !== file) throw new Error(`Arquivo da prévia sem registro: ${label}.`);
  const bytes = await safeRead(root, 'preview/' + file, MAX_JSON);
  if (bytes.length !== record.bytes || digest(bytes) !== record.sha256) throw new Error(`Dados capturados alterados ou ausentes: preview/${file}. Use local.data.json para sobrepor valores.`);
  return JSON.parse(bytes);
}
function none() {
  return {version: 0, source: {kind: 'demonstration', association: 'unavailable'}, issues: [{code: 'legacy-preview', reason: 'Projeto sem contexto visual capturado. Dados locais não certificam fidelidade.'}], resources: [], assets: {}, pages: [], api: [], map: {}, aliases: {}, platform: {fontSheets: [], themeSheets: []}};
}
export async function loadPreview(root, project) {
  let bytes;
  try {bytes = await safeRead(root, 'preview/manifest.json');} catch (error) {if (error.code === 'ENOENT') return none(); throw error;}
  const manifest = JSON.parse(bytes);
  if (manifest.format !== 'yampi-local-preview' || ![1, 2].includes(manifest.version) || !Number.isFinite(Date.parse(manifest.capturedAt)) || manifest.source?.origin !== project.manifest.context.previewOrigin || !['editor', 'published', 'demonstration'].includes(manifest.source.kind) || !['same-editor', 'published-unverified', 'unavailable'].includes(manifest.source.association) || !Array.isArray(manifest.resources) || manifest.resources.length > MAX_RESOURCES || !Array.isArray(manifest.issues) || manifest.issues.length > 1000) throw new Error('Manifesto visual inválido ou de outra loja.');
  const assets = {}, map = {}, categories = {};
  let total = 0;
  for (const item of manifest.resources) {
    assetPath(item.path); const url = safeUrl(item.url);
    if (!assets[item.path]) {
      const value = await safeRead(root, 'preview/' + item.path);
      if (value.length !== item.bytes || value.length > MAX_ASSET || digest(value) !== item.sha256 || !item.path.includes(item.sha256) || !validAsset(value, item.path.split('.').at(-1)) || (total += value.length) > MAX_ASSETS) throw new Error('Asset capturado ausente, inseguro ou alterado: ' + item.path);
      assets[item.path] = value;
    } else if (assets[item.path].length !== item.bytes || digest(assets[item.path]) !== item.sha256) throw new Error('Recurso duplicado inconsistente.');
    map[url.href] = '/preview/' + item.path; categories[item.path] = item.category || 'other';
  }
  const output = {...manifest, assets, map, categories, aliases: {}, api: [], platform: {fontSheets: [], themeSheets: [], ...(plain(manifest.platform) ? manifest.platform : {})}};
  if (manifest.version === 1) {
    // 0.3.x: data already rewritten, allowlisted and without section order.
    const dataBytes = await safeRead(root, 'preview/data.json', MAX_JSON);
    if (!manifest.dataFile || dataBytes.length !== manifest.dataFile.bytes || digest(dataBytes) !== manifest.dataFile.sha256) throw new Error('Dados capturados de prévia ausentes ou alterados. Edite local.data.json para personalizar.');
    const data = JSON.parse(dataBytes);
    if (!Array.isArray(data.pages) || data.pages.length > 7) throw new Error('Páginas capturadas inválidas.');
    for (const item of manifest.resources) {const tail = new URL(item.url).pathname.match(/\/assets\/(.+)$/)?.[1]; if (tail) {const alias = '/tema/assets/' + tail; map[alias] = map[alias] && map[alias] !== map[item.url] ? '' : map[item.url];}}
    output.pages = data.pages.map(page => ({id: page.id, kind: page.kind, sourceUrl: page.sourceUrl, raw: legacyToRaw(page.data, page.kind)}));
    output.legacyData = data.data;
    output.issues = [...manifest.issues, {code: 'legacy-preview-format', reason: 'Prévia capturada pela versão 0.3.x: parâmetros e ordem das seções podem estar incompletos. Faça uma nova exportação e troque somente preview/ com o atualizador.'}];
  } else {
    if (!Array.isArray(manifest.pages) || manifest.pages.length > 12) throw new Error('Páginas capturadas inválidas.');
    output.pages = [];
    for (const page of manifest.pages) {
      if (!/^page-\d+$/.test(page.id) || !KINDS.has(page.kind) || new URL(page.sourceUrl).origin !== manifest.source.origin) throw new Error('Rota capturada inválida.');
      const raw = await verifiedJson(root, `raw/${page.id}.json`, page, page.id);
      if (!plain(raw)) throw new Error('Rota capturada inválida.');
      output.pages.push({id: page.id, kind: page.kind, context: typeof page.context === 'string' ? page.context : undefined, sourceUrl: page.sourceUrl, raw});
    }
    if (manifest.api) {
      const recorded = await verifiedJson(root, 'raw/api.json', manifest.api, 'api');
      if (!Array.isArray(recorded.records)) throw new Error('Leituras públicas gravadas inválidas.');
      output.api = recorded.records.filter(r => plain(r) && r.method === 'GET' && typeof r.path === 'string');
    }
    for (const [from, to] of Object.entries(plain(manifest.aliases) ? manifest.aliases : {})) if (map[to] && !map[from]) {safeUrl(from); map[from] = map[to];}
  }
  map.__origin = manifest.source.origin;
  return output;
}
export async function loadOverrides(root, preview) {
  let value;
  try {value = JSON.parse(await safeRead(root, 'local.data.json'));}
  catch (error) {if (error.code === 'ENOENT') return {overrides: emptyOverrides(), issues: []}; throw new Error('local.data.json inválido: ' + error.message);}
  if (isOverrides(value)) return {overrides: validateOverrides(value), issues: []};
  if (preview.version === 0) return {overrides: emptyOverrides(), legacy: value, issues: []};
  if (preview.version === 1 && JSON.stringify(value) === JSON.stringify(preview.legacyData)) return {overrides: emptyOverrides(), issues: []};
  return {overrides: emptyOverrides(), issues: [{code: 'legacy-local-data-ignored', reason: 'local.data.json está no formato anterior (cópia completa dos dados) e não é aplicado. Escreva somente sobreposições no formato descrito no README.'}]};
}
// Choose the captured route. An uncaptured template only receives the global
// header/footer/theme of the home capture, never another page's sections.
export function selectPage(local, kind, capture) {
  const {preview} = local;
  if (preview.version === 0) return {raw: legacyToRaw(local.legacy || {}, kind), captured: false};
  if (capture) {
    const page = preview.pages.find(p => p.id === capture && p.kind === kind);
    if (!page) throw new Error('Página capturada não encontrada: ' + capture);
    return {raw: page.raw, page, captured: true};
  }
  const page = preview.pages.find(p => p.kind === kind && p.context !== 'search') ?? preview.pages.find(p => p.kind === kind);
  if (page) return {raw: page.raw, page, captured: true};
  const base = (preview.pages.find(p => p.kind === 'home') ?? preview.pages[0])?.raw ?? {};
  const sections = (Array.isArray(base.themeConfig?.sections) ? base.themeConfig.sections : []).filter(s => Number(s?.position) !== 1);
  return {raw: {themeConfig: {...base.themeConfig, sections}, merchant: base.merchant, data: {}}, captured: false, issue: {code: 'page-not-captured', resource: kind, reason: `Página "${kind}" sem captura: somente cabeçalho, rodapé e configuração global.`}};
}
export function renderContext(local, kind, capture) {
  const selected = selectPage(local, kind, capture), page = selected.page;
  const raw = applyOverrides(selected.raw, local.overrides, {kind, id: page?.id});
  const context = local.rewrite(platformContext(raw, {kind}));
  const routes = local.preview.pages.map(p => ({id: p.id, kind: p.kind, context: p.context, sourceUrl: p.sourceUrl}));
  context.__preview = {source: local.preview.source, capturedAt: local.preview.capturedAt, page: {kind, id: page?.id ?? null, sourceUrl: page?.sourceUrl ?? null, captured: selected.captured}, assetMap: local.preview.map, routes, platform: local.preview.platform};
  return {context, raw, page, captured: selected.captured, expected: expectedSections(raw), issues: selected.issue ? [selected.issue] : []};
}
// Captured store paths render locally. Anything else is an explicit 404.
export function routeFor(preview, url) {
  const target = url.pathname + url.search;
  const candidates = preview.pages.map(page => ({page, source: new URL(page.sourceUrl)}));
  const match = candidates.find(c => c.source.pathname + c.source.search === target) ?? candidates.find(c => c.source.pathname === url.pathname && c.source.pathname !== '/');
  return match?.page;
}
function fontFace(body, map) {
  const declaration = body.match(/(^|;)(\s*src\s*:)([^;]*)/i);
  if (!declaration) return body;
  const kept = declaration[3].split(/,(?![^(]*\))/).map(part => {
    const url = part.match(/url\(\s*["']?([^"')\s]+)["']?\s*\)/i)?.[1];
    if (!url) return /\blocal\(/i.test(part) ? part : undefined;
    if (/^\/(?:preview|__platform|tema)\//.test(url)) return part;
    const local = lookup(url, map);
    return local ? part.replace(url, local) : undefined;
  }).filter(Boolean);
  return kept.some(part => /url\(/i.test(part)) ? body.replace(declaration[0], declaration[1] + declaration[2] + kept.join(',')) : undefined;
}
function lookup(src, map) {
  if (map[src]) return map[src];
  try {const url = new URL(src.startsWith('//') ? 'https:' + src : src, map.__origin || 'https://local.invalid'); return map[url.href];} catch {return undefined;}
}
// Uncaptured fonts are removed with their @font-face, never pointed at an image.
export function rewriteCSS(css, mapping) {
  return css.replace(/@font-face\s*\{([^{}]*)\}/gi, (whole, body) => {const kept = fontFace(body, mapping); return kept === undefined ? '/* Fonte não capturada; pilha de fallback mantida. */' : '@font-face{' + kept + '}';})
    .replace(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi, (whole, src) => {
      if (/^(?:#|data:)/.test(src) || /^\/(?:preview|__platform|__local)\//.test(src) || src.startsWith('/tema/') && !mapping[src]) return whole;
      const local = lookup(src, mapping);
      if (local) return `url("${local}")`;
      return /\.(?:png|jpe?g|webp|svg|gif)(?:[?#]|$)/i.test(src) ? `url("${PLACEHOLDER}")` : 'url("")';
    })
    .replace(/@import\s+(?:url\(\s*["']?([^"')\s]+)["']?\s*\)|["']([^"']+)["'])[^;]*;/gi, (whole, target, quoted) => {const src = target || quoted; if (/^\/(?:preview|tema|__local)\//.test(src)) return whole; const local = lookup(src, mapping); return local ? whole.replace(src, local) : '/* Import não capturado; consulte o relatório visual. */';});
}
export async function checkIntegrity(root, {original = false, returnZip} = {}) {
  const project = await readProject(root);
  const modified = project.manifest.files.filter(f => project.files[f.path] && digest(project.files[f.path]) !== f.sha256).map(f => f.path);
  const added = Object.keys(project.files).filter(p => !project.baseline[p]).sort();
  const removed = project.manifest.files.filter(f => !project.files[f.path]).map(f => f.path);
  let preview, previewError;
  try {preview = await loadPreview(root, project);} catch (error) {previewError = error.message;}
  if (original && modified.length + added.length + removed.length) throw new Error(`O tema local difere da exportação original: ${modified.length} modificados, ${added.length} adicionados, ${removed.length} ausentes.`);
  const zip = await returnZipCheck(root, project, returnZip);
  if (returnZip && zip.status !== 'matches') throw new Error('ZIP de retorno diferente do projeto: ' + zip.differences.join('; '));
  return {
    originalFiles: project.manifest.files.length, localFiles: Object.keys(project.files).length,
    modified: modified.length, added: added.length, removed: removed.length, modifiedFiles: modified.slice(0, 50), addedFiles: added.slice(0, 50), removedFiles: removed.slice(0, 50),
    originalIntegrity: 'SHA-256 e tamanho conferidos', codeCompleteness: 'Inventário estável do editor; sem auditoria independente do inventário remoto',
    newFiles: added.length ? 'Arquivos adicionados não são enviados pela extensão; arquivos que dependem deles ficam bloqueados no envio.' : 'nenhum',
    returnZip: zip, previewSource: preview?.source ?? null, previewFormat: preview?.version ?? null, previewError: previewError ?? null,
    capturedAssets: preview ? Object.keys(preview.assets).length : 0, issues: preview?.issues ?? [], visual: 'not-validated'
  };
}
// The return ZIP must contain exactly manifest + baseline + tema with equal hashes.
async function returnZipCheck(root, project, name) {
  let file = name;
  if (!file) {
    const names = (await readdir(root)).filter(n => /^retorno-yampi(?:-[\w-]+)?\.zip$/.test(n));
    const dated = await Promise.all(names.map(async n => ({n, time: (await stat(path.join(root, n))).mtimeMs})));
    file = dated.sort((a, b) => b.time - a.time)[0]?.n;
    if (!file) return {status: 'absent'};
  }
  if (path.basename(file) !== file || !/^retorno-yampi(?:-[\w-]+)?\.zip$/.test(file)) throw new Error('Informe o nome de um ZIP de retorno desta pasta.');
  const entries = unzipSync(await safeRead(root, file, 80 * 1024 * 1024)), differences = [];
  const expected = new Map([['.yampi-sync/manifest.json', undefined], ...Object.entries(project.baseline).map(([p, b]) => ['.yampi-sync/baseline/' + p, b]), ...Object.entries(project.files).map(([p, b]) => ['tema/' + p, b])]);
  for (const key of Object.keys(entries)) if (!expected.has(key)) differences.push('entrada extra ' + key);
  for (const [key, bytes] of expected) {
    if (!entries[key]) differences.push('entrada ausente ' + key);
    else if (bytes && digest(entries[key]) !== digest(bytes)) differences.push('conteúdo diferente ' + key);
  }
  if (entries['.yampi-sync/manifest.json'] && JSON.stringify(JSON.parse(new TextDecoder().decode(entries['.yampi-sync/manifest.json']))) !== JSON.stringify(project.manifest)) differences.push('manifesto diferente');
  return {name: file, status: differences.length ? (name ? 'different' : 'stale') : 'matches', entries: Object.keys(entries).length, differences: differences.slice(0, 20)};
}
export function createRewriter(preview) {return urlRewriter(preview.map);}
export const resourceMime = path => MIMES[path.split('.').at(-1)] || 'application/octet-stream';
