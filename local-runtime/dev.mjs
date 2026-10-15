import http from 'node:http';
import path from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import {readProject, safeRead, textFiles, renderPage, validateMarkup, validPath, compileStyles, compileComponents, digest} from './engine.mjs';
import {loadPreview, loadOverrides, renderContext, routeFor, rewriteCSS, assetPath, resourceMime, checkIntegrity, createRewriter, PLACEHOLDER} from './preview.mjs';
import {themeSheet} from './contract.mjs';
import {cssParity} from './parity.mjs';
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const types = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', css: 'text/css; charset=utf-8', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf'};
const componentOptions = config => ({registerUnlisted: config.components?.registerUnlisted === true, splideCss: config.splideCss === true});
export async function loadLocal(root) {
  const config = JSON.parse(await safeRead(root, 'local.config.json'));
  if (!config.pages || typeof config.pages !== 'object' || !Array.isArray(config.styles) || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('local.config.json inválido.');
  const project = await readProject(root), text = textFiles(project.files);
  const preview = await loadPreview(root, project);
  const {overrides, legacy, issues} = await loadOverrides(root, preview);
  return {project, text, config, preview, overrides, legacy, issues, rewrite: createRewriter(preview), signature: digest(JSON.stringify(text))};
}
function missingSections(expected, called) {
  const remaining = [...called];
  return expected.filter(section => {const index = remaining.indexOf(section.alias); if (index < 0) return true; remaining.splice(index, 1); return false;});
}
// Post-process the rendered page like the platform would serve it locally:
// remote scripts removed, captured assets mapped, store links routed locally.
function servePage(html, local, issues) {
  const origin = local.preview.source?.origin || local.project.manifest.context.previewOrigin, map = local.preview.map;
  const mapped = src => {try {return map[src] || map[new URL(src.startsWith('//') ? 'https:' + src : src, origin).href];} catch {return undefined;}};
  let placeholders = 0;
  const image = src => {
    if (!/^(?:https?:)?\/\//i.test(src)) return src;
    const local = mapped(src);
    if (local) return local;
    placeholders++; return PLACEHOLDER;
  };
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '').replace(/<base\b[^>]*>/gi, '');
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, tag => {
    if (/rel\s*=\s*["']?(?:preload|prefetch|manifest|preconnect|dns-prefetch|modulepreload)\b/i.test(tag)) return '';
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || !/^(?:https?:)?\/\//i.test(href)) return tag;
    const local = mapped(href);
    if (local) return tag.replace(href, local);
    issues.push({code: 'stylesheet-not-captured', resource: href, reason: 'Folha externa do template não capturada.'});
    return '';
  });
  html = html.replace(/\b(src|data-src|poster)\s*=\s*(["'])([^"']*)\2/gi, (whole, attr, quote, src) => `${attr}=${quote}${escape(image(src))}${quote}`);
  html = html.replace(/\b(srcset|data-srcset)\s*=\s*(["'])([^"']*)\2/gi, (whole, attr, quote, value) => attr + '=' + quote + value.split(',').map(part => {const [src, ...size] = part.trim().split(/\s+/); return escape([image(src), ...size].join(' '));}).join(', ') + quote);
  html = html.replace(/(<a\b[^>]*\bhref\s*=\s*)(["'])([^"']*)\2/gi, (whole, start, quote, href) => {
    try {const url = new URL(href.startsWith('//') ? 'https:' + href : href); if (url.origin === origin) return start + quote + escape(url.pathname + url.search + url.hash) + quote;} catch {/* Relative and special links stay unchanged. */}
    return whole;
  });
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (whole, open, css, close) => open + rewriteCSS(css, map) + close);
  html = html.replace(/\bstyle\s*=\s*"([^"]*)"/gi, (whole, css) => 'style="' + rewriteCSS(css.replace(/&quot;/g, '"'), map).replace(/"/g, '&quot;') + '"');
  return {html, placeholders};
}
const STATUS_CSS = '#yampi-preview-status{position:fixed;bottom:8px;left:8px;max-width:calc(100% - 40px);z-index:2147483647;padding:8px 12px;background:#fff3d6;color:#453817;font:12px/1.4 system-ui;box-shadow:0 1px 6px #0003}#yampi-preview-status[data-incomplete="true"]{background:#fce9e5;color:#a52f18}#yampi-preview-status a{color:inherit}#yampi-local-notice{position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#fce9e5;color:#a52f18;font:14px/1.4 system-ui;padding:12px}#yampi-local-notice[data-error="false"]{background:#fff3d6;color:#453817}';
export function renderRoute(local, kind, capture) {
  const template = local.config.pages[kind];
  if (typeof template !== 'string') throw new Error('Página não configurada em local.config.json: ' + kind);
  const {context, expected, page, captured, issues} = renderContext(local, kind, capture);
  const trace = {sections: [], assetsUrl: 0, fonts: []};
  const rendered = renderPage(local.text, template, context, local.config, trace);
  const served = servePage(rendered, local, issues);
  let html = served.html;
  // Fictional demonstration data does not define which sections must render.
  const structural = local.preview.source.kind !== 'demonstration';
  const missing = structural ? missingSections(expected, trace.sections.map(s => s.alias)) : [];
  for (const family of new Set(trace.fonts)) issues.push({code: 'font-not-captured', resource: family, reason: 'font_link sem folha de fonte capturada; a pilha de fallback é usada.'});
  const {warnings} = validateMarkup(html, {files: local.text});
  const state = {page: {kind, id: page?.id ?? null, sourceUrl: page?.sourceUrl ?? null, captured}, expectedSections: structural ? expected.length : null, renderedSections: structural ? expected.length - missing.length : trace.sections.length, missingSections: missing, assetsUrl: trace.assetsUrl, placeholders: served.placeholders, warnings: [...issues, ...warnings].slice(0, 50)};
  const sheet = `<link rel="stylesheet" href="/__local/components.css?page=${encodeURIComponent(kind)}">`;
  if (!/<body\b/i.test(html)) html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
  if (!/<head\b/i.test(html)) html = html.replace(/<body\b/i, '<head></head>$&');
  // Keep the stylesheet order of the template; captured fonts and component styles come first.
  let injected = false;
  html = html.replace(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/i, tag => {injected = true; return sheet + tag;});
  if (!injected) html = html.replace(/<\/head>/i, sheet + '</head>');
  html = html.replace(/<head\b[^>]*>/i, tag => tag + `<style>${STATUS_CSS}</style><script type="application/json" id="yampi-local-state">${JSON.stringify(state).replace(/</g, '\\u003c')}</script>`);
  // Yampi mounts Vue on #app. Without it, the body content becomes the local root.
  if (!/\bid\s*=\s*["']app["']/i.test(html)) html = html.replace(/(<body\b[^>]*>)/i, '$1<div id="yampi-local-root">').replace(/<\/body>/i, '</div></body>');
  const notice = local.preview.source.kind === 'demonstration' ? 'Prévia demonstrativa: contexto visual fictício.' : 'Prévia parcial: ' + (local.preview.source.kind === 'published' ? 'vitrine publicada; rascunho não vinculado.' : 'dados do editor com recursos publicados.');
  const summary = !structural ? 'dados fictícios' : missing.length ? `Prévia incompleta: ${state.renderedSections} de ${state.expectedSections} seções` : `${state.renderedSections}/${state.expectedSections} seções`;
  html = html.replace(/<body\b[^>]*>/i, tag => tag + `<aside id="yampi-preview-status" data-incomplete="${missing.length > 0}">${escape(notice)} <span data-summary>${escape(summary)}</span> · <a href="/__local/">Páginas</a> · <a href="/__local/diagnostic.json" target="_blank">Diagnóstico</a></aside>`).replace(/<\/body>/i, '<script type="module" src="/__local/app.js"></script></body>');
  return {html, state, issues, warnings};
}
export async function validateLocal(root) {
  const local = await loadLocal(root), {config, text, preview} = local;
  compileStyles(text, config.styles);
  compileStyles(text, config.mobileStyles || []);
  for (const entries of Object.values(config.pageStyles || {})) compileStyles(text, entries);
  for (const entries of Object.values(config.mobilePageStyles || {})) compileStyles(text, entries);
  const components = await compileComponents(text, root, componentOptions(config));
  const pages = [];
  for (const captured of preview.pages) if (typeof config.pages[captured.kind] !== 'string') throw new Error('Template da página capturada não configurado: ' + captured.kind);
  for (const kind of Object.keys(config.pages)) {
    const captures = preview.pages.filter(p => p.kind === kind).map(p => p.id);
    for (const capture of captures.length ? captures : [undefined]) {
      const result = renderRoute(local, kind, capture);
      pages.push({kind, capture: capture ?? null, captured: result.state.page.captured, expectedSections: result.state.expectedSections, renderedSections: result.state.renderedSections, missingSections: result.state.missingSections, warnings: result.state.warnings});
    }
  }
  const report = {checkedAt: new Date().toISOString(), pages, components: components.warnings, overrides: local.issues, cssParity: cssParity(local), previewIssues: preview.issues.length, visual: 'not-validated'};
  const folder = path.join(root, '.cache');
  await mkdir(folder, {recursive: true});
  await writeFile(path.join(folder, 'yampi-check.json'), JSON.stringify(report, null, 2) + '\n');
  const incomplete = pages.filter(p => p.expectedSections !== null && p.renderedSections < p.expectedSections);
  if (incomplete.length) throw new Error('Seções visíveis não renderizadas: ' + incomplete.map(p => `${p.kind}${p.capture ? ' (' + p.capture + ')' : ''}: ${p.renderedSections} de ${p.expectedSections} (${p.missingSections.map(s => s.alias).join(', ')})`).join('; ') + '. Relatório em .cache/yampi-check.json.');
  return report;
}
function sheetEntries(config, pathname, pages) {
  const sheet = themeSheet(pathname, pages);
  if (!sheet) return undefined;
  if (sheet.group === 'styles') return config.styles || [];
  if (sheet.group === 'mobileStyles') return config.mobileStyles || [];
  return config[sheet.group]?.[sheet.page] || [];
}
export async function createLocalServer(root) {
  const initial = await loadLocal(root);
  const runtimeIssues = [], cache = new Map();
  const note = issue => {if (!runtimeIssues.some(i => i.code === issue.code && i.resource === issue.resource) && runtimeIssues.length < 500) runtimeIssues.push(issue);};
  const cached = async (key, build) => {if (!cache.has(key)) {if (cache.size > 64) cache.clear(); cache.set(key, build());} return cache.get(key);};
  const components = local => cached('components:' + local.signature + JSON.stringify(componentOptions(local.config)), () => compileComponents(local.text, root, componentOptions(local.config)));
  const css = (local, entries) => cached('css:' + local.signature + JSON.stringify(entries), async () => rewriteCSS(compileStyles(local.text, entries), local.preview.map));
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (!['GET', 'HEAD'].includes(req.method) || !/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '')) {res.writeHead(403).end('Acesso local somente.'); return;}
    const send = (status, type, value) => {res.writeHead(status, {'Content-Type': type}).end(req.method === 'HEAD' ? undefined : value);};
    const sandboxed = (type, bytes) => {res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'"); send(200, type, bytes);};
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      // Captured preview resources are immutable verified bytes.
      if (url.pathname.startsWith('/preview/assets/')) {
        const name = assetPath(decodeURIComponent(url.pathname.slice(9))), bytes = initial.preview.assets[name];
        if (!bytes) {note({code: 'local-asset-missing', resource: name, reason: 'Recurso local não incluído na captura.'}); send(404, 'text/plain', 'Asset visual ausente; consulte o diagnóstico.'); return;}
        sandboxed(resourceMime(name), bytes); return;
      }
      if (url.pathname === '/__local/empty.css' || url.pathname === '/__local/empty.js') {send(200, url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', ''); return;}
      if (url.pathname === PLACEHOLDER) {send(200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><rect width="640" height="400" fill="#e8e8e8"/><text x="320" y="205" text-anchor="middle" fill="#666" font-size="24" font-family="sans-serif">Imagem não capturada · prévia local</text></svg>'); return;}
      const local = await loadLocal(root), {project, config, preview} = local, pages = Object.keys(config.pages);
      // $assets points here: captured platform icons first, theme uploads as fallback.
      if (url.pathname.startsWith('/__platform/assets/')) {
        const rest = decodeURIComponent(url.pathname.slice('/__platform/assets/'.length));
        if (!rest || rest.split('/').some(part => !part || part === '..' || part === '.')) {send(404, 'text/plain', 'Asset não encontrado.'); return;}
        const remote = preview.platform.assetsBase ? preview.map[preview.platform.assetsBase.replace(/\/$/, '') + '/' + rest] : undefined;
        if (remote) {const name = remote.slice('/preview/'.length); sandboxed(resourceMime(name), preview.assets[name]); return;}
        const theme = 'assets/' + rest, type = types[theme.split('.').at(-1)?.toLowerCase()];
        if (type && project.files[theme] && validPath(theme)) {sandboxed(type, project.files[theme]); return;}
        note({code: 'platform-asset-missing', resource: rest, reason: 'Ícone/recurso de $assets não capturado nem presente em tema/assets.'});
        send(404, 'text/plain', 'Asset da plataforma não capturado; consulte o diagnóstico.'); return;
      }
      if (url.pathname === '/__local/data.json') {
        const kind = url.searchParams.get('page') || 'home', {context} = renderContext(local, kind, url.searchParams.get('capture') || undefined);
        context.__preview.api = preview.api.map(record => ({...record, body: local.rewrite(record.body)}));
        send(200, 'application/json', JSON.stringify(context)); return;
      }
      if (url.pathname === '/__local/app.js') {send(200, 'text/javascript', (await components(local)).js); return;}
      if (url.pathname === '/__local/components.css') {
        const fonts = preview.version === 1 ? preview.styles || [] : preview.resources.filter(r => r.category === 'font-css').map(r => (preview.assets[r.path]?.toString('utf8').match(/@font-face\s*\{[^}]*\}/gi) || []).join('\n'));
        send(200, 'text/css; charset=utf-8', [...fonts, rewriteCSS((await components(local)).css, preview.map)].join('\n')); return;
      }
      if (url.pathname === '/__local/style.css') {
        // Mobile order follows head.twig: page-mobile, then global-mobile.
        const page = url.searchParams.get('page') || 'home', mobile = [...(config.mobilePageStyles?.[page] || []), ...(config.mobileStyles || [])];
        const body = await css(local, [...config.styles, ...(config.pageStyles?.[page] || [])]);
        send(200, 'text/css; charset=utf-8', body + (mobile.length ? '\n@media screen and (max-width: 700px){\n' + await css(local, mobile) + '\n}' : '')); return;
      }
      if (url.pathname.startsWith('/__local/css/')) {
        const entries = sheetEntries(config, url.pathname.slice('/__local'.length), pages);
        if (!entries) {send(404, 'text/plain', 'Folha do tema não reconhecida.'); return;}
        send(200, 'text/css; charset=utf-8', entries.length ? await css(local, entries) : ''); return;
      }
      if (url.pathname === '/__local/diagnostic.json') {
        let report = null; try {report = JSON.parse(await safeRead(root, 'preview/report.json'));} catch {/* Older projects have no report. */}
        send(200, 'application/json', JSON.stringify({code: {integrity: 'checked-on-load', completeness: 'stable-editor-inventory; independent remote inventory not verified'}, configuration: preview.source, contract: report?.contract ?? null, pages: preview.pages.map(p => ({id: p.id, kind: p.kind, context: p.context ?? null, sourceUrl: p.sourceUrl})), uncapturedTemplates: pages.filter(kind => !preview.pages.some(p => p.kind === kind)), assets: {included: preview.resources.length, issues: [...preview.issues, ...runtimeIssues]}, components: (await components(local)).warnings, overrides: local.issues, cssParity: 'npm run check grava .cache/yampi-check.json', compilation: 'checked-on-render; failures return HTTP 422', initialization: 'browser exposes __yampiLocalReady and __yampiLocalState; not inferred from HTTP', visual: 'not-validated', capturedAt: preview.capturedAt, toolVersion: preview.toolVersion ?? null, limits: preview.limits ?? null}));
        return;
      }
      if (url.pathname.startsWith('/tema/assets/')) {
        const name = validPath(decodeURIComponent(url.pathname.slice(6)));
        const type = types[name.split('.').at(-1)?.toLowerCase()];
        if (!type || !project.files[name]) {note({code: 'theme-asset-missing', resource: name, reason: 'Asset não encontrado no tema; não substituído silenciosamente.'}); send(404, 'text/plain', 'Asset não encontrado.'); return;}
        sandboxed(type, project.files[name]); return;
      }
      // Store paths render like the store, "/" included; the index lives at /__local/.
      const page = url.pathname === '/preview' ? {kind: url.searchParams.get('page') || 'home', capture: url.searchParams.get('capture') || undefined} : url.pathname.startsWith('/__local') ? undefined : (() => {const captured = routeFor(preview, url); return captured && {kind: captured.kind, capture: captured.id};})();
      if (page) {
        if (typeof config.pages[page.kind] !== 'string') {send(404, 'text/plain', 'Página não configurada.'); return;}
        const result = renderRoute(local, page.kind, page.capture);
        for (const issue of result.issues) note(issue);
        send(200, 'text/html; charset=utf-8', result.html); return;
      }
      const index = url.pathname === '/' || url.pathname === '/__local/';
      if (!index && (url.pathname.startsWith('/__') || url.pathname === '/favicon.ico')) {send(404, 'text/plain', 'Rota local não encontrada.'); return;}
      if (!index) {
        note({code: 'route-not-captured', resource: url.pathname, reason: 'Rota da loja sem captura nesta prévia.'});
        const links = preview.pages.map(p => `<li><a href="${escape(new URL(p.sourceUrl).pathname + new URL(p.sourceUrl).search)}">${escape(p.kind)} · ${escape(new URL(p.sourceUrl).pathname)}</a></li>`).join('');
        send(404, 'text/html; charset=utf-8', `<!doctype html><meta charset="utf-8"><title>Rota não capturada</title><h1>Rota não capturada nesta prévia</h1><p><code>${escape(url.pathname + url.search)}</code> não foi capturada. A prévia não consulta a loja.</p><ul>${links}</ul><p><a href="/__local/">Voltar ao índice</a></p>`); return;
      }
      const captured = preview.pages.map(p => {const source = new URL(p.sourceUrl); return `<li><a href="${escape(source.pathname + source.search)}">${escape(p.kind)}${p.context === 'search' ? ' (busca)' : ''}</a> · <code>${escape(source.pathname + source.search)}</code></li>`;}).join('');
      const templates = pages.map(kind => `<li><a href="/preview?page=${encodeURIComponent(kind)}">${escape(kind)}</a>${preview.pages.some(p => p.kind === kind) ? '' : ' · sem captura (cabeçalho e rodapé apenas)'}</li>`).join('');
      send(200, 'text/html; charset=utf-8', `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Prévia local do tema</title><style>body{font:16px system-ui;max-width:820px;margin:60px auto;padding:24px;color:#20372e}a{color:#20634f}li{margin:12px 0}code{background:#eef2ed;padding:3px 5px}</style><h1>Prévia local do tema</h1><p>Edite em <code>tema/</code> e recarregue para conferir. Contexto: ${escape(initial.preview.source.kind)}; prévia parcial, sem backend. Consulte preview/report.json e <a href="/__local/diagnostic.json">o diagnóstico</a>.</p><h2>Páginas capturadas</h2><ul>${captured || '<li>Nenhuma página capturada.</li>'}</ul><h2>Templates</h2><ul>${templates || '<li>Configure as páginas em local.config.json.</li>'}</ul><p>Use <code>npm run pack</code> para gerar o ZIP de retorno e importe-o na extensão.</p><p>Compatibilidade parcial com Twig e Vue 2. Confira a prévia da Yampi antes de publicar.</p></html>`);
    } catch (error) {send(422, 'text/html; charset=utf-8', '<!doctype html><meta charset="utf-8"><h1>Não foi possível montar a prévia</h1><pre>' + escape(error.message) + '</pre><p>Corrija o arquivo ou adapte as sobreposições em local.data.json e as entradas em local.config.json.</p>');}
  });
  return {server, port: initial.config.port};
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const root = path.resolve(import.meta.dirname, '../..');
  try {
    if (process.argv.includes('--integrity')) console.log(JSON.stringify(await checkIntegrity(root), null, 2));
    else if (process.argv.includes('--check')) {
      const report = await validateLocal(root);
      for (const page of report.pages) console.log(`${page.kind}${page.capture ? ' (' + page.capture + ')' : ''}: ${page.expectedSections === null ? 'dados fictícios' : page.renderedSections + '/' + page.expectedSections + ' seções'}${page.captured ? '' : ' · sem captura'}${page.warnings.length ? ' · ' + page.warnings.length + ' avisos' : ''}`);
      for (const warning of report.components) console.log('Aviso: ' + warning.resource + ' — ' + warning.reason);
      console.log(`Associação pelo CSS publicado: ${report.cssParity.association}.`);
      console.log(`Original íntegro; ${report.pages.length} páginas compiladas. Fidelidade visual não verificada. Detalhes em .cache/yampi-check.json.`);
    } else {
      const {server, port} = await createLocalServer(root);
      server.on('error', error => {console.error(error.message); process.exitCode = 1;});
      server.listen(port, '127.0.0.1', () => console.log(`Prévia local: http://127.0.0.1:${port}. Edite tema/ e recarregue a página.`));
    }
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
