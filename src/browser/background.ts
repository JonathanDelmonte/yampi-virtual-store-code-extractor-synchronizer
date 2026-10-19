import type {Command} from './bridge';
import {assertContext, validateContext} from '../core/model';
import {publicUrl} from '../core/preview';
import {fetchPublicResource} from './public-fetch';
import {isEditorURL as allowed, GUIDE_TITLE, EDITOR_TITLE} from './toolbar';
import type {JobRequest, JobState} from '../jobs/types';
// job: the background operation that holds the lock. While it runs, the panel only watches it,
// and closing or reopening the panel never releases the editor.
type Session = {tabId: number; editorUrl: string; documentId?: string; locked: boolean; access?: 'read' | 'write'; previewOrigins?: string[]; job?: string};
const BRIDGE_VERSION = '0.8.1';
const RUNNER = 'runner.html';
const inFlight = new Map<string, Set<Promise<unknown>>>();
const ports = new Map<string, Set<Promise<string>>>();
const panelRevision = new Map<number, number>();
function nextPanelRevision(tabId: number): void {
  panelRevision.set(tabId, (panelRevision.get(tabId) || 0) + 1);
}
let sessionQueue = Promise.resolve();
async function serialize<T>(job: () => Promise<T>): Promise<T> {
  const previous = sessionQueue;
  let release!: () => void;
  sessionQueue = new Promise<void>(resolve => {release = resolve;});
  await previous;
  try {return await job();} finally {release();}
}
// Session storage also keeps each tab's job state under "job:<tab>". Sessions are UUID keys.
const jobKey = (tabId: number) => `job:${tabId}`;
async function sessions(): Promise<[string, Session][]> {
  return Object.entries(await chrome.storage.session.get(null)).filter(([key]) => !key.includes(':')) as [string, Session][];
}
async function getSession(token: string): Promise<Session | undefined> {
  if (token.includes(':')) return undefined;
  return (await chrome.storage.session.get(token))[token] as Session | undefined;
}
function panelSender(sender: chrome.runtime.MessageSender): boolean {
  // Native side-panel messages omit documentId/frameId/tab. A tab or iframe must never impersonate one.
  if (sender.tab || sender.id !== chrome.runtime.id || !sender.url || sender.frameId !== undefined && sender.frameId !== 0) return false;
  const url = new URL(sender.url);
  return url.href.split(/[?#]/)[0] === chrome.runtime.getURL('panel.html') && /^\d+$/.test(url.searchParams.get('tab') || '');
}
// The background runner is the extension's own offscreen document, never a tab or a frame.
function runnerSender(sender: chrome.runtime.MessageSender): boolean {
  return !sender.tab && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL(RUNNER) && (sender.frameId === undefined || sender.frameId === 0);
}
async function nativeDocument(sender: chrome.runtime.MessageSender): Promise<string> {
  const contexts = await chrome.runtime.getContexts({contextTypes: ['SIDE_PANEL'], ...(sender.documentId ? {documentIds: [sender.documentId]} : {documentUrls: [sender.url!]})});
  const matching = contexts.filter(c => c.documentUrl === sender.url && c.frameId === 0 && c.documentId);
  if (matching.length !== 1) throw new Error('Painel lateral não reconhecido. Abra pelo ícone da extensão.');
  return matching[0].documentId!;
}
async function runnerDocument(sender: chrome.runtime.MessageSender): Promise<void> {
  const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(RUNNER)]});
  if (contexts.length !== 1 || sender.documentId && contexts[0].documentId !== sender.documentId) throw new Error('Execução em segundo plano não reconhecida.');
}
async function authenticate(token: string, sender: chrome.runtime.MessageSender): Promise<Session> {
  if (!panelSender(sender)) throw new Error('Painel não autorizado.');
  const documentId = await nativeDocument(sender);
  return serialize(async () => {
    const session = await getSession(token);
    if (!session) throw new Error('Sessão expirada. Clique na extensão dentro do editor novamente.');
    if (new URL(sender.url!).searchParams.get('tab') !== String(session.tabId)) throw new Error('Este painel pertence a outra aba.');
    if (session.documentId && session.documentId !== documentId) {
      const live = await chrome.runtime.getContexts({contextTypes: ['SIDE_PANEL'], documentIds: [session.documentId]});
      // A background job keeps running without its panel: a new panel may watch it.
      if (live.length || session.locked && !session.job) throw new Error('Outro painel está trabalhando neste editor.');
    }
    if (session.documentId !== documentId) {
      session.documentId = documentId;
      await chrome.storage.session.set({[token]: session});
    }
    return session;
  });
}
async function reloadEditor(tabId: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let loading = false;
    const timer = setTimeout(() => finish(new Error('O editor não terminou de recarregar. Nenhuma gravação foi iniciada nesta etapa.')), 25000);
    function finish(error?: Error) {
      clearTimeout(timer); chrome.tabs.onUpdated.removeListener(updated);
      if (error) reject(error); else resolve();
    }
    function updated(id: number, change: {status?: string}) {
      if (id !== tabId) return;
      if (change.status === 'loading') loading = true;
      if (loading && change.status === 'complete') finish();
    }
    chrome.tabs.onUpdated.addListener(updated);
    void chrome.tabs.reload(tabId).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
  });
}
// Check the bridge version and execute in one round trip. Never cache this readiness across
// reloads; reinject only when the current page needs it.
async function bridge(tabId: number, cmd: Command): Promise<{ok: boolean; value?: unknown; error?: string} | undefined> {
  const invoke = () => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: async (command: Command, version: string) => {
    const api = (window as unknown as {YampiThemeSyncBridge?: {version?: string; command: (c: Command) => Promise<unknown>}}).YampiThemeSyncBridge;
    if (api?.version !== version) return {needsBridge: true};
    return api.command(command);
  }, args: [cmd, BRIDGE_VERSION] as [Command, string]});
  let results = await invoke();
  if ((results[0]?.result as {needsBridge?: boolean} | undefined)?.needsBridge) {
    await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', files: ['bridge.js']});
    results = await invoke();
  }
  return results[0]?.result as {ok: boolean; value?: unknown; error?: string} | undefined;
}
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
// Yampi answers a reload of the editor's address with its "Acesso restrito" page (seen on
// 19/10/2026), while the same editor opens from its menu. Waiting or reloading again does not help.
export const RESTRICTED = 'A Yampi mostrou “Acesso restrito” ao recarregar o editor. Abra o Editor de código pelo menu da Yampi e tente de novo; um envio continua de onde parou.';
async function restricted(tabId: number): Promise<boolean> {
  const [result] = await chrome.scripting.executeScript({target: {tabId}, func: () => /Acesso restrito/i.test(document.body?.innerText || '')}).catch(() => []);
  return result?.result === true;
}
// After a reload, wait here until the editor answers: worker timers are not slowed down like
// the timers of a hidden tab, so a send keeps its pace while the user works in another tab.
async function refresh(tabId: number): Promise<void> {
  await reloadEditor(tabId);
  const start = Date.now();
  for (;;) {
    const reply = await bridge(tabId, {op: 'context'}).catch(error => ({ok: false, error: error instanceof Error ? error.message : String(error)}));
    if (reply?.ok) return;
    if (await restricted(tabId)) throw new Error(RESTRICTED);
    if (Date.now() - start > 30000) throw new Error(reply?.error || 'O editor não respondeu depois de recarregar.');
    await sleep(250);
  }
}
async function execute(token: string, session: Session, message: {action?: string; command?: Command; preview?: {url?: string; origins?: string[]; context?: unknown}}): Promise<unknown> {
  if (message.action === 'refresh') {await refresh(session.tabId); return null;}
  const previewRequest = message.preview;
  const previewAction = ['preview-allow', 'preview-fetch'].includes(message.action || '');
  const cmd = previewAction ? {op: 'context' as const, context: validateContext(previewRequest?.context)} : message.command as Command;
  if (!cmd || !['context', 'inventory', 'read', 'readAsset', 'visual', 'write', 'create', 'upload', 'links', 'directOpen', 'directRead'].includes(cmd.op)) throw new Error('Comando não permitido.');
  if (previewAction && session.access !== 'read') throw new Error('Captura visual exige uma operação de leitura.');
  if (['write', 'create', 'upload'].includes(cmd.op) && session.access !== 'write') throw new Error('Esta operação permite apenas copiar. Gravação bloqueada.');
  const reply = await bridge(session.tabId, cmd);
  if (!reply?.ok) throw new Error(reply?.error || 'Sem resposta do editor.');
  if (!previewAction) return reply.value;
  const expected = validateContext(previewRequest?.context); assertContext(expected, validateContext(reply.value));
  if (message.action === 'preview-allow') {
    const origins = previewRequest?.origins;
    if (!Array.isArray(origins) || origins.length > 32 || origins.some(origin => typeof origin !== 'string' || new URL(publicUrl(origin, origin)).origin !== origin)) throw new Error('Origens da prévia inválidas.');
    for (const origin of origins) if (!await chrome.permissions.contains({origins: [origin + '/*']})) throw new Error('Origem não autorizada no Chrome.');
    session.previewOrigins = [...new Set([expected.previewOrigin, ...origins])]; await chrome.storage.session.set({[token]: session}); return null;
  }
  if (typeof previewRequest?.url !== 'string') throw new Error('URL da prévia ausente.');
  const origin = new URL(publicUrl(previewRequest.url, expected.previewOrigin)).origin;
  if (!await chrome.permissions.contains({origins: [origin + '/*']})) throw new Error('Permissão de leitura da vitrine/recurso não concedida.');
  const result = await fetchPublicResource(previewRequest.url, session.previewOrigins || [expected.previewOrigin]);
  const after = await bridge(session.tabId, {op: 'context', context: expected});
  if (!after?.ok) throw new Error('A loja mudou durante a captura pública.');
  assertContext(expected, validateContext(after.value));
  return result;
}
// ---------------------------------------------------------------------------------------------
// Background jobs: the runner document does the work; this worker owns the editor tab, the lock,
// downloads, the toolbar badge and the final notice.
let creatingRunner: Promise<void> | undefined;
async function ensureRunner(): Promise<void> {
  const existing = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(RUNNER)]});
  if (existing.length) return;
  creatingRunner ||= chrome.offscreen.createDocument({url: RUNNER, reasons: ['WORKERS', 'BLOBS', 'DOM_PARSER'] as chrome.offscreen.Reason[], justification: 'Copia, compara e envia o tema em segundo plano, mesmo com o painel fechado.'}).finally(() => {creatingRunner = undefined;});
  await creatingRunner;
}
async function toRunner<T>(message: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const reply = await chrome.runtime.sendMessage({target: 'runner', ...message}) as {ok: boolean; value?: T; error?: string} | undefined;
      if (!reply) throw new Error('Receiving end does not exist.');
      if (!reply.ok) throw new Error(reply.error || 'Falha na execução em segundo plano.');
      return reply.value as T;
    } catch (error) {
      // The document may still be loading its script right after it was created.
      if (attempt >= 20 || !/Receiving end does not exist|Could not establish connection/i.test(String(error))) throw error;
      await sleep(100);
    }
  }
}
const badgeShown = new Map<number, string>();
async function showBadge(tabId: number, state: JobState): Promise<void> {
  const percent = Math.round(state.fraction * 100);
  const text = state.status === 'running' ? `${Math.min(percent, 99)}%` : state.status === 'waiting' ? '?' : state.status === 'completed' ? '✓' : '!';
  const color = state.status === 'running' ? '#00D4F0' : state.status === 'waiting' ? '#F5A524' : state.status === 'completed' ? '#1DB471' : '#E5484D';
  const title = state.status === 'running' ? `${state.title} · ${percent}%. A operação continua mesmo com o painel fechado.` : state.status === 'waiting' ? `${state.title}: aguardando sua decisão no painel.` : state.status === 'completed' ? `${state.title}: concluído.` : `${state.title}: interrompido. Abra o painel para ver o motivo.`;
  if (badgeShown.get(tabId) === text + title) return;
  badgeShown.set(tabId, text + title);
  await Promise.allSettled([
    chrome.action.setBadgeText({tabId, text}),
    chrome.action.setBadgeBackgroundColor({tabId, color}),
    chrome.action.setBadgeTextColor?.({tabId, color: state.status === 'running' ? '#001418' : '#ffffff'}),
    chrome.action.setTitle({tabId, title})
  ]);
}
async function panelOpen(tabId: number): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({contextTypes: ['SIDE_PANEL']}).catch(() => []);
  return contexts.some(context => context.documentUrl?.split('#')[0] === chrome.runtime.getURL(`panel.html?tab=${tabId}`));
}
function endTitle(state: JobState): string {
  const done = state.status === 'completed', store = state.context.storeName;
  if (state.kind === 'export') return `${done ? 'Tema baixado' : 'Download do tema interrompido'} · ${store}`;
  if (state.scope === 'restore') return `${done ? 'Restauração concluída' : 'Restauração interrompida'} · ${store}`;
  return `${done ? 'Envio concluído' : 'Envio interrompido'} · ${store}`;
}
async function notifyEnd(tabId: number, state: JobState): Promise<void> {
  if (!chrome.notifications || state.kind === 'compare' || await panelOpen(tabId)) return;
  const result = state.result, items = result?.kind === 'send' ? result.verified + result.uploaded : 0;
  const message = state.status === 'completed'
    ? result?.kind === 'send' ? `${items} ${items === 1 ? 'item conferido' : 'itens conferidos'} na Yampi. Confira em Ver prévia antes de publicar.` : 'O ZIP está na pasta de downloads.'
    : `${state.error || 'Abra o painel para ver o motivo.'} Abra o painel para continuar de onde parou.`;
  await chrome.notifications.create(`zirtuno:${tabId}:${state.id}`, {type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: endTitle(state), message, priority: 1}).catch(() => {});
}
async function releaseJob(token: string, jobId: string): Promise<Session | undefined> {
  return serialize(async () => {
    const session = await getSession(token);
    if (!session || session.job !== jobId) return session;
    session.locked = false; delete session.access; delete session.job; delete session.previewOrigins;
    await chrome.storage.session.set({[token]: session});
    return session;
  });
}
function validRequest(value: unknown): JobRequest {
  const request = value as JobRequest;
  if (!request || typeof request.id !== 'string' || !/^[\w-]{8,64}$/.test(request.id) || !['export', 'compare', 'send'].includes(request.kind)) throw new Error('Operação inválida.');
  if (request.scope !== undefined && !['project', 'restore', 'update'].includes(request.scope)) throw new Error('Operação inválida.');
  // An update only reads the store; the panel writes the project folder after the user applies it.
  if (request.scope === 'update' && request.kind !== 'compare') throw new Error('Operação inválida.');
  if (request.paths !== undefined && (!Array.isArray(request.paths) || request.paths.length > 6000 || request.paths.some(path => typeof path !== 'string'))) throw new Error('Operação inválida.');
  for (const key of ['resume', 'journalId'] as const) if (request[key] !== undefined && (typeof request[key] !== 'string' || !/^[\w-]{8,64}$/.test(request[key]!))) throw new Error('Operação inválida.');
  return {id: request.id, kind: request.kind, ...(request.includePreview ? {includePreview: true} : {}), ...(request.scope ? {scope: request.scope} : {}), ...(request.journalId ? {journalId: request.journalId} : {}), ...(request.paths ? {paths: [...request.paths]} : {}), ...(request.full ? {full: true} : {}), ...(request.resume ? {resume: request.resume} : {})};
}
async function startJob(token: string, session: Session, message: {job?: unknown; context?: unknown}): Promise<null> {
  const request = validRequest(message.job), context = validateContext(message.context);
  const access = request.kind === 'send' ? 'write' : 'read';
  await serialize(async () => {
    const current = await getSession(token);
    if (!current || current.documentId !== session.documentId) throw new Error('Sessão encerrada. Clique na extensão novamente.');
    if (current.locked) throw new Error(current.job ? 'Uma operação já está em andamento nesta aba.' : 'Aguarde a operação atual terminar.');
    if ((await sessions()).some(([key, value]) => key !== token && value.tabId === current.tabId && value.locked)) throw new Error('Outro painel está trabalhando neste editor.');
    Object.assign(current, {locked: true, access, job: request.id}); delete current.previewOrigins;
    await chrome.storage.session.set({[token]: current});
  });
  try {
    await ensureRunner();
    await toRunner({action: 'start', job: request, context, tabId: session.tabId, token});
  } catch (error) {
    await releaseJob(token, request.id);
    throw error;
  }
  void chrome.tabs.update(session.tabId, {autoDiscardable: false}).catch(() => {});
  return null;
}
// A job whose runner is gone (extension reloaded, browser crash) is marked interrupted, and the
// editor is released. The send's own record still says where it stopped.
async function reconcile(tabId: number): Promise<JobState | undefined> {
  const state = (await chrome.storage.session.get(jobKey(tabId)))[jobKey(tabId)] as JobState | undefined;
  if (!state || state.status !== 'running' && state.status !== 'waiting') return state;
  const exists = (await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(RUNNER)]})).length > 0;
  const running = exists && await toRunner<boolean>({action: 'has', jobId: state.id}).catch(() => false);
  if (running) return state;
  const interrupted: JobState = {...state, status: 'failed', detail: 'Operação interrompida', error: 'A operação parou porque a extensão foi reiniciada ou atualizada. Nada foi desfeito.', finishedAt: Date.now()};
  await chrome.storage.session.set({[jobKey(tabId)]: interrupted});
  for (const [token, session] of await sessions()) if (session.tabId === tabId && session.job === state.id) await releaseJob(token, state.id);
  await showBadge(tabId, interrupted);
  return interrupted;
}
const downloadsDone = new Map<number, (state: 'complete' | 'interrupted') => void>();
chrome.downloads?.onChanged.addListener(delta => {
  const state = delta.state?.current;
  if (state === 'complete' || state === 'interrupted') {downloadsDone.get(delta.id)?.(state); downloadsDone.delete(delta.id);}
});
async function download(url: string, name: string): Promise<null> {
  // Only files the runner document made (blob:chrome-extension://<this extension>/...), under a plain name.
  if (!url.startsWith(`blob:${chrome.runtime.getURL('')}`) || !/^[\w.-]{1,160}$/.test(name) || name.startsWith('.')) throw new Error('Download inválido.');
  const id = await chrome.downloads.download({url, filename: name, saveAs: false, conflictAction: 'uniquify'});
  const result = await new Promise<'complete' | 'interrupted' | 'timeout'>(resolve => {
    const timer = setTimeout(() => {downloadsDone.delete(id); resolve('timeout');}, 120000);
    downloadsDone.set(id, state => {clearTimeout(timer); resolve(state);});
    // The download may have finished before the listener was registered.
    void chrome.downloads.search({id}).then(([item]) => {if (item?.state === 'complete' || item?.state === 'interrupted') {downloadsDone.delete(id); clearTimeout(timer); resolve(item.state);}});
  });
  if (result === 'interrupted') throw new Error('Download cancelado ou interrompido. Nenhuma alteração foi feita depois dele.');
  if (result === 'timeout') throw new Error('O download não foi confirmado a tempo. Nenhuma alteração foi feita depois dele.');
  return null;
}
async function fromRunner(message: {runner: string; session?: string; action?: string; state?: JobState; url?: string; name?: string; ms?: number; command?: Command; preview?: {url?: string; origins?: string[]; context?: unknown}}, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await runnerDocument(sender);
  const jobId = message.runner, token = typeof message.session === 'string' ? message.session : '';
  const session = await getSession(token);
  if (!session || session.job !== jobId || !session.locked) throw new Error('Operação em segundo plano não autorizada para esta aba.');
  if (message.action === 'job-wait') {await sleep(Math.max(0, Math.min(Number(message.ms) || 0, 10000))); return null;}
  if (message.action === 'job-report' || message.action === 'job-finish') {
    const state = message.state as JobState;
    if (!state || state.id !== jobId) throw new Error('Estado de operação inválido.');
    await chrome.storage.session.set({[jobKey(session.tabId)]: state});
    await showBadge(session.tabId, state);
    if (message.action === 'job-finish') {
      await releaseJob(token, jobId);
      void chrome.tabs.update(session.tabId, {autoDiscardable: true}).catch(() => {});
      await notifyEnd(session.tabId, state);
    }
    return null;
  }
  if (message.action === 'job-download') return download(String(message.url), String(message.name));
  const tab = await chrome.tabs.get(session.tabId);
  if (!allowed(tab.url) || tab.url !== session.editorUrl) throw new Error('A aba do editor mudou de endereço. Abra o editor de código novamente e continue o envio pelo painel.');
  return execute(token, session, message);
}
// ---------------------------------------------------------------------------------------------
export async function openEditorPanel(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  nextPanelRevision(tab.id);
  if (!allowed(tab.url)) {
    const configuring = chrome.sidePanel.setOptions({tabId: tab.id, path: `guide.html?tab=${tab.id}`, enabled: true});
    const opening = chrome.sidePanel.open({tabId: tab.id});
    try {
      await Promise.all([configuring, opening]);
      await chrome.action.setBadgeText({text: '', tabId: tab.id});
      await chrome.action.setTitle({title: GUIDE_TITLE, tabId: tab.id});
    } catch (error) {
      await chrome.action.setBadgeText({text: '!', tabId: tab.id});
      await chrome.action.setTitle({title: error instanceof Error ? error.message : String(error), tabId: tab.id});
    }
    return;
  }
  // Use a stable, tab-specific path. Chrome receives both calls in order, before any awaited storage work.
  // Changing from a global panel to a tab panel after opening leaves the wrong document displayed.
  const configuring = chrome.sidePanel.setOptions({tabId: tab.id, path: `panel.html?tab=${tab.id}`, enabled: true});
  const opening = chrome.sidePanel.open({tabId: tab.id});
  void configuring.catch(() => {}); void opening.catch(() => {});
  try {
    const token = await serialize(async () => {
      const sameTab = (await sessions()).filter(([, value]) => value.tabId === tab.id);
      const busy = sameTab.find(([, value]) => value.locked);
      if (busy) return busy[0];
      const previous = sameTab.find(([, value]) => value.editorUrl === tab.url);
      if (previous) return previous[0];
      for (const [key] of sameTab) await chrome.storage.session.remove(key);
      const key = crypto.randomUUID();
      await chrome.storage.session.set({[key]: {tabId: tab.id!, editorUrl: tab.url!, locked: false} satisfies Session});
      return key;
    });
    await configuring; await opening;
    await chrome.runtime.sendMessage({editorClicked: token}).catch(() => {});
    // A running job keeps its progress on the icon.
    const state = (await chrome.storage.session.get(jobKey(tab.id)))[jobKey(tab.id)] as JobState | undefined;
    if (state && (state.status === 'running' || state.status === 'waiting')) return;
    await chrome.action.setBadgeText({text: '', tabId: tab.id});
    await chrome.action.setTitle({title: EDITOR_TITLE, tabId: tab.id});
  } catch (error) {
    await Promise.allSettled([configuring, opening]);
    await chrome.action.setBadgeText({text: '!', tabId: tab.id});
    await chrome.action.setTitle({title: error instanceof Error ? error.message : String(error), tabId: tab.id});
  }
}
chrome.action.onClicked.addListener(openEditorPanel);
// A manifest default_path enables a global panel on every tab. Keep the default
// disabled; only an explicit toolbar click enables the selected editor tab.
void chrome.sidePanel.setOptions({enabled: false}).catch(() => {});
chrome.runtime.onInstalled.addListener(() => {
  // Clear old tab-specific badges/tooltips when upgrading; no page access or injection.
  void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.filter(tab => tab.id !== undefined).map(async tab => {
    await chrome.action.setBadgeText({text: '', tabId: tab.id});
    await chrome.action.setTitle({title: allowed(tab.url) ? EDITOR_TITLE : GUIDE_TITLE, tabId: tab.id});
  }))).catch(() => {});
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.url) {
    nextPanelRevision(id); badgeShown.delete(id);
    void chrome.sidePanel.setOptions({tabId: id, enabled: false}).catch(() => {});
    void chrome.action.setBadgeText({text: '', tabId: id}).catch(() => {});
    void chrome.action.setTitle({title: allowed(change.url) ? EDITOR_TITLE : GUIDE_TITLE, tabId: id}).catch(() => {});
  }
});
// onClosed is available in Chrome 142+. Older supported versions still benefit
// from the global default being disabled and navigation being scoped to the tab.
const panelEvents = chrome.sidePanel as typeof chrome.sidePanel & {
  onClosed?: {addListener: (listener: (info: {tabId?: number; path: string}) => void) => void};
};
panelEvents.onClosed?.addListener(info => {
  if (info.tabId === undefined) return;
  const tabId = info.tabId, revision = panelRevision.get(tabId);
  void chrome.sidePanel.getOptions({tabId}).then(options => {
    // A late close event from the guide must not disable the newly opened editor panel.
    if (panelRevision.get(tabId) !== revision || options.path !== info.path || !options.enabled) return;
    return chrome.sidePanel.setOptions({tabId, enabled: false});
  }).catch(() => {});
});
chrome.notifications?.onClicked.addListener(id => {
  const tabId = Number(id.split(':')[1]);
  if (!id.startsWith('zirtuno:') || !Number.isSafeInteger(tabId)) return;
  void (async () => {
    const tab = await chrome.tabs.update(tabId, {active: true});
    if (tab?.windowId !== undefined) await chrome.windows?.update(tab.windowId, {focused: true});
  })().catch(() => {});
  void chrome.notifications.clear(id);
});
chrome.runtime.onConnect.addListener(port => {
  const token = port.name.startsWith('panel:') ? port.name.slice(6) : '';
  if (!token || !port.sender || !panelSender(port.sender)) return;
  const owner = nativeDocument(port.sender);
  void owner.catch(() => {});
  const owners = ports.get(token) || new Set<Promise<string>>(); owners.add(owner); ports.set(token, owners);
  port.onDisconnect.addListener(() => {
    owners.delete(owner); if (!owners.size && ports.get(token) === owners) ports.delete(token);
    void (async () => {
      // A closing panel must not release the editor while an issued write is still running.
      await Promise.allSettled([...(inFlight.get(token) || [])]);
      const documentId = await owner;
      await serialize(async () => {
        const session = await getSession(token);
        // A background job owns its lock: closing the panel never stops or releases it.
        if (!session || session.documentId !== documentId || session.job) return;
        const liveOwners = await Promise.all([...(ports.get(token) || [])].map(p => p.catch(() => undefined)));
        if (liveOwners.includes(documentId)) return;
        session.locked = false; delete session.documentId; delete session.access;
        await chrome.storage.session.set({[token]: session});
      });
    })().catch(() => {});
  });
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof message?.runner === 'string') {
    if (!runnerSender(sender)) return false;
    void fromRunner(message, sender).then(value => sendResponse({ok: true, value}), error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
    return true;
  }
  if (!panelSender(sender)) return false;
  if (message?.action === 'session') {
    void (async () => {
      await nativeDocument(sender);
      return serialize(async () => {
        const tabId = Number(new URL(sender.url!).searchParams.get('tab'));
        const entry = (await sessions()).find(([, value]) => value.tabId === tabId);
        if (!entry) throw new Error('Clique no ícone da extensão dentro do editor para conectar.');
        return entry[0];
      });
    })().then(value => sendResponse({ok: true, value}), error => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (typeof message?.session !== 'string') return false;
  const token = message.session as string;
  const job = (async () => {
    const session = await authenticate(token, sender);
    const tab = await chrome.tabs.get(session.tabId);
    if (!allowed(tab.url) || tab.url !== session.editorUrl) throw new Error('A aba de origem mudou. Clique novamente no ícone dentro do editor correto.');
    if (message.action === 'heartbeat') return null;
    if (message.action === 'job-state') return reconcile(session.tabId);
    if (message.action === 'job-start') return startJob(token, session, message);
    if (message.action === 'job-cancel' || message.action === 'job-decide') {
      if (!session.job) throw new Error('Nenhuma operação em andamento.');
      return toRunner({action: message.action === 'job-cancel' ? 'cancel' : 'decide', jobId: session.job, decision: message.decision});
    }
    if (message.action === 'job-dismiss') {
      const state = (await chrome.storage.session.get(jobKey(session.tabId)))[jobKey(session.tabId)] as JobState | undefined;
      if (state && state.status !== 'running' && state.status !== 'waiting') {
        await chrome.storage.session.remove(jobKey(session.tabId)); badgeShown.delete(session.tabId);
        await chrome.action.setBadgeText({text: '', tabId: session.tabId}); await chrome.action.setTitle({title: EDITOR_TITLE, tabId: session.tabId});
      }
      return null;
    }
    if (['lock', 'unlock'].includes(message.action)) return serialize(async () => {
      const current = await getSession(token);
      if (!current || current.documentId !== session.documentId) throw new Error('Sessão encerrada. Clique na extensão novamente.');
      if (current.job) {
        if (message.action === 'unlock') return null;
        throw new Error('Uma operação está em andamento em segundo plano. Acompanhe pelo painel.');
      }
      if (message.action === 'lock') {
        if (message.access !== undefined && !['read', 'write'].includes(message.access)) throw new Error('Permissão da operação inválida.');
        if ((await sessions()).some(([key, value]) => key !== token && value.tabId === current.tabId && value.locked)) throw new Error('Outro painel está trabalhando neste editor.');
      }
      current.locked = message.action === 'lock';
      delete current.previewOrigins;
      if (current.locked) current.access = message.access || 'read'; else delete current.access;
      await chrome.storage.session.set({[token]: current}); return null;
    });
    if (!session.locked || session.job) throw new Error('Inicie uma operação antes de acessar o editor.');
    return execute(token, session, message);
  })();
  const pending = inFlight.get(token) || new Set(); pending.add(job); inFlight.set(token, pending);
  void job.then(value => sendResponse({ok: true, value}), error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)})).catch(() => {}).finally(() => {
    pending.delete(job); if (!pending.size) inFlight.delete(token);
  });
  return true;
});
chrome.tabs.onRemoved.addListener(async id => {
  panelRevision.delete(id); badgeShown.delete(id);
  const state = (await chrome.storage.session.get(jobKey(id)))[jobKey(id)] as JobState | undefined;
  if (state && (state.status === 'running' || state.status === 'waiting')) void toRunner({action: 'cancel', jobId: state.id}).catch(() => {});
  await serialize(async () => {
    for (const [token, value] of await sessions()) if (value.tabId === id) await chrome.storage.session.remove(token);
  });
  await chrome.storage.session.remove(jobKey(id));
});
