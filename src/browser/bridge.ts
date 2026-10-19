import {sanitizeRaw} from '../core/preview';
import type {EditorView} from '@codemirror/view';
import {editorView, readDocument} from './editor-document';
import {assertContext, validatePath, validatePaths, validateImage, imagePath, writable, creatableName, uploadablePath, imageType, dataUrlBytes, MAX_FILE_BYTES, type Context} from '../core/model';
import {openSession, readFiles, YAMPI_SERVER, type Server} from './server-read';
// directOpen/directRead: copies straight from the editor's own server (see server-read.ts).
export interface Command {op: 'context' | 'inventory' | 'read' | 'readAsset' | 'visual' | 'write' | 'create' | 'upload' | 'links' | 'directOpen' | 'directRead'; context?: Context; path?: string; paths?: string[]; store?: string; expected?: string; content?: string}
export const version = '0.8.0';
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
function inventory(): Map<string, HTMLElement> {
  const entries=[...root().querySelectorAll<HTMLElement>('aside .file-name')].map(node=>[pathFor(node),node] as const).filter(([path])=>!path.startsWith('logs/'));
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
    title.click(); await until(() => folder.classList.contains('active'));
  }
  const settled = stability();
  await until(() => {
    guard(context);
    return settled(root().querySelector('aside [aria-busy="true"], aside .loading, aside .spinner, aside .loader-bg') ? undefined : JSON.stringify([...inventory().keys()].sort()));
  });
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
  return buttons.some(b => !b.disabled) || !!root().querySelector('main .tab-item .holder-icon circle, main .tab-item .change-icon, main .tab-item .unsaved, main .tab-item.dirty');
}
function assertClean(): void {
  if (dirty()) throw new Error('Existe um arquivo com alterações não salvas. Salve ou descarte manualmente antes de continuar.');
}
function guard(context: Context): void {assertContext(context, getContext());}
// Waits react to the editor's own DOM changes. In a hidden tab the browser runs timers about
// once a second, and chained timers can wait up to a minute; DOM changes still arrive at once.
// The fallback check hops through a message first, so its timer never counts as chained.
async function until(check: () => boolean, timeout = 10000): Promise<void> {
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
      if (performance.now() - start > (document.hidden ? timeout * 3 : timeout)) finish(new Error('O editor não confirmou a operação dentro do prazo.'));
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
function stability(): (value: unknown) => boolean {
  let last: unknown, since = 0, checks = 0;
  return value => {
    if (value === undefined || value !== last) {last = value; since = performance.now(); checks = 0; return false;}
    return ++checks >= 2 && performance.now() - since >= 320;
  };
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
  const candidates=reading?[...root().querySelectorAll<HTMLElement>('aside .file-name')].filter(n=>clean(n)===path.split('/').pop()&&pathFor(n)===path):[];
  if(candidates.length>1)throw new Error('O arquivo tem caminhos duplicados na árvore. Operação interrompida.');
  const item = reading?candidates[0]:inventory().get(path);
  if (!item) throw new Error(`O arquivo não existe na loja: ${path}. A extensão não cria duplicatas.`);
  const parents: HTMLElement[] = [];
  for (let n = item.parentElement; n && n.tagName !== 'ASIDE'; n = n.parentElement) if (n.classList.contains('collapse-list')) parents.unshift(n);
  for (const parent of parents) if (!parent.classList.contains('active')) {
    const title = [...parent.children].find(c => c.classList.contains('folder-title')) as HTMLElement | undefined;
    if (!title) throw new Error('Árvore do editor não reconhecida.');
    title.click();
    await until(() => parent.classList.contains('active'));
  }
  item.click();
  await until(() => {
    guard(context);
    const image = root().querySelector<HTMLImageElement>('main img');
    return selectedPath() === path && clean(root().querySelector('main .tab-item.active p')) === path.split('/').pop() && (imagePath(path) ? !!image?.complete && !!image.naturalWidth : !!root().querySelector('main .cm-content'));
  });
  // CodeMirror and the active tab can switch before async file loading finishes. Require stable UI/document.
  const settled = stability();
  await until(() => {
    guard(context);
    if (selectedPath() !== path || root().querySelector('main [aria-busy="true"], main .loading, main .spinner, main .loader-bg')) return settled(undefined);
    // CodeMirror Text is immutable: a new document resets the same stability window.
    // Copy/validate the full text once after stabilization, rather than on each poll.
    return settled(imagePath(path) ? visibleImage().src : view().state.doc);
  });
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
// Creation goes through the editor's own controls, as a person would: the folder's
// "Adicionar arquivo" button opens a dialog (name and extension) or, for assets/images,
// the image uploader. Yampi validates, saves to the draft and lists the new file.
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
async function openAddDialog(folder: string, kind: 'file' | 'image', context: Context): Promise<HTMLElement> {
  if (activeDialogs().length) throw new Error('Há uma janela aberta no editor da Yampi. Feche-a e tente novamente.');
  const lists = [...root().querySelectorAll<HTMLElement>('aside .collapse-list')].filter(list => folderPath(list) === folder);
  if (lists.length !== 1) throw new Error(`A pasta ${folder} não existe no editor, e a Yampi não permite criar pastas.`);
  const title = [...lists[0].children].find(c => c.classList.contains('folder-title'));
  const add = title && [...title.children].find(c => c.classList.contains('add-item')) as HTMLElement | undefined;
  if (!add) throw new Error(`Sem permissão para adicionar arquivos em ${folder}.`);
  guard(context);
  add.click();
  let dialog: HTMLElement | undefined;
  await until(() => {
    const open = activeDialogs();
    if (open.length !== 1 || clean(open[0].querySelector('.ds-modal h3')) !== 'Adicionar arquivo') return false;
    const fits = kind === 'file' ? !!open[0].querySelector('form .ds-select') && open[0].querySelectorAll('input.ds-input__field').length === 1 : open[0].querySelectorAll('.ds-file-uploader input.ds-file-uploader__input').length === 1;
    if (fits) dialog = open[0];
    return fits;
  });
  return dialog!;
}
async function finishDialog(dialog: HTMLElement, path: string, error: string, context: Context, timeout: number): Promise<void> {
  try {
    await until(() => !dialogButton(dialog, 'Adicionar arquivo').disabled || !!clean(dialog.querySelector(error)));
    const refused = clean(dialog.querySelector(error));
    if (refused) throw new Error(`A Yampi recusou ${path}: ${refused}`);
    guard(context);
    dialogButton(dialog, 'Adicionar arquivo').click();
    await until(() => {
      const message = clean(dialog.querySelector(error));
      if (message) throw new Error(`A Yampi recusou ${path}: ${message}`);
      return !dialog.classList.contains('ds-modal-overlay--active') && inventory().has(path);
    }, timeout);
  } catch (failure) {
    // Leave the editor as it was: close the dialog without confirming anything.
    if (dialog.classList.contains('ds-modal-overlay--active')) try {dialogButton(dialog, 'Cancelar').click();} catch { /* The error below explains the stop. */ }
    throw failure;
  }
}
async function createFile(path: string, context: Context): Promise<void> {
  validatePath(path);
  const name = path.split('/').at(-1)!, folder = path.slice(0, -name.length - 1), match = /^(.+)\.(twig|vue|scss)$/.exec(name);
  if (!creatableName(path) || !match) throw new Error(`A Yampi não cria arquivos com esse nome ou tipo: ${path}`);
  if (inventory().has(path)) throw new Error(`O arquivo já existe na loja: ${path}. A extensão não cria duplicatas.`);
  const dialog = await openAddDialog(folder, 'file', context);
  try {
    const select = dialog.querySelector<HTMLElement>('form .ds-select')!, label = EXTENSION_LABEL[match[2]];
    const chosen = () => clean(select.querySelector('.ds-select__trigger span'));
    if (chosen() !== label) {
      select.click();
      await until(() => [...select.querySelectorAll('.ds-select__option')].filter(o => clean(o) === label).length === 1);
      [...select.querySelectorAll<HTMLElement>('.ds-select__option')].find(o => clean(o) === label)!.click();
      await until(() => chosen() === label);
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
  const dialog = await openAddDialog('assets/images', 'image', context);
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
    guard(context);
    if (selectedPath() !== input.path) throw new Error('A seleção do editor mudou.');
    editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: input.content}});
    await until(() => !findButton('Salvar arquivo').disabled);
    guard(context);
    if (selectedPath() !== input.path || readDocument(editor) !== input.content) throw new Error('O arquivo foi alterado durante a operação. Gravação interrompida.');
    const save = findButton('Salvar arquivo');
    save.click();
    await until(() => {
      guard(context);
      return save.disabled && !save.querySelector('.loading, .spinner, .button__loader, .button__spinner') && !root().querySelector('main [aria-busy="true"]');
    }, 20000);
    // Do not click publish, delete or rename controls. A separate fresh-page verification follows.
    if (readDocument(view()) !== input.content) throw new Error('Conteúdo diferente após salvar.');
    return {ok: true, value: {saved: true}};
  } catch (error) {return {ok: false, error: error instanceof Error ? error.message : String(error)};}
  finally {busy = false; activeRoot = undefined;}
}
