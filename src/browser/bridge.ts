import {sanitizeRaw} from '../core/preview';
import type {EditorView} from '@codemirror/view';
import {editorView, readDocument} from './editor-document';
import {assertContext, validatePath, validatePaths, validateImage, imagePath, writable, creatableName, uploadablePath, imageType, dataUrlBytes, MAX_FILE_BYTES, type Context} from '../core/model';
import {openSession, readFiles, YAMPI_SERVER, type Server} from './server-read';
import {includeSpot} from '../../local-runtime/dependencies.mjs';
// directOpen/directRead: copies straight from the editor's own server (see server-read.ts).
export interface Command {op: 'context' | 'inventory' | 'read' | 'readAsset' | 'visual' | 'write' | 'create' | 'upload' | 'links' | 'directOpen' | 'directRead'; context?: Context; path?: string; paths?: string[]; store?: string; expected?: string; content?: string}
export const version = '0.10.7';
type Reply = {ok: true; value: unknown} | {ok: false; error: string};
const clean = (e: Element | null) => e?.textContent?.trim() || '';
type EditorRoot = ShadowRoot | HTMLElement;
let activeRoot: EditorRoot | undefined;
function discoverRoot(): EditorRoot {
  const hosts = document.querySelectorAll<HTMLElement>('yampi-code-editor');
  if (hosts.length !== 1) throw new Error('Componente do editor Yampi não reconhecido. Abra o editor de código e aguarde o carregamento.');
  // The real editor is a custom element with an open shadow root. Never search the surrounding app.
  const root = hosts[0].shadowRoot || hosts[0];
  if (root.querySelectorAll('aside').length !== 1 || root.querySelectorAll('main').length !== 1 || !root.querySelector('aside .collapse-list > .folder-title')) throw new Error('A estrutura de arquivos do editor ainda não está disponível ou mudou. Tente conectar novamente após o carregamento.');
  return root;
}
function root(): EditorRoot {
  const current = discoverRoot();
  if (activeRoot && current !== activeRoot) throw new Error('O componente do editor mudou durante a operação. Operação interrompida.');
  return current;
}
function findButton(label: string): HTMLButtonElement {
  const matches = [...root().querySelectorAll<HTMLButtonElement>('main button')].filter(b => clean(b) === label);
  if (matches.length !== 1) throw new Error(`Controle do editor não reconhecido: ${label}`);
  return matches[0];
}
let previewAnchor: HTMLAnchorElement | undefined;
function previewLink(): URL {
  getContext();
  const url = new URL(previewAnchor!.href);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('URL de prévia inválida.');
  return url;
}
function getContext(): Context {
  const headers = root().querySelectorAll('header');
  if (headers.length !== 1) throw new Error('Cabeçalho do componente do editor não reconhecido.');
  const header = headers[0];
  const dividers = header.querySelectorAll('.divider');
  const previews = header.querySelectorAll<HTMLAnchorElement>('a[href][target="_blank"]');
  if (dividers.length !== 1 || previews.length !== 1) throw new Error('Identificação da loja e link de prévia não reconhecidos no cabeçalho. Nenhum arquivo foi enviado.');
  previewAnchor = previews[0];
  const divider = dividers[0];
  const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
  const names: string[] = []; let found = false;
  // The store is the only non-control text after the separator and before the preview link.
  // Editor/preview titles and generated Vue attributes are not identity signals.
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (parent?.closest('a') === previews[0]) break;
    if (!parent || parent.closest('script,style,button,input,[hidden],[aria-hidden="true"]')) continue;
    if (divider.compareDocumentPosition(walker.currentNode) & Node.DOCUMENT_POSITION_FOLLOWING) found = true;
    const value = walker.currentNode.textContent?.trim();
    if (!value) continue;
    if (found) names.push(value);
  }
  if (names.length !== 1) throw new Error('Nome da loja não reconhecido no cabeçalho do editor. Nenhum arquivo foi enviado.');
  const storeName = names[0];
  const preview = new URL(previews[0].href);
  if (!['https:', 'http:'].includes(preview.protocol)) throw new Error('URL de prévia inválida.');
  return {storeName, previewOrigin: preview.origin, editorOrigin: location.origin};
}
function pathFor(file: Element): string {
  const parts = [clean(file)];
  let node = file.parentElement;
  while (node && node.tagName !== 'ASIDE') {
    if (node.classList.contains('collapse-list')) {
      const title = [...node.children].find(c => c.classList.contains('folder-title'));
      const label = title && [...title.children].find(c => c.tagName === 'SPAN');
      if (!label) throw new Error('Pasta sem identificação.');
      parts.unshift(clean(label));
    }
    node = node.parentElement;
  }
  const path = parts.join('/');
  return path.startsWith('logs/') ? path : validatePath(path);
}
// The tree's files. A row being edited (a file being created or renamed) shows a name that is not
// a file of the store yet: never listed.
const treeNames = () => [...root().querySelectorAll<HTMLElement>('aside .file-name')].filter(node => !node.closest('.editing-row'));
function inventory(): Map<string, HTMLElement> {
  const entries=treeNames().map(node=>[pathFor(node),node] as const).filter(([path])=>!path.startsWith('logs/'));
  const paths = entries.map(([path])=>path);
  validatePaths(paths);
  return new Map(entries);
}
async function completeInventory(context: Context): Promise<string[]> {
  let opened = 0;
  for (;;) {
    guard(context); assertClean();
    const folder = [...root().querySelectorAll<HTMLElement>('aside .collapse-list:not(.active)')].find(node => {
      const title = [...node.children].find(c => c.classList.contains('folder-title'));
      return clean(title || null) !== 'logs';
    });
    if (!folder) break;
    if (++opened > 3000) throw new Error('Árvore de pastas ultrapassa os limites.');
    const title = [...folder.children].find(c => c.classList.contains('folder-title')) as HTMLElement | undefined;
    if (!title) throw new Error('Pasta não reconhecida.');
    title.click(); await until(() => folder.classList.contains('active'), 10000, () => `a pasta ${clean(title)} abrir na árvore`);
  }
  const settled = stability();
  await until(() => {
    guard(context);
    return settled(root().querySelector('aside [aria-busy="true"], aside .loading, aside .spinner, aside .loader-bg') ? undefined : JSON.stringify([...inventory().keys()].sort()));
  }, 10000, 'a árvore de arquivos terminar de carregar');
  // A lazy tree can add folders after the initial expansion.
  if ([...root().querySelectorAll('aside .collapse-list:not(.active)')].some(n => clean([...n.children].find(c => c.classList.contains('folder-title')) || null) !== 'logs')) throw new Error('A árvore adicionou pastas durante a leitura. Exporte novamente.');
  return [...inventory().keys()].sort();
}
function view(): EditorView {
  const contents = root().querySelectorAll<HTMLElement>('main .cm-content');
  if (contents.length !== 1) throw new Error('Editor CodeMirror não reconhecido; nenhuma operação realizada.');
  return editorView(contents[0]);
}
function dirty(): boolean {
  const buttons = [...root().querySelectorAll<HTMLButtonElement>('main button')].filter(b => clean(b) === 'Salvar arquivo');
  // Tabs with unsaved changes: the close button marked "has-changes" since the editor of 05/11/2026;
  // a change icon before it.
  return buttons.some(b => !b.disabled) || !!root().querySelector('main .tab-item .close-button.has-changes, main .tab-item .holder-icon circle, main .tab-item .change-icon, main .tab-item .unsaved, main .tab-item.dirty');
}
function assertClean(): void {
  // After a refused save the change stays in its tab: closing the tab without saving discards it.
  if (dirty()) throw new Error('Existe um arquivo com alterações não salvas no editor. Feche a aba dele sem salvar, ou salve-o se a alteração for sua, antes de continuar.');
}
function guard(context: Context): void {assertContext(context, getContext());}
// Waits react to the editor's own DOM changes. In a hidden tab the browser runs timers about
// once a second, and chained timers can wait up to a minute; DOM changes still arrive at once.
// The fallback check hops through a message first, so its timer never counts as chained.
// what: the step being waited for, named in the error so a stop says where it stopped.
async function until(check: () => boolean, timeout = 10000, what?: string | (() => string)): Promise<void> {
  if (check()) return;
  const target: Node = activeRoot ?? document;
  await new Promise<void>((resolve, reject) => {
    const start = performance.now();
    let done = false, timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => test());
    const finish = (error?: unknown) => {
      if (done) return;
      done = true; observer.disconnect(); target.removeEventListener('load', test, true); clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    function test() {
      if (done) return;
      try {if (check()) {finish(); return;}} catch (error) {finish(error); return;}
      // A hidden tab answers slower: allow it more time before calling it a failure.
      if (performance.now() - start > (document.hidden ? timeout * 3 : timeout)) {
        let step = '';
        try {step = typeof what === 'function' ? what() : what || '';} catch { /* The generic message still stops the operation. */ }
        finish(new Error(`O editor não confirmou a operação dentro do prazo${step ? `: esperava ${step}` : ''}.`));
      }
    }
    function schedule() {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {channel.port1.close(); if (!done) timer = setTimeout(() => {test(); if (!done) schedule();}, 80);};
      channel.port2.postMessage(null);
    }
    observer.observe(target, {subtree: true, childList: true, attributes: true, characterData: true});
    target.addEventListener('load', test, true);
    schedule();
  });
}
// The same value for at least 320 ms, seen at least twice: a file opens before its content
// arrives, and the editor can swap documents while loading.
function stability(ms = 320): (value: unknown) => boolean {
  let last: unknown, since = 0, checks = 0;
  return value => {
    if (value === undefined || value !== last) {last = value; since = performance.now(); checks = 0; return false;}
    return ++checks >= 2 && performance.now() - since >= ms;
  };
}
// How the editor answers a save (public editor modules 550f3324 and 030ca37f, read on 13/11/2026).
// While it sends, the button (DsButton, as "Adicionar arquivo") carries "sending" and a loader with
// a spinner. Saved, the button turns off in the same update that ends the sending. Refused, the
// button stays on and the file stays marked as changed; when the Yampi server explains the refusal
// (HTTP 406), its message goes to a red box above the tabs, and any other refusal shows nothing.
// A box stays until the next save that works, or until closed.
const sending = (button: HTMLButtonElement) => button.classList.contains('sending') || !!button.querySelector('.loading, .spinner, .button__loader, .button__spinner');
const errorBoxes = () => [...root().querySelectorAll<HTMLElement>('main .has-error > .bg-red-pure')];
function saveError(): string {return errorBoxes().map(box => box.textContent?.trim() || '').filter(Boolean).join('\n');}
// A box left by an earlier refusal would read as this save's: the same refusal again changes
// nothing on screen, and neither does a refusal without a message. Its own icon closes it, which
// only hides the notice. Best effort: a box that stays is compared with what comes after.
async function dismissSaveError(): Promise<void> {
  const boxes = errorBoxes();
  if (!boxes.length) return;
  for (const box of boxes) box.querySelector('svg')?.dispatchEvent(new MouseEvent('click', {bubbles: true, composed: true}));
  await until(() => !saveError(), 3000).catch(() => {});
}
// The refusal in the user's terms, with the stretch Yampi read as an inclusion when it names one.
function refusal(path: string, message: string, content: string): string {
  const named = /incluir o arquivo '([\s\S]*?)'\.(?:\s|$)/i.exec(message)?.[1];
  const spot = named === undefined ? undefined : includeSpot(content, named);
  const where = spot ? ` Ela leu como inclusão de arquivo a palavra include seguida de aspas na linha ${spot.line} (${spot.excerpt}).` : '';
  return `A Yampi recusou salvar ${path}: ${message.replace(/\s+/g, ' ').trim()}${where} A loja continua com a versão anterior. A alteração ficou só na aba do editor: feche essa aba sem salvar, corrija o projeto e compare de novo.`;
}
function selectedPath(): string | undefined {
  const selected = root().querySelectorAll('aside .collapse-item.selected .file-name');
  return selected.length === 1 ? pathFor(selected[0]) : undefined;
}
async function open(path: string, context: Context, reading=false): Promise<void> {
  guard(context);
  assertClean();
  validatePath(path);
  // Full inventories are still checked before/after capture and on every write.
  // A read only resolves matching names, including their complete directory path.
  const candidates=reading?treeNames().filter(n=>clean(n)===path.split('/').pop()&&pathFor(n)===path):[];
  if(candidates.length>1)throw new Error('O arquivo tem caminhos duplicados na árvore. Operação interrompida.');
  const item = reading?candidates[0]:inventory().get(path);
  if (!item) throw new Error(`O arquivo não existe na loja: ${path}. A extensão não cria duplicatas.`);
  const parents: HTMLElement[] = [];
  for (let n = item.parentElement; n && n.tagName !== 'ASIDE'; n = n.parentElement) if (n.classList.contains('collapse-list')) parents.unshift(n);
  for (const parent of parents) if (!parent.classList.contains('active')) {
    const title = [...parent.children].find(c => c.classList.contains('folder-title')) as HTMLElement | undefined;
    if (!title) throw new Error('Árvore do editor não reconhecida.');
    title.click();
    await until(() => parent.classList.contains('active'), 10000, () => `a pasta ${clean(title)} abrir na árvore`);
  }
  item.click();
  await until(() => {
    guard(context);
    const image = root().querySelector<HTMLImageElement>('main img');
    return selectedPath() === path && clean(root().querySelector('main .tab-item.active p')) === path.split('/').pop() && (imagePath(path) ? !!image?.complete && !!image.naturalWidth : !!root().querySelector('main .cm-content'));
  }, 10000, `${path} abrir no editor`);
  // CodeMirror and the active tab can switch before async file loading finishes. Require stable UI/document.
  const settled = stability();
  await until(() => {
    guard(context);
    if (selectedPath() !== path || root().querySelector('main [aria-busy="true"], main .loading, main .spinner, main .loader-bg')) return settled(undefined);
    // CodeMirror Text is immutable: a new document resets the same stability window.
    // Copy/validate the full text once after stabilization, rather than on each poll.
    return settled(imagePath(path) ? visibleImage().src : view().state.doc);
  }, 10000, `o conteúdo de ${path} terminar de carregar`);
  assertClean();
}
function visibleImage(): HTMLImageElement {
  const images = [...root().querySelectorAll<HTMLImageElement>('main img')];
  if (images.length !== 1 || !images[0].complete || !images[0].naturalWidth) throw new Error('Prévia da imagem não reconhecida. Nenhuma exportação parcial será entregue.');
  return images[0];
}
async function downloadImage(url: URL): Promise<Uint8Array> {
  const response = await fetch(url.href, {credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000)});
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error('Não foi possível baixar a imagem dentro dos limites.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Imagem sem conteúdo.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length; if (size > MAX_FILE_BYTES) throw new Error('Imagem grande demais.');
      chunks.push(value);
    }
  } finally {await reader.cancel().catch(() => {});}
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  return bytes;
}
// Only the real editor talks to the Yampi server; the fictitious one reaches it only when a test
// answers in its place.
function yampiServer(): Server {
  if (location.origin !== 'https://app.yampi.com.br') throw new Error('Leitura direta disponível só no editor da Yampi.');
  return {base: YAMPI_SERVER, fetch: (url, init) => fetch(url, init)};
}
async function readImage(path: string, context: Context): Promise<string> {
  const source = visibleImage().src;
  const url = new URL(source, location.href);
  if (url.username || url.password || (!['https:', 'data:', 'blob:'].includes(url.protocol) && url.origin !== location.origin) || (url.protocol === 'blob:' && url.origin !== location.origin)) throw new Error('Origem da imagem não permitida.');
  if (source.length > MAX_FILE_BYTES * 1.5) throw new Error('Imagem grande demais.');
  const bytes = url.protocol === 'data:' ? dataUrlBytes(source) : await downloadImage(url);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Imagem grande demais.');
  guard(context);
  if (selectedPath() !== path || visibleImage().src !== source) throw new Error('A imagem selecionada mudou durante a leitura.');
  validateImage(path, bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
// Creation goes through the editor's own controls, as a person would: the folder's "+"
// ("Adicionar arquivo"). Since the editor of 05/11/2026 (module web-component-030ca37f.js), it
// opens a row in the folder's list (NewFileInput): one field for the name with its extension, Enter
// confirms, Esc or losing the focus cancels, the row shows "sending" while the request runs and the
// error under the field. Earlier editors opened a window (name and extension apart). For
// assets/images, both open the image uploader. Yampi validates, saves to the draft and lists the file.
const EXTENSION_LABEL: Record<string, string> = {scss: 'SCSS', vue: 'Vue', twig: 'Twig'};
function folderPath(list: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = list; node && node.tagName !== 'ASIDE'; node = node.parentElement) {
    if (!node.classList.contains('collapse-list')) continue;
    const title = [...node.children].find(c => c.classList.contains('folder-title'));
    const label = title && [...title.children].find(c => c.tagName === 'SPAN');
    if (!label) throw new Error('Pasta sem identificação.');
    parts.unshift(clean(label));
  }
  return parts.join('/');
}
const activeDialogs = () => [...root().querySelectorAll<HTMLElement>('.ds-modal-overlay.ds-modal-overlay--active')];
function dialogButton(dialog: HTMLElement, label: string): HTMLButtonElement {
  const matches = [...dialog.querySelectorAll<HTMLButtonElement>('button')].filter(b => clean(b) === label);
  if (matches.length !== 1) throw new Error(`Controle da janela da Yampi não reconhecido: ${label}`);
  return matches[0];
}
// The new-file row of a folder: a direct child of the folder's own list, with its one field.
function editingRows(list: HTMLElement): HTMLElement[] {
  const items = [...list.children].find(c => c.tagName === 'UL');
  return items ? [...items.children].filter((c): c is HTMLElement => c.classList.contains('editing-row')) : [];
}
type AddControl = {kind: 'row'; row: HTMLElement; input: HTMLInputElement} | {kind: 'dialog'; dialog: HTMLElement};
async function openAddControl(folder: string, kind: 'file' | 'image', context: Context): Promise<AddControl> {
  if (activeDialogs().length) throw new Error('Há uma janela aberta no editor da Yampi. Feche-a e tente novamente.');
  const lists = [...root().querySelectorAll<HTMLElement>('aside .collapse-list')].filter(list => folderPath(list) === folder);
  if (lists.length !== 1) throw new Error(`A pasta ${folder} não existe no editor, e a Yampi não permite criar pastas.`);
  if (root().querySelector('aside .editing-row')) throw new Error('Há um arquivo sendo criado ou renomeado na árvore do editor da Yampi. Conclua ou cancele (Esc) e tente novamente.');
  const title = [...lists[0].children].find(c => c.classList.contains('folder-title'));
  const add = title && [...title.children].find(c => c.classList.contains('add-item')) as HTMLElement | undefined;
  if (!add) throw new Error(`Sem permissão para adicionar arquivos em ${folder}.`);
  guard(context);
  add.click();
  let found: AddControl | undefined;
  await until(() => {
    if (kind === 'file') {
      const rows = editingRows(lists[0]), inputs = rows.flatMap(row => [...row.querySelectorAll<HTMLInputElement>('input')]);
      if (rows.length === 1 && inputs.length === 1) {found = {kind: 'row', row: rows[0], input: inputs[0]}; return true;}
    }
    const open = activeDialogs();
    if (open.length !== 1 || clean(open[0].querySelector('.ds-modal h3')) !== 'Adicionar arquivo') return false;
    const fits = kind === 'file' ? !!open[0].querySelector('form .ds-select') && open[0].querySelectorAll('input.ds-input__field').length === 1 : open[0].querySelectorAll('.ds-file-uploader input.ds-file-uploader__input').length === 1;
    if (fits) found = {kind: 'dialog', dialog: open[0]};
    return fits;
  }, 10000, () => {
    const open = activeDialogs(), rows = editingRows(lists[0]);
    if (rows.length) return `o campo de novo arquivo da pasta ${folder} ficar pronto (a linha apareceu com ${rows.flatMap(row => [...row.querySelectorAll('input')]).length} campos)`;
    return open.length ? `a janela "Adicionar arquivo" da pasta ${folder} mostrar ${kind === 'file' ? 'a extensão e o nome do arquivo' : 'o envio de imagem'} (abriu outra janela: "${clean(open[0].querySelector('.ds-modal h3')) || 'sem título'}")` : `o "+" da pasta ${folder} abrir o campo de novo arquivo ou a janela "Adicionar arquivo" (não abriu nenhum dos dois)`;
  });
  return found!;
}
async function openAddDialog(folder: string, context: Context): Promise<HTMLElement> {
  const control = await openAddControl(folder, 'image', context);
  if (control.kind !== 'dialog') throw new Error(`O "+" da pasta ${folder} não abriu o envio de imagens.`);
  return control.dialog;
}
// The window shows its "Adicionar" request in flight on the button, as "Salvar" does (`sending`,
// above). It shows a refusal of the name, and "already exists", under the field; any other refusal
// of the server it only logs to the console, and the window stays open.
async function finishDialog(dialog: HTMLElement, path: string, error: string, context: Context, timeout: number): Promise<void> {
  try {
    await until(() => !dialogButton(dialog, 'Adicionar arquivo').disabled || !!clean(dialog.querySelector(error)), 10000, `o botão "Adicionar arquivo" ficar disponível para ${path}`);
    const refused = clean(dialog.querySelector(error));
    if (refused) throw new Error(`A Yampi recusou ${path}: ${refused}`);
    guard(context);
    const confirm = dialogButton(dialog, 'Adicionar arquivo');
    confirm.click();
    let sent = false, idle = 0;
    await until(() => {
      const message = clean(dialog.querySelector(error));
      if (message) throw new Error(`A Yampi recusou ${path}: ${message}`);
      if (!dialog.classList.contains('ds-modal-overlay--active')) return inventory().has(path);
      if (sending(confirm)) {sent = true; idle = 0; return false;}
      idle ||= performance.now();
      // The request ended (or never showed) and the window is still open, without a message.
      if (performance.now() - idle > (sent ? 1500 : 8000)) throw new Error(`A Yampi não confirmou a criação de ${path}: o pedido terminou e a janela "Adicionar arquivo" continuou aberta, sem mensagem. O editor da Yampi só mostra no console uma recusa do servidor diferente de "já existe". Confira no editor se o arquivo aparece; ao continuar, a extensão confere a loja antes de criar de novo.`);
      return false;
    }, timeout, () => dialog.classList.contains('ds-modal-overlay--active') ? `a Yampi responder ao pedido de criação de ${path}` : `${path} aparecer na árvore do editor depois de criado`);
  } catch (failure) {
    // Leave the editor as it was: close the dialog without confirming anything.
    if (dialog.classList.contains('ds-modal-overlay--active')) try {dialogButton(dialog, 'Cancelar').click();} catch { /* The error below explains the stop. */ }
    throw failure;
  }
}
// The row of the editor of 05/11/2026: the name with its extension, then Enter, as a person types.
// The same request, the row in "sending" while it runs, and any refusal under the field. Esc
// cancels it; nothing else is clicked, so no other file is renamed or deleted.
async function createInRow(row: HTMLElement, input: HTMLInputElement, path: string, context: Context): Promise<void> {
  const name = path.split('/').at(-1)!;
  // The field itself also takes the class "error": the message is the .error with text under it.
  const refusal = () => [...row.querySelectorAll('.error')].map(node => clean(node)).find(Boolean) || '';
  const key = (type: 'keyup' | 'keydown', value: 'Enter' | 'Escape') => input.dispatchEvent(new KeyboardEvent(type, {key: value, code: value, keyCode: value === 'Enter' ? 13 : 27, which: value === 'Enter' ? 13 : 27, bubbles: true, composed: true, cancelable: true}));
  try {
    guard(context);
    // Typed and confirmed in one go: the row cancels itself if the page loses the focus first.
    input.value = name;
    input.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
    key('keyup', 'Enter');
    let sent = false, idle = 0, closed = 0;
    await until(() => {
      const message = row.isConnected ? refusal() : '';
      if (message) throw new Error(`A Yampi recusou ${path}: ${message}`);
      if (!row.isConnected) {
        if (inventory().has(path)) return true;
        closed ||= performance.now();
        if (!sent && performance.now() - closed > 3000) throw new Error(`O campo de novo arquivo da Yampi fechou antes de confirmar ${path}: a página do editor perdeu o foco ou o Esc foi pressionado. Nada foi criado; ao continuar, a extensão tenta de novo.`);
        return false;
      }
      if (row.classList.contains('sending')) {sent = true; idle = 0; return false;}
      idle ||= performance.now();
      if (performance.now() - idle > (sent ? 1500 : 8000)) throw new Error(sent ? `A Yampi não confirmou a criação de ${path}: o pedido terminou e o campo continuou aberto, sem mensagem. Confira no editor se o arquivo aparece; ao continuar, a extensão confere a loja antes de criar de novo.` : `O campo de novo arquivo da Yampi não aceitou ${name} com Enter.`);
      return false;
    }, 20000, () => row.isConnected ? `a Yampi responder ao pedido de criação de ${path}` : `${path} aparecer na árvore do editor depois de criado`);
  } catch (failure) {
    // Leave the tree as it was: Esc closes the row without creating anything.
    if (row.isConnected && !row.classList.contains('sending')) key('keydown', 'Escape');
    throw failure;
  }
}
async function createFile(path: string, context: Context): Promise<void> {
  validatePath(path);
  const name = path.split('/').at(-1)!, folder = path.slice(0, -name.length - 1), match = /^(.+)\.(twig|vue|scss)$/.exec(name);
  if (!creatableName(path) || !match) throw new Error(`A Yampi não cria arquivos com esse nome ou tipo: ${path}`);
  if (inventory().has(path)) throw new Error(`O arquivo já existe na loja: ${path}. A extensão não cria duplicatas.`);
  const control = await openAddControl(folder, 'file', context);
  if (control.kind === 'row') return createInRow(control.row, control.input, path, context);
  const dialog = control.dialog;
  try {
    const select = dialog.querySelector<HTMLElement>('form .ds-select')!, label = EXTENSION_LABEL[match[2]];
    const chosen = () => clean(select.querySelector('.ds-select__trigger span'));
    if (chosen() !== label) {
      select.click();
      await until(() => [...select.querySelectorAll('.ds-select__option')].filter(o => clean(o) === label).length === 1, 10000, () => `a opção ${label} aparecer em "Extensão do arquivo" (opções vistas: ${[...select.querySelectorAll('.ds-select__option')].map(o => clean(o)).join(', ') || 'nenhuma'})`);
      [...select.querySelectorAll<HTMLElement>('.ds-select__option')].find(o => clean(o) === label)!.click();
      await until(() => chosen() === label, 10000, () => `a extensão ${label} ficar escolhida (mostra "${chosen()}")`);
    }
    const input = dialog.querySelector<HTMLInputElement>('input.ds-input__field')!;
    input.value = match[1];
    input.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
  } catch (failure) {
    try {dialogButton(dialog, 'Cancelar').click();} catch { /* The error below explains the stop. */ }
    throw failure;
  }
  await finishDialog(dialog, path, '.ds-input__error', context, 20000);
}
async function uploadImage(path: string, data: string, context: Context): Promise<void> {
  validatePath(path);
  if (!uploadablePath(path)) throw new Error(`A Yampi guarda imagens só direto em assets/images, com nome em minúsculas: ${path}`);
  if (inventory().has(path)) throw new Error(`A imagem já existe na loja: ${path}. A extensão não cria duplicatas.`);
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  validateImage(path, bytes);
  const dialog = await openAddDialog('assets/images', context);
  try {
    const input = dialog.querySelector<HTMLInputElement>('input.ds-file-uploader__input')!, transfer = new DataTransfer();
    transfer.items.add(new File([bytes], path.split('/').at(-1)!, {type: imageType(path)}));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles: true, composed: true}));
  } catch (failure) {
    try {dialogButton(dialog, 'Cancelar').click();} catch { /* The error below explains the stop. */ }
    throw failure;
  }
  await finishDialog(dialog, path, '.ds-file-uploader__error', context, 30000);
}
let busy = false;
export async function command(input: Command): Promise<Reply> {
  if (busy) return {ok: false, error: 'O editor já está executando outra operação da extensão.'};
  busy = true;
  try {
    activeRoot = discoverRoot();
    const context = getContext();
    if (input.context) guard(input.context);
    assertClean();
    if (input.op === 'context') return {ok: true, value: context};
    // The editor's own "Ver prévia" link, for the panel's shortcut after a send.
    if (input.op === 'links') return {ok: true, value: {preview: previewLink().href}};
    if (input.op === 'visual') {
      // Only a draft theme configuration in the platform format is read here; the
      // admin page's account, session and store data are never collected.
      const descriptor = Object.getOwnPropertyDescriptor(window, 'themeConfig');
      const config = descriptor && 'value' in descriptor ? descriptor.value as {theme?: unknown; sections?: unknown} : undefined;
      if (!config || typeof config !== 'object' || !config.theme || typeof config.theme !== 'object' || !Array.isArray(config.sections)) return {ok: true, value: {}};
      return {ok: true, value: {themeConfig: sanitizeRaw({themeConfig: config}, 'editor').raw.themeConfig}};
    }
    if (input.op === 'inventory') return {ok: true, value: await completeInventory(context)};
    if (input.op === 'directOpen') return {ok: true, value: {store: await openSession(yampiServer(), context)}};
    if (input.op === 'directRead') {
      if (!Array.isArray(input.paths) || !input.paths.length || input.paths.length > 64 || typeof input.store !== 'string') throw new Error('Comando inválido.');
      validatePaths(input.paths);
      const value = await readFiles(yampiServer(), input.paths, input.store, downloadImage, location.href);
      guard(context); // The editor still shows the same store.
      return {ok: true, value};
    }
    if (!input.path) throw new Error('Arquivo não informado.');
    // The full tree is listed first, so the absence check sees every folder.
    if (input.op === 'create') {await completeInventory(context); await createFile(input.path, context); return {ok: true, value: {created: true}};}
    if (input.op === 'upload') {
      if (typeof input.content !== 'string') throw new Error('Comando inválido.');
      await completeInventory(context); await uploadImage(input.path, input.content, context); return {ok: true, value: {uploaded: true}};
    }
    await open(input.path, context,input.op==='read'||input.op==='readAsset');
    if (input.op === 'readAsset' && imagePath(input.path)) return {ok: true, value: await readImage(input.path, context)};
    if (imagePath(input.path)) throw new Error('Imagens são exportadas para uso local; envio binário está bloqueado.');
    const editor = view();
    const old = readDocument(editor);
    if (input.op === 'read') return {ok: true, value: old};
    if (input.op !== 'write' || typeof input.content !== 'string' || typeof input.expected !== 'string') throw new Error('Comando inválido.');
    if (!writable(input.path) || new TextEncoder().encode(input.content).length > MAX_FILE_BYTES || input.content.includes('\u0000')) throw new Error('Tipo de arquivo não permitido para envio.');
    if (old !== input.expected) throw new Error(`Conflito antes de salvar: ${input.path}`);
    if (input.content === old) return {ok: true, value: {saved: false}};
    await dismissSaveError();
    guard(context);
    if (selectedPath() !== input.path) throw new Error('A seleção do editor mudou.');
    editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: input.content}});
    await until(() => !findButton('Salvar arquivo').disabled, 10000, `o botão "Salvar arquivo" ficar disponível para ${input.path}`);
    guard(context);
    if (selectedPath() !== input.path || readDocument(editor) !== input.content) throw new Error('O arquivo foi alterado durante a operação. Gravação interrompida.');
    const save = findButton('Salvar arquivo'), shown = saveError();
    save.click();
    // Saved: the button turns off. Refused: the sending ends with the button on, which stops the
    // send at once instead of waiting for the time limit, with Yampi's message when it gives one.
    let sent = false;
    const ended = stability(1000);
    await until(() => {
      guard(context);
      if (sending(save)) {sent = true; ended(undefined); return false;}
      // Another load in the editor only delays the answer.
      if (root().querySelector('main [aria-busy="true"]')) {ended(undefined); return false;}
      if (save.disabled) return true;
      const message = saveError();
      if (message && message !== shown) throw new Error(refusal(input.path!, message, input.content!));
      if (sent && ended('refused')) throw new Error(`A Yampi não confirmou o salvamento de ${input.path}: o editor terminou de enviar sem salvar e sem mostrar o motivo${shown ? ` (continua na tela um aviso anterior: ${shown.replace(/\s+/g, ' ')})` : ''}. A alteração ficou só na aba do editor: feche essa aba sem salvar e continue o envio de onde parou.`);
      return false;
    }, 20000, `a Yampi confirmar o salvamento de ${input.path}`);
    // Do not click publish, delete or rename controls. A separate fresh-page verification follows.
    if (readDocument(view()) !== input.content) throw new Error('Conteúdo diferente após salvar.');
    return {ok: true, value: {saved: true}};
  } catch (error) {return {ok: false, error: error instanceof Error ? error.message : String(error)};}
  finally {busy = false; activeRoot = undefined;}
}
