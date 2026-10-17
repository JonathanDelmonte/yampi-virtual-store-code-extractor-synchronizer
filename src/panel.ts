import {preparePreview, finishPreview, unauthorizedOrigins} from './browser/preview-capture';
import {publicUrl} from './core/preview';
import {BrowserAdapter, type RPC} from './browser/adapter';
import {PanelConnection} from './browser/panel-connection';
import {zipInWorker} from './browser/zip-client';
import {decodeProject, readProjectDirectory, readProjectEntries, type Project} from './core/archive';
import {makePlan, missingNewTexts, selectionIssues, sendable} from './core/planner';
import {changedPaths, remoteFromCapture} from './core/compare';
import {explainBlock} from './core/explain';
import {formatDuration} from './core/progress';
import {chooseBaseline, type Review, type Workspace} from './core/workspace';
import {COMPONENTS_FILE} from '../local-runtime/contract.mjs';
import {assertContext, writable, MAX_TOTAL_BYTES, MAX_FILE_BYTES, type Context, type Assets, type Files, type Plan, type PlanRow, type Journal, type Snapshot} from './core/model';
import {get, put, clearLocal, journalHistory, loadWorkspace, updateWorkspace} from './storage';
import {startingState} from './jobs/engine';
import {active, type JobRequest, type JobState, type Scope, type SendInput} from './jobs/types';
import {ExtensionJobs, LocalJobs, type JobClient} from './panel/client';
import {canPickFolders, droppedItem, folderEntries, permitted, pickFolder, recallFolder, rememberFolder, replaceThemeFile, type Folder, type Remembered} from './panel/folder';
import {renderDiff} from './panel/diff-view';
import {lens, adaptiveShadows} from './panel/glass';
import {$, el, glyph, list, plural, dateTime, since, enter, toast, copyText} from './panel/dom';
const isDemo = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('demo') === '1';
const editorTab = new URLSearchParams(location.search).get('tab');
// --- State ------------------------------------------------------------------------------------
// One screen at a time. The route is where the user chose to go; the view shown also depends on
// what is happening (connecting, an operation running, its result).
type Route = 'home' | 'export' | 'send';
type View = 'connecting' | 'offline' | 'home' | 'export' | 'pick' | 'review' | 'job' | 'result';
let route: Route = 'home';
let rpc: RPC;
let connection: PanelConnection | undefined;
let client: JobClient;
let connected = false, context: Context | undefined;
let offline: {title: string; text: string} | undefined;
let notice: {title: string; text: string} | undefined;
let busy = false, busyTitle = '', controller: AbortController | undefined;
let localProgress: {done: number; total: number} | undefined;
let workspace: Workspace | undefined, plan: Plan | undefined, scope: Scope = 'project', restoreJournal: Journal | undefined;
const selected = new Set<string>();
// liveJob: the operation whose screen is shown (running, or finished and not yet dismissed).
let job: JobState | undefined, liveJob = '', settling = false, handled = '', cancelled = '';
let history: Journal[] = [], journal: Journal | undefined, resumable: Journal | undefined;
let remembered: Remembered | undefined;
let diffRow: PlanRow | undefined, diffTab: 'remote' | 'base' | 'store' = 'remote';
let lastAnnounced = '', lastView = '';
// --- Editor connection --------------------------------------------------------------------------
if (isDemo) {
  $('demo-notice').hidden = false;
  $('fixture').hidden = false;
  const frame = $<HTMLIFrameElement>('fixture-frame');
  frame.src = 'fixture.html';
  await new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), {once: true}));
  rpc = async request => {
    if (request.action === 'lock' || request.action === 'unlock') return null;
    if (request.action === 'refresh') {
      await new Promise<void>(resolve => {frame.addEventListener('load', () => resolve(), {once: true}); frame.contentWindow!.location.reload();});
      return null;
    }
    const api = (frame.contentWindow as unknown as {YampiThemeSyncBridge: {command: (r: unknown) => Promise<{ok: boolean; value: unknown; error?: string}>}}).YampiThemeSyncBridge;
    const reply = await api.command(request.command);
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  };
  client = new LocalJobs(rpc, {download: (bytes, name, type) => save(bytes, name, type), compress: zipInWorker, preview: {prepare: preparePreview, finish: finishPreview, unauthorized: unauthorizedOrigins}});
} else {
  connection = new PanelConnection(chrome.runtime, () => {
    const wasConnected = connected; connected = false;
    controller?.abort(); $('connection-state').textContent = 'Editor desconectado';
    // Keep the precise first diagnostic instead of replacing it with a generic disconnect.
    if (wasConnected && !busy) offline = {title: 'Conexão encerrada', text: active(job) ? 'A operação continua em segundo plano. Conecte de novo para acompanhar.' : 'Conecte de novo para continuar. Nenhum envio recomeça sozinho.'};
    render();
  });
  rpc = connection.request;
  window.addEventListener('pagehide', () => connection?.close());
  client = new ExtensionJobs(Number(editorTab), message => connection!.request(message as Parameters<RPC>[0]));
}
const adapter = new BrowserAdapter(rpc);
client.subscribe(state => onJob(state));
lens($('topbar'), 'lens-top', {radius: 18, bezel: 14, shift: 6});
lens($('dock'), 'lens-dock', {radius: 18, bezel: 14, shift: 6});
adaptiveShadows($('topbar'), $('dock'));
document.addEventListener('keydown', () => {document.body.dataset.input = 'keyboard';});
document.addEventListener('pointerdown', () => {delete document.body.dataset.input;});
// --- Which screen -------------------------------------------------------------------------------
function currentView(): View {
  if (!connected) return busy || !offline ? 'connecting' : 'offline';
  if (busy || active(job) || settling) return 'job';
  if (job && job.id === liveJob && !(job.kind === 'compare' && job.status === 'completed')) return 'result';
  if (route === 'export') return 'export';
  if (route === 'send') return plan ? 'review' : 'pick';
  return 'home';
}
function go(next: Route): void {
  notice = undefined; route = next;
  if (job && !active(job) && job.id === liveJob) dismissJob();
  render();
}
// A finished operation's screen goes away when the user moves on; the icon badge is cleared too.
function dismissJob(): void {
  liveJob = '';
  void client.dismiss().catch(() => {});
}
// --- Rendering ------------------------------------------------------------------------------------
type Head = {title: string; detail: string; tone?: 'ok' | 'error' | 'run'};
function head(view: View): Head {
  const store = context?.storeName || 'a loja';
  if (view === 'connecting') return {title: 'Conectando ao editor…', detail: ''};
  if (view === 'offline') return {title: offline!.title, detail: offline!.text, tone: 'error'};
  if (view === 'home') return {title: 'O que você quer fazer?', detail: ''};
  if (view === 'export') return {title: 'Baixar o tema', detail: `Uma cópia do código de ${store} em ZIP, para editar no computador.`};
  if (view === 'pick') return workspace?.project ? {title: 'Comparar com a loja', detail: 'Releia a pasta depois de editar, ou escolha outra.'} : {title: 'Escolha a pasta do projeto', detail: 'A pasta extraída do ZIP que a extensão baixou.'};
  if (view === 'review') return reviewHead();
  if (view === 'job') {
    if (busy) return {title: busyTitle || 'Um momento…', detail: localProgress ? `${localProgress.done} de ${localProgress.total} arquivos` : '', tone: 'run'};
    const phase = job!.phases.find(p => p.status === 'active');
    return {title: job!.status === 'waiting' ? 'Falta autorizar imagens e fontes' : job!.title, detail: settling ? 'Concluindo…' : job!.status === 'waiting' ? 'O código já foi copiado. Autorize para incluir as imagens e fontes no ZIP.' : phase ? `${phase.label}${phase.total > 1 ? `: ${Math.floor(phase.done)} de ${phase.total}` : ''}` : job!.detail, tone: 'run'};
  }
  return resultHead(job!);
}
function reviewHead(): Head {
  const store = plan!.context.storeName, reading = (scope === 'restore' ? workspace?.restore : workspace?.review)?.reading;
  const compared = reading ? `Comparado com ${store} ${since(reading.capturedAt)}.` : '';
  if (scope === 'restore' && restoreJournal) return {title: selected.size ? `Restaurar ${plural(selected.size, 'item', 'itens')}` : 'Nada para restaurar', detail: `Envio de ${dateTime(restoreJournal.startedAt)}. Só volta o que continua igual ao que foi enviado.`};
  if (missingNewTexts(plan!).length) return {title: 'Ajuste o projeto antes de enviar', detail: compared};
  if (!selected.size) return {title: plan!.rows.some(row => row.status === 'conflict' || row.status === 'blocked-dependency') ? 'Nada pronto para enviar' : 'Nada para enviar', detail: plan!.rows.some(row => row.status === 'conflict') ? compared : `A loja já tem tudo o que o projeto mudou. ${compared}`};
  return {title: `${selected.size} ${selected.size === 1 ? 'alteração pronta' : 'alterações prontas'}`, detail: compared};
}
function resultHead(state: JobState): Head {
  const result = state.result, restore = state.scope === 'restore';
  if (state.status === 'completed') {
    if (result?.kind === 'export') return {title: 'ZIP baixado', detail: 'Extraia numa pasta e abra no VS Code para editar.', tone: 'ok'};
    if (result?.kind === 'send') {
      const items = result.verified + result.uploaded;
      return {title: restore ? 'Restauração concluída' : 'Envio concluído', detail: `${plural(items, 'item conferido', 'itens conferidos')} na Yampi. Confira a prévia e publique na Yampi quando estiver tudo certo.`, tone: 'ok'};
    }
  }
  const noun = state.kind === 'export' ? 'Download' : state.kind === 'compare' ? 'Comparação' : restore ? 'Restauração' : 'Envio';
  const feminine = state.kind === 'compare' || restore;
  if (state.status === 'cancelled') {
    if (/descartad/i.test(state.error || '')) return {title: 'Download cancelado', detail: 'Nada mudou na loja.'};
    return {title: `${noun} ${state.kind === 'send' ? (feminine ? 'pausada' : 'pausado') : (feminine ? 'interrompida' : 'interrompido')}`, detail: state.kind === 'send' ? 'O item em andamento terminou e foi conferido. Continue quando quiser.' : 'Nada mudou na loja.'};
  }
  return {title: `${noun} ${feminine ? 'interrompida' : 'interrompido'}`, detail: state.error || '', tone: 'error'};
}
function render(): void {
  const view = currentView(), info = head(view);
  document.body.dataset.view = view;
  document.body.dataset.tone = info.tone || '';
  $('status').textContent = info.title;
  $('detail').textContent = info.detail;
  $('notice').hidden = !notice || view === 'job' || view === 'offline' || view === 'connecting';
  if (notice) $('notice').replaceChildren(el('strong', {text: notice.title}), notice.text);
  $('view-home').hidden = view !== 'home';
  $('export-section').hidden = view !== 'export';
  $('import-section').hidden = view !== 'pick';
  $('review').hidden = view !== 'review';
  $('view-job').hidden = view !== 'job';
  $('done').hidden = view !== 'result';
  $('back').hidden = !['export', 'pick', 'review'].includes(view);
  $('store').textContent = connected && context ? context.storeName : view === 'offline' ? 'Editor indisponível' : 'Conectando…';
  document.body.dataset.connection = !connected ? (view === 'offline' ? 'error' : 'idle') : view === 'job' ? 'busy' : 'connected';
  // The project card is also read by the review and the tests; keep it current on every screen.
  renderPick();
  if (view === 'home') renderHome();
  if (view === 'export') renderExport();
  if (view === 'review') renderPlan();
  if (view === 'job') renderJob();
  if (view === 'result') renderResult();
  renderDock(view);
  controls();
  // Screen readers hear the screen changing and phase changes, not every percent.
  const spoken = view === 'job' && job && !busy ? `${job.id}:${job.status}:${job.phases.find(p => p.status === 'active')?.id || ''}` : `${view}:${info.title}`;
  if (spoken !== lastAnnounced) {lastAnnounced = spoken; $('announcer').textContent = `${info.title}. ${info.detail}`;}
  if (view !== lastView) {
    // A new screen starts at the top, with focus on its title for keyboard and reader users.
    if (lastView) {
      window.scrollTo({top: 0});
      if (document.body.dataset.input === 'keyboard') $('status').focus({preventScroll: true});
      const section = {home: 'view-home', export: 'export-section', pick: 'import-section', review: 'review', job: 'view-job', result: 'done'}[view as string];
      enter(document.querySelector<HTMLElement>('.view-head')!, ...(section ? [$(section)] : []));
    }
    lastView = view;
  }
}
function renderHome(): void {
  const project = workspace?.project, pending = workspace?.review?.reading && plan ? selected.size : 0;
  $('send-tile-text').textContent = pending ? `${plural(pending, 'alteração pronta', 'alterações prontas')} para enviar` : project ? `Projeto “${project.name}”, lido ${since(project.loadedAt)}` : 'Do seu projeto para a loja';
  $('resume-card').hidden = !resumable;
  if (resumable) $('resume-text').textContent = `Parou em ${resumable.verified.length + (resumable.uploaded?.length || 0)} de ${resumable.selected.length} itens${resumable.error ? `: ${resumable.error}` : '.'} O que já foi conferido continua na loja.`;
  const last = history.find(item => item.status === 'completed');
  $('last-send').hidden = !last || !!resumable;
  if (last) $('last-send').textContent = `Último envio em ${dateTime(last.startedAt)}: ${plural(last.verified.length + (last.uploaded?.length || 0), 'item conferido', 'itens conferidos')}. Histórico e backups ficam no menu.`;
}
function renderExport(): void {
  const base = workspace?.baseline;
  $('baseline-info').hidden = !base;
  if (base) $('baseline-info').textContent = `Último download em ${dateTime(workspace?.lineage?.exportedAt || base.capturedAt)}.`;
}
function renderPick(): void {
  const project = workspace?.project, lineage = workspace?.lineage;
  $('project-card').hidden = !project;
  $('dropzone').hidden = !!project;
  if (!project) return;
  const images = Object.keys(project.localAssets).length;
  $('project-name').textContent = project.name;
  $('local-info').textContent = `${Object.keys(project.local).length} textos e ${plural(images, 'imagem', 'imagens')}, lidos ${since(project.loadedAt)}.`;
  $('reference-info').textContent = workspace?.baseline ? `Exportado em ${dateTime(lineage?.exportedAt || workspace.baseline.capturedAt)}${lineage?.journals.length ? `, com ${plural(lineage.journals.length, 'envio', 'envios')} desde então` : ''}.` : 'Falta a exportação original: escolha a pasta com .yampi-sync/.';
}
function renderJob(): void {
  const showJob = !busy && !!job;
  const fraction = showJob ? job!.fraction : localProgress?.total ? localProgress.done / localProgress.total : 0;
  $('progress').style.setProperty('--p', String(fraction));
  $('progress').setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  $('percent').textContent = showJob || localProgress ? `${Math.round(fraction * 100)}%` : '…';
  $('current').hidden = !showJob || !job!.path;
  if (showJob && job!.path) $('current').textContent = job!.path;
  const meta = $('job-meta');
  meta.hidden = !showJob || job!.status === 'waiting';
  if (!meta.hidden) meta.textContent = job!.etaMs !== undefined ? `Restam cerca de ${formatDuration(job!.etaMs)}.` : `Em andamento há ${formatDuration(job!.elapsedMs)}.`;
  const waiting = showJob && job!.status === 'waiting' && job!.waiting?.kind === 'origins';
  $('preview-pending').hidden = !waiting;
  if (waiting) $('preview-origins').textContent = list(job!.waiting!.origins);
  $('background-note').hidden = !showJob || isDemo || waiting;
  $('phases-box').hidden = !showJob;
  if (showJob) $('phases').replaceChildren(...job!.phases.filter(p => p.status !== 'skipped' && (p.total || p.status === 'active')).map(phase => el('li', {class: 'phase', attrs: {'data-status': phase.status}},
    el('span', {class: 'phase-mark'}, phase.status === 'done' ? glyph('check') : phase.status === 'failed' ? glyph('x') : false),
    el('span', {text: phase.label}),
    el('span', {class: 'phase-count', text: phase.total > 1 ? `${Math.floor(phase.done)}/${phase.total}` : ''}))));
  renderEvents(showJob);
}
function renderEvents(show: boolean): void {
  $('events').hidden = !show || !job?.events.length;
  if (show && job) $('event-list').replaceChildren(...job.events.slice(0, 50).map(event => el('li', {class: 'event', attrs: {'data-tone': event.tone}},
    el('span', {class: 'event-text'}, event.text, event.path ? ': ' : '', event.path ? el('code', {text: event.path}) : false),
    el('time', {text: new Date(event.at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit', second: '2-digit'})}))));
}
// A count and its label, in the singular for one.
function setCount(id: string, value: number, one: string, many: string): void {
  $(id).textContent = String(value); $(id + '-label').textContent = value === 1 ? one : many;
  $(id).parentElement!.classList.toggle('zero', !value);
}
function renderResult(): void {
  const state = job!, result = state.result;
  const send = result?.kind === 'send' ? result : undefined, exported = result?.kind === 'export' ? result : undefined;
  $('done-counts').hidden = !((send || exported) && state.status === 'completed');
  if (send) {setCount('done-saved', send.verified, 'salvo', 'salvos'); setCount('done-created', send.created, 'criado', 'criados'); setCount('done-images', send.uploaded, 'imagem', 'imagens');}
  if (exported) {setCount('done-saved', exported.texts, 'arquivo', 'arquivos'); setCount('done-created', exported.images, 'imagem', 'imagens'); setCount('done-images', exported.pages ?? 0, 'página', 'páginas');}
  $('done-summary').textContent = send && state.status === 'completed' ? `${send.verified} ${send.verified === 1 ? 'arquivo salvo' : 'arquivos salvos'}${send.created ? `, ${send.created} ${send.created === 1 ? 'deles criado' : 'deles criados'} pela extensão` : ''}${send.uploaded ? ` e ${send.uploaded} ${send.uploaded === 1 ? 'imagem enviada' : 'imagens enviadas'}` : ''}. A extensão não publicou nada.` : send ? `${plural(send.verified + send.uploaded, 'item conferido', 'itens conferidos')} de ${send.total} antes de parar.` : '';
  $('preview-info').hidden = !exported; $('preview-more').hidden = !exported;
  if (exported) {$('preview-info').textContent = exported.preview; $('preview-details').textContent = `${exported.previewDetails ?? ''} Arquivo: ${exported.fileName}.`.trim();}
  $('done-warnings').hidden = !send?.warnings.length;
  $('done-warnings').replaceChildren(...(send?.warnings || []).map(text => el('li', {}, el('span', {text}))));
  $('undo').hidden = !(send && state.status === 'completed');
  renderEvents(state.status !== 'completed');
}
// --- Bottom bar: the one next step -----------------------------------------------------------------
function renderDock(view: View): void {
  const show: string[] = [];
  if (view === 'offline') show.push('retry');
  if (view === 'home' && resumable) show.push('resume');
  if (view === 'export') show.push('export');
  if (view === 'pick') show.push(...(remembered && canPickFolders() ? ['reload-folder', 'pick-folder'] : ['pick-folder']));
  if (view === 'review') show.push('apply');
  // While waiting for the user's choice, the choices are on screen; "stop" would only repeat them.
  if (view === 'job' && (busy ? !!controller : job?.status === 'running')) show.push('cancel');
  if (view === 'result' && job) {
    if (job.status === 'completed' && job.result?.kind === 'send' && previewUrl()) show.push('open-preview');
    if (job.status === 'completed' && job.result?.kind === 'export' && !isDemo) show.push('show-file');
    if (job.kind === 'send' && job.status !== 'completed' && resumable) show.push('resume');
    show.push('finish');
  }
  for (const id of ['retry', 'export', 'reload-folder', 'pick-folder', 'apply', 'resume', 'open-preview', 'show-file', 'cancel', 'finish']) $(id).hidden = !show.includes(id);
  // "Choose a folder" is the main action unless the last folder can simply be read again.
  $('pick-folder').classList.toggle('primary', !show.includes('reload-folder'));
  $('pick-folder').textContent = show.includes('reload-folder') ? 'Outra' : 'Escolher a pasta';
  $('finish').textContent = job && job.status === 'completed' ? 'Concluir' : 'Voltar';
  $('finish').classList.toggle('primary', show.length === 1);
  $('dock').hidden = !show.length;
  $('dock').dataset.count = String(show.length);
}
// --- Controls -------------------------------------------------------------------------------------
function controls(): void {
  const working = busy || active(job) || settling;
  $('export').toggleAttribute('disabled', working || !connected);
  $('include-preview').toggleAttribute('disabled', working);
  for (const id of ['preview-allow', 'preview-partial', 'preview-discard']) $(id).toggleAttribute('disabled', busy);
  for (const id of ['pick-folder', 'pick-other', 'reload-folder', 'folder', 'baseline', 'clear', 'history', 'demo-local', 'mode-import', 'mode-export']) $(id).toggleAttribute('disabled', working);
  $('compare').toggleAttribute('disabled', working || !connected || !workspace?.baseline || !workspace?.project);
  const missing = plan ? missingNewTexts(plan).length : 0, partial = plan ? selectionIssues(plan, selected) : [];
  const blocked = !!missing || partial.length > 0;
  $('apply').toggleAttribute('disabled', working || !connected || !plan || !selected.size || blocked);
  $('apply-label').textContent = plan && selected.size ? `${scope === 'restore' ? 'Restaurar' : 'Enviar'} ${selected.size} ${selected.size === 1 ? 'item' : 'itens'} para ${plan.context.storeName}` : 'Nada para enviar';
  $('apply').title = !plan || !selected.size ? 'Nada pronto para enviar.' : missing ? 'Ajuste no projeto os arquivos novos que a Yampi não permite criar.' : partial.length ? 'Arquivos que usam uns aos outros vão juntos.' : '';
  if (working || !plan || !selected.size || blocked) closeSheet('confirm-panel');
  $('confirm-send').toggleAttribute('disabled', working || !connected);
  $('discard-whitespace').hidden = !plan?.rows.some(r => r.status === 'update' && r.whitespaceOnly);
  for (const id of ['discard-whitespace', 'select-all', 'select-none', 'filter', 'search']) $(id).toggleAttribute('disabled', working);
  $('cancel').toggleAttribute('disabled', !!job && cancelled === job.id && !busy);
  $('restore').toggleAttribute('disabled', working || !connected || !journal);
  $('download-backup').toggleAttribute('disabled', busy || !journal);
  $('download-journal').toggleAttribute('disabled', busy || !journal);
  if (remembered) $('reload-folder-label').textContent = `Reler “${remembered.name}”`;
  document.querySelectorAll<HTMLInputElement>('#rows input[type="checkbox"]').forEach(input => {
    input.disabled = working || !sendable(plan?.rows.find(r => r.path === input.dataset.path));
  });
}
// Panel-local work (reading a folder or a ZIP) starts synchronously, so the screen never lags
// behind the click. A failure stays on the screen where it happened.
async function run(title: string, work: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true; busyTitle = title; controller = new AbortController(); localProgress = undefined; notice = undefined; render();
  try {await work();}
  catch (error) {notice = {title: 'Não deu certo', text: error instanceof Error ? error.message : String(error)};}
  finally {busy = false; controller = undefined; localProgress = undefined; render();}
}
function progressLocal(done: number, total: number): void {localProgress = {done, total}; render();}
// --- Navigation -------------------------------------------------------------------------------------
$('mode-export').addEventListener('click', () => go('export'));
$('mode-import').addEventListener('click', () => go('send'));
$('back').addEventListener('click', () => go('home'));
$('finish').addEventListener('click', () => go(job?.kind === 'send' && job.status !== 'completed' ? 'send' : 'home'));
// The editor's own "Ver prévia" link, read at the end of the send.
function previewUrl(): string | undefined {return job?.result?.kind === 'send' ? job.result.preview : undefined;}
// --- Workspace and plan -------------------------------------------------------------------------
async function loadStoreData(): Promise<void> {
  if (!context) return;
  workspace = await loadWorkspace(context);
  history = await journalHistory(context);
  if (!journal || !history.some(item => item.id === journal!.id)) journal = history[0];
  resumable = undefined;
  const latest = history[0];
  if (latest && latest.status !== 'completed' && !active(job) && await get(`sendplan:${latest.id}`)) resumable = latest;
  // The demo keeps the folder it was given in memory; the extension finds it again in IndexedDB.
  remembered = isDemo ? remembered : await recallFolder(context);
  restoreJournal = workspace?.restore ? history.find(item => item.id === workspace!.restore!.journalId) : undefined;
  computePlan();
  updateHistory(); journalInfo();
}
function review(): Review | undefined {return scope === 'restore' ? workspace?.restore : workspace?.review;}
function computePlan(): void {
  plan = undefined; selected.clear();
  scope = workspace?.restore?.reading && restoreJournal ? 'restore' : 'project';
  const current = review(), reading = current?.reading;
  if (!reading || !workspace) return;
  let base: Snapshot | undefined, local: Files | undefined, assets: Assets = {};
  if (scope === 'restore') {base = {context: restoreJournal!.context, capturedAt: restoreJournal!.startedAt, files: restoreJournal!.after}; local = restoreJournal!.before;}
  else {base = workspace.baseline; local = workspace.project?.local; assets = workspace.project?.localAssets || {};}
  if (!base || !local) return;
  try {
    const {remote, assumed} = remoteFromCapture(base, reading);
    plan = makePlan(base, local, remote, assets, {overrides: current!.overrides, assumed, inventory: reading.inventory});
  } catch (error) {notice = {title: 'A comparação não vale mais', text: error instanceof Error ? error.message : String(error)}; return;}
  const discarded = new Set(current!.discarded || []);
  for (const row of plan.rows) if (row.status === 'update' && row.whitespaceOnly && discarded.has(row.path)) row.status = 'whitespace-only';
  // Whitespace-only differences start unselected; coupled files start together.
  const chosen = current!.selected ? new Set(current!.selected) : undefined;
  for (const row of plan.rows) if (sendable(row) && (chosen ? chosen.has(row.path) : !row.whitespaceOnly)) selected.add(row.path);
}
let saving: ReturnType<typeof setTimeout> | undefined;
function persistReview(change: (value: Review) => void): void {
  if (!context) return;
  const target = scope;
  clearTimeout(saving);
  saving = setTimeout(() => void updateWorkspace(context!, value => {
    const current = target === 'restore' ? value.restore : value.review;
    if (current) change(current);
  }).then(next => {workspace = next;}).catch(() => {}), 250);
}
const labels: Record<PlanRow['status'], string> = {
  update: 'Pronto para envio', create: 'Novo, será criado', upload: 'Imagem nova, será enviada', unchanged: 'Sem alterações', 'remote-only': 'Mudou apenas na loja', 'already-applied': 'Já está na loja', conflict: 'Conflito', 'missing-local': 'Ausente no projeto, preservado', 'missing-remote': 'Removido na loja, bloqueado', 'new-local': 'Novo, a Yampi não permite criar', unsupported: 'Sem suporte, bloqueado', 'blocked-dependency': 'Bloqueado', 'whitespace-only': 'Só espaço em branco, ignorado'
};
const label = (row: PlanRow) => row.status === 'update' && row.override ? 'Usará a versão do projeto' : row.status === 'update' && row.base === undefined ? 'Novo, será preenchido' : row.status === 'unchanged' && row.assumed ? 'Sem alterações no projeto' : labels[row.status];
const short = (path: string) => path.replace(/^assets\//, '');
function rowNote(row: PlanRow): string {
  return [row.source ? `Vem de ${row.source}.` : '', row.rewritten ? `${plural(row.rewritten, 'referência de imagem ajustada', 'referências de imagem ajustadas')}.` : '', row.reason || '', row.blockedBy?.length ? `Depende de ${list(row.blockedBy)}.` : '', row.dependsOn?.length ? `Vai junto com ${list(row.dependsOn)}.` : ''].filter(Boolean).join(' ');
}
function linkButton(text: string, act: () => void): HTMLButtonElement {
  const button = el('button', {class: 'link', text, attrs: {type: 'button'}}); button.addEventListener('click', act); return button;
}
function attentionItem(text: string, ...actions: HTMLButtonElement[]): HTMLLIElement {
  return el('li', {}, el('span', {text}), actions.length ? el('span', {class: 'actions'}, ...actions) : false);
}
// Only what needs a decision or a fix, in one line each, with the action that solves it.
function attention(): HTMLLIElement[] {
  if (!plan) return [];
  const items: HTMLLIElement[] = [];
  const rows = new Map(plan.rows.map(row => [row.path, row]));
  for (const row of plan.rows) {
    const block = row.reason ? undefined : explainBlock(plan, row);
    if (block && (block.storeOnly.length || block.conflicts.length)) {
      const look = (paths: string[], one: string, many: (path: string) => string, tab?: 'store') => paths.map(path => linkButton(paths.length === 1 ? one : many(path), () => openDiff(rows.get(path)!, tab)));
      items.push(attentionItem(block.text, ...look(block.storeOnly, 'Ver a mudança', path => `Ver ${path}`, 'store'), ...look(block.conflicts, 'Comparar e escolher', path => `Escolher ${path}`)));
    } else if (row.override) items.push(attentionItem(`${row.path}: vai a versão do projeto. A da loja fica no backup.`, linkButton('Ver', () => openDiff(row)), linkButton('Manter a da loja', () => setOverride(row, false))));
    else if (row.status === 'conflict' && !row.image && writable(row.path)) items.push(attentionItem(`${row.path} mudou na loja depois da sua cópia.`, linkButton('Comparar e escolher', () => openDiff(row))));
    else if (row.status === 'conflict') items.push(attentionItem(`${row.path} mudou na loja, e a extensão não pode substituí-lo.`, linkButton('Ver', () => openDiff(row))));
    else if (row.status === 'new-local' || row.status === 'blocked-dependency' || row.status === 'unsupported' && row.reason && row.path !== COMPONENTS_FILE) items.push(attentionItem(`${row.source || row.path}: ${row.reason || (row.blockedBy?.length ? `usa ${list(row.blockedBy)}, que não pode ser enviado.` : 'não pode ser enviado.')}`, linkButton('Ver', () => openDiff(row))));
    else if (row.status === 'missing-remote') items.push(attentionItem(`${row.path} foi removido da loja e não será recriado.`, linkButton('Ver', () => openDiff(row))));
  }
  for (const issue of selectionIssues(plan, selected)) items.push(attentionItem(`${issue.path} precisa ir junto com ${issue.requires}.`));
  for (const warning of plan.warnings || []) items.push(attentionItem(`${warning.path}: ${warning.message}`));
  return items;
}
function setOverride(row: PlanRow, use: boolean): void {
  const current = review(); if (!current) return;
  const overrides = new Set(current.overrides);
  if (use) overrides.add(row.path); else overrides.delete(row.path);
  current.overrides = [...overrides]; delete current.selected;
  persistReview(value => {value.overrides = [...overrides]; delete value.selected;});
  computePlan(); render();
  const next = plan?.rows.find(item => item.path === row.path);
  if (next && diffRow) openDiff(next);
}
function renderPlan(): void {
  if (!plan) return;
  const count = (test: (row: PlanRow) => boolean) => plan!.rows.filter(test).length;
  const changed = count(r => r.status === 'update' && !r.whitespaceOnly && r.base !== undefined), created = count(r => r.status === 'create' || r.status === 'update' && r.base === undefined);
  const images = count(r => r.status === 'upload');
  const conflicts = count(r => r.status === 'conflict'), blocked = count(r => ['blocked-dependency', 'new-local', 'missing-remote'].includes(r.status) || r.status === 'unsupported' && !!r.reason && r.path !== COMPONENTS_FILE), whitespace = count(r => r.status === 'update' && !!r.whitespaceOnly);
  setCount('count-update', changed, 'alterado', 'alterados'); setCount('count-create', created, 'novo', 'novos'); setCount('count-upload', images, 'imagem', 'imagens');
  const kinds = list([changed ? plural(changed, 'arquivo alterado', 'arquivos alterados') : '', created ? plural(created, 'arquivo novo', 'arquivos novos') : '', images ? plural(images, 'imagem nova', 'imagens novas') : '']);
  $('summary').textContent = [
    `${plural(selected.size, 'item', 'itens')} para enviar${kinds ? `: ${kinds}` : ''}.`,
    conflicts ? `${plural(conflicts, 'conflito precisa', 'conflitos precisam')} da sua decisão.` : 'Nenhum conflito.',
    blocked ? `${plural(blocked, 'item bloqueado', 'itens bloqueados')}.` : '',
    whitespace ? `${plural(whitespace, 'arquivo muda', 'arquivos mudam')} só em espaços em branco.` : '',
    `${plural(plan.rows.length, 'caminho comparado', 'caminhos comparados')}.`
  ].filter(Boolean).join(' ');
  const assumed = count(r => !!r.assumed);
  $('assumed-note').hidden = !assumed;
  $('assumed-note').textContent = `${plural(assumed, 'arquivo', 'arquivos')} que o projeto não altera não ${assumed === 1 ? 'foi relido' : 'foram relidos'} na loja, porque não seriam enviados de qualquer forma.`;
  const moved = plan.rows.filter(r => r.status === 'upload' && r.source);
  $('moves-title').textContent = moved.length ? `${moved.length === 1 ? 'Uma imagem vai' : `${moved.length} imagens vão`} direto para assets/images, porque a Yampi não aceita subpastas. As referências são ajustadas.` : '';
  $('moves-list').replaceChildren(...moved.map(r => el('li', {text: `${short(r.source!)} → ${short(r.path)}`})));
  $('moves').hidden = !moved.length;
  const lineage = workspace?.lineage;
  $('reference-detail').textContent = scope === 'project' && workspace?.baseline ? `Projeto “${workspace.project?.name || ''}”, comparado com a exportação de ${dateTime(lineage?.exportedAt || workspace.baseline.capturedAt)}${lineage?.journals.length ? ` e ${plural(lineage.journals.length, 'envio feito', 'envios feitos')} depois` : ''}.` : '';
  const items = attention();
  $('attention-list').replaceChildren(...items);
  $('attention').hidden = !items.length;
  $('attention-title').textContent = conflicts && items.length === conflicts ? `${plural(conflicts, 'conflito', 'conflitos')} para decidir` : 'Precisa da sua atenção';
  $('files-summary').textContent = `Ver os arquivos (${plan.rows.filter(row => !['unchanged', 'already-applied', 'missing-local'].includes(row.status)).length})`;
  $('target-store').textContent = plan.context.storeName;
  renderRows();
}
function renderRows(): void {
  // The list is built only while open: hundreds of rows are not worth keeping in the page.
  if (!plan || !($('all-files') as HTMLDetailsElement).open) {$('rows').replaceChildren(); $('rows-more').hidden = true; return;}
  const filter = $<HTMLSelectElement>('filter').value, query = $<HTMLInputElement>('search').value.trim().toLowerCase();
  const rows = plan.rows.filter(row => {
    if (query && !row.path.toLowerCase().includes(query) && !(row.source || '').toLowerCase().includes(query)) return false;
    if (filter === 'changes') return !['unchanged', 'already-applied', 'missing-local'].includes(row.status);
    if (filter === 'update') return sendable(row);
    if (filter === 'conflict') return row.status === 'conflict';
    if (filter === 'whitespace') return !!row.whitespaceOnly || row.status === 'whitespace-only';
    if (filter === 'blocked') return ['blocked-dependency', 'new-local', 'missing-remote', 'unsupported'].includes(row.status);
    return true;
  });
  const shown = rows.slice(0, 400), working = busy || active(job);
  $('rows').replaceChildren(...shown.map(row => {
    const checkbox = el('input', {attrs: {type: 'checkbox', 'aria-label': `Enviar ${row.path}`, 'data-path': row.path}});
    checkbox.checked = selected.has(row.path); checkbox.disabled = !sendable(row) || working;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(row.path); else selected.delete(row.path);
      persistReview(value => {value.selected = [...selected];});
      render();
    });
    const name = row.path.split('/').pop()!, folder = row.path.slice(0, -name.length), note = rowNote(row);
    const view = linkButton('Diferenças', () => openDiff(row)); view.classList.add('row-action');
    return el('li', {class: 'file-row'},
      el('label', {class: 'check'}, checkbox, el('span')),
      el('div', {class: 'file-main'}, el('span', {class: 'file-name', text: name}), el('span', {class: 'file-folder', text: folder}), el('span', {class: `row-status ${row.status}`, text: label(row) + (row.status === 'update' && row.whitespaceOnly ? ', só espaço em branco' : '')}), note ? el('small', {class: 'row-detail', text: note}) : false),
      view);
  }));
  $('rows-more').hidden = rows.length <= shown.length;
  $('rows-more').textContent = `Mostrando ${shown.length} de ${rows.length}. Use a busca para encontrar os demais.`;
}
$('all-files').addEventListener('toggle', renderRows);
$('filter').addEventListener('change', renderRows);
$('search').addEventListener('input', renderRows);
$('select-all').addEventListener('click', () => {
  if (!plan) return;
  for (const row of plan.rows) if (sendable(row) && !row.whitespaceOnly) selected.add(row.path);
  persistReview(value => {value.selected = [...selected];}); render();
});
$('select-none').addEventListener('click', () => {selected.clear(); persistReview(value => {value.selected = [];}); render();});
$('discard-whitespace').addEventListener('click', () => {
  if (!plan || busy) return;
  const paths = plan.rows.filter(row => row.status === 'update' && row.whitespaceOnly).map(row => row.path);
  for (const path of paths) selected.delete(path);
  persistReview(value => {value.discarded = [...new Set([...value.discarded || [], ...paths])]; value.selected = [...selected];});
  const current = review(); if (current) current.discarded = [...new Set([...current.discarded || [], ...paths])];
  for (const row of plan.rows) if (paths.includes(row.path)) row.status = 'whitespace-only';
  render(); toast('Mudanças só de espaço em branco não serão enviadas.');
});
// --- Sheets ---------------------------------------------------------------------------------------
const sheets = ['confirm-panel', 'diff', 'menu-sheet'];
function openSheet(id: string): void {
  $(id).hidden = false; $('sheet-scrim').hidden = false;
  requestAnimationFrame(() => ($(id).querySelector<HTMLElement>('button:not([hidden]):not(:disabled)') || $(id)).focus());
}
function closeSheet(id: string): void {
  if ($(id).hidden) return;
  $(id).hidden = true;
  if (sheets.every(sheet => $(sheet).hidden)) $('sheet-scrim').hidden = true;
}
const closeAll = () => {for (const id of sheets) closeSheet(id); diffRow = undefined;};
function openDiff(row: PlanRow, tab?: typeof diffTab): void {
  diffRow = row;
  $('diff-title').textContent = row.source ? `${row.source} → ${row.path}` : row.path;
  showDiffTab(row.status === 'create' || row.base === undefined ? 'remote' : tab ?? diffTab);
  // A change made only in the store goes to the project when the user asks: written into the
  // remembered project folder, or copied to paste by hand.
  const storeOnly = row.status === 'remote-only' && !row.image && typeof row.remote === 'string';
  $('diff-write-store').hidden = !(storeOnly && projectFolder());
  $('diff-copy-store').hidden = !storeOnly;
  $('diff-copy-store').classList.toggle('primary', $('diff-write-store').hidden);
  $('diff-copy-store').textContent = $('diff-write-store').hidden ? 'Copiar a versão da loja' : 'Copiar';
  $('diff-use-project').hidden = !(row.status === 'conflict' && !row.image && writable(row.path));
  $('diff-keep-store').hidden = !row.override;
  openSheet('diff');
}
function showDiffTab(tab: typeof diffTab): void {
  diffTab = tab;
  const tabs = {remote: 'diff-tab-remote', base: 'diff-tab-base', store: 'diff-tab-store'} as const;
  for (const [key, id] of Object.entries(tabs)) $(id).setAttribute('aria-selected', String(key === tab));
  ($('diff').querySelector('.switch') as HTMLElement).style.setProperty('--index', String(Object.keys(tabs).indexOf(tab)));
  const row = diffRow; if (!row) return;
  if (row.image) {
    const size = (bytes?: Uint8Array) => bytes ? `${(bytes.length / 1024).toFixed(1).replace('.', ',')} KB` : 'ausente';
    $('diff-stats').textContent = `Imagem. Original: ${size(row.image.base)}. Projeto: ${size(row.image.local)}. Loja: ${size(row.image.remote)}.`;
    $('diff-body').replaceChildren(el('p', {class: 'diff-empty', text: 'Imagens são comparadas pelos bytes. A Yampi não substitui uma imagem existente: uma versão nova precisa de outro nome.'}));
    return;
  }
  if (row.assumed && tab !== 'base') {
    $('diff-stats').textContent = 'A versão da loja não foi relida: o projeto não altera este arquivo.';
    $('diff-body').replaceChildren(el('p', {class: 'diff-empty', text: 'Segure Alt ao clicar em “Comparar de novo” para reler todos os arquivos da loja.'}));
    return;
  }
  const pairs = {remote: [row.remote, row.local, 'Loja', 'Projeto'], base: [row.base, row.local, 'Original', 'Projeto'], store: [row.base, row.remote, 'Original', 'Loja']} as const;
  const [before, after, a, b] = pairs[tab];
  renderDiff($('diff-body'), $('diff-stats'), before, after, {before: a, after: b});
}
$('diff-tab-remote').addEventListener('click', () => showDiffTab('remote'));
$('diff-tab-base').addEventListener('click', () => showDiffTab('base'));
$('diff-tab-store').addEventListener('click', () => showDiffTab('store'));
$('close-diff').addEventListener('click', () => {closeSheet('diff'); diffRow = undefined;});
// Explicit, per file, with both versions on screen; the store's version stays in the backup.
$('diff-use-project').addEventListener('click', () => {if (diffRow) {setOverride(diffRow, true); toast('A versão do projeto será enviada. A da loja fica no backup.');}});
$('diff-keep-store').addEventListener('click', () => {if (diffRow) {setOverride(diffRow, false); toast('A versão da loja será mantida.');}});
$('diff-write-store').addEventListener('click', () => {
  const row = diffRow, folder = projectFolder(), expected = workspace?.project?.local[row?.path ?? ''];
  if (!row || !folder || typeof row.remote !== 'string') return;
  // Chrome asks for write access during this click; the store text is written only after it.
  const allowed = permitted(folder, true, 'readwrite'), text = row.remote;
  closeSheet('diff'); diffRow = undefined;
  void run(`Trazendo ${row.path} da loja`, async () => {
    if (!await allowed) throw new Error('O Chrome não liberou a escrita na pasta. Abra a comparação e use “Copiar a versão da loja”.');
    if (expected === undefined) throw new Error(`tema/${row.path} não está no projeto lido. Compare de novo.`);
    await replaceThemeFile(folder, row.path, expected, text);
    toast(`tema/${row.path} agora tem a versão da loja.`, 5000);
    await readFolder(folder);
  });
});
$('diff-copy-store').addEventListener('click', () => {
  const row = diffRow; if (!row || typeof row.remote !== 'string') return;
  void copyText(row.remote).then(copied => toast(copied ? `Versão da loja copiada. Cole em tema/${row.path} e compare de novo.` : 'O Chrome não deixou copiar. Abra o arquivo no editor da Yampi e copie de lá.', 7000));
});
$('sheet-scrim').addEventListener('click', closeAll);
document.addEventListener('keydown', event => {if (event.key === 'Escape') closeAll();});
$('menu').addEventListener('click', () => {updateHistory(); journalInfo(); controls(); openSheet('menu-sheet');});
$('close-menu').addEventListener('click', () => closeSheet('menu-sheet'));
// --- Jobs -------------------------------------------------------------------------------------------
const newId = () => crypto.randomUUID();
// The job's first state shows at once; the runner's reports replace it.
async function startJob(request: JobRequest): Promise<void> {
  if (!context) throw new Error('Conecte ao editor de código da Yampi.');
  job = startingState(request, context); liveJob = request.id; notice = undefined;
  render();
  try {await client.start(request, context);}
  catch (error) {job = undefined; liveJob = ''; throw error;}
}
function onJob(state: JobState | undefined): void {
  if (!state) {if (!active(job)) {job = undefined; render();} return;}
  if (job && state.id !== job.id && active(job) && state.updatedAt < job.updatedAt) return;
  const finishing = !active(state) && handled !== state.id;
  if (state.id === liveJob || active(state)) liveJob = state.id;
  job = state;
  if (finishing && state.id === liveJob) {
    handled = state.id; settling = true;
    render();
    void loadStoreData().finally(() => {
      settling = false;
      // A finished comparison opens the review; everything else shows its result.
      if (state.kind === 'compare' && state.status === 'completed') {route = 'send'; dismissJob();}
      render();
      if (state.status === 'completed' && state.kind === 'send') toast(state.scope === 'restore' ? 'Restauração concluída e conferida.' : 'Envio concluído e conferido na Yampi.');
    });
    return;
  }
  render();
}
$('cancel').addEventListener('click', () => {
  if (busy && controller) {controller.abort(); return;}
  if (!active(job)) return;
  cancelled = job!.id; controls();
  void client.cancel().catch(error => toast(error instanceof Error ? error.message : String(error)));
  toast('Interrompendo depois do item atual.');
});
// --- Export -----------------------------------------------------------------------------------------
function requestScopes(origins: string[]): Promise<boolean> {
  if (isDemo) return Promise.resolve(false);
  return chrome.permissions.request({origins: origins.map(origin => publicUrl(origin, origin).replace(/\/$/, '') + '/*')}).catch(() => false);
}
$('export').addEventListener('click', () => {
  // The permission prompt needs this click: ask before anything else.
  const permission = $<HTMLInputElement>('include-preview').checked && context ? requestScopes([context.previewOrigin]) : Promise.resolve(false);
  void run('Preparando o download', async () => {await startJob({id: newId(), kind: 'export', includePreview: await permission});});
});
$('preview-allow').addEventListener('click', () => {
  const origins = job?.waiting?.origins || [];
  const permission = requestScopes(origins);
  void (async () => {
    if (!await permission) {toast('Permissão não concedida. Você pode baixar sem esses recursos.'); return;}
    await client.decide({action: 'allow', origins});
  })().catch(error => toast(error instanceof Error ? error.message : String(error)));
});
$('preview-partial').addEventListener('click', () => void client.decide({action: 'partial'}).catch(() => {}));
$('preview-discard').addEventListener('click', () => void client.decide({action: 'discard'}).catch(() => {}));
$('show-file').addEventListener('click', () => {
  // The ZIP the export just saved, in the system's file manager.
  const name = job?.result?.kind === 'export' ? job.result.fileName : '';
  void chrome.downloads.search({orderBy: ['-startTime'], limit: 20}).then(items => {
    const item = items.find(entry => entry.filename.replace(/\\/g, '/').split('/').pop()?.startsWith(name.replace(/\.zip$/, '')));
    if (item) chrome.downloads.show(item.id); else chrome.downloads.showDefaultFolder();
  });
});
// --- Project folder ---------------------------------------------------------------------------------
async function adoptProject(project: Project | {local: Files; localAssets: Assets}, source: {name: string; kind: 'folder' | 'zip' | 'demo'}, full = false): Promise<void> {
  let target = context;
  if ('baseline' in project) {
    if (connected && context) assertContext(project.baseline.context, context);
    target = project.baseline.context;
  } else if (!workspace?.baseline) throw new Error('Esta pasta não tem a exportação original (.yampi-sync/). Escolha a pasta extraída do ZIP baixado pela extensão, ou baixe o tema antes.');
  if (!target) throw new Error('Conecte ao editor para carregar este projeto.');
  const chosen = 'baseline' in project ? chooseBaseline(workspace, project.baseline) : undefined;
  workspace = await updateWorkspace(target, value => {
    if (chosen) {value.baseline = chosen.baseline; value.lineage = chosen.lineage;}
    value.project = {local: project.local, localAssets: project.localAssets, name: source.name, kind: source.kind, loadedAt: new Date().toISOString()};
    value.review = {overrides: []}; delete value.restore;
  });
  if (chosen?.advanced) toast('Os arquivos já enviados não voltam como conflito.');
  restoreJournal = undefined; computePlan(); route = 'send';
  if (connected) await compare(full);
}
async function compare(full = false): Promise<void> {
  const base = workspace?.baseline, project = workspace?.project;
  if (!base || !project) throw new Error('Carregue a exportação original e a pasta editada.');
  closeSheet('confirm-panel');
  await startJob({id: newId(), kind: 'compare', scope: 'project', paths: changedPaths(base, project.local, project.localAssets), ...(full ? {full: true} : {})});
}
async function readFolder(folder: Folder, full = false): Promise<void> {
  busyTitle = `Lendo “${folder.name}”`; render();
  const {name, entries} = await folderEntries(folder, controller?.signal);
  const project = await readProjectEntries(entries, (done, total) => {if (controller?.signal.aborted) throw new Error('Leitura da pasta cancelada.'); progressLocal(done, total);});
  if (context) await rememberFolder('baseline' in project ? project.baseline.context : context, folder, name).catch(() => {});
  remembered = {folder, name, savedAt: new Date().toISOString()};
  await adoptProject(project, {name, kind: 'folder'}, full);
}
function chooseFolder(): void {
  if (!canPickFolders()) {$('folder').click(); return;}
  void run('Escolhendo a pasta', async () => {
    const folder = await pickFolder().catch(error => {
      // Without folder access for extension pages, the regular file input takes over.
      if (error instanceof DOMException && ['SecurityError', 'NotAllowedError'].includes(error.name)) {$('folder').click(); return undefined;}
      throw error;
    });
    if (folder) await readFolder(folder);
  });
}
$('pick-folder').addEventListener('click', chooseFolder);
$('pick-other').addEventListener('click', chooseFolder);
$('reload-folder').addEventListener('click', () => {
  const folder = remembered?.folder;
  if (!folder) return;
  // The permission prompt needs this click.
  const allowed = permitted(folder, true);
  void run(`Lendo “${folder.name}”`, async () => {
    if (!await allowed) throw new Error('O Chrome não liberou a leitura da pasta. Escolha a pasta de novo.');
    await readFolder(folder);
  });
});
$('folder').addEventListener('change', () => void run('Lendo a pasta do projeto', async () => {
  const files = $<HTMLInputElement>('folder').files; if (!files?.length) return;
  const name = files[0].webkitRelativePath.split('/')[0] || 'Pasta do projeto';
  const project = await readProjectDirectory(files, progressLocal);
  $<HTMLInputElement>('folder').value = '';
  await adoptProject(project, {name, kind: 'folder'});
}));
async function readZip(file: File): Promise<void> {
  if (file.size > MAX_TOTAL_BYTES * 2 + MAX_FILE_BYTES) throw new Error('ZIP muito grande.');
  await adoptProject(await decodeProject(new Uint8Array(await file.arrayBuffer())), {name: file.name, kind: 'zip'});
}
$('baseline').addEventListener('change', () => void run('Conferindo o ZIP', async () => {
  const file = $<HTMLInputElement>('baseline').files?.[0]; if (!file) return;
  $<HTMLInputElement>('baseline').value = '';
  await readZip(file);
}));
// The whole screen takes a dropped folder or ZIP while choosing or reviewing the project.
const dropzone = $('dropzone');
const dropTarget = () => dropzone.hidden ? $('project-card') : dropzone;
const accepts = () => ['pick', 'review', 'home'].includes(currentView());
for (const type of ['dragenter', 'dragover']) document.addEventListener(type, event => {if (!accepts()) return; event.preventDefault(); if (!busy) dropTarget().classList.add('dragging');});
document.addEventListener('dragleave', event => {if (!(event as DragEvent).relatedTarget) dropTarget().classList.remove('dragging');});
document.addEventListener('drop', event => {
  if (!accepts()) return;
  event.preventDefault(); dropTarget().classList.remove('dragging');
  if (busy || active(job)) return;
  const item = droppedItem(event);
  void run('Lendo o projeto', async () => {
    const dropped = await item;
    if (!dropped) throw new Error('Solte a pasta do projeto ou o ZIP de retorno.');
    if (dropped instanceof File) {
      if (!/\.zip$/i.test(dropped.name)) throw new Error('Solte a pasta do projeto ou um ZIP exportado pela extensão.');
      await readZip(dropped);
    } else await readFolder(dropped);
  });
});
// Alt + click reads every file of the store, not only the ones the project changes. A project read
// from the remembered folder is read again first, so a file fixed there since then counts.
// The remembered folder, when the project on screen was read from it.
function projectFolder(): Folder | undefined {
  const project = workspace?.project;
  return remembered && project?.kind === 'folder' && project.name === remembered.name ? remembered.folder : undefined;
}
$('compare').addEventListener('click', event => {
  const full = (event as MouseEvent).altKey, folder = projectFolder();
  const again = folder ? permitted(folder, true) : null;
  void run('Preparando a comparação', async () => {
    if (folder && again && await again) return readFolder(folder, full);
    if (again) toast('Sem acesso à pasta: comparado com a leitura anterior.');
    await compare(full);
  });
});
// --- Send -------------------------------------------------------------------------------------------
$('apply').addEventListener('click', () => {
  if (!plan || !selected.size || busy) return;
  const rows = plan.rows.filter(row => selected.has(row.path));
  const created = rows.filter(r => r.status === 'create').length, images = rows.filter(r => r.status === 'upload').length, texts = rows.length - images;
  $('target-store').textContent = plan.context.storeName;
  $('confirm-counts').textContent = `${list([texts ? `${plural(texts, 'arquivo', 'arquivos')}${created ? ` (${created} ${created === 1 ? 'novo' : 'novos'})` : ''}` : '', images ? plural(images, 'imagem nova', 'imagens novas') : ''])}.`;
  openSheet('confirm-panel');
});
$('cancel-send').addEventListener('click', () => {closeSheet('confirm-panel'); $('apply').focus();});
$('confirm-send').addEventListener('click', () => {
  if (!plan) return;
  const current = plan, chosen = [...selected], sendScope = scope, journalId = restoreJournal?.id;
  closeSheet('confirm-panel');
  void run('Preparando o envio', async () => {
    const id = newId();
    await put(`jobinput:${id}`, {plan: current, selected: chosen, scope: sendScope, ...(sendScope === 'restore' && journalId ? {journalId} : {})} satisfies SendInput);
    // The comparison is used up: another send always starts from a new one.
    plan = undefined;
    await startJob({id, kind: 'send', scope: sendScope, ...(sendScope === 'restore' && journalId ? {journalId} : {})});
  });
});
$('resume').addEventListener('click', () => {
  const previous = resumable; if (!previous) return;
  void run('Retomando o envio', async () => {resumable = undefined; await startJob({id: newId(), kind: 'send', resume: previous.id, ...(previous.scope ? {scope: previous.scope} : {})});});
});
$('open-preview').addEventListener('click', () => {
  const url = previewUrl(); if (!url) return;
  if (isDemo) window.open(url, '_blank', 'noopener'); else void chrome.tabs.create({url});
});
// --- History and recovery ---------------------------------------------------------------------------
function journalInfo(): void {
  $('journal-info').textContent = journal ? `${journal.verified.length + (journal.uploaded?.length || 0)} de ${journal.selected.length} itens conferidos. ${journal.status === 'completed' ? 'Concluído' : 'Interrompido'} em ${dateTime(journal.startedAt)}.${journal.scope === 'restore' ? ' Foi uma restauração.' : ''}` : 'Nenhum envio nesta instalação.';
}
function updateHistory(): void {
  const picker = $<HTMLSelectElement>('history'); picker.replaceChildren();
  for (const item of history) picker.append(el('option', {text: `${dateTime(item.startedAt)} — ${item.status === 'completed' ? 'concluído' : 'interrompido'}`, attrs: {value: item.id}}));
  if (journal) picker.value = journal.id;
}
$('history').addEventListener('change', () => {journal = history.find(j => j.id === $<HTMLSelectElement>('history').value); journalInfo(); controls();});
async function save(bytes: Uint8Array, name: string, type = 'application/zip'): Promise<void> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type}));
  try {
    if (isDemo) {
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      return;
    }
    const id = await chrome.downloads.download({url, filename: name, saveAs: false, conflictAction: 'uniquify'});
    const start = Date.now();
    for (;;) {
      const [item] = await chrome.downloads.search({id});
      if (item?.state === 'complete') break;
      if (item?.state === 'interrupted') throw new Error('Download cancelado ou interrompido.');
      if (Date.now() - start > 120000) throw new Error('O download não foi confirmado.');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } finally {URL.revokeObjectURL(url);}
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
$('download-backup').addEventListener('click', () => {
  closeSheet('menu-sheet');
  void run('Baixando o backup', async () => {
    const stored = await get<{journalId: string; bytes: Uint8Array}>(`backup:${journal?.id}`);
    if (!stored || stored.journalId !== journal?.id) throw new Error('O backup deste envio não foi concluído. Use o registro ou a exportação original.');
    await save(stored.bytes, `backup-${stamp()}.zip`); toast('Backup baixado.');
  });
});
$('download-journal').addEventListener('click', () => {
  closeSheet('menu-sheet');
  void run('Baixando o registro', async () => {
    if (!journal) throw new Error('Escolha um envio no histórico.');
    await save(new TextEncoder().encode(JSON.stringify(journal, null, 2)), `registro-${journal.id}.json`, 'application/json');
    toast('Registro baixado. Guarde fora do repositório.');
  });
});
// Undo is a new comparison from the send record: the sent version becomes the original, the previous one the project.
async function prepareRestore(entry: Journal): Promise<void> {
  if (!context) throw new Error('Conecte ao editor.');
  workspace = await updateWorkspace(context, value => {value.restore = {journalId: entry.id, overrides: []};});
  restoreJournal = entry; route = 'send';
  await startJob({id: newId(), kind: 'compare', scope: 'restore', journalId: entry.id, paths: [...new Set([...Object.keys(entry.before), ...Object.keys(entry.after)])].sort()});
}
$('restore').addEventListener('click', () => {const entry = journal; closeSheet('menu-sheet'); if (entry) void run('Preparando a restauração', () => prepareRestore(entry));});
$('undo').addEventListener('click', () => {
  const id = job?.result?.kind === 'send' ? job.result.journalId : undefined;
  const entry = history.find(item => item.id === id) || journal;
  if (entry) {dismissJob(); void run('Preparando a restauração', () => prepareRestore(entry));}
});
$('clear').addEventListener('click', async () => {
  if (!confirm('Apagar as cópias originais, o projeto carregado e os backups guardados nesta extensão? Os ZIPs já baixados continuam no computador. Nada muda na loja.')) return;
  closeSheet('menu-sheet');
  await clearLocal(); workspace = undefined; plan = undefined; journal = undefined; history = []; resumable = undefined; remembered = undefined; restoreJournal = undefined; selected.clear();
  route = 'home'; toast('Dados locais apagados.'); render();
});
// --- Demo -------------------------------------------------------------------------------------------
if (isDemo) $('demo-local').addEventListener('click', () => void run('Carregando as alterações fictícias', async () => {
  const base = workspace?.baseline;
  if (!base) throw new Error('Baixe o tema da loja fictícia primeiro.');
  const sample = {...base.files};
  sample['elements/head.twig'] += '<!-- Redesign local -->\n';
  sample['sections/home/main_banner.twig'] += '<!-- Banner revisado -->\n';
  sample['templates/home.twig'] += '<!-- Página inicial revisada -->\n';
  sample['assets/styles/global/main.scss'] += 'body { background: white; }\n';
  sample['assets/images/readme.md'] += 'Mudança não suportada\n';
  sample['templates/new.twig'] = '<p>Novo</p>\n<img src="{{ \'images/demo/nova.png\' | assets_url }}" alt="">\n';
  const assets: Assets = {...base.assets, 'assets/images/demo/nova.png': base.assets?.['assets/images/example.png'] || new Uint8Array()};
  await adoptProject({baseline: base, local: sample, localAssets: assets}, {name: 'Alterações fictícias', kind: 'demo'});
}));
// --- Connection -------------------------------------------------------------------------------------
async function connect(): Promise<void> {
  if (busy) return;
  connected = false; offline = undefined; $('connection-state').textContent = 'Conectando';
  busy = true; busyTitle = 'Conectando ao editor…'; render();
  try {
    if (connection) await connection.connect();
    const current = await client.state();
    if (active(current)) {
      // An operation is running in the background: watch it without touching the editor.
      context = current!.context; job = current; liveJob = current!.id;
    } else {
      await rpc({action: 'lock', access: 'read'});
      try {context = await adapter.context();} finally {await rpc({action: 'unlock'}).catch(() => {});}
      // A result not dismissed yet (it may have finished while the panel was closed) is shown.
      job = current; if (current) {handled = current.id; liveJob = current.kind === 'compare' ? '' : current.id;}
    }
    connected = true; $('connection-state').textContent = 'Editor conectado';
    await loadStoreData();
    if (plan) route = 'send';
  } catch (error) {
    offline = {title: 'Não foi possível conectar', text: error instanceof Error ? error.message : String(error)};
  } finally {busy = false; render();}
}
$('retry').addEventListener('click', () => void connect());
if (!isDemo && editorTab) chrome.runtime.onMessage.addListener(incoming => {
  // A click on the toolbar icon inside the editor means: download the theme.
  if (incoming?.editorClicked !== connection?.token || busy || active(job)) return;
  if (!connected) void connect(); else go('export');
});
render();
if (isDemo || editorTab) await connect();
else {offline = {title: 'Abra pelo ícone da extensão', text: 'No editor de código da Yampi, clique no ícone da extensão.'}; render();}
