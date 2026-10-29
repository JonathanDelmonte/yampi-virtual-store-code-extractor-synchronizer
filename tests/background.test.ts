import {beforeEach, afterEach, describe, test, expect, vi} from 'vitest';
type Session = {tabId: number; editorUrl: string; documentId?: string; locked: boolean; access?: 'read' | 'write'; previewOrigins?:string[]; job?: string};
let stored: Record<string, Session>, tabs: Map<number, {id: number; url: string}>, contexts: Map<string, chrome.runtime.ExtensionContext>, injected: Set<number>;
let chromeMock: typeof chrome, clicked: (tab: chrome.tabs.Tab) => Promise<void>, removed: (id: number) => Promise<void>;
let listener: (message: unknown, sender: chrome.runtime.MessageSender, response: (r: unknown) => void) => boolean;
let connect: (port: chrome.runtime.Port) => void;
let updated: Set<(id: number, change: {status?: string; url?: string}) => void>;
let panelClosed: (info: {tabId?: number; path: string}) => void, installed: () => void;
let panelOptions: Map<number, chrome.sidePanel.PanelOptions>;
let runnerMessages: {target?: string; action?: string; job?: {id: string}}[], runnerHas: boolean;
const extId = 'fictitious-test-extension', url = 'https://app.yampi.com.br/store/code-editor/';
function sender(token: string, documentId?: string): chrome.runtime.MessageSender {
  return {id: extId, url: `chrome-extension://${extId}/panel.html?tab=${stored[token]?.tabId || 1}`, documentId};
}
async function message(token: string, input: Record<string, unknown>, source = sender(token)) {
  return new Promise<{ok: boolean; value?: unknown; error?: string}>(resolve => {
    const accepted = listener({session: token, ...input}, source, result => resolve(result as {ok: boolean; value?: unknown; error?: string}));
    if (!accepted) resolve({ok: false, error: 'rejected-sender'});
  });
}
function context(token: string, doc = `doc-${token}`, type = 'SIDE_PANEL') {
  contexts.set(doc, {contextType: type, documentId: doc, documentUrl: sender(token).url!, frameId: 0} as chrome.runtime.ExtensionContext);
}
async function open(tabId = 1) {
  await clicked({id: tabId, url} as chrome.tabs.Tab);
  const [token] = Object.entries(stored).filter(([, s]) => s.tabId === tabId).at(-1)!;
  context(token); return token;
}
function port(token: string) {
  let disconnect!: () => void;
  connect({name: `panel:${token}`, sender: sender(token), onDisconnect: {addListener: (fn: () => void) => {disconnect = fn;}}} as unknown as chrome.runtime.Port);
  return (removeContext = true) => {if (removeContext) contexts.delete(`doc-${token}`); disconnect();};
}
beforeEach(async () => {
  vi.resetModules(); stored = {}; tabs = new Map([[1, {id: 1, url}], [2, {id: 2, url}]]); contexts = new Map(); injected = new Set(); updated = new Set(); runnerMessages = []; runnerHas = true;
  panelOptions = new Map();
  chromeMock = {
    runtime: {id: extId, getURL: (p: string) => `chrome-extension://${extId}/${p}`, sendMessage: vi.fn(async (message: {target?: string; action?: string}) => {runnerMessages.push(message); return message?.target === 'runner' ? {ok: true, value: message.action === 'has' ? runnerHas : null} : undefined;}),
      getContexts: vi.fn(async (filter: {documentIds?: string[]; contextTypes?: string[]; documentUrls?: string[]}) => [...contexts.values()].filter(c => (!filter.documentIds || filter.documentIds.includes(c.documentId!)) && (!filter.documentUrls || filter.documentUrls.includes(c.documentUrl!)) && (!filter.contextTypes || filter.contextTypes.includes(c.contextType)))),
      onInstalled: {addListener: vi.fn(fn => {installed = fn;})}, onMessage: {addListener: vi.fn(fn => {listener = fn;})}, onConnect: {addListener: vi.fn(fn => {connect = fn;})}},
    action: {onClicked: {addListener: vi.fn(fn => {clicked = fn;})}, setBadgeText: vi.fn(async () => {}), setTitle: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}), setBadgeTextColor: vi.fn(async () => {})},
    offscreen: {createDocument: vi.fn(async ({url}: {url: string}) => {contexts.set('runner-doc', {contextType: 'OFFSCREEN_DOCUMENT', documentId: 'runner-doc', documentUrl: `chrome-extension://${extId}/${url}`, frameId: 0} as chrome.runtime.ExtensionContext);})},
    notifications: {create: vi.fn(async () => ''), clear: vi.fn(async () => true), onClicked: {addListener: vi.fn()}},
    downloads: {download: vi.fn(async () => 7), search: vi.fn(async () => [{id: 7, state: 'complete'}]), onChanged: {addListener: vi.fn()}},
    permissions:{contains:vi.fn(async()=>true)},
    sidePanel: {open: vi.fn(async () => {}),
      setOptions: vi.fn(async (options: chrome.sidePanel.PanelOptions) => {if (options.tabId !== undefined) panelOptions.set(options.tabId, {...panelOptions.get(options.tabId), ...options});}),
      getOptions: vi.fn(async ({tabId}: {tabId: number}) => panelOptions.get(tabId) || {}),
      onClosed: {addListener: vi.fn(fn => {panelClosed = fn;})}},
    storage: {session: {
      get: vi.fn(async (key: string | null) => structuredClone(key === null ? stored : {[key]: stored[key]})),
      set: vi.fn(async (values: Record<string, Session>) => {Object.assign(stored, structuredClone(values));}),
      remove: vi.fn(async (key: string) => {delete stored[key];})}},
    tabs: {create: vi.fn(), update: vi.fn(async (id: number) => tabs.get(id)), query: vi.fn(async () => [...tabs.values()]), get: vi.fn(async (id: number) => {const tab = tabs.get(id); if (!tab) throw new Error('closed'); return tab;}),
      reload: vi.fn(async (id: number) => {for (const fn of updated) {fn(id, {status: 'loading'}); fn(id, {status: 'complete'});}}),
      onUpdated: {addListener: vi.fn(fn => updated.add(fn)), removeListener: vi.fn(fn => updated.delete(fn))}, onRemoved: {addListener: vi.fn(fn => {removed = fn;})}},
    scripting: {executeScript: vi.fn(async (request: {target: {tabId: number}; files?: string[]; args?: unknown[]}) => {
      if (request.files) {injected.add(request.target.tabId); return [{result: null}];}
      if (!request.args) return [{result: injected.has(request.target.tabId)}];
      if (!injected.has(request.target.tabId)) return [{result:{needsBridge:true}}];
      return [{result: {ok: true, value: ['templates/home.twig']}}];})}
  } as unknown as typeof chrome;
  vi.stubGlobal('chrome', chromeMock); await import('../src/browser/background');
});
afterEach(() => {vi.unstubAllGlobals();});
describe('painel lateral, permissões e isolamento do editor', () => {
  test('captura pública usa autorização por sessão e leitura; expira ao desbloquear',async()=>{
    const token=await open(),ctx={storeName:'Fictícia A',previewOrigin:'https://store-a.invalid',editorOrigin:'https://app.yampi.com.br'};
    vi.mocked(chromeMock.scripting.executeScript).mockImplementation(async request=>'args' in request&&request.args?[{result:{ok:true,value:ctx}}]:[{result:true}]);
    const fetcher=vi.fn(async()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}));vi.stubGlobal('fetch',fetcher);
    await message(token,{action:'lock',access:'write'});expect((await message(token,{action:'preview-fetch',preview:{url:'https://store-a.invalid/a.svg',context:ctx}})).error).toContain('leitura');expect(fetcher).not.toHaveBeenCalled();
    await message(token,{action:'unlock'});await message(token,{action:'lock',access:'read'});
    expect((await message(token,{action:'preview-allow',preview:{origins:['https://cdn-a.invalid'],context:ctx}})).ok).toBe(true);
    expect((await message(token,{action:'preview-fetch',preview:{url:'https://cdn-a.invalid/a.svg',context:ctx}})).ok).toBe(true);expect(fetcher).toHaveBeenCalledWith('https://cdn-a.invalid/a.svg',expect.objectContaining({credentials:'omit',redirect:'manual'}));
    expect((await message(token,{action:'preview-fetch',preview:{url:'https://cdn-b.invalid/a.svg',context:ctx}})).ok).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);
    await message(token,{action:'unlock'});expect(stored[token].previewOrigins).toBeUndefined();await message(token,{action:'lock',access:'read'});expect((await message(token,{action:'preview-fetch',preview:{url:'https://cdn-a.invalid/a.svg',context:ctx}})).ok).toBe(false);
  });
  test('captura pública rejeita permissão ausente e mudança de loja durante o GET',async()=>{
    const token=await open(),ctx={storeName:'Fictícia A',previewOrigin:'https://store-a.invalid',editorOrigin:'https://app.yampi.com.br'};let current=ctx;
    vi.mocked(chromeMock.scripting.executeScript).mockImplementation(async request=>'args' in request&&request.args?[{result:{ok:true,value:current}}]:[{result:true}]);
    const fetcher=vi.fn(async()=>{current={...ctx,storeName:'Fictícia B'};return new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}});});vi.stubGlobal('fetch',fetcher);await message(token,{action:'lock',access:'read'});
    vi.mocked(chromeMock.permissions.contains).mockImplementationOnce(async()=>false);expect((await message(token,{action:'preview-fetch',preview:{url:'https://store-a.invalid/a.svg',context:ctx}})).error).toContain('concedida');expect(fetcher).not.toHaveBeenCalled();
    expect((await message(token,{action:'preview-fetch',preview:{url:'https://store-a.invalid/a.svg',context:ctx}})).ok).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test('painel global desativado: trocar de aba nunca habilita outro painel', async () => {
    expect(chromeMock.sidePanel.setOptions).toHaveBeenCalledWith({enabled: false});
    await open(1);
    for (const fn of updated) fn(2, {url: 'https://outro.invalid/'});
    expect(chromeMock.sidePanel.setOptions).toHaveBeenLastCalledWith({tabId: 2, enabled: false});
    expect(chromeMock.sidePanel.open).toHaveBeenCalledTimes(1);
  });
  test('fechar desativa a aba até um novo clique, sem encerrar gravação em andamento', async () => {
    const token = await open(); await message(token, {action: 'lock', access: 'write'});
    panelClosed({tabId: 1, path: 'panel.html?tab=1'});
    await vi.waitFor(() => expect(chromeMock.sidePanel.setOptions).toHaveBeenLastCalledWith({tabId: 1, enabled: false}));
    expect(stored[token].locked).toBe(true);
    for (const fn of updated) fn(1, {url: 'https://app.yampi.com.br/store/'});
    expect(chromeMock.sidePanel.setOptions).toHaveBeenLastCalledWith({tabId: 1, enabled: false});
    expect(chromeMock.sidePanel.open).toHaveBeenCalledTimes(1);
  });
  test('fora do editor abre somente orientação nativa, sem sessão, navegação ou injeção', async () => {
    await clicked({id: 1, url: 'https://outro.invalid/'} as chrome.tabs.Tab);
    expect(chromeMock.sidePanel.open).toHaveBeenCalledWith({tabId: 1});
    expect(chromeMock.sidePanel.setOptions).toHaveBeenCalledWith({tabId: 1, path: 'guide.html?tab=1', enabled: true});
    expect(chromeMock.storage.session.set).not.toHaveBeenCalled();expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();expect(stored).toEqual({});
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({text: '', tabId: 1});
  });
  test('fechamento atrasado da orientação não desativa o painel do editor', async () => {
    await clicked({id: 1, url: 'https://outro.invalid/'} as chrome.tabs.Tab);
    await open();
    panelClosed({tabId: 1, path: 'guide.html?tab=1'});
    await vi.waitFor(() => expect(chromeMock.sidePanel.getOptions).toHaveBeenCalled());
    expect(panelOptions.get(1)).toMatchObject({path: 'panel.html?tab=1', enabled: true});
  });
  test('novo clique invalida uma conferência de fechamento ainda pendente', async () => {
    await open();
    let finish!: (options: chrome.sidePanel.PanelOptions) => void;
    vi.mocked(chromeMock.sidePanel.getOptions).mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
    panelClosed({tabId: 1, path: 'panel.html?tab=1'});
    await open();
    finish({path: 'panel.html?tab=1', enabled: true});
    await Promise.resolve(); await Promise.resolve();
    expect(panelOptions.get(1)).toMatchObject({path: 'panel.html?tab=1', enabled: true});
  });
  test('a orientação não pode se autenticar como painel de código', async () => {
    const token=await open();
    expect((await message(token,{action:'lock'},{id:extId,url:`chrome-extension://${extId}/guide.html?tab=1`})).ok).toBe(false);
    expect(stored[token].locked).toBe(false);
  });
  test('atualização limpa os avisos antigos sem abrir painel ou ler páginas', async () => {
    installed();
    await vi.waitFor(()=>expect(chromeMock.action.setBadgeText).toHaveBeenCalledTimes(2));
    expect(chromeMock.sidePanel.open).not.toHaveBeenCalled();expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeMock.action.setTitle).toHaveBeenCalledWith({tabId:1,title:expect.stringContaining('Editor de código da Yampi')});
  });
  test('abre painel nativo antes de esperar storage, sem criar outra aba', async () => {
    const opening = clicked({id: 1, url} as chrome.tabs.Tab);
    expect(chromeMock.sidePanel.open).toHaveBeenCalledWith({tabId: 1});
    expect(chromeMock.storage.session.get).not.toHaveBeenCalled();
    await opening; expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    expect(chromeMock.sidePanel.setOptions).toHaveBeenCalledWith(expect.objectContaining({tabId: 1, enabled: true}));
  });
  test('erro da API do painel fica no ícone, sem abrir uma aba alternativa', async () => {
    vi.mocked(chromeMock.sidePanel.open).mockRejectedValueOnce(new Error('Painel indisponível'));
    await clicked({id: 1, url} as chrome.tabs.Tab);
    expect(chromeMock.action.setTitle).toHaveBeenCalledWith({tabId: 1, title: 'Painel indisponível'}); expect(chromeMock.tabs.create).not.toHaveBeenCalled();
  });
  test('uma aba ou iframe que imita o painel não pode acessar o editor', async () => {
    const token = await open();
    expect((await message(token, {action: 'lock'}, {...sender(token), tab: {id: 100} as chrome.tabs.Tab})).ok).toBe(false);
    expect((await message(token, {action: 'lock'}, {...sender(token), frameId: 2})).ok).toBe(false);
    context(token, `doc-${token}`, 'TAB');
    expect((await message(token, {action: 'lock'})).ok).toBe(false);
    context(token); contexts.get(`doc-${token}`)!.frameId = 2;
    expect((await message(token, {action: 'lock'})).ok).toBe(false);
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  test('rejeita token divergente e documento de outro painel', async () => {
    const token = await open();
    expect((await message(token, {action: 'lock'}, {...sender(token), url: `chrome-extension://${extId}/panel.html?tab=outro`})).ok).toBe(false);
    await message(token, {action: 'lock'}); context(token, 'another-document');
    expect((await message(token, {action: 'lock'}, sender(token, 'another-document'))).error).toContain('Outro painel');
  });
  test('abrir e reabrir não autoriza extração automática nem leitura de arquivos', async () => {
    const token = await open(); await open();
    expect(stored[token].locked).toBe(false); expect(stored[token].access).toBeUndefined();
    expect((await message(token, {action: 'auto-export'})).ok).toBe(false);
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  test('sem lock não lê e não grava', async () => {
    const token = await open(); expect((await message(token, {command: {op: 'write'}})).ok).toBe(false); expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  test('lock de leitura bloqueia gravação antes de injetar qualquer comando', async () => {
    const token = await open(); await message(token, {action: 'lock', access: 'read'});
    expect((await message(token, {command: {op: 'write', path: 'templates/home.twig', expected: 'a', content: ''}})).error).toContain('apenas copiar');
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
    await message(token, {action: 'unlock'}); await message(token, {action: 'lock'});
    expect((await message(token, {command: {op: 'write'}})).ok).toBe(false);
  });
  test('permissão de envio expira ao terminar e não fica disponível para a cópia', async () => {
    const token = await open(); await message(token, {action: 'lock', access: 'write'});
    expect((await message(token, {command: {op: 'write'}})).ok).toBe(true);
    await message(token, {action: 'unlock'}); expect(stored[token].access).toBeUndefined();
    await message(token, {action: 'lock', access: 'read'});
    expect((await message(token, {command: {op: 'write'}})).ok).toBe(false);
  });
  test('heartbeat exige painel e aba corretos e não injeta nem altera locks', async () => {
    const token = await open(), other = await open(2);
    expect((await message(token, {action: 'heartbeat'})).ok).toBe(true); expect(stored[token].locked).toBe(false);
    await message(token, {action: 'lock'}); await message(token, {action: 'heartbeat'}); expect(stored[token].locked).toBe(true);
    expect((await message(token, {action: 'heartbeat'}, sender(other))).error).toContain('outra aba');
    tabs.get(1)!.url = 'https://app.yampi.com.br/store/themes';
    expect((await message(token, {action: 'heartbeat'})).error).toContain('origem mudou');
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  test('desconectar port antigo não libera lock do mesmo documento reconectado', async () => {
    const token = await open(), closeOld = port(token), closeNew = port(token);
    await message(token, {action: 'lock'}); closeOld(false);
    await message(token, {action: 'heartbeat'}); expect(stored[token].locked).toBe(true);
    closeNew(); await vi.waitFor(() => expect(stored[token].locked).toBe(false));
  });
  test('novo clique durante operação reutiliza a sessão', async () => {
    const token = await open(); await message(token, {action: 'lock'});
    expect(await open()).toBe(token); expect(Object.keys(stored)).toHaveLength(1);
    await message(token, {action: 'unlock'}); expect(await open()).toBe(token);
    expect(stored[token].locked).toBe(false); expect(stored[token].access).toBeUndefined();
  });
  test('handshake identifica só a sessão da aba indicada pelo painel nativo', async () => {
    const a = await open(), b = await open(2);
    expect((await message(a, {action: 'session'})).value).toBe(a);
    expect((await message(b, {action: 'session'})).value).toBe(b);
    expect((await message(a, {action: 'lock'}, sender(b))).error).toContain('outra aba');
  });
  test('abas de lojas diferentes conservam sessões independentes', async () => {
    const a = await open(), b = await open(2);
    expect((await message(a, {action: 'lock'})).ok).toBe(true); expect((await message(b, {action: 'lock'})).ok).toBe(true);
    await message(b, {command: {op: 'inventory'}});
    expect(vi.mocked(chromeMock.scripting.executeScript).mock.calls.every(([r]) => r.target.tabId === 2)).toBe(true);
  });
  test('refresh aguarda loading e complete, ignorando complete antigo', async () => {
    const token = await open(); await message(token, {action: 'lock'}); let response = false;
    vi.mocked(chromeMock.tabs.reload).mockImplementation(async () => {});
    const wait = message(token, {action: 'refresh'}).then(value => {response = true; return value;});
    await vi.waitFor(() => expect(updated.size).toBe(2));
    for (const fn of updated) fn(1, {status: 'complete'});
    await Promise.resolve(); expect(response).toBe(false);
    for (const fn of updated) {fn(1, {status: 'loading'}); fn(1, {status: 'complete'});}
    expect((await wait).ok).toBe(true); expect(updated.size).toBe(1);
  });
  test('navegação da origem invalida a sessão', async () => {
    const token = await open(); await message(token, {action: 'lock'}); tabs.get(1)!.url = 'https://app.yampi.com.br/store/themes';
    expect((await message(token, {command: {op: 'inventory'}})).error).toContain('origem mudou'); expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  test('somente comandos permitidos no MAIN world, sem publicação', async () => {
    const token = await open(); await message(token, {action: 'lock'}); await message(token, {command: {op: 'inventory'}});
    expect(vi.mocked(chromeMock.scripting.executeScript).mock.calls.every(([r]) => r.target.tabId === 1 && r.world === 'MAIN')).toBe(true);
    const calls = vi.mocked(chromeMock.scripting.executeScript).mock.calls.length;
    expect((await message(token, {command: {op: 'publish'}})).ok).toBe(false); expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(calls);
  });
  test('adaptador existente não é reinjetado durante uma operação', async () => {
    const token = await open(); await message(token, {action: 'lock'});
    await message(token, {command: {op: 'inventory'}}); await message(token, {command: {op: 'inventory'}});
    expect(vi.mocked(chromeMock.scripting.executeScript).mock.calls.filter(([r]) => 'files' in r)).toHaveLength(1);
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(4);
    injected.delete(1); // A reload destroys the previously injected bridge.
    await message(token,{command:{op:'inventory'}});
    expect(vi.mocked(chromeMock.scripting.executeScript).mock.calls.filter(([r])=>'files' in r)).toHaveLength(2);
  });
  test('fechar painel espera a gravação pendente antes de liberar a sessão', async () => {
    const token = await open(); const close = port(token); await message(token, {action: 'lock', access: 'write'});
    let finish!: () => void;
    vi.mocked(chromeMock.scripting.executeScript).mockImplementationOnce(() => new Promise(resolve => {finish = () => resolve([{result: true}]);}));
    const writing = message(token, {command: {op: 'write', path: 'templates/home.twig'}});
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); close(); await Promise.resolve(); expect(stored[token].locked).toBe(true);
    finish(); await writing; await vi.waitFor(() => expect(stored[token].locked).toBe(false)); expect(stored[token].documentId).toBeUndefined();
  });
  test('fechar editor remove a sessão', async () => {
    const token = await open(); await removed(1); expect(stored[token]).toBeUndefined();
    expect((await message(token, {action: 'lock'})).ok).toBe(false);
  });
});
const runnerSender = (documentId = 'runner-doc'): chrome.runtime.MessageSender => ({id: extId, url: `chrome-extension://${extId}/runner.html`, documentId});
const shop = {storeName: 'Fictícia A', previewOrigin: 'https://store-a.invalid', editorOrigin: 'https://app.yampi.com.br'};
async function fromRunner(input: Record<string, unknown>, source = runnerSender()) {
  return new Promise<{ok: boolean; value?: unknown; error?: string}>(resolve => {
    const accepted = listener(input, source, result => resolve(result as {ok: boolean; value?: unknown; error?: string}));
    if (!accepted) resolve({ok: false, error: 'rejected-sender'});
  });
}
async function startJob(kind: 'send' | 'compare' = 'send') {
  const token = await open(), id = 'job-' + kind + '-0001';
  const reply = await message(token, {action: 'job-start', job: {id, kind, scope: 'project'}, context: shop});
  return {token, id, reply};
}
const jobState = (id: string, status: string, fraction = 0.5) => ({id, kind: 'send', status, context: shop, title: 'Enviando para Fictícia A', detail: '', phases: [], fraction, elapsedMs: 0, startedAt: 0, updatedAt: 0, events: []});
const storedJob = () => (stored as unknown as Record<string, {status: string; fraction: number}>)['job:1'];
describe('operações em segundo plano: o painel pode fechar', () => {
  test('iniciar entrega o editor à execução em segundo plano, com acesso só do tipo da operação', async () => {
    const {token, id, reply} = await startJob();
    expect(reply.ok).toBe(true);
    expect(stored[token]).toMatchObject({locked: true, access: 'write', job: id});
    expect(chromeMock.offscreen.createDocument).toHaveBeenCalledWith(expect.objectContaining({url: 'runner.html'}));
    expect(runnerMessages.find(m => m.target === 'runner' && m.action === 'start')).toMatchObject({job: {id, kind: 'send'}, tabId: 1, token});
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(1, {autoDiscardable: false});
    expect((await message(token, {action: 'job-start', job: {id: 'job-compare-0002', kind: 'compare'}, context: shop})).error).toContain('em andamento');
  });
  test('fechar o painel não libera o editor; outro painel acompanha, mas não comanda o editor', async () => {
    const {token} = await startJob(), close = port(token);
    close(); await new Promise(r => setTimeout(r, 0));
    expect(stored[token].locked).toBe(true);
    context(token, 'doc-new');
    expect((await message(token, {action: 'heartbeat'}, sender(token, 'doc-new'))).ok).toBe(true);
    expect((await message(token, {action: 'lock', access: 'read'}, sender(token, 'doc-new'))).error).toContain('segundo plano');
    expect((await message(token, {command: {op: 'read', path: 'templates/home.twig'}}, sender(token, 'doc-new'))).ok).toBe(false);
    expect((await message(token, {action: 'unlock'}, sender(token, 'doc-new'))).ok).toBe(true);
    expect(stored[token].locked).toBe(true);
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  test('a execução em segundo plano só age na aba e na operação que recebeu', async () => {
    const {token, id} = await startJob(), other = await open(2);
    expect((await fromRunner({runner: id, session: token, command: {op: 'inventory'}})).ok).toBe(true);
    expect(vi.mocked(chromeMock.scripting.executeScript).mock.calls.every(([r]) => r.target.tabId === 1)).toBe(true);
    expect((await fromRunner({runner: 'outra-operacao', session: token, command: {op: 'inventory'}})).error).toContain('não autorizada');
    expect((await fromRunner({runner: id, session: other, command: {op: 'inventory'}})).error).toContain('não autorizada');
    // A tab, a page or another extension page cannot pose as the runner.
    expect((await fromRunner({runner: id, session: token, command: {op: 'inventory'}}, {...runnerSender(), tab: {id: 5} as chrome.tabs.Tab})).error).toBe('rejected-sender');
    expect((await fromRunner({runner: id, session: token, command: {op: 'inventory'}}, {...runnerSender(), url: `chrome-extension://${extId}/panel.html?tab=1`})).error).toBe('rejected-sender');
    expect((await fromRunner({runner: id, session: token, command: {op: 'inventory'}}, runnerSender('documento-falso'))).ok).toBe(false);
    expect((await fromRunner({runner: id, session: token, command: {op: 'publish'}})).ok).toBe(false);
  });
  test('comparação em segundo plano não pode gravar', async () => {
    const {token, id} = await startJob('compare');
    expect(stored[token].access).toBe('read');
    expect((await fromRunner({runner: id, session: token, command: {op: 'write', path: 'templates/home.twig', expected: 'a', content: 'b'}})).error).toContain('apenas copiar');
  });
  test('progresso fica no ícone; o fim libera o editor e avisa quando o painel está fechado', async () => {
    const {token, id} = await startJob();
    contexts.delete(`doc-${token}`);
    await fromRunner({runner: id, session: token, action: 'job-report', state: jobState(id, 'running', 0.42)});
    expect(storedJob()).toMatchObject({status: 'running', fraction: 0.42});
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({tabId: 1, text: '42%'});
    await fromRunner({runner: id, session: token, action: 'job-finish', state: {...jobState(id, 'completed', 1), result: {kind: 'send', verified: 3, uploaded: 1, created: 1, total: 4, warnings: []}}});
    expect(stored[token]).toMatchObject({locked: false}); expect(stored[token].job).toBeUndefined();
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({tabId: 1, text: '✓'});
    expect(chromeMock.notifications.create).toHaveBeenCalledWith(expect.stringContaining('zirtuno:1:'), expect.objectContaining({title: 'Envio concluído · Fictícia A', message: expect.stringContaining('4 itens conferidos')}));
    expect(chromeMock.tabs.update).toHaveBeenLastCalledWith(1, {autoDiscardable: true});
    // After the end, a panel can use the editor again.
    context(token);
    expect((await message(token, {action: 'lock', access: 'read'})).ok).toBe(true);
  });
  test('com o painel aberto não há notificação', async () => {
    const {token, id} = await startJob();
    await fromRunner({runner: id, session: token, action: 'job-finish', state: jobState(id, 'completed', 1)});
    expect(chromeMock.notifications.create).not.toHaveBeenCalled();
  });
  test('download pedido pela execução aceita só endereços da própria extensão', async () => {
    const {token, id} = await startJob();
    expect((await fromRunner({runner: id, session: token, action: 'job-download', url: 'https://outra.invalid/a.zip', name: 'a.zip'})).ok).toBe(false);
    expect((await fromRunner({runner: id, session: token, action: 'job-download', url: `blob:chrome-extension://${extId}/123`, name: '../a.zip'})).ok).toBe(false);
    expect((await fromRunner({runner: id, session: token, action: 'job-download', url: `blob:chrome-extension://${extId}/123`, name: 'backup-antes-do-envio-loja.zip'})).ok).toBe(true);
    expect(chromeMock.downloads.download).toHaveBeenCalledTimes(1);
  });
  test('operação sem execução viva é marcada como interrompida e libera o editor', async () => {
    const {token, id} = await startJob();
    await fromRunner({runner: id, session: token, action: 'job-report', state: jobState(id, 'running')});
    runnerHas = false;
    const reply = await message(token, {action: 'job-state'});
    expect(reply.value).toMatchObject({status: 'failed', error: expect.stringContaining('reiniciada')});
    expect(stored[token].locked).toBe(false);
  });
  test('o ícone durante a operação reabre o painel sem apagar o progresso', async () => {
    const {token, id} = await startJob();
    await fromRunner({runner: id, session: token, action: 'job-report', state: jobState(id, 'running', 0.3)});
    vi.mocked(chromeMock.action.setBadgeText).mockClear();
    expect(await open()).toBe(token);
    expect(chromeMock.action.setBadgeText).not.toHaveBeenCalled();
  });
  test('fechar a aba do editor cancela a operação e apaga a sessão', async () => {
    const {token, id} = await startJob();
    await fromRunner({runner: id, session: token, action: 'job-report', state: jobState(id, 'running')});
    await removed(1);
    expect(runnerMessages.some(m => m.target === 'runner' && m.action === 'cancel')).toBe(true);
    expect(stored[token]).toBeUndefined();
  });
});
describe('atualizar o projeto pelo worker', () => {
  test('a leitura para atualizar só lê; atualizar nunca é um envio', async () => {
    const token = await open();
    expect((await message(token, {action: 'job-start', job: {id: 'job-update-0001', kind: 'send', scope: 'update'}, context: shop})).error).toBe('Operação inválida.');
    expect((await message(token, {action: 'job-start', job: {id: 'job-update-0002', kind: 'compare', scope: 'update', full: true}, context: shop})).ok).toBe(true);
    expect(stored[token]).toMatchObject({locked: true, access: 'read', job: 'job-update-0002'});
    expect(runnerMessages.find(m => m.target === 'runner' && m.action === 'start')).toMatchObject({job: {id: 'job-update-0002', kind: 'compare', scope: 'update', full: true}});
  });
});
