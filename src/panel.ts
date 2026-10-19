import {preparePreview, finishPreview, unauthorizedOrigins} from './browser/preview-capture';
import {publicUrl} from './core/preview';
import {BrowserAdapter, type RPC} from './browser/adapter';
import {PanelConnection} from './browser/panel-connection';
import {zipInWorker} from './browser/zip-client';
import {decodeProject, readProjectDirectory, readProjectEntries, type Project} from './core/archive';
import {makePlan, missingNewTexts, selectionIssues, sendable, IMAGES_OFF} from './core/planner';
import {changedPaths, remoteFromCapture} from './core/compare';
import {explainBlock} from './core/explain';
import {formatDuration} from './core/progress';
import {chooseBaseline, type Review, type Workspace} from './core/workspace';
import {CHOICES, applyUpdate, folderChange, planUpdate, type Resolution, type UpdateKind, type UpdatePlan, type UpdateRow} from './core/update';
import {listVersions, restoreVersion, saveVersion, versionChanges, versionFiles, type Version, type VersionChange} from './core/versions';
import {writeReference} from './core/reference';
import type {ProjectFolder} from './core/project-folder';
import {COMPONENTS_FILE} from '../local-runtime/contract.mjs';
import {assertContext, sameContext, writable, MAX_TOTAL_BYTES, MAX_FILE_BYTES, type Context, type Assets, type Files, type Plan, type PlanRow, type Journal, type Snapshot} from './core/model';
import {get, put, clearLocal, journalHistory, loadWorkspace, updateWorkspace} from './storage';
import {startingState} from './jobs/engine';
import {active, type JobRequest, type JobState, type Scope, type SendInput} from './jobs/types';
import {ExtensionJobs, LocalJobs, type JobClient} from './panel/client';
import {canPickFolders, droppedItem, folderEntries, openProject, permitted, pickFolder, recallFolder, rememberFolder, replaceThemeFile, type Folder, type Remembered} from './panel/folder';
import {renderDiff} from './panel/diff-view';
import {HistoryPicker} from './panel/history-picker';
import {trackTruncatedLabel} from './panel/truncated-label';
import {$, el, glyph, list, plural, dateTime, since, enter, toast, copyText} from './panel/dom';
const isDemo = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('demo') === '1';
const editorTab = new URLSearchParams(location.search).get('tab');
trackTruncatedLabel($('store'));
trackTruncatedLabel($('connection-state'));
// --- State ------------------------------------------------------------------------------------
// One screen at a time. The route is where the user chose to go; the view shown also depends on
// what is happening (connecting, an operation running, its result).
type Route = 'export' | 'send';
type View = 'connecting' | 'offline' | 'export' | 'pick' | 'review' | 'update' | 'job' | 'result';
let route: Route = 'export';
let rpc: RPC;
let connection: PanelConnection | undefined;
let client: JobClient;
let connected = false, context: Context | undefined;
let offline: {title: string; text: string} | undefined;
// tone ok: a confirmation (green), otherwise a problem to fix (red).
let notice: {title: string; text: string; tone?: 'ok'} | undefined;
let busy = false, busyTitle = '', controller: AbortController | undefined;
let localProgress: {done: number; total: number} | undefined;
let workspace: Workspace | undefined, plan: Plan | undefined, scope: Scope = 'project', restoreJournal: Journal | undefined;
const selected = new Set<string>();
// liveJob: the operation whose screen is shown (running, or finished and not yet dismissed).
let job: JobState | undefined, liveJob = '', settling = false, handled = '', cancelled = '';
let history: Journal[] = [], journal: Journal | undefined, resumable: Journal | undefined;
let remembered: Remembered | undefined;
let diffRow: PlanRow | undefined, diffTab: 'remote' | 'base' | 'store' = 'remote';
// The update of the project folder under review, and the versions sheet: the folder's versions,
// the texts of the folder as read when it opened, and the version open in it.
let updatePlan: UpdatePlan | undefined;
let versions: {list: Version[]; skipped: string[]; current: Files; open?: {version: Version; saved: Files; changes: VersionChange[]}} | undefined;
// The diff sheet also shows an update row or a file of a version.
let diffUpdate: UpdateRow | undefined, diffVersion: {path: string; saved?: string; current?: string} | undefined;
let lastAnnounced = '', lastView = '';
const historyPicker = new HistoryPicker($('history-picker'), value => {
  const entry = history.find(item => item.id === value);
  if (!entry) return;
  journal = entry; journalInfo(); controls();
});
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
document.addEventListener('keydown', () => {document.body.dataset.input = 'keyboard';});
document.addEventListener('pointerdown', () => {delete document.body.dataset.input;});
// --- Which screen -------------------------------------------------------------------------------
function currentView(): View {
  if (!connected) return busy || !offline ? 'connecting' : 'offline';
  if (busy || active(job) || settling) return 'job';
  if (job && job.id === liveJob && !(job.kind === 'compare' && job.status === 'completed')) return 'result';
  if (route === 'export') return 'export';
  if (route === 'send') return updatePlan ? 'update' : plan ? 'review' : 'pick';
  return 'export';
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
  if (view === 'export') return {title: 'Baixar arquivos', detail: `Copie o código de ${store} em ZIP, edite no computador e depois envie as alterações que escolher.`};
  if (view === 'pick') return workspace?.project ? {title: 'Comparar com a loja', detail: 'Releia a pasta depois de editar, ou escolha outra. Você revisa a comparação antes de confirmar o envio.'} : {title: 'Importar projeto', detail: 'Escolha a pasta do projeto editado. A extensão compara com a loja antes de você selecionar os arquivos e confirmar o envio.'};
  if (view === 'review') return reviewHead();
  if (view === 'update') return updateHead();
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
function updateHead(): Head {
  const rows = updatePlan!.rows, decide = rows.filter(row => CHOICES[row.kind]).length, changes = rows.filter(row => folderChange(row)).length;
  const detail = `Loja lida ${since(updatePlan!.remote.capturedAt)}. Nada foi gravado na pasta ainda.`;
  if (decide) return {title: `${plural(decide, 'arquivo para decidir', 'arquivos para decidir')} antes de atualizar`, detail};
  return {title: changes ? `Atualizar a pasta: ${plural(changes, 'mudança da loja', 'mudanças da loja')}` : 'A pasta já tem tudo o que a loja mudou', detail};
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
  const noun = state.kind === 'export' ? 'Download' : state.kind === 'compare' ? (state.scope === 'update' ? 'Leitura da loja' : 'Comparação') : restore ? 'Restauração' : 'Envio';
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
  $('notice').dataset.tone = notice?.tone || '';
  $('notice').setAttribute('role', notice?.tone === 'ok' ? 'status' : 'alert');
  $('export-section').hidden = view !== 'export';
  $('import-section').hidden = view !== 'pick';
  $('review').hidden = view !== 'review';
  $('update-view').hidden = view !== 'update';
  $('view-job').hidden = view !== 'job';
  $('done').hidden = view !== 'result';
  const storeName = connected && context ? context.storeName : view === 'offline' ? 'Editor indisponível' : 'Conectando…';
  if ($('store').textContent !== storeName) $('store').textContent = storeName;
  const connectionText = connected ? view === 'job' ? 'Editor conectado · operação em andamento' : 'Editor conectado' : view === 'offline' ? 'Editor desconectado' : 'Conectando ao editor…';
  if ($('connection-state').textContent !== connectionText) $('connection-state').textContent = connectionText;
  const activeRoute = job && job.id === liveJob && ['job', 'result'].includes(view) ? job.kind === 'export' ? 'export' : 'send' : route;
  for (const [name, id] of [['export', 'mode-export'], ['send', 'mode-import']]) {
    $(id).setAttribute('aria-selected', String(activeRoute === name));
    $(id).tabIndex = activeRoute === name ? 0 : -1;
  }
  $('operation-panel').setAttribute('aria-labelledby', activeRoute === 'export' ? 'mode-export' : 'mode-import');
  $('recovery-store').textContent = context ? `Loja: ${context.storeName}.` : 'Conecte ao editor para carregar o histórico da loja.';
  document.body.dataset.connection = !connected ? (view === 'offline' ? 'error' : 'idle') : view === 'job' ? 'busy' : 'connected';
  // The project card is also read by the review and the tests; keep it current on every screen.
  renderPick();
  renderHistorySummary(view);
  if (view === 'export') renderExport();
  if (view === 'review') renderPlan();
  if (view === 'update') renderUpdate();
  if (view === 'job') renderJob();
  if (view === 'result') renderResult();
  renderProjectTools(view);
  renderDock(view);
  controls();
  // Screen readers hear the screen changing and phase changes, not every percent.
  const spoken = view === 'job' && job && !busy ? `${job.id}:${job.status}:${job.phases.find(p => p.status === 'active')?.id || ''}` : `${view}:${info.title}`;
  if (spoken !== lastAnnounced) {lastAnnounced = spoken; $('announcer').textContent = `${info.title}. ${info.detail}`;}
  if (view !== lastView) {
    // A new screen starts at the top, with focus on its title for keyboard and reader users.
    if (lastView) {
      window.scrollTo({top: 0});
      if (document.body.dataset.input === 'keyboard' && !document.activeElement?.closest('.operation-tabs')) $('status').focus({preventScroll: true});
      const section = {export: 'export-section', pick: 'import-section', review: 'review', update: 'update-view', job: 'view-job', result: 'done'}[view as string];
      enter(document.querySelector<HTMLElement>('.view-head')!, ...(section ? [$(section)] : []));
    }
    lastView = view;
  }
}
function renderHistorySummary(view: View): void {
  $('resume-card').hidden = !resumable;
  if (resumable) $('resume-text').textContent = `Parou em ${resumable.verified.length + (resumable.uploaded?.length || 0)} de ${resumable.selected.length} itens${resumable.error ? `: ${resumable.error}` : '.'} O que já foi conferido continua na loja.`;
  const last = history.find(item => item.status === 'completed');
  $('resume-area').hidden = !connected || view === 'job' || (!resumable && !last);
  $('last-send').hidden = !last || !!resumable;
  if (last) $('last-send').textContent = `Último envio em ${dateTime(last.startedAt)}: ${plural(last.verified.length + (last.uploaded?.length || 0), 'item conferido', 'itens conferidos')}. Consulte o histórico no menu ⋯.`;
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
  $('reference-info').textContent = workspace?.baseline ? `Referência: loja em ${dateTime(lineage?.exportedAt || workspace.baseline.capturedAt)}${lineage?.journals.length ? `, com ${plural(lineage.journals.length, 'envio', 'envios')} desde então` : ''}.${interruptedReference ? ' A última atualização parou no meio: use Atualizar da loja para concluir.' : ''}` : 'Falta a exportação original: escolha a pasta com .yampi-sync/.';
  if (project.kind === 'zip') $('zip-name').textContent = project.name;
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
// --- Actions stay beside the content of their current step -----------------------------------------
function renderDock(view: View): void {
  const show: string[] = [];
  if (view === 'offline') show.push('retry');
  if (['export', 'pick', 'review'].includes(view) && resumable) show.push('resume');
  if (view === 'export') show.push('export');
  if (view === 'pick') show.push(...(remembered && canPickFolders() ? ['reload-folder', 'pick-folder'] : ['pick-folder']));
  if (view === 'review') show.push('apply');
  if (view === 'update') show.push('apply-update', 'cancel-update');
  // While waiting for the user's choice, the choices are on screen; "stop" would only repeat them.
  if (view === 'job' && (busy ? !!controller : job?.status === 'running')) show.push('cancel');
  if (view === 'result' && job) {
    if (job.status === 'completed' && job.result?.kind === 'send' && previewUrl()) show.push('open-preview');
    if (job.status === 'completed' && job.result?.kind === 'export' && !isDemo) show.push('show-file');
    if (job.kind === 'send' && job.status !== 'completed' && resumable) show.push('resume');
    show.push('finish');
  }
  for (const id of ['retry', 'export', 'reload-folder', 'pick-folder', 'apply', 'apply-update', 'cancel-update', 'resume', 'open-preview', 'show-file', 'cancel', 'finish']) $(id).hidden = !show.includes(id);
  // "Choose a folder" is the main action unless the last folder can simply be read again.
  $('pick-folder').classList.toggle('primary', !show.includes('reload-folder'));
  $('pick-folder').textContent = show.includes('reload-folder') ? 'Outra' : 'Escolher a pasta';
  $('finish').textContent = job && job.status === 'completed' ? 'Concluir' : 'Voltar';
  $('finish').classList.toggle('primary', show.length === 1);
  $('resume').classList.toggle('primary', view === 'result');
  $('dock').hidden = !show.length;
  $('dock').dataset.count = String(show.length);
  const slot = {export: 'export-actions', pick: 'pick-actions', review: 'review-actions', update: 'update-actions', job: 'job-actions', result: 'result-actions'}[view as string] || 'connection-actions';
  if ($('dock').parentElement !== $(slot)) $(slot).append($('dock'));
}
// "Atualizar da loja" and "Versões" stay with the project, on the screen that shows it. Both write
// to the project folder, so a project read from a ZIP only explains how to get them.
function renderProjectTools(view: View): void {
  const tools = $('project-tools'), project = workspace?.project;
  tools.hidden = !project || !['pick', 'review'].includes(view) || scope === 'restore';
  if (tools.hidden) return;
  const slot = view === 'review' ? 'review-tools' : 'pick-tools';
  if (tools.parentElement !== $(slot)) $(slot).append(tools);
  $('project-tools-note').hidden = !!projectFolder();
}
// --- Controls -------------------------------------------------------------------------------------
function controls(): void {
  const working = busy || active(job) || settling;
  $('export').toggleAttribute('disabled', working || !connected);
  $('include-preview').toggleAttribute('disabled', working);
  for (const id of ['preview-allow', 'preview-partial', 'preview-discard']) $(id).toggleAttribute('disabled', busy);
  for (const id of ['pick-folder', 'pick-other', 'reload-folder', 'folder', 'baseline', 'clear', 'demo-local', 'mode-import', 'mode-export', 'go-import']) $(id).toggleAttribute('disabled', working);
  historyPicker.setDisabled(working);
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
  // The update reads the store; applying it and the versions only touch the project folder.
  const folderReady = !!projectFolder() && !!workspace?.baseline;
  $('update-project').toggleAttribute('disabled', working || !connected || !folderReady);
  $('open-versions').toggleAttribute('disabled', working || !folderReady);
  $('apply-update').toggleAttribute('disabled', working || !updatePlan || !projectFolder());
  for (const id of ['cancel-update', 'send-images', 'save-version', 'version-name', 'restore-all', 'diff-restore', 'diff-choose-marks', 'diff-choose-mine', 'diff-choose-store']) $(id).toggleAttribute('disabled', working);
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
$('go-import').addEventListener('click', () => go('send'));
document.querySelector('.operation-tabs')!.addEventListener('keydown', event => {
  const key = (event as KeyboardEvent).key;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
  const current = event.target as HTMLButtonElement;
  if (current.disabled) return;
  event.preventDefault();
  const id = key === 'Home' ? 'mode-export' : key === 'End' ? 'mode-import' : current.id === 'mode-export' ? 'mode-import' : 'mode-export';
  $<HTMLButtonElement>(id).focus(); $<HTMLButtonElement>(id).click();
});
$('finish').addEventListener('click', () => go(job?.kind === 'send' && job.status !== 'completed' ? 'send' : 'export'));
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
  computePlan(); computeUpdate();
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
    // New images go only when the user turned them on for this send.
    plan = makePlan(base, local, remote, assets, {overrides: current!.overrides, assumed, inventory: reading.inventory, uploads: !!current!.images});
  } catch (error) {notice = {title: 'A comparação não vale mais', text: error instanceof Error ? error.message : String(error)}; return;}
  const discarded = new Set(current!.discarded || []);
  for (const row of plan.rows) if (row.status === 'update' && row.whitespaceOnly && discarded.has(row.path)) row.status = 'whitespace-only';
  // Whitespace-only differences start unselected; coupled files start together.
  const chosen = current!.selected ? new Set(current!.selected) : undefined;
  for (const row of plan.rows) if (sendable(row) && (chosen ? chosen.has(row.path) : !row.whitespaceOnly)) selected.add(row.path);
}
// The update under review: the reference, the folder as last read, the full reading of the store
// and the choices made so far. Nothing is written until the user applies it.
function computeUpdate(): void {
  updatePlan = undefined;
  const reading = workspace?.update?.reading, base = workspace?.baseline, project = workspace?.project;
  if (!reading || !base || !project) return;
  // What this installation's sends left in the store: their content is the project's own change.
  const sent: Record<string, string[]> = {};
  for (const item of history) for (const path of item.verified) if (typeof item.after[path] === 'string') (sent[path] ||= []).push(item.after[path]);
  try {updatePlan = planUpdate(base, project.local, project.localAssets, reading, workspace!.update!.choices, sent);}
  catch (error) {notice = {title: 'A atualização não vale mais', text: error instanceof Error ? error.message : String(error)};}
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
  // New images left out of the send: one line, with the switch that sends them.
  const offImages = plan.rows.filter(row => row.reason === IMAGES_OFF).length;
  if (offImages) items.push(attentionItem(`${plural(offImages, 'imagem nova fica', 'imagens novas ficam')} no projeto: o envio de imagens está desligado.`, linkButton('Ligar o envio de imagens', () => $<HTMLInputElement>('send-images').click())));
  for (const row of plan.rows) {
    if (row.reason === IMAGES_OFF) continue;
    const block = row.reason ? undefined : explainBlock(plan, row);
    if (block && (block.storeOnly.length || block.conflicts.length)) {
      const look = (paths: string[], one: string, many: (path: string) => string, tab?: 'store') => paths.map(path => linkButton(paths.length === 1 ? one : many(path), () => openDiff(rows.get(path)!, tab)));
      items.push(attentionItem(block.text, ...look(block.storeOnly, 'Ver a mudança', path => `Ver ${path}`, 'store'), ...look(block.conflicts, 'Comparar e escolher', path => `Escolher ${path}`)));
    } else if (block?.images.length) items.push(attentionItem(block.text, linkButton('Ver', () => openDiff(row))));
    else if (row.override) items.push(attentionItem(`${row.path}: vai a versão do projeto. A da loja fica no backup.`, linkButton('Ver', () => openDiff(row)), linkButton('Manter a da loja', () => setOverride(row, false))));
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
  const conflicts = count(r => r.status === 'conflict'), blocked = count(r => r.reason !== IMAGES_OFF && (['blocked-dependency', 'new-local', 'missing-remote'].includes(r.status) || r.status === 'unsupported' && !!r.reason && r.path !== COMPONENTS_FILE)), whitespace = count(r => r.status === 'update' && !!r.whitespaceOnly);
  const offImages = count(r => r.reason === IMAGES_OFF), candidates = images + offImages, sendImages = !!review()?.images;
  $('images-option').hidden = !candidates || scope === 'restore';
  $<HTMLInputElement>('send-images').checked = sendImages;
  $('images-option-text').textContent = sendImages ? `Ligado: ${plural(images, 'imagem nova vai', 'imagens novas vão')} para assets/images da loja.` : `Desligado: ${plural(candidates, 'imagem nova fica', 'imagens novas ficam')} só no projeto.`;
  setCount('count-update', changed, 'alterado', 'alterados'); setCount('count-create', created, 'novo', 'novos'); setCount('count-upload', images, 'imagem', 'imagens');
  const kinds = list([changed ? plural(changed, 'arquivo alterado', 'arquivos alterados') : '', created ? plural(created, 'arquivo novo', 'arquivos novos') : '', images ? plural(images, 'imagem nova', 'imagens novas') : '']);
  $('summary').textContent = [
    `${plural(selected.size, 'item', 'itens')} para enviar${kinds ? `: ${kinds}` : ''}.`,
    conflicts ? `${plural(conflicts, 'conflito precisa', 'conflitos precisam')} da sua decisão.` : 'Nenhum conflito.',
    blocked ? `${plural(blocked, 'item bloqueado', 'itens bloqueados')}.` : '',
    offImages ? `${plural(offImages, 'imagem nova fica', 'imagens novas ficam')} fora do envio.` : '',
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
  $('reference-detail').textContent = scope === 'project' && workspace?.baseline ? `Projeto “${workspace.project?.name || ''}”, comparado com a referência: a loja em ${dateTime(lineage?.exportedAt || workspace.baseline.capturedAt)}${lineage?.journals.length ? ` e ${plural(lineage.journals.length, 'envio feito', 'envios feitos')} depois` : ''}.${interruptedReference ? ' A última atualização da pasta parou no meio: use Atualizar da loja para concluir.' : ''}` : '';
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
// New images go only when the user turns them on for this send, after the warning. A comparison
// starts again with them off.
$('send-images').addEventListener('change', () => {
  const input = $<HTMLInputElement>('send-images'), current = review();
  if (!current || !plan) return;
  if (input.checked) {
    const count = plan.rows.filter(row => row.reason === IMAGES_OFF).length;
    if (!confirm(`Enviar ${plural(count, 'imagem nova', 'imagens novas')} para assets/images de ${plan.context.storeName}?\n\nDepois de enviada, a imagem fica na loja: a extensão não substitui nem apaga imagens, e desfazer o envio não a remove. Confira os nomes na lista de arquivos antes de enviar.`)) {input.checked = false; return;}
  }
  current.images = input.checked; delete current.selected;
  persistReview(value => {value.images = input.checked; delete value.selected;});
  computePlan(); render();
  toast(input.checked ? 'As imagens novas vão junto deste envio.' : 'As imagens novas ficam só no projeto.');
});
// --- Update of the project folder -------------------------------------------------------------------
const updateLabels: Record<UpdateKind, string> = {
  same: 'Igual na pasta e na loja', mine: 'Mudou só na pasta: fica', store: 'Mudou na loja: vem para a pasta', removed: 'Removido na loja: sai da pasta',
  merged: 'Mudou dos dois lados, em trechos diferentes: juntado', conflict: 'Mudou dos dois lados nas mesmas linhas', 'removed-edited': 'Removido na loja e editado na pasta',
  'deleted-changed': 'Apagado na pasta e mudado na loja', marked: 'Ainda com marcações de conflito: fica como está'
};
const imageLabels: Partial<Record<UpdateKind, string>> = {mine: 'Imagem da pasta: fica', store: 'Imagem da loja: vem para a prévia local', removed: 'Imagem removida na loja: sai da pasta'};
const choiceLabels: Record<Resolution, string> = {marks: 'Marcar no arquivo', mine: 'Manter a da pasta', store: 'Usar a da loja'};
function choiceText(row: UpdateRow): string {
  if (row.kind === 'conflict') return row.resolution === 'marks' ? `Vai com as duas versões marcadas (${plural(row.conflicts || 1, 'trecho', 'trechos')}), para você resolver no editor de código. Nada com marcações é enviado.` : row.resolution === 'mine' ? 'Fica a da pasta. No próximo envio, ela substitui a da loja, que vai para o backup.' : 'Fica a da loja. A sua continua na versão “Pasta antes de atualizar”.';
  if (row.kind === 'removed-edited') return row.resolution === 'store' ? 'Sai da pasta, como na loja. A sua continua na versão “Pasta antes de atualizar”.' : 'Fica na pasta. Se você enviar, ele volta para a loja.';
  return row.resolution === 'store' ? 'Volta para a pasta com a versão da loja.' : 'Continua apagado na pasta. Nada muda na loja.';
}
function setChoice(row: UpdateRow, choice: Resolution): void {
  const update = workspace?.update, target = updatePlan?.context;
  if (!update || !target) return;
  update.choices = {...update.choices, [row.path]: choice};
  computeUpdate(); render();
  const next = updatePlan?.rows.find(item => item.path === row.path);
  if (diffUpdate && next) openUpdateDiff(next);
  void updateWorkspace(target, value => {if (value.update) value.update.choices = {...value.update.choices, [row.path]: choice};}).catch(() => {});
}
function renderUpdate(): void {
  if (!updatePlan) return;
  const rows = updatePlan.rows, texts = rows.filter(row => !row.image);
  setCount('count-store', texts.filter(row => row.kind === 'store' || row.kind === 'removed').length, 'da loja', 'da loja');
  setCount('count-merged', texts.filter(row => row.kind === 'merged').length, 'juntado', 'juntados');
  setCount('count-decide', rows.filter(row => CHOICES[row.kind]).length, 'para decidir', 'para decidir');
  const items: HTMLLIElement[] = [];
  for (const row of rows) {
    const options = CHOICES[row.kind];
    if (options) items.push(attentionItem(`${row.path}: ${updateLabels[row.kind].toLowerCase()}. ${choiceText(row)}`, linkButton('Comparar', () => openUpdateDiff(row)), ...options.filter(option => option !== row.resolution).map(option => linkButton(choiceLabels[option], () => setChoice(row, option)))));
    else if (row.kind === 'marked') items.push(attentionItem(`${row.path} ainda tem marcações de conflito. A atualização não mexe nele: resolva no editor de código.`, linkButton('Ver', () => openUpdateDiff(row))));
  }
  $('update-attention-list').replaceChildren(...items);
  $('update-attention').hidden = !items.length;
  const changing = rows.filter(row => row.kind !== 'same');
  $('update-files-summary').textContent = `Ver os arquivos (${changing.length})`;
  $('update-rows').replaceChildren(...changing.slice(0, 400).map(row => {
    const name = row.path.split('/').pop()!, folder = row.path.slice(0, -name.length);
    const view = linkButton('Diferenças', () => openUpdateDiff(row)); view.classList.add('row-action');
    return el('li', {class: 'file-row plain'},
      el('div', {class: 'file-main'}, el('span', {class: 'file-name', text: name}), el('span', {class: 'file-folder', text: folder}), el('span', {class: `row-status u-${row.kind}`, text: (row.image ? imageLabels[row.kind] : undefined) ?? updateLabels[row.kind]})),
      row.image ? false : view);
  }));
}
// --- Versions of the project ------------------------------------------------------------------------
const kindLabels: Record<Version['kind'], string> = {referencia: 'Loja antes de uma atualização', 'antes-de-atualizar': 'Pasta antes de atualizar', loja: 'Loja numa atualização', envio: 'Loja depois de um envio', 'antes-de-restaurar': 'Pasta antes de trazer uma versão', manual: 'Salva por você'};
const changeLabels: Record<VersionChange['change'], string> = {changed: 'Mudou desde então', 'missing-now': 'Apagado desde então', 'added-since': 'Criado depois: fica como está'};
async function openVersion(access: ProjectFolder, version: Version): Promise<void> {
  const saved = await versionFiles(access, version);
  versions!.open = {version, saved, changes: versionChanges(saved, versions!.current)};
}
// The folder is read again each time: the versions are compared with what it has now.
async function loadVersions(folder: Folder, keep?: string): Promise<void> {
  const fresh = await readProjectFromFolder(folder), access = await openProject(folder);
  const {versions: found, skipped} = await listVersions(access, fresh.baseline.context);
  versions = {list: found, skipped, current: fresh.local};
  const open = keep && found.find(item => item.id === keep);
  if (open) await openVersion(access, open);
  renderVersions();
}
function renderVersions(): void {
  if (!versions) return;
  const open = versions.open;
  $('versions-home').hidden = !!open; $('version-detail').hidden = !open;
  $('versions-empty').hidden = !!versions.list.length;
  $('versions-skipped').hidden = !versions.skipped.length;
  $('versions-skipped').textContent = `${plural(versions.skipped.length, 'registro ignorado', 'registros ignorados')}: de outra loja ou ilegível.`;
  $('versions-list').replaceChildren(...versions.list.map(version => {
    const button = linkButton('Abrir', () => void run('Abrindo a versão', async () => {const folder = projectFolder(); if (folder) {await openVersion(await openProject(folder), version); renderVersions();}}));
    button.classList.add('row-action');
    return el('li', {class: 'file-row plain version-row'},
      el('div', {class: 'file-main'}, el('span', {class: 'file-name', text: version.label}), el('span', {class: 'file-folder', text: `${dateTime(version.createdAt)} · ${plural(version.files.length, 'texto', 'textos')}`}), el('span', {class: 'row-status', text: kindLabels[version.kind]})),
      button);
  }));
  if (!open) return;
  $('version-title').textContent = open.version.label;
  const restorable = open.changes.filter(change => change.change !== 'added-since');
  $('version-summary').textContent = `${kindLabels[open.version.kind]}, ${dateTime(open.version.createdAt)}. ${open.changes.length ? `${plural(open.changes.length, 'arquivo difere', 'arquivos diferem')} da pasta agora.` : 'A pasta tem exatamente estes textos.'}`;
  $('restore-all').hidden = !restorable.length;
  $('restore-all').textContent = `Trazer ${plural(restorable.length, 'arquivo', 'arquivos')} desta versão`;
  $('version-rows').replaceChildren(...open.changes.slice(0, 400).map(change => {
    const name = change.path.split('/').pop()!, folder = change.path.slice(0, -name.length);
    return el('li', {class: 'file-row plain'},
      el('div', {class: 'file-main'}, el('span', {class: 'file-name', text: name}), el('span', {class: 'file-folder', text: folder}), el('span', {class: 'row-status', text: changeLabels[change.change]})),
      el('span', {class: 'row-actions'}, linkButton('Ver', () => openVersionDiff(change.path)), change.change === 'added-since' ? false : linkButton('Trazer', () => restorePaths([change.path]))));
  }));
}
// Brings files of the open version into tema/. What the user compared must still be what the folder
// has; the folder as it is goes into a version first.
function restorePaths(paths: string[]): void {
  const folder = projectFolder(), open = versions?.open, shown = versions?.current;
  if (!folder || !open || !shown || !paths.length) return;
  const allowed = permitted(folder, true, 'readwrite');
  void run('Trazendo da versão', async () => {
    if (!await allowed) throw new Error('O Chrome não liberou a escrita na pasta do projeto. Nada foi gravado.');
    const fresh = await readProjectFromFolder(folder);
    const moved = paths.filter(path => fresh.local[path] !== shown[path]);
    if (moved.length) throw new Error(`${list(moved)} mudou na pasta depois de abrir as versões. Abra as versões de novo.`);
    const {restored} = await restoreVersion(await openProject(folder), open.version, paths, fresh.local);
    await readFolder(folder, false, false);
    await loadVersions(folder, open.version.id);
    toast(`${plural(restored.length, 'arquivo trazido', 'arquivos trazidos')} para a pasta. A pasta de antes ficou guardada como versão.`, 6000);
  });
}
// --- Sheets ---------------------------------------------------------------------------------------
const sheets = ['confirm-panel', 'diff', 'menu-sheet', 'versions-sheet'];
function openSheet(id: string): void {
  if (id === 'menu-sheet') {
    $('menu').setAttribute('aria-expanded', 'true');
  }
  $(id).hidden = false; $('sheet-scrim').hidden = false;
  requestAnimationFrame(() => ($(id).querySelector<HTMLElement>('button:not([hidden]):not(:disabled)') || $(id)).focus());
}
function closeSheet(id: string): void {
  if ($(id).hidden) return;
  $(id).hidden = true;
  if (id === 'menu-sheet') {
    historyPicker.close(false);
    $('menu').setAttribute('aria-expanded', 'false');
    $('menu').focus({preventScroll: true});
  }
  if (sheets.every(sheet => $(sheet).hidden)) $('sheet-scrim').hidden = true;
}
const clearDiff = () => {diffRow = undefined; diffUpdate = undefined; diffVersion = undefined;};
const closeAll = () => {for (const id of sheets) closeSheet(id); clearDiff();};
const DIFF_ACTIONS = ['diff-write-store', 'diff-copy-store', 'diff-use-project', 'diff-keep-store', 'diff-choose-marks', 'diff-choose-mine', 'diff-choose-store', 'diff-restore'];
function diffActions(visible: string[]): void {for (const id of DIFF_ACTIONS) $(id).hidden = !visible.includes(id);}
const diffSwitch = () => $('diff').querySelector<HTMLElement>('.switch')!;
// A row of the update under review: the same three views (reference, folder, store), and its choices.
function openUpdateDiff(row: UpdateRow): void {
  clearDiff(); diffUpdate = row;
  $('diff-title').textContent = row.path;
  diffSwitch().hidden = !!row.image;
  diffActions((CHOICES[row.kind] || []).filter(option => option !== row.resolution).map(option => `diff-choose-${option}`));
  showDiffTab(row.kind === 'store' || row.kind === 'removed' ? 'store' : 'remote');
  openSheet('diff');
}
// A file of the open version against the folder now.
function openVersionDiff(path: string): void {
  const open = versions?.open; if (!open) return;
  clearDiff(); diffVersion = {path, saved: open.saved[path], current: versions!.current[path]};
  $('diff-title').textContent = path;
  diffSwitch().hidden = true;
  diffActions(diffVersion.saved !== undefined ? ['diff-restore'] : []);
  showDiffTab('remote');
  openSheet('diff');
}
function openDiff(row: PlanRow, tab?: typeof diffTab): void {
  clearDiff(); diffActions([]); diffSwitch().hidden = false;
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
  if (diffVersion) {renderDiff($('diff-body'), $('diff-stats'), diffVersion.saved, diffVersion.current, {before: 'Versão', after: 'Pasta agora'}); return;}
  if (diffUpdate) {
    const update = diffUpdate;
    if (update.image) {
      $('diff-stats').textContent = 'Imagem. Na atualização, a da loja só entra onde a pasta ainda tinha a imagem antiga.';
      $('diff-body').replaceChildren(el('p', {class: 'diff-empty', text: 'Imagens servem à prévia local: não entram nas versões e só vão para a loja se você ligar o envio de imagens.'}));
      return;
    }
    const views = {remote: [update.store, update.local, 'Loja', 'Pasta'], base: [update.base, update.local, 'Referência', 'Pasta'], store: [update.base, update.store, 'Referência', 'Loja']} as const;
    const [from, to, a, b] = views[tab];
    renderDiff($('diff-body'), $('diff-stats'), from, to, {before: a, after: b});
    return;
  }
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
$('close-diff').addEventListener('click', () => {closeSheet('diff'); clearDiff();});
for (const option of ['marks', 'mine', 'store'] as const) $(`diff-choose-${option}`).addEventListener('click', () => {if (diffUpdate) setChoice(diffUpdate, option);});
$('diff-restore').addEventListener('click', () => {const path = diffVersion?.path; if (path) {closeSheet('diff'); clearDiff(); restorePaths([path]);}});
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
$('menu').addEventListener('click', () => {
  updateHistory(); journalInfo(); controls();
  openSheet('menu-sheet');
});
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
      if (state.kind === 'send') void recordSendInFolder();
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
// The reference in the folder stopped between two states (an update cut midway): readable and safe
// to compare, and finished by the next update.
let interruptedReference = false;
// compareAfter: compare with the store at once (reading a project); off when only refreshing what
// the folder has, after the extension itself wrote to it.
async function adoptProject(project: Project | {local: Files; localAssets: Assets}, source: {name: string; kind: 'folder' | 'zip' | 'demo'}, full = false, compareAfter = true): Promise<void> {
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
    value.review = {overrides: []}; delete value.restore; delete value.update;
  });
  if (chosen?.advanced) toast('Os arquivos já enviados não voltam como conflito.');
  interruptedReference = 'interrupted' in project && !!project.interrupted;
  if (interruptedReference) toast('A última atualização da pasta parou no meio. Use Atualizar da loja para concluir.', 8000);
  restoreJournal = undefined; computePlan(); computeUpdate(); route = 'send';
  if (connected && compareAfter) await compare(full);
}
async function readProjectFromFolder(folder: Folder): Promise<Project> {
  const {entries} = await folderEntries(folder, controller?.signal);
  const project = await readProjectEntries(entries, progressLocal);
  if (!('baseline' in project)) throw new Error('Esta pasta não tem .yampi-sync/. Escolha a pasta do projeto baixado pela extensão.');
  return project;
}
// After a send, the folder's reference follows the store too, and a version keeps the store's
// texts: only when write access to the folder is already given, never with a prompt outside a click.
async function recordSendInFolder(): Promise<void> {
  const folder = projectFolder(), base = workspace?.baseline, lineage = workspace?.lineage;
  if (!folder || !base || !lineage?.advancedAt) return;
  try {
    if (!await permitted(folder, false, 'readwrite')) return;
    const {entries} = await folderEntries(folder), fresh = await readProjectEntries(entries);
    if (!('baseline' in fresh) || !fresh.manifest || fresh.baseline.capturedAt !== lineage.exportedAt || !sameContext(fresh.baseline.context, base.context)) return;
    const access = await openProject(folder);
    await writeReference(access, fresh.baseline, base, fresh.manifest, 'send');
    await saveVersion(access, {kind: 'envio', origin: 'loja', label: 'Loja depois do envio', context: base.context, files: base.files, journals: lineage.journals});
    toast('Envio registrado também na pasta do projeto.', 4000);
  } catch (error) {
    notice = {title: 'O envio está na loja, mas a pasta não registrou', text: `${error instanceof Error ? error.message : String(error)} Use Atualizar da loja para alinhar a pasta.`};
    render();
  }
}
async function compare(full = false): Promise<void> {
  const base = workspace?.baseline, project = workspace?.project;
  if (!base || !project) throw new Error('Carregue a exportação original e a pasta editada.');
  closeSheet('confirm-panel');
  await startJob({id: newId(), kind: 'compare', scope: 'project', paths: changedPaths(base, project.local, project.localAssets), ...(full ? {full: true} : {})});
}
async function readFolder(folder: Folder, full = false, compareAfter = true): Promise<void> {
  busyTitle = `Lendo “${folder.name}”`; render();
  const {name, entries} = await folderEntries(folder, controller?.signal);
  const project = await readProjectEntries(entries, (done, total) => {if (controller?.signal.aborted) throw new Error('Leitura da pasta cancelada.'); progressLocal(done, total);});
  if (context) await rememberFolder('baseline' in project ? project.baseline.context : context, folder, name).catch(() => {});
  remembered = {folder, name, savedAt: new Date().toISOString()};
  await adoptProject(project, {name, kind: 'folder'}, full, compareAfter);
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
  $('zip-name').textContent = file.name;
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
const accepts = () => ['export', 'pick', 'review'].includes(currentView());
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
// Update: the folder is read again, the whole store is read in the background, and the user reviews
// what comes to the folder before anything is written. Chrome asks for write access in this click.
$('update-project').addEventListener('click', () => {
  const folder = projectFolder();
  if (!folder) return;
  const allowed = permitted(folder, true, 'readwrite');
  void run('Lendo a pasta do projeto', async () => {
    if (!await allowed) throw new Error('O Chrome não liberou a escrita na pasta do projeto. Sem ela, a extensão não atualiza a pasta nem guarda versões.');
    await readFolder(folder, false, false);
    await startJob({id: newId(), kind: 'compare', scope: 'update', full: true});
  });
});
$('cancel-update').addEventListener('click', () => {
  const target = updatePlan?.context || context;
  updatePlan = undefined; closeAll(); render();
  if (target) void updateWorkspace(target, value => {delete value.update;}).then(next => {workspace = next; render();}).catch(() => {});
});
$('apply-update').addEventListener('click', () => {
  const folder = projectFolder(), current = updatePlan;
  if (!folder || !current) return;
  const allowed = permitted(folder, true, 'readwrite');
  closeAll();
  void run('Atualizando a pasta', async () => {
    if (!await allowed) throw new Error('O Chrome não liberou a escrita na pasta do projeto. Nada foi gravado.');
    const result = await applyUpdate(await openProject(folder), current, await readProjectFromFolder(folder), progressLocal);
    // The reference is now the store as read: the next comparison starts from it.
    workspace = await updateWorkspace(current.context, value => {value.baseline = current.reference; value.lineage = {exportedAt: current.reference.capturedAt, journals: []}; delete value.update;});
    updatePlan = undefined;
    await readFolder(folder, false, false);
    notice = {title: 'Pasta atualizada com a loja', tone: 'ok', text: [
      `${plural(result.written.length, 'arquivo gravado', 'arquivos gravados')}${result.removed.length ? ` e ${plural(result.removed.length, 'removido', 'removidos')}` : ''} em tema/.`,
      result.marked.length ? `Com marcações de conflito para resolver no editor de código: ${list(result.marked)}.` : '',
      'Versões guardadas em .yampi-sync/versoes/. Nada foi enviado à loja.'
    ].filter(Boolean).join(' ')};
  });
});
$('open-versions').addEventListener('click', () => {
  const folder = projectFolder();
  if (!folder) return;
  const allowed = permitted(folder, true);
  void run('Abrindo as versões', async () => {
    if (!await allowed) throw new Error('O Chrome não liberou a leitura da pasta. Escolha a pasta de novo.');
    await loadVersions(folder);
    openSheet('versions-sheet');
  });
});
$('close-versions').addEventListener('click', () => closeSheet('versions-sheet'));
$('version-back').addEventListener('click', () => {if (versions) {delete versions.open; renderVersions();}});
$('restore-all').addEventListener('click', () => {const open = versions?.open; if (open) restorePaths(open.changes.filter(change => change.change !== 'added-since').map(change => change.path));});
$('version-form').addEventListener('submit', event => {
  event.preventDefault();
  const folder = projectFolder();
  if (!folder) return;
  const allowed = permitted(folder, true, 'readwrite'), name = $<HTMLInputElement>('version-name').value.trim();
  void run('Guardando a versão', async () => {
    if (!await allowed) throw new Error('O Chrome não liberou a escrita na pasta do projeto. Nada foi gravado.');
    const fresh = await readProjectFromFolder(folder);
    await saveVersion(await openProject(folder), {kind: 'manual', origin: 'pasta', label: name || `Pasta em ${dateTime(Date.now())}`, context: fresh.baseline.context, files: fresh.local});
    $<HTMLInputElement>('version-name').value = '';
    await loadVersions(folder);
    toast('Versão guardada na pasta do projeto.');
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
  // With write access, the send is also recorded in the project folder; refusing changes nothing in the send.
  const folder = projectFolder();
  if (folder) void permitted(folder, true, 'readwrite').catch(() => false);
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
  $('journal-error').hidden = !journal?.error;
  $('journal-error').textContent = journal?.error || '';
}
function updateHistory(): void {
  historyPicker.update(history.map(item => ({value: item.id, label: dateTime(item.startedAt), description: `${item.status === 'completed' ? 'Concluído' : 'Interrompido'} · ${plural(item.verified.length + (item.uploaded?.length || 0), 'item conferido', 'itens conferidos')}`})), journal?.id);
}
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
  if (!confirm('Apagar as cópias originais, o projeto carregado e os backups guardados nesta extensão? Os ZIPs já baixados e as versões na pasta do projeto continuam no computador. Nada muda na loja.')) return;
  closeSheet('menu-sheet');
  await clearLocal(); workspace = undefined; plan = undefined; journal = undefined; history = []; resumable = undefined; remembered = undefined; restoreJournal = undefined; selected.clear();
  route = 'export'; updateHistory(); journalInfo(); toast('Dados locais apagados.'); render();
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
    if (plan || updatePlan) route = 'send';
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
