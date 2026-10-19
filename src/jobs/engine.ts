import {BrowserAdapter, type RPC} from '../browser/adapter';
import {encodeSnapshot} from '../core/archive';
import type {ArchiveEntries} from '../core/compression';
import {assertContext, type Adapter, type Context, type Journal, type Progress, type Snapshot} from '../core/model';
import {demonstration, type Data, type PreviewBundle} from '../core/preview';
import {ProgressTracker, type PhaseSpec} from '../core/progress';
import {retryReads} from '../core/retry';
import {applyPlan, capture, continues} from '../core/workflow';
import {advanceBaseline} from '../core/workspace';
import {get, put, saveJournal, journalHistory, updateWorkspace} from '../storage';
import type {PreviewDraft, PreviewFetch} from '../browser/preview-capture';
import type {Decision, JobEvent, JobRequest, JobState, SendInput, Waiting} from './types';
// Public storefront capture needs a DOM parser: available in the background document and the
// demo page, injected so the rest of the engine runs anywhere (including unit tests).
export interface PreviewTools {
  prepare(snapshot: Snapshot, fetcher: PreviewFetch, options: {editorData?: Data; enabled?: boolean; signal?: AbortSignal}): Promise<PreviewDraft>;
  finish(draft: PreviewDraft, fetcher: PreviewFetch, origins: string[], signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<PreviewBundle>;
  unauthorized(bundle: PreviewBundle): string[];
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
  export: [{id: 'inventory', label: 'Listar os arquivos', weight: 2, total: 1}, {id: 'read', label: 'Ler os arquivos', weight: 1}, {id: 'preview', label: 'Capturar a vitrine', weight: 0.6}, {id: 'zip', label: 'Preparar o ZIP', weight: 6, total: 1}, {id: 'download', label: 'Baixar o ZIP', weight: 3, total: 1}],
  compare: [{id: 'prepare', label: 'Recarregar o editor', weight: 6, total: 1}, {id: 'inventory', label: 'Listar os arquivos', weight: 2, total: 1}, {id: 'read', label: 'Ler o que mudou', weight: 1}],
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
// One line for the result screen; the numbers and the report stay one click away.
export function previewSummary(visual: PreviewBundle): {line: string; details: string} {
  const line = visual.source.kind === 'demonstration' ? 'Prévia com dados de exemplo, sem a vitrine.' : visual.source.kind === 'editor' ? 'Prévia parcial, com dados do editor.' : 'Prévia parcial: vitrine publicada, rascunho não vinculado.';
  const kinds = [...new Set(visual.pages.map(p => p.kind + (p.context === 'search' ? ' (busca)' : '')))].join(', ') || 'nenhuma';
  const megabytes = (Object.values(visual.assets).reduce((sum, bytes) => sum + bytes.length, 0) / 1048576).toFixed(1).replace('.', ',');
  const details = `${count(visual.pages.length, 'página', 'páginas')} (${kinds}); ${count(Object.keys(visual.assets).length, 'recurso local', 'recursos locais')} (${megabytes} MB); ${count(visual.api.length, 'leitura pública gravada', 'leituras públicas gravadas')}; ${count(visual.issues.length, 'observação', 'observações')}. Relatório em preview/report.json. Rode npm run check para conferir seções e CSS; a fidelidade visual não é conferida automaticamente.`;
  return {line, details};
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
  if (request.kind === 'export') return `Baixando o tema de ${store}`;
  if (request.kind === 'compare') return request.scope === 'restore' ? `Preparando a restauração de ${store}` : `Comparando com ${store}`;
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
    state.detail = request.kind === 'export' ? 'ZIP da loja baixado' : request.kind === 'compare' ? 'Comparação concluída' : 'Arquivos salvos e conferidos após recarregar';
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
  async function exportTheme() {
    const snapshot = await capture(adapter, {signal: control.signal, progress, notice});
    let visual: PreviewBundle;
    if (request.includePreview && host.preview) {
      step('preview', 'Capturando contexto visual público…');
      const tools = host.preview, fetcher = remoteFetch(host.rpc, snapshot.context, control.signal);
      const draft = await tools.prepare(snapshot, fetcher, {editorData: await raw.visual?.(), enabled: true, signal: control.signal});
      let origins = [snapshot.context.previewOrigin];
      const finish = async () => {
        await host.rpc({action: 'preview-allow', preview: {origins, context: snapshot.context}});
        state.detail = 'Baixando recursos visuais';
        return tools.finish(draft, fetcher, origins, control.signal, (done, total) => {tracker.total('preview', total); tracker.set('preview', done); report();});
      };
      visual = await finish();
      for (let missing = tools.unauthorized(visual); missing.length; missing = tools.unauthorized(visual)) {
        state.status = 'waiting'; state.waiting = {kind: 'origins', origins: missing};
        state.detail = 'Código copiado; recursos visuais aguardam autorização';
        report(true);
        const decision = await control.decision(state.waiting);
        state.status = 'running'; delete state.waiting;
        if (decision.action === 'discard') throw new Error('Preparação visual descartada. Nenhum arquivo da Yampi foi alterado.');
        if (decision.action === 'partial') break;
        origins = [...new Set([...origins, ...decision.origins])];
        visual = await finish();
      }
      tracker.finish('preview');
    } else {
      tracker.skip('preview');
      visual = demonstration(snapshot.context, request.includePreview ? 'Captura visual indisponível neste ambiente. Código exportado; a prévia usa dados demonstrativos.' : 'Captura visual não autorizada ou desativada. Código exportado; configurações, catálogo de amostra, imagens e fontes visuais não foram capturados.', Object.keys(snapshot.files));
    }
    step('zip', 'Preparando ZIP…');
    const {inventory: _inventory, partial: _partial, ...exported} = snapshot;
    const bytes = await encodeSnapshot(exported, true, visual, {signal: control.signal, ...(host.compress ? {compress: host.compress} : {})});
    tracker.finish('zip');
    await updateWorkspace(expected, workspace => {
      workspace.baseline = exported; workspace.lineage = {exportedAt: exported.capturedAt, journals: []};
      if (workspace.review) {delete workspace.review.reading; workspace.review.overrides = []; delete workspace.review.selected;}
    });
    step('download', 'Baixando o ZIP');
    const name = fileName('exportacao', expected.storeName);
    await host.download(bytes, name);
    tracker.finish('download');
    const summary = previewSummary(visual);
    return {kind: 'export' as const, texts: Object.keys(exported.files).length, images: Object.keys(exported.assets || {}).length, pages: visual.pages.length, fileName: name, preview: summary.line, previewDetails: summary.details};
  }
  async function compare() {
    step('prepare', 'Recarregando o editor');
    await adapter.refresh();
    tracker.finish('prepare');
    const observed = await capture(adapter, {signal: control.signal, progress, notice, ...(request.full ? {} : {only: request.paths || []})});
    await updateWorkspace(expected, workspace => {
      const review = {reading: observed, overrides: []};
      if (request.scope === 'restore') workspace.restore = {...review, journalId: request.journalId!};
      else workspace.review = review;
    });
    return {kind: 'compare' as const, read: Object.keys(observed.files).length + Object.keys(observed.assets || {}).length, listed: observed.inventory.length, full: !!request.full};
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
