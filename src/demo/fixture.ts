import {EditorState} from '@codemirror/state';
import {EditorView as CurrentEditorView} from '@codemirror/view';
import {EditorView as LegacyEditorView} from '@codemirror/view-legacy';
import {YAMPI_VUE_TEMPLATE, type Files} from '../core/model';
import {demoSnapshot} from './sample';
// Fictitious markup only: reproduce the boundary of the real custom element, not its proprietary code.
// Tree, dialogs and uploader follow the class names and rules of the public editor module.
const host = document.createElement('yampi-code-editor');
const root = host.attachShadow({mode: 'open'});
const style = document.querySelector('style')!.cloneNode(true);
root.append(style, document.querySelector('header')!, document.querySelector('.layout')!, document.querySelector('#add-file')!, document.querySelector('#add-asset')!);
document.body.prepend(host);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => (root.getElementById(id) || document.getElementById(id)) as T;
const EditorView = new URLSearchParams(location.search).get('codemirror') === 'current' ? CurrentEditorView : LegacyEditorView;
let files: Files = JSON.parse(sessionStorage.getItem('fixture-files') || JSON.stringify(demoSnapshot.files));
const uploads: Record<string, string> = JSON.parse(sessionStorage.getItem('fixture-assets') || '{}');
const assetSources: Record<string, string> = {...Object.fromEntries(Object.entries(demoSnapshot.assets || {}).map(([p, b]) => [p, 'data:image/png;base64,' + btoa(String.fromCharCode(...b))])), ...uploads};
let current: string | undefined, editor: CurrentEditorView | LegacyEditorView | undefined, generation = 0, publications = Number(sessionStorage.getItem('fixture-publications') || 0);
const initialFiles = sessionStorage.getItem('fixture-files'), initialAssets = sessionStorage.getItem('fixture-assets');
let saves = 0, textChanges = 0;
// add: clicks on a folder's "Adicionar arquivo". Created files and uploaded images are listed apart.
const operations = {dispatch: 0, save: 0, forbidden: 0, add: 0};
const created: {files: string[]; images: string[]} = {files: [], images: []};
Object.assign(window, {fictitiousOperations: operations, fictitiousCreated: created});
root.querySelector('#publish')!.setAttribute('data-dangerous', 'publish');
root.addEventListener('click', event => {if ((event.target as Element).closest('[data-dangerous]')) operations.forbidden++;}, true);
$('test-info').textContent = `Publicações: ${publications}`;
function store() {sessionStorage.setItem('fixture-files', JSON.stringify(files));}
const save = $<HTMLButtonElement>('save');
save.addEventListener('click', () => {
  if (!current || !editor || save.disabled) return;
  const path = current, value = editor.state.doc.toString();
  operations.save++; saves++;
  // Keep enabled until the fake server has persisted, just as a save acknowledgment should.
  setTimeout(() => {
    files[path] = value; store(); save.disabled = true; $('tab').querySelector('.holder-icon')!.replaceChildren();
    $('version').textContent = 'Versão salva · ' + Date.now();
  }, 150);
});
const items = new Map<string, HTMLElement>();
function open(path: string) {
  const li = items.get(path)!;
  generation++; const id = generation;
  current = path;
  root.querySelectorAll('li.selected').forEach(e => e.classList.remove('selected')); li.classList.add('selected');
  $('tab').querySelector('p')!.textContent = path.split('/').pop()!;
  editor?.destroy(); editor = undefined; $('editor').innerHTML = '<div class="loading" aria-busy="true">Carregando arquivo…</div>';
  save.disabled = true;
  setTimeout(() => {
    if (generation !== id) return;
    $('editor').replaceChildren();
    if (assetSources[path]) {const img = document.createElement('img'); img.src = assetSources[path]; img.alt = path; $('editor').append(img); return;}
    editor = new EditorView({parent: $('editor'), state: EditorState.create({doc: files[path], extensions: [EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      operations.dispatch++; textChanges++;
      save.disabled = update.state.doc.toString() === files[path];
      $('tab').querySelector('.holder-icon')!.innerHTML = save.disabled ? '' : '<div class="change-icon"></div>';
    })]})});
  }, 450);
}
// Assertions use counters independently of persisted file contents, to catch edit-and-undo attempts.
Object.assign(window, {fictitiousUnchanged: () => !saves && !textChanges && !created.files.length && !created.images.length && sessionStorage.getItem('fixture-files') === initialFiles && sessionStorage.getItem('fixture-assets') === initialAssets});
// Same structure as the real tree: caret, name and a hidden "Adicionar arquivo" control per folder.
const opened = new Set<string>();
function folder(parent: HTMLElement, name: string, path: string): HTMLElement {
  const holder = document.createElement('div'); holder.className = 'collapse-list' + (opened.has(path) ? ' active' : '');
  const title = document.createElement('div'); title.className = 'folder-title';
  const caret = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); caret.setAttribute('class', 'caret-icon'); caret.setAttribute('width', '10'); caret.setAttribute('height', '10'); title.append(caret);
  const span = document.createElement('span'); span.textContent = name; title.append(span);
  const add = document.createElement('div'); add.className = 'add-item'; add.title = 'Adicionar arquivo'; add.textContent = '+';
  add.addEventListener('click', () => {operations.add++; opened.add(path); holder.classList.add('active'); (path === 'assets/images' ? openAssetDialog : openFileDialog)(path);});
  title.append(add);
  const list = document.createElement('ul'); list.className = 'all-files'; holder.append(title, list); parent.append(holder);
  title.addEventListener('click', event => {if (event.target !== title && event.target !== span) return; holder.classList.toggle('active') ? opened.add(path) : opened.delete(path);});
  return list;
}
function renderTree() {
  $('tree').replaceChildren(); items.clear(); $('remote-file').replaceChildren();
  const folders = new Map<string, HTMLElement>();
  for (const path of [...Object.keys(files), ...Object.keys(assetSources)].sort()) {
    const parts = path.split('/'); let parent = $('tree'), key = '';
    for (const name of parts.slice(0, -1)) {
      key += (key ? '/' : '') + name;
      if (!folders.has(key)) folders.set(key, folder(parent, name, key));
      parent = folders.get(key)!;
    }
    const li = document.createElement('li'); li.className = 'collapse-item' + (path === current ? ' selected' : '');
    const name = document.createElement('span'); name.className = 'file-name'; name.textContent = parts.at(-1)!; li.append(name); parent.append(li);
    for (const action of ['delete', 'rename']) {
      const control = document.createElement('button'); control.setAttribute('data-dangerous', action); control.setAttribute('aria-label', action + ' fictício');
      control.addEventListener('click', event => event.stopPropagation()); li.append(control);
    }
    li.addEventListener('click', () => open(path));
    items.set(path, li);
    const option = document.createElement('option'); option.value = path; option.textContent = path; $('remote-file').append(option);
  }
}
renderTree();
// Dialogs: DsModal overlay, DsSelect without the current option, DsInput and DsButton, as in the editor.
function dialog(id: string) {
  const overlay = $(id), primary = [...overlay.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent!.trim() === 'Adicionar arquivo')!;
  const close = () => overlay.classList.remove('ds-modal-overlay--active');
  for (const button of overlay.querySelectorAll<HTMLButtonElement>('.ds-modal__close, .color-secondary')) button.addEventListener('click', close);
  return {overlay, primary, close, open: () => overlay.classList.add('ds-modal-overlay--active')};
}
function showError(holder: HTMLElement, className: string, message: string) {
  holder.querySelector('.' + className)?.remove();
  if (message) {const error = document.createElement('p'); error.className = className; error.textContent = message; holder.append(error);}
}
const fileDialog = dialog('add-file'), select = fileDialog.overlay.querySelector<HTMLElement>('.ds-select')!, input = fileDialog.overlay.querySelector<HTMLInputElement>('.ds-input__field')!;
let fileFolder = '', extension = 'SCSS';
function renderSelect() {
  select.querySelector('.ds-select__trigger span')!.textContent = extension;
  fileDialog.overlay.querySelector('.ds-input__suffix span')!.textContent = ' .' + extension.toLowerCase();
  const dropdown = select.querySelector<HTMLElement>('.ds-select__dropdown')!;
  dropdown.replaceChildren(...['SCSS', 'Vue', 'Twig', 'JS'].filter(value => value !== extension).map(value => {
    const option = document.createElement('div'); option.className = 'ds-select__option'; option.textContent = value;
    option.addEventListener('click', () => {extension = value; renderSelect();}); return option;
  }));
}
select.addEventListener('click', () => {const dropdown = select.querySelector<HTMLElement>('.ds-select__dropdown')!; dropdown.hidden = !dropdown.hidden;});
input.addEventListener('input', () => {fileDialog.primary.disabled = !input.value.length;});
function openFileDialog(path: string) {
  fileFolder = path; extension = 'SCSS'; input.value = ''; fileDialog.primary.disabled = true;
  showError(input.closest('.ds-input')!, 'ds-input__error', ''); renderSelect(); fileDialog.open();
}
fileDialog.primary.addEventListener('click', () => {
  const name = input.value, holder = input.closest<HTMLElement>('.ds-input')!, path = `${fileFolder}/${name}.${extension.toLowerCase()}`;
  if (!name.trim()) return showError(holder, 'ds-input__error', 'O nome do arquivo não pode ficar em branco.');
  if (/[^\w\s-]/.test(name)) return showError(holder, 'ds-input__error', 'O nome do arquivo não pode conter espaço ou símbolos.');
  if (path in files) return showError(holder, 'ds-input__error', `Um arquivo com o nome "${name}.${extension.toLowerCase()}" já existe.`);
  fileDialog.primary.disabled = true;
  setTimeout(() => {
    files[path] = extension === 'Vue' ? YAMPI_VUE_TEMPLATE : ''; store(); created.files.push(path);
    fileDialog.close(); renderTree(); open(path);
  }, 200);
});
// Uploader: the editor keeps images in assets/images, named as its sanitizer gives.
const assetDialog = dialog('add-asset'), uploader = assetDialog.overlay.querySelector<HTMLInputElement>('.ds-file-uploader__input')!;
let pending: {name: string; data: string} | undefined;
function sanitize(fileName: string): string {
  const parts = fileName.split(/[/\\]/).at(-1)!.split('.'), last = parts.length > 1 ? parts.pop()! : '';
  return parts.join('.').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + (last ? '.' + last.toLowerCase() : '');
}
function openAssetDialog() {
  pending = undefined; assetDialog.primary.disabled = true; showError(assetDialog.overlay.querySelector('.ds-file-uploader')!, 'ds-file-uploader__error', ''); assetDialog.open();
}
uploader.addEventListener('change', () => {
  const file = uploader.files?.[0], holder = assetDialog.overlay.querySelector<HTMLElement>('.ds-file-uploader')!;
  uploader.value = '';
  if (!file) return;
  if (file.size > 2097152) return showError(holder, 'ds-file-uploader__error', 'O tamanho do arquivo não pode ser maior que 2MB.');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) return showError(holder, 'ds-file-uploader__error', 'Tipo de arquivo não suportado. Use .png, .jpg, .jpeg, .webp ou .svg.');
  const reader = new FileReader();
  reader.onload = () => {pending = {name: sanitize(file.name), data: String(reader.result)}; assetDialog.primary.disabled = false;};
  reader.readAsDataURL(file);
});
assetDialog.primary.addEventListener('click', () => {
  if (!pending) return;
  const path = 'assets/images/' + pending.name, data = pending.data;
  if (path in assetSources) return showError(assetDialog.overlay.querySelector('.ds-file-uploader')!, 'ds-file-uploader__error', 'Um arquivo com esse nome já existe.');
  assetDialog.primary.disabled = true;
  setTimeout(() => {
    assetSources[path] = uploads[path] = data; sessionStorage.setItem('fixture-assets', JSON.stringify(uploads)); created.images.push(path);
    assetDialog.close(); renderTree(); open(path);
  }, 200);
});
$('external-change').addEventListener('click', () => {
  const path = $<HTMLSelectElement>('remote-file').value; if (assetSources[path]) return; files[path] += '\n<!-- Alteração feita na loja depois da exportação -->\n'; store();
  if (current === path) open(path);
});
$('switch-shop').addEventListener('click', () => {$('shop-name').textContent = 'Outra loja de testes';});
// What the fictitious editor's server answers, for tests that stand in for the Yampi server on the
// routes the real editor reads. The session's store follows the header, so "Trocar loja fictícia"
// also switches it. Images answer with the address the editor shows.
Object.assign(window, {fictitiousServer: (route: string, path?: string) => {
  const name = $('shop-name').textContent!.trim(), alias = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (route === 'merchant') return {name, url: root.querySelector<HTMLAnchorElement>('header a')!.href, alias, can_edit: true};
  if (route === 'identity') return {alias};
  return path === undefined ? null : path in files ? files[path] : assetSources[path] ?? null;
}});
$('reset').addEventListener('click', () => {sessionStorage.removeItem('fixture-files'); sessionStorage.removeItem('fixture-assets'); location.reload();});
$('publish').addEventListener('click', () => {sessionStorage.setItem('fixture-publications', String(++publications)); $('test-info').textContent = `Publicações: ${publications}`;});
