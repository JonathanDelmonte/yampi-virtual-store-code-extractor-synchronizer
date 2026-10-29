import type {Files} from '../core/model';
import {kindsText, type Data, type PageKind, type PageStage, type PreviewBundle, type PreviewIssue, type PreviewPage, type RawPage, type StageSummary} from '../core/preview';
import {dataRoutes, routeKey, themeRoutes, type Route} from '../core/preview-links';
import {Pacer, pool} from '../core/pacer';
import {fetchFailure} from './public-fetch';
import {mergeIssues, readPage, type PreviewFetch, type ReadPage} from './preview-capture';
// After the representative cut: the store's pages that the captured pages and the theme link to
// (categories, subcategories, showcases /l, searches, institutional pages, promotions), then the
// page of each product they show, so that every link of the local preview opens. Same public
// reads, same origin and the same permissions as the representative pages; nothing from the
// editor session. Only window.data and its two companions enter, through the same blocklist.
export interface ExpandOptions {
  editorData?: Data; signal?: AbortSignal;
  // Waiting goes through the host (the worker): timers in a hidden document can run late.
  wait?: (ms: number) => Promise<void>; now?: () => number;
  onProgress?: (stage: PageStage, done: number, total: number) => void;
}
const ATTEMPTS = 6, NETWORK_ATTEMPTS = 3, MAX_WAIT_S = 60, MAX_LISTED = 200, MAX_NOTES = 100, PRODUCT_ROUNDS = 2, LIMIT = 'limite da etapa';
const STORE_KINDS = new Set<PageKind>(['category', 'pages', 'promotion']);
// Failures of the connection, not of the page: the read is repeated.
const NETWORK = /Failed to fetch|NetworkError|network|timed? ?out|timeout|ECONNRESET|socket|Sem resposta|Receiving end|Could not establish/i;
// A store change stops the whole export, as everywhere else.
const FATAL = /loja (?:de destino )?mudou|Cancelad/i;
interface Outcome {route: Route; read?: ReadPage; error?: string; status?: number; redirected?: boolean}
const bytes = (value: unknown) => value === undefined ? 0 : new TextEncoder().encode(JSON.stringify(value)).length;
const path = (url: string) => {const parsed = new URL(url); return parsed.pathname + parsed.search;};
const empty = (): StageSummary => ({found: 0, captured: 0, byKind: {}, left: 0, skipped: []});
const kindName = (page: PreviewPage) => page.context === 'search' ? 'search' : page.kind;
export async function expandPreview(visual: PreviewBundle, files: Files, fetcher: PreviewFetch, options: ExpandOptions = {}): Promise<PreviewBundle> {
  if (visual.source.kind === 'demonstration' || !visual.pages.length) return visual;
  const bundle: PreviewBundle = {...visual, pages: [...visual.pages], issues: [...visual.issues], removedKeys: [...visual.removedKeys]};
  const origin = new URL(bundle.source.origin).origin, limits = bundle.limits;
  const pacer = new Pacer(options.wait, options.now, options.signal);
  const check = () => {if (options.signal?.aborted) throw new Error('Captura de prévia cancelada.');};
  const removed = new Set(bundle.removedKeys), notes: PreviewIssue[] = [];
  const summary: Record<PageStage, StageSummary> = {store: empty(), product: empty()}, spent: Record<PageStage, number> = {store: 0, product: 0};
  const progress: Record<PageStage, {done: number; total: number}> = {store: {done: 0, total: 0}, product: {done: 0, total: 0}};
  // Every link found so far, in the order found: the menu and footer first, then the theme's own
  // links, the captured pages and the recorded public reads.
  const found = new Map<string, Route>(), tried = new Set(bundle.pages.map(page => routeKey(new URL(page.sourceUrl))));
  const collect = (pages: PreviewPage[]) => {for (const page of pages) for (const key of ['merchant', 'data', 'themeConfig'] as const) dataRoutes(page.raw[key], origin, key, found);};
  const home = bundle.pages.find(page => page.kind === 'home');
  if (home) dataRoutes(home.raw.merchant, origin, 'merchant', found);
  themeRoutes(files, origin, found);
  collect(bundle.pages);
  for (const record of bundle.api) dataRoutes(record.body, origin, 'api ' + record.path, found);
  // themeConfig and merchant repeat on every page and are stored once: each distinct copy counts
  // once in the budget, as in the ZIP.
  const counted = new Set<string>();
  const cost = (raw: RawPage) => {
    let total = bytes(raw.data) + bytes(raw.bodyClasses); const fresh: string[] = [];
    for (const key of ['themeConfig', 'merchant'] as const) {const text = JSON.stringify(raw[key] ?? null); if (!counted.has(text)) {fresh.push(text); total += text.length;}}
    return {total, commit: () => fresh.forEach(text => counted.add(text))};
  };
  async function read(route: Route, expected: PageKind): Promise<Outcome> {
    for (let attempt = 1; ; attempt++) {
      check(); await pacer.turn();
      try {const page = await readPage(route.url, fetcher, limits, expected, options.editorData); pacer.ok(); return {route, read: page};}
      catch (error) {
        const message = error instanceof Error ? error.message : String(error), failure = fetchFailure(message);
        if (FATAL.test(message)) throw error;
        // Only after the last attempt does a page asking for calm become a note.
        if ((failure.status === 429 || failure.status === 503) && attempt < ATTEMPTS) {pacer.calm(Math.min(MAX_WAIT_S, failure.retryAfter ?? 5 * attempt)); continue;}
        if (failure.status === undefined && !failure.redirected && NETWORK.test(message) && attempt < NETWORK_ATTEMPTS) {await pacer.sleep(1000 * attempt); continue;}
        return {route, error: message, status: failure.status, redirected: failure.redirected};
      }
    }
  }
  // Out of the preview, with the reason: in the stage's list (report and panel) and in the notes.
  const skip = (stage: PageStage, route: Route, reason: string, note?: string) => {
    if (summary[stage].skipped.length < MAX_LISTED) summary[stage].skipped.push({route: path(route.url), reason, ...(route.sources.length ? {sources: route.sources} : {})});
    if (note) notes.push({code: 'page-unavailable', resource: route.url, reason: `${stage === 'product' ? 'Página de produto' : 'Página da loja'} fora da prévia: ${note}`});
  };
  const fail = (stage: PageStage, outcome: Outcome) => {
    const {route, status} = outcome;
    // A 404 is a link to a route the store does not have: where the link is written says what to fix.
    if ((status === 404 || status === 410) && !route.inferred) {
      skip(stage, route, `HTTP ${status}: link quebrado`);
      notes.push({code: 'link-broken', resource: path(route.url), reason: `A loja responde HTTP ${status}: ${path(route.url)} não existe. Linkado em ${route.sources.join(', ') || 'dados da loja'}.`});
      return;
    }
    const reason = outcome.redirected ? 'redirecionamento não seguido' : status ? `HTTP ${status}` : 'indisponível';
    skip(stage, route, reason, outcome.error || reason);
  };
  let next = bundle.pages.reduce((max, page) => Math.max(max, Number(page.id.slice(5)) + 1), 0);
  const accept = (stage: PageStage, route: Route, page: ReadPage): boolean => {
    const count = bundle.pages.filter(item => item.stage === stage).length, budget = cost(page.raw);
    if (count >= (stage === 'store' ? limits.storePages : limits.productPages) || spent[stage] + budget.total > (stage === 'store' ? limits.storeBytes : limits.productBytes)) {skip(stage, route, LIMIT); return false;}
    budget.commit(); spent[stage] += budget.total;
    const added: PreviewPage = {id: 'page-' + next++, kind: page.kind, ...(page.context ? {context: page.context} : {}), sourceUrl: route.url, stage, raw: page.raw};
    bundle.pages.push(added); bundle.issues.push(...page.issues); page.removed.forEach(key => removed.add(key));
    summary[stage].captured++; summary[stage].byKind[kindName(added)] = (summary[stage].byKind[kindName(added)] || 0) + 1;
    collect([added]);
    return true;
  };
  async function round(stage: PageStage, routes: Route[]): Promise<void> {
    if (!routes.length) return;
    for (const route of routes) tried.add(route.key);
    summary[stage].found += routes.length;
    progress[stage].total += routes.length; options.onProgress?.(stage, progress[stage].done, progress[stage].total);
    const outcomes = await pool(routes, async route => {
      const outcome = await read(route, stage === 'product' ? 'product' : 'category');
      progress[stage].done++; options.onProgress?.(stage, progress[stage].done, progress[stage].total);
      return outcome;
    });
    check();
    // Pages enter in the order of the links, whatever order the reads finished in.
    for (const outcome of outcomes) {
      const page = outcome.read;
      if (!page) {fail(stage, outcome); continue;}
      if (stage === 'product' ? page.kind !== 'product' || !(page.raw.data as {product?: {data?: unknown}} | undefined)?.product?.data : !STORE_KINDS.has(page.kind)) {
        // A product page reached by a link without /p still belongs to the product pages.
        if (stage === 'store' && page.kind === 'product') {accept('product', outcome.route, page); continue;}
        const reason = stage === 'product' ? 'página sem produto' : `página do tipo ${page.kind}`;
        skip(stage, outcome.route, reason, `${reason} em ${path(outcome.route.url)}.`);
        continue;
      }
      accept(stage, outcome.route, page);
    }
  }
  const pending = (product: boolean) => [...found.values()].filter(route => route.product === product && !tried.has(route.key));
  const room = (stage: PageStage) => Math.max(0, (stage === 'store' ? limits.storePages : limits.productPages) - bundle.pages.filter(page => page.stage === stage).length);
  // Store pages in rounds: the pages read in one round bring the links of the next.
  for (let turn = 1; turn <= limits.storeRounds && pending(false).length && room('store'); turn++) await round('store', pending(false).slice(0, room('store')));
  // Products, then those only other product pages show (similar products).
  for (let turn = 1; turn <= PRODUCT_ROUNDS && pending(true).length && room('product'); turn++) await round('product', pending(true).slice(0, room('product')));
  // The categories only a product links to (its breadcrumbs: the way back from the product page).
  if (room('store')) await round('store', pending(false).slice(0, room('store')));
  // The representative cut's notes about what it left out are answered by the stages.
  const filled = new Set<string>(bundle.pages.map(kindName));
  bundle.issues = bundle.issues.filter(issue => issue.code !== 'page-limit' && !(issue.code === 'page-kind-missing' && filled.has(issue.resource ?? '')));
  const date = bundle.capturedAt.slice(0, 10);
  if (summary.store.captured) bundle.issues.push({code: 'store-pages', reason: `${summary.store.captured} páginas da loja (${kindsText(summary.store.byKind)}) lidas da vitrine pública em ${date}, além do recorte representativo.`});
  if (summary.product.captured) bundle.issues.push({code: 'product-pages', reason: `${summary.product.captured} páginas de produto lidas da vitrine pública em ${date}. Foto de produto sem cópia usa o placeholder.`});
  // What stayed out: past the stage's budget, or found only in the pages of its last round.
  for (const stage of ['store', 'product'] as const) {
    const left = pending(stage === 'product'), full = !room(stage), limited = summary[stage].skipped.filter(item => item.reason === LIMIT).length + (full ? left.length : 0);
    const examples = left.length ? ` (ex.: ${left.slice(0, 5).map(route => path(route.url)).join(', ')})` : '';
    summary[stage].left = left.length;
    if (limited) bundle.issues.push({code: stage === 'store' ? 'store-page-limit' : 'product-page-limit', reason: `Limite de ${stage === 'store' ? `${limits.storePages} páginas da loja ou ${Math.round(limits.storeBytes / 1048576)} MiB` : `${limits.productPages} páginas de produto ou ${Math.round(limits.productBytes / 1048576)} MiB`} atingido; ${limited} ${limited === 1 ? 'caminho ficou' : 'caminhos ficaram'} de fora${examples}.`});
    if (left.length && !full) bundle.issues.push({code: stage === 'store' ? 'store-page-rounds' : 'product-page-rounds', reason: `${left.length} ${left.length === 1 ? 'caminho só apareceu' : 'caminhos só apareceram'} nas páginas da última rodada (${stage === 'store' ? `${limits.storeRounds} rodadas e a dos produtos` : `${PRODUCT_ROUNDS} rodadas`}) e ${left.length === 1 ? 'ficou' : 'ficaram'} de fora${examples}.`});
  }
  // Hundreds of failures would bury the other notes: the first ones stay, the rest is counted.
  const broken = notes.filter(note => note.code === 'link-broken'), other = notes.filter(note => note.code !== 'link-broken');
  bundle.issues.push(...broken.slice(0, MAX_NOTES), ...other.slice(0, MAX_NOTES));
  if (broken.length > MAX_NOTES || other.length > MAX_NOTES) bundle.issues.push({code: 'pages-unavailable-limited', reason: `${Math.max(0, broken.length - MAX_NOTES) + Math.max(0, other.length - MAX_NOTES)} páginas a mais ficaram de fora; a lista está em report.json > pages.stages.`});
  bundle.issues = mergeIssues(bundle.issues);
  bundle.removedKeys = [...removed];
  bundle.stages = summary;
  return bundle;
}
