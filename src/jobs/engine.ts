import {BrowserAdapter, type RPC} from '../browser/adapter';
import {encodePreview, encodeSnapshot} from '../core/archive';
import type {ArchiveEntries} from '../core/compression';
import {assertContext, type Adapter, type Context, type Files, type Journal, type Progress, type Snapshot} from '../core/model';
import {demonstration, kindsText, PREVIEW_ORIGINS, type Data, type PageStage, type PreviewBundle, type StageSummary} from '../core/preview';
import type {LinkCheck, LinkReport} from '../core/preview-links';
import {Pacer, pool} from '../core/pacer';
import {ProgressTracker, type PhaseSpec} from '../core/progress';
import {retryReads} from '../core/retry';
import {storeChanged} from '../core/direct';
import {applyPlan, capture, continues} from '../core/workflow';
import {advanceBaseline} from '../core/workspace';
import {get, put, saveJournal, journalHistory, loadWorkspace, updateWorkspace} from '../storage';
import type {PreviewDraft, PreviewFetch} from '../browser/preview-capture';
import {fetchFailure} from '../browser/public-fetch';
import type {Decision, JobEvent, JobRequest, JobState, SendInput, Waiting} from './types';
// Public storefront capture needs a DOM parser: available in the background document and the
// demo page, injected so the rest of the engine runs anywhere (including unit tests).
export interface ExpandOptions {editorData?: Data; signal?: AbortSignal; wait?: (ms: number) => Promise<void>; onProgress?: (stage: PageStage, done: number, total: number) => void}
export interface PreviewTools {
  prepare(snapshot: Snapshot, fetcher: PreviewFetch, options: {editorData?: Data; enabled?: boolean; signal?: AbortSignal}): Promise<PreviewDraft>;
  finish(draft: PreviewDraft, fetcher: PreviewFetch, origins: string[], signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<PreviewBundle>;
  unauthorized(bundle: PreviewBundle): string[];
  // The store's pages and the product pages, after the representative cut.
  expand?(visual: PreviewBundle, files: Files, fetcher: PreviewFetch, options: ExpandOptions): Promise<PreviewBundle>;
}
export type EditorAdapter = Adapter & {visual?(): Promise<Data>};
export interface EngineHost {
  rpc: RPC;
  download(bytes: Uint8Array, name: string, type?: string): Promise<void>;
  report(state: JobState): void;
  // Waiting goes through the host: timers in a hidden document can run late.
  wait(ms: number): Promise<void>;
  compress?: (entries: ArchiveEntries, signal?: AbortSignal) => Promise<Uint8Array>;
  preview?: PreviewTools;
  adapter?: (rpc: RPC) => EditorAdapter;
}
export interface JobControl {signal: AbortSignal; decision(waiting: Waiting): Promise<Decision>}
// Weights: roughly how long one item takes compared with reading one file in the editor.
const PHASES: Record<JobRequest['kind'], PhaseSpec[]> = {
  export: [{id: 'inventory', label: 'Listar os arquivos', weight: 2, total: 1}, {id: 'read', label: 'Ler os arquivos', weight: 1}, {id: 'preview', label: 'Capturar a vitrine', weight: 0.6}, {id: 'store', label: 'Páginas da loja', weight: 0.5}, {id: 'products', label: 'Páginas dos produtos', weight: 0.4}, {id: 'zip', label: 'Preparar o ZIP', weight: 6, total: 1}, {id: 'download', label: 'Baixar o ZIP', weight: 3, total: 1}],
  compare: [{id: 'prepare', label: 'Recarregar o editor', weight: 6, total: 1}, {id: 'inventory', label: 'Listar os arquivos', weight: 2, total: 1}, {id: 'read', label: 'Ler o que mudou', weight: 1}, {id: 'links', label: 'Conferir os links na loja', weight: 0.5}],
  send: [{id: 'prepare', label: 'Recarregar o editor', weight: 6, total: 1}, {id: 'preflight', label: 'Conferir a loja', weight: 1}, {id: 'backup', label: 'Guardar o backup', weight: 3, total: 1}, {id: 'create', label: 'Criar arquivos novos', weight: 3.5}, {id: 'upload', label: 'Enviar imagens', weight: 4.5}, {id: 'save', label: 'Salvar e conferir', weight: 7}, {id: 'final', label: 'Conferência final', weight: 1}]
};
// Steps whose items are slow enough that every one is worth showing at once.
const HEAVY = new Set(['prepare', 'backup', 'create', 'upload', 'save', 'zip', 'download']);
const DONE_TEXT: Record<string, string> = {create: 'Arquivo criado', upload: 'Imagem enviada', save: 'Salvo e conferido'};
export function fileName(prefix: string, storeName: string): string {
  const store = storeName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'loja';
  return `${prefix}-${store}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
}
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// "Páginas da loja: 48 (34 categorias ou vitrines, 13 institucionais, 1 promoção); 3 de fora: /a (HTTP 404: link quebrado)…".
function stageText(label: string, stage: StageSummary | undefined): string {
  if (!stage || !stage.found && !stage.left) return '';
  // Read and left out (404, redirect, budget), plus found and never read.
  const out = stage.skipped.length + stage.left;
  const listed = stage.skipped.slice(0, 5).map(item => `${item.route} (${item.reason})`).join(', ');
  return `${label}: ${stage.captured}${stage.captured ? ` (${kindsText(stage.byKind)})` : ''}${out ? `; ${out} de fora${listed ? `: ${listed}${stage.skipped.length > 5 ? ', …' : ''}` : ''}` : '; nenhuma de fora'}.`;
}
// One line for the result screen; the numbers and the report stay one click away.
export function previewSummary(visual: PreviewBundle): {line: string; details: string; warnings: string[]} {
  const line = visual.source.kind === 'demonstration' ? 'Prévia com dados de exemplo, sem a vitrine.' : visual.source.kind === 'editor' ? 'Prévia parcial, com dados do editor.' : 'Prévia parcial: vitrine publicada, rascunho não vinculado.';
  const representative = visual.pages.filter(p => !p.stage);
  const kinds = [...new Set(representative.map(p => p.kind + (p.context === 'search' ? ' (busca)' : '')))].join(', ') || 'nenhuma';
  const megabytes = (Object.values(visual.assets).reduce((sum, bytes) => sum + bytes.length, 0) / 1048576).toFixed(1).replace('.', ',');
  const stages = [stageText('Páginas da loja', visual.stages?.store), stageText('Páginas dos produtos', visual.stages?.product)].filter(Boolean).join(' ');
  const details = `${count(representative.length, 'página representativa', 'páginas representativas')} (${kinds}); ${count(Object.keys(visual.assets).length, 'recurso local', 'recursos locais')} (${megabytes} MB); ${count(visual.api.length, 'leitura pública gravada', 'leituras públicas gravadas')}; ${count(visual.issues.length, 'observação', 'observações')}.${stages ? ' ' + stages : ''} Relatório em preview/report.json. Rode npm run check para conferir seções e CSS; a fidelidade visual não é conferida automaticamente.`;
  // A link of the theme or of the store's data to a route the store does not have breaks on the
  // published site too: shown apart, with where it is written.
  const broken = visual.issues.filter(issue => issue.code === 'link-broken');
  const warnings = broken.slice(0, 10).map(issue => `Link quebrado na loja: ${issue.reason}`);
  if (broken.length > 10) warnings.push(`E mais ${broken.length - 10} links quebrados, listados em preview/report.json.`);
  return {line, details, warnings};
}
function remoteFetch(rpc: RPC, context: Context, signal: AbortSignal): PreviewFetch {
  // The authenticated worker checks the same store before AND after every GET.
  return async url => {
    if (signal.aborted) throw new Error('Cancelado.');
    const reply = await rpc({action: 'preview-fetch', preview: {url, context}}) as {encoded: string; type: string; url: string};
    return {bytes: Uint8Array.from(atob(reply.encoded), c => c.charCodeAt(0)), type: reply.type, url: reply.url};
  };
}
function titleFor(request: JobRequest, store: string): string {
  if (request.kind === 'export') return request.previewOnly ? `Baixando a prévia de ${store}` : `Baixando o tema de ${store}`;
  if (request.kind === 'compare') return request.scope === 'restore' ? `Preparando a restauração de ${store}` : request.scope === 'update' ? `Lendo ${store} para atualizar o projeto` : `Comparando com ${store}`;
  if (request.resume) return `Continuando o envio para ${store}`;
  return request.scope === 'restore' ? `Restaurando ${store}` : `Enviando para ${store}`;
}
// What the panel shows the moment a job is requested, before the runner's first report.
export function startingState(request: JobRequest, context: Context): JobState {
  const now = Date.now(), {phases} = new ProgressTracker(PHASES[request.kind]).snapshot();
  return {id: request.id, kind: request.kind, status: 'running', ...(request.scope ? {scope: request.scope} : {}), ...(request.resume ? {resumed: true} : {}), context, title: titleFor(request, context.storeName), detail: 'Preparando…', phases, fraction: 0, elapsedMs: 0, startedAt: now, updatedAt: now, events: []};
}
export async function runJob(request: JobRequest, expected: Context, host: EngineHost, control: JobControl): Promise<JobState> {
  const tracker = new ProgressTracker(PHASES[request.kind]);
  const state = startingState(request, expected);
  let lastReport = 0;
  const report = (force = false) => {
    const snapshot = tracker.snapshot();
    Object.assign(state, {phases: snapshot.phases, fraction: snapshot.fraction, elapsedMs: snapshot.elapsedMs, updatedAt: Date.now()});
    if (snapshot.etaMs === undefined) delete state.etaMs; else state.etaMs = snapshot.etaMs;
    if (!force && Date.now() - lastReport < 150) return;
    lastReport = Date.now();
    host.report(structuredClone(state));
  };
  const event = (text: string, tone: JobEvent['tone'], path?: string) => {state.events = [{at: Date.now(), text, tone, ...(path ? {path} : {})}, ...state.events].slice(0, 60);};
  const phaseDone = new Map<string, number>();
  const progress = (p: Progress) => {
    const status = p.step && tracker.status(p.step);
    if (!p.step || !status) return;
    // A step that starts is shown at once: listing a large tree can take a while.
    const starting = status !== 'active';
    if (starting) tracker.start(p.step, p.total); else tracker.total(p.step, p.total);
    const advanced = p.done > (phaseDone.get(p.step) ?? 0);
    tracker.set(p.step, p.done); phaseDone.set(p.step, p.done);
    // The next step's size enters the bar in the same report that closes this one.
    if (p.next && tracker.status(p.next.step)) tracker.total(p.next.step, p.next.total);
    if (p.label) tracker.relabel(p.step, p.label);
    state.detail = p.phase;
    if (p.path) state.path = p.path; else delete state.path;
    if (advanced && p.path && DONE_TEXT[p.step]) event(DONE_TEXT[p.step], 'ok', p.path);
    report(starting || HEAVY.has(p.step) || p.done === p.total);
  };
  const raw = host.adapter ? host.adapter(host.rpc) : new BrowserAdapter(host.rpc);
  const adapter = retryReads(raw, {wait: host.wait, signal: control.signal, onRetry: (error, attempt) => {
    event(`Leitura repetida (${attempt}ª nova tentativa): ${error instanceof Error ? error.message : String(error)}`, 'info');
    report(true);
  }});
  const step = (id: string, detail: string) => {tracker.start(id); state.detail = detail; delete state.path; report(true);};
  // How the copy reads the files: straight from the Yampi server or through the editor.
  const notice = (text: string, tone: JobEvent['tone']) => {event(text, tone); report(true);};
  let journal: Journal | undefined, input: SendInput | undefined;
  report(true);
  try {
    assertContext(expected, await adapter.context());
    if (request.kind === 'export') state.result = await exportTheme();
    else if (request.kind === 'compare') state.result = await compare();
    else state.result = await send();
    tracker.complete();
    state.status = 'completed'; delete state.path;
    state.detail = request.kind === 'export' ? (request.previewOnly ? 'ZIP da prévia baixado' : 'ZIP da loja baixado') : request.kind === 'compare' ? 'Comparação concluída' : 'Arquivos salvos e conferidos após recarregar';
    event(state.detail, 'ok');
  } catch (error) {
    tracker.failActive();
    const message = error instanceof Error ? error.message : String(error);
    state.status = control.signal.aborted || /^Cancelad|descartada/i.test(message) ? 'cancelled' : 'failed';
    state.error = message; state.detail = state.status === 'cancelled' ? 'Operação interrompida a seu pedido' : 'Operação interrompida';
    event(message, state.status === 'cancelled' ? 'warn' : 'error', state.path);
    if (request.kind === 'send' && journal) state.result = sendResult(journal);
  } finally {
    // The store keeps every confirmed item even when a send stops: the reference follows it.
    if (request.kind === 'send' && journal && input) {
      const sent = journal, plan = input.plan, scope = input.scope;
      await updateWorkspace(expected, workspace => {
        const moved = advanceBaseline(workspace, plan, sent);
        if (scope === 'restore' && sent.status === 'completed') delete workspace.restore;
        else if (scope === 'restore' && workspace.restore) delete workspace.restore.reading;
        if (moved || sent.created?.length || sent.uploaded?.length) {if (workspace.review) {delete workspace.review.reading; workspace.review.overrides = []; delete workspace.review.selected;}}
      }).catch(error => event(`Não foi possível atualizar a referência: ${error instanceof Error ? error.message : String(error)}`, 'warn'));
    }
  }
  state.finishedAt = Date.now();
  report(true);
  return state;
  // The editor's own "Ver prévia" link, for the panel's shortcut; best effort.
  async function previewLink(): Promise<{preview?: string}> {
    try {
      const links = await (raw as EditorAdapter & {links?(): Promise<{preview?: string}>}).links?.();
      const url = links?.preview ? new URL(links.preview) : undefined;
      return url && url.origin === expected.previewOrigin ? {preview: url.href} : {};
    } catch {return {};}
  }
  function sendResult(value: Journal) {
    return {kind: 'send' as const, journalId: value.id, verified: value.verified.length, created: value.created?.length || 0, uploaded: value.uploaded?.length || 0, total: value.selected.length, warnings: value.warnings || []};
  }
  // The store as the extension last knew it (export, update or send): a preview-only download
  // reads the storefront, not the theme again.
  async function reference(): Promise<Snapshot> {
    const baseline = (await loadWorkspace(expected))?.baseline;
    if (!baseline) throw new Error('A extensão não guarda o tema desta loja. Baixe o tema ou atualize a pasta do projeto antes.');
    tracker.skip('inventory'); tracker.skip('read');
    return baseline;
  }
  async function exportTheme() {
    if (request.previewOnly && !(request.includePreview && host.preview)) throw new Error('Sem a leitura da vitrine liberada no Chrome, não há prévia nova para baixar.');
    const snapshot = request.previewOnly ? await reference() : await capture(adapter, {signal: control.signal, progress, notice});
    let visual: PreviewBundle;
    if (request.includePreview && host.preview) {
      step('preview', 'Capturando contexto visual público…');
      const tools = host.preview, fetcher = remoteFetch(host.rpc, snapshot.context, control.signal), editorData = await raw.visual?.();
      const draft = await tools.prepare(snapshot, fetcher, {editorData, enabled: true, signal: control.signal});
      let origins = [snapshot.context.previewOrigin];
      // An origin Chrome already allows (asked at the download click, or in an earlier download)
      // needs no question: the worker accepts it. Only the others are asked, once per round.
      const allow = async (list: string[]) => {await host.rpc({action: 'preview-allow', preview: {origins: list, context: snapshot.context}});};
      const granted = async (candidates: string[]) => {
        const out: string[] = [];
        for (const origin of candidates.filter(item => !origins.includes(item))) {try {await allow([...origins, ...out, origin]); out.push(origin);} catch { /* Not allowed in Chrome yet: asked below. */ }}
        return out;
      };
      origins.push(...await granted(PREVIEW_ORIGINS));
      // The count of this step never goes back: a later round finds in its cache what the earlier
      // one already captured, and only goes further.
      let best = {done: 0, total: 0};
      const finish = async () => {
        await allow(origins);
        state.detail = 'Baixando recursos visuais';
        return tools.finish(draft, fetcher, origins, control.signal, (done, total) => {
          best = {done: Math.max(best.done, done), total: Math.max(best.total, total, done)};
          tracker.total('preview', best.total); tracker.set('preview', best.done); report();
        });
      };
      visual = await finish();
      for (let missing = tools.unauthorized(visual); missing.length; missing = tools.unauthorized(visual)) {
        const known = await granted(missing);
        if (known.length) {origins.push(...known); visual = await finish(); continue;}
        // Fonts listed by fonts.googleapis.com are served by fonts.gstatic.com: asked together.
        const asking = [...new Set([...missing, ...missing.some(origin => origin === 'https://fonts.googleapis.com') ? ['https://fonts.gstatic.com'] : []])].filter(origin => !origins.includes(origin));
        state.status = 'waiting'; state.waiting = {kind: 'origins', origins: asking};
        state.detail = 'Código copiado; recursos visuais aguardam autorização';
        report(true);
        const decision = await control.decision(state.waiting);
        state.status = 'running'; delete state.waiting;
        if (decision.action === 'discard') throw new Error('Preparação visual descartada. Nenhum arquivo da Yampi foi alterado.');
        if (decision.action === 'partial') break;
        tracker.relabel('preview', 'Completar a vitrine com os recursos autorizados');
        origins = [...new Set([...origins, ...decision.origins])];
        visual = await finish();
      }
      tracker.finish('preview');
      // The store's pages, then the product pages, each with its own count: "Páginas da loja: 12 de 40".
      if (tools.expand && visual.source.kind !== 'demonstration') {
        const phase = {store: 'store', product: 'products'} as const, label = {store: 'Páginas da loja', product: 'Páginas dos produtos'} as const;
        visual = await tools.expand(visual, snapshot.files, fetcher, {editorData, signal: control.signal, wait: host.wait, onProgress: (stage, done, total) => {
          const id = phase[stage], starting = tracker.status(id) !== 'active';
          // The last round of store pages (categories only a product links to) comes after the products.
          if (starting) tracker.start(id);
          tracker.total(id, total); tracker.set(id, done);
          state.detail = `${label[stage]}: ${done} de ${total}`; report(starting || done === total);
        }});
      }
      tracker.finish('store'); tracker.finish('products');
    } else {
      tracker.skip('preview'); tracker.skip('store'); tracker.skip('products');
      visual = demonstration(snapshot.context, request.includePreview ? 'Captura visual indisponível neste ambiente. Código exportado; a prévia usa dados demonstrativos.' : 'Captura visual não autorizada ou desativada. Código exportado; configurações, catálogo de amostra, imagens e fontes visuais não foram capturados.', Object.keys(snapshot.files));
    }
    step('zip', 'Preparando ZIP…');
    const {inventory: _inventory, partial: _partial, ...exported} = snapshot as Snapshot & {inventory?: string[]; partial?: boolean};
    const options = {signal: control.signal, ...(host.compress ? {compress: host.compress} : {})};
    const bytes = request.previewOnly ? await encodePreview(exported, visual, options) : await encodeSnapshot(exported, true, visual, options);
    tracker.finish('zip');
    // Only a new download of the theme becomes the reference; a preview-only one changes nothing.
    if (!request.previewOnly) await updateWorkspace(expected, workspace => {
      workspace.baseline = exported; workspace.lineage = {exportedAt: exported.capturedAt, journals: []};
      if (workspace.review) {delete workspace.review.reading; workspace.review.overrides = []; delete workspace.review.selected;}
    });
    step('download', 'Baixando o ZIP');
    const name = fileName(request.previewOnly ? 'previa' : 'exportacao', expected.storeName);
    await host.download(bytes, name);
    tracker.finish('download');
    const summary = previewSummary(visual);
    return {kind: 'export' as const, texts: request.previewOnly ? 0 : Object.keys(exported.files).length, images: request.previewOnly ? 0 : Object.keys(exported.assets || {}).length, pages: visual.pages.length, fileName: name, preview: summary.line, previewDetails: summary.details, ...(summary.warnings.length ? {warnings: summary.warnings} : {}), ...(request.previewOnly ? {previewOnly: true} : {})};
  }
  async function compare() {
    // With the Yampi server answering, the reading is the server's own and the editor is not
    // reloaded (Yampi answers a reload of the editor's address with "Acesso restrito").
    const server = adapter.direct && await adapter.direct.open().then(() => true, error => {if (storeChanged(error)) throw error; return false;});
    if (server) tracker.skip('prepare');
    else {step('prepare', 'Recarregando o editor'); await adapter.refresh(); tracker.finish('prepare');}
    // An update reads the whole store: any file the store changed may have to come to the project.
    const whole = !!request.full || request.scope === 'update';
    if (request.scope === 'update') tracker.relabel('read', 'Ler a loja inteira');
    const observed = await capture(adapter, {signal: control.signal, progress, notice, ...(server ? {serverOnly: true} : {}), ...(whole ? {} : {only: request.paths || []})});
    const links = request.scope === 'project' && request.links?.length ? await checkLinks(request.links) : undefined;
    if (!links) tracker.skip('links');
    await updateWorkspace(expected, workspace => {
      // Kept apart from the send's review: the folder changes only when the user applies it.
      if (request.scope === 'update') {workspace.update = {reading: observed, choices: {}}; return;}
      const review = {reading: observed, overrides: [], ...(links ? {links} : {})};
      if (request.scope === 'restore') workspace.restore = {...review, journalId: request.journalId!};
      else workspace.review = review;
    });
    return {kind: 'compare' as const, read: Object.keys(observed.files).length + Object.keys(observed.assets || {}).length, listed: observed.inventory.length, full: whole, ...(links ? {links} : {})};
  }
  // Categories, showcases and pages are data of the Yampi panel, not theme files: a send creates no
  // route. Each internal link of the texts the project changed is read on the storefront, and a
  // route the store answers 404 for is a warning of the review, never a block (the category may be
  // being created in the panel right now).
  async function checkLinks(links: LinkCheck[]): Promise<LinkReport> {
    step('links', 'Conferindo os links na loja');
    tracker.total('links', links.length);
    const fetcher = remoteFetch(host.rpc, expected, control.signal), pacer = new Pacer(host.wait, Date.now, control.signal);
    const outcome: LinkReport = {checked: 0, broken: [], unchecked: 0};
    let done = 0;
    const one = async (link: LinkCheck): Promise<'ok' | 'broken' | 'unchecked'> => {
      for (let attempt = 1; ; attempt++) {
        if (control.signal.aborted || outcome.reason) return 'unchecked';
        await pacer.turn();
        try {await fetcher(link.url); pacer.ok(); return 'ok';}
        catch (error) {
          const message = error instanceof Error ? error.message : String(error), failure = fetchFailure(message);
          if (/loja (?:de destino )?mudou/i.test(message)) throw error;
          if (/Permissão de leitura|não autorizada/i.test(message)) {outcome.reason = 'O Chrome não liberou a leitura da vitrine.'; return 'unchecked';}
          if ((failure.status === 429 || failure.status === 503) && attempt < 4) {pacer.calm(Math.min(30, failure.retryAfter ?? 5 * attempt)); continue;}
          // A redirect or another answer of the store means the route exists in some form.
          return failure.status === 404 || failure.status === 410 ? 'broken' : failure.redirected || failure.status && failure.status < 500 ? 'ok' : 'unchecked';
        }
      }
    };
    const results = await pool(links, async link => {const result = await one(link); tracker.set('links', ++done); report(); return result;});
    results.forEach((result, index) => {if (result === 'broken') outcome.broken.push(links[index]); if (result === 'unchecked') outcome.unchecked++; else outcome.checked++;});
    tracker.finish('links');
    if (outcome.broken.length) event(`${count(outcome.broken.length, 'link leva', 'links levam')} a uma rota que não existe na loja`, 'warn');
    if (outcome.reason) event(`Links não conferidos: ${outcome.reason}`, 'info');
    return outcome;
  }
  async function send() {
    let previous: Journal | undefined;
    if (request.resume) {
      previous = (await journalHistory(expected)).find(item => item.id === request.resume);
      input = await get<SendInput>(`sendplan:${request.resume}`);
      if (!previous || !input) throw new Error('O registro deste envio não está completo nesta instalação. Compare novamente para enviar o que falta.');
    } else {
      input = await get<SendInput>(`jobinput:${request.id}`);
      if (!input) throw new Error('O envio confirmado não foi encontrado. Compare e confirme novamente.');
    }
    const plan = input.plan, chosen = new Set(input.selected);
    const rows = plan.rows.filter(row => chosen.has(row.path)), texts = rows.filter(row => row.status !== 'upload');
    tracker.total('preflight', rows.filter(row => row.status === 'update').length);
    tracker.total('create', rows.filter(row => row.status === 'create').length);
    tracker.total('upload', rows.filter(row => row.status === 'upload').length);
    tracker.total('save', texts.length); tracker.total('final', texts.length);
    if (previous && continues(previous)) {tracker.skip('preflight'); tracker.skip('backup');}
    const sending = input;
    let stored = false;
    journal = await applyPlan(adapter, plan, input.selected, {
      signal: control.signal, progress,
      persist: async value => {
        await saveJournal(value);
        // The confirmed plan stays with the record, so an interrupted send can continue as it was.
        if (!stored) {stored = true; await put(`sendplan:${value.id}`, {...sending, journalId: value.id});}
        journal = structuredClone(value);
      },
      backup: async (snapshot, value) => {
        const zip = await encodeSnapshot(snapshot);
        await put(`backup:${value.id}`, {journalId: value.id, bytes: zip});
        await host.download(zip, fileName('backup-antes-do-envio', expected.storeName));
        event('Backup guardado e baixado', 'ok');
      }
    }, {previous, scope: input.scope});
    for (const warning of journal.warnings || []) event(warning, 'warn');
    return {...sendResult(journal), ...await previewLink()};
  }
}
