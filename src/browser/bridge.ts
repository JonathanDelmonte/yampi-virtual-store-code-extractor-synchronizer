import {visualData} from '../core/preview';
import type {EditorView} from '@codemirror/view';
import {editorView, readDocument} from './editor-document';
import {assertContext, validatePath, validatePaths, validateImage, imagePath, writable, MAX_FILE_BYTES, type Context} from '../core/model';
export interface Command {op: 'context' | 'inventory' | 'read' | 'readAsset' | 'visual' | 'write'; context?: Context; path?: string; expected?: string; content?: string}
export const version = '0.3.6';
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
function getContext(): Context {
  const headers = root().querySelectorAll('header');
  if (headers.length !== 1) throw new Error('Cabeçalho do componente do editor não reconhecido.');
  const header = headers[0];
  const dividers = header.querySelectorAll('.divider');
  const previews = header.querySelectorAll<HTMLAnchorElement>('a[href][target="_blank"]');
  if (dividers.length !== 1 || previews.length !== 1) throw new Error('Identificação da loja e link de prévia não reconhecidos no cabeçalho. Nenhum arquivo foi enviado.');
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
  let previous = '', stable = 0;
  await until(() => {
    guard(context);
    if (root().querySelector('aside [aria-busy="true"], aside .loading, aside .spinner, aside .loader-bg')) {stable = 0; return false;}
    const current = JSON.stringify([...inventory().keys()].sort());
    stable = current === previous ? stable + 1 : 0; previous = current;
    return stable >= 4;
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
async function until(check: () => boolean, timeout = 10000): Promise<void> {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > timeout) throw new Error('O editor não confirmou a operação dentro do prazo.');
    await new Promise(r => setTimeout(r, 80));
  }
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
  let last: unknown, stable = 0;
  await until(() => {
    guard(context);
    if (selectedPath() !== path || root().querySelector('main [aria-busy="true"], main .loading, main .spinner, main .loader-bg')) {stable = 0; return false;}
    // CodeMirror Text is immutable: a new document resets the same stability window.
    // Copy/validate the full text once after stabilization, rather than on each poll.
    const value = imagePath(path) ? visibleImage().src : view().state.doc;
    stable = value === last ? stable + 1 : 0;
    last = value;
    return stable >= 4;
  });
  assertClean();
}
function visibleImage(): HTMLImageElement {
  const images = [...root().querySelectorAll<HTMLImageElement>('main img')];
  if (images.length !== 1 || !images[0].complete || !images[0].naturalWidth) throw new Error('Prévia da imagem não reconhecida. Nenhuma exportação parcial será entregue.');
  return images[0];
}
async function readImage(path: string, context: Context): Promise<string> {
  const source = visibleImage().src;
  const url = new URL(source, location.href);
  if (url.username || url.password || (!['https:', 'data:', 'blob:'].includes(url.protocol) && url.origin !== location.origin) || (url.protocol === 'blob:' && url.origin !== location.origin)) throw new Error('Origem da imagem não permitida.');
  if (source.length > MAX_FILE_BYTES * 1.5) throw new Error('Imagem grande demais.');
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
  guard(context);
  if (selectedPath() !== path || visibleImage().src !== source) throw new Error('A imagem selecionada mudou durante a leitura.');
  validateImage(path, bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
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
    if (input.op === 'visual') {
      const values: Record<string, unknown> = {};
      for (const name of ['merchantData','merchant','pageConfig','themeConfig','product','products','categories','banners','collections','content','sections','filters']) {
        const descriptor = Object.getOwnPropertyDescriptor(window,name);
        if (descriptor && 'value' in descriptor) values[name] = descriptor.value;
      }
      return {ok:true,value:visualData(values)};
    }
    if (input.op === 'inventory') return {ok: true, value: await completeInventory(context)};
    if (!input.path) throw new Error('Arquivo não informado.');
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
    // Do not click publish, delete, rename, or create controls. A separate fresh-page verification follows.
    if (readDocument(view()) !== input.content) throw new Error('Conteúdo diferente após salvar.');
    return {ok: true, value: {saved: true}};
  } catch (error) {return {ok: false, error: error instanceof Error ? error.message : String(error)};}
  finally {busy = false; activeRoot = undefined;}
}
