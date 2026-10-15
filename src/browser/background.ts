import type {Command} from './bridge';
import {assertContext, validateContext} from '../core/model';
import {publicUrl} from '../core/preview';
import {fetchPublicResource} from './public-fetch';
import {isEditorURL as allowed, GUIDE_TITLE, EDITOR_TITLE} from './toolbar';
type Session = {tabId: number; editorUrl: string; documentId?: string; locked: boolean; access?: 'read' | 'write'; previewOrigins?: string[]};
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
async function getSession(token: string): Promise<Session | undefined> {
  return (await chrome.storage.session.get(token))[token] as Session | undefined;
}
function panelSender(sender: chrome.runtime.MessageSender): boolean {
  // Native side-panel messages omit documentId/frameId/tab. A tab or iframe must never impersonate one.
  if (sender.tab || sender.id !== chrome.runtime.id || !sender.url || sender.frameId !== undefined && sender.frameId !== 0) return false;
  const url = new URL(sender.url);
  return url.href.split(/[?#]/)[0] === chrome.runtime.getURL('panel.html') && /^\d+$/.test(url.searchParams.get('tab') || '');
}
async function nativeDocument(sender: chrome.runtime.MessageSender): Promise<string> {
  const contexts = await chrome.runtime.getContexts({contextTypes: ['SIDE_PANEL'], ...(sender.documentId ? {documentIds: [sender.documentId]} : {documentUrls: [sender.url!]})});
  const matching = contexts.filter(c => c.documentUrl === sender.url && c.frameId === 0 && c.documentId);
  if (matching.length !== 1) throw new Error('Painel lateral não reconhecido. Abra pelo ícone da extensão.');
  return matching[0].documentId!;
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
      if (live.length || session.locked) throw new Error('Outro painel está trabalhando neste editor.');
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
      const all = await chrome.storage.session.get(null);
      const sameTab = Object.entries(all).filter(([, value]) => (value as Session).tabId === tab.id);
      const busy = sameTab.find(([, value]) => (value as Session).locked);
      if (busy) return busy[0];
      const previous = sameTab.find(([, value]) => (value as Session).editorUrl === tab.url);
      if (previous) return previous[0];
      for (const [key] of sameTab) await chrome.storage.session.remove(key);
      const key = crypto.randomUUID();
      await chrome.storage.session.set({[key]: {tabId: tab.id!, editorUrl: tab.url!, locked: false} satisfies Session});
      return key;
    });
    await configuring; await opening;
    await chrome.runtime.sendMessage({editorClicked: token}).catch(() => {});
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
    nextPanelRevision(id);
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
        if (!session || session.documentId !== documentId) return;
        const liveOwners = await Promise.all([...(ports.get(token) || [])].map(p => p.catch(() => undefined)));
        if (liveOwners.includes(documentId)) return;
        session.locked = false; delete session.documentId; delete session.access;
        await chrome.storage.session.set({[token]: session});
      });
    })().catch(() => {});
  });
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!panelSender(sender)) return false;
  if (message?.action === 'session') {
    void (async () => {
      await nativeDocument(sender);
      return serialize(async () => {
        const tabId = Number(new URL(sender.url!).searchParams.get('tab'));
        const entry = Object.entries(await chrome.storage.session.get(null)).find(([, value]) => (value as Session).tabId === tabId);
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
    if (['lock', 'unlock'].includes(message.action)) return serialize(async () => {
      const current = await getSession(token);
      if (!current || current.documentId !== session.documentId) throw new Error('Sessão encerrada. Clique na extensão novamente.');
      if (message.action === 'lock') {
        if (message.access !== undefined && !['read', 'write'].includes(message.access)) throw new Error('Permissão da operação inválida.');
        const all = await chrome.storage.session.get(null);
        if (Object.entries(all).some(([key, value]) => key !== token && (value as Session).tabId === current.tabId && (value as Session).locked)) throw new Error('Outro painel está trabalhando neste editor.');
      }
      current.locked = message.action === 'lock';
      delete current.previewOrigins;
      if (current.locked) current.access = message.access || 'read'; else delete current.access;
      await chrome.storage.session.set({[token]: current}); return null;
    });
    if (!session.locked) throw new Error('Inicie uma operação antes de acessar o editor.');
    if (message.action === 'refresh') {await reloadEditor(session.tabId); return null;}
    const previewRequest = message.preview as {url?: string; origins?: string[]; context?: unknown} | undefined;
    const previewAction = ['preview-allow', 'preview-fetch'].includes(message.action);
    const cmd = previewAction ? {op: 'context' as const, context: validateContext(previewRequest?.context)} : message.command as Command;
    if (!cmd || !['context', 'inventory', 'read', 'readAsset', 'visual', 'write'].includes(cmd.op)) throw new Error('Comando não permitido.');
    if (previewAction && session.access !== 'read') throw new Error('Captura visual exige uma operação de leitura.');
    if (cmd.op === 'write' && session.access !== 'write') throw new Error('Esta operação permite apenas copiar. Gravação bloqueada.');
    // Check the bridge version and execute in one round trip. Never cache this
    // readiness across reloads; reinject only when the current page needs it.
    const invoke=()=>chrome.scripting.executeScript({target: {tabId: session.tabId}, world: 'MAIN', func: async command => {
      const api = (window as unknown as {YampiThemeSyncBridge?: {version?:string;command: (c: Command) => Promise<unknown>}}).YampiThemeSyncBridge;
      if (api?.version !== '0.3.7') return {needsBridge:true};
      return api.command(command);
    }, args: [cmd]});
    let results=await invoke();
    if((results[0]?.result as {needsBridge?:boolean}|undefined)?.needsBridge){
      await chrome.scripting.executeScript({target: {tabId: session.tabId}, world: 'MAIN', files: ['bridge.js']});
      results=await invoke();
    }
    const reply = results[0]?.result as {ok: boolean; value?: unknown; error?: string} | undefined;
    if (!reply?.ok) throw new Error(reply?.error || 'Sem resposta do editor.');
    if (previewAction) {
      const expected = validateContext(previewRequest?.context); assertContext(expected, validateContext(reply.value));
      if (message.action === 'preview-allow') {
        const origins = previewRequest?.origins;
        if (!Array.isArray(origins) || origins.length > 32 || origins.some(origin => typeof origin !== 'string' || new URL(publicUrl(origin,origin)).origin !== origin)) throw new Error('Origens da prévia inválidas.');
        for (const origin of origins) if (!await chrome.permissions.contains({origins: [origin + '/*']})) throw new Error('Origem não autorizada no Chrome.');
        session.previewOrigins = [...new Set([expected.previewOrigin, ...origins])]; await chrome.storage.session.set({[token]:session}); return null;
      }
      if (typeof previewRequest?.url !== 'string') throw new Error('URL da prévia ausente.');
      const origin = new URL(publicUrl(previewRequest.url,expected.previewOrigin)).origin;
      if (!await chrome.permissions.contains({origins:[origin+'/*']})) throw new Error('Permissão de leitura da vitrine/recurso não concedida.');
      const result = await fetchPublicResource(previewRequest.url, session.previewOrigins || [expected.previewOrigin]);
      const [after] = await chrome.scripting.executeScript({target:{tabId:session.tabId},world:'MAIN',func: async context => (window as unknown as {YampiThemeSyncBridge:{command:(input:Command)=>Promise<unknown>}}).YampiThemeSyncBridge.command({op:'context',context}),args:[expected]});
      const checked=after?.result as {ok:boolean;value:unknown}|undefined;if(!checked?.ok)throw new Error('A loja mudou durante a captura pública.');assertContext(expected,validateContext(checked.value));
      return result;
    }
    return reply.value;
  })();
  const pending = inFlight.get(token) || new Set(); pending.add(job); inFlight.set(token, pending);
  void job.then(value => sendResponse({ok: true, value}), error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)})).catch(() => {}).finally(() => {
    pending.delete(job); if (!pending.size) inFlight.delete(token);
  });
  return true;
});
chrome.tabs.onRemoved.addListener(async id => {
  panelRevision.delete(id);
  await serialize(async () => {
    const stored = await chrome.storage.session.get(null);
    for (const [token, value] of Object.entries(stored)) if ((value as Session).tabId === id) await chrome.storage.session.remove(token);
  });
});
