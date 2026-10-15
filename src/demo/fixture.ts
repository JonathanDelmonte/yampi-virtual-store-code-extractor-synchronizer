import {EditorState} from '@codemirror/state';
import {EditorView as CurrentEditorView} from '@codemirror/view';
import {EditorView as LegacyEditorView} from '@codemirror/view-legacy';
import type {Files} from '../core/model';
import {demoSnapshot} from './sample';
// Fictitious markup only: reproduce the boundary of the real custom element, not its proprietary code.
const host = document.createElement('yampi-code-editor');
const root = host.attachShadow({mode: 'open'});
const style = document.querySelector('style')!.cloneNode(true);
root.append(style, document.querySelector('header')!, document.querySelector('.layout')!);
document.body.prepend(host);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => (root.getElementById(id) || document.getElementById(id)) as T;
const EditorView = new URLSearchParams(location.search).get('codemirror') === 'current' ? CurrentEditorView : LegacyEditorView;
let files: Files = JSON.parse(sessionStorage.getItem('fixture-files') || JSON.stringify(demoSnapshot.files));
const assetSources = Object.fromEntries(Object.entries(demoSnapshot.assets || {}).map(([p, b]) => [p, 'data:image/png;base64,' + btoa(String.fromCharCode(...b))]));
let current: string | undefined, editor: CurrentEditorView | LegacyEditorView | undefined, generation = 0, publications = Number(sessionStorage.getItem('fixture-publications') || 0);
const initialFiles = sessionStorage.getItem('fixture-files');
let saves = 0, textChanges = 0;
const operations = {dispatch: 0, save: 0, forbidden: 0};
Object.assign(window, {fictitiousOperations: operations});
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
function open(path: string, li: HTMLElement) {
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
Object.assign(window, {fictitiousUnchanged: () => !saves && !textChanges && sessionStorage.getItem('fixture-files') === initialFiles});
// Test only: the owner creates an empty file by hand in the Yampi editor. Reload the page to show it in the tree.
Object.assign(window, {fictitiousCreateEmpty: (path: string) => {if (path in files) throw new Error('Arquivo fictício já existe.'); files[path] = ''; store();}});
function folder(parent: HTMLElement, name: string): HTMLElement {
  const holder = document.createElement('div'); holder.className = 'collapse-list';
  const title = document.createElement('div'); title.className = 'folder-title';
  const span = document.createElement('span'); span.textContent = name; title.append(span);
  const create = document.createElement('button'); create.setAttribute('data-dangerous', 'create'); create.setAttribute('aria-label', 'Criar arquivo fictício'); title.append(create);
  create.addEventListener('click', event => event.stopPropagation());
  const list = document.createElement('ul'); list.className = 'all-files'; holder.append(title, list); parent.append(holder);
  title.addEventListener('click', () => holder.classList.toggle('active'));
  return list;
}
const folders = new Map<string, HTMLElement>();
for (const path of [...Object.keys(files), ...Object.keys(assetSources)].sort()) {
  const parts = path.split('/'); let parent = $('tree'), key = '';
  for (const name of parts.slice(0, -1)) {
    key += (key ? '/' : '') + name;
    if (!folders.has(key)) folders.set(key, folder(parent, name));
    parent = folders.get(key)!;
  }
  const li = document.createElement('li'); li.className = 'collapse-item';
  const name = document.createElement('span'); name.className = 'file-name'; name.textContent = parts.at(-1)!; li.append(name); parent.append(li);
  for (const action of ['delete', 'rename']) {
    const control = document.createElement('button'); control.setAttribute('data-dangerous', action); control.setAttribute('aria-label', action + ' fictício');
    control.addEventListener('click', event => event.stopPropagation()); li.append(control);
  }
  li.addEventListener('click', () => open(path, li));
  const option = document.createElement('option'); option.value = path; option.textContent = path; $('remote-file').append(option);
}
$('external-change').addEventListener('click', () => {
  const path = $<HTMLSelectElement>('remote-file').value; if (assetSources[path]) return; files[path] += '\n<!-- Alteração feita na loja depois da exportação -->\n'; store();
  if (current === path) open(path, root.querySelector('li.selected')!);
});
$('switch-shop').addEventListener('click', () => {$('shop-name').textContent = 'Outra loja de testes';});
$('reset').addEventListener('click', () => {sessionStorage.removeItem('fixture-files'); location.reload();});
$('publish').addEventListener('click', () => {sessionStorage.setItem('fixture-publications', String(++publications)); $('test-info').textContent = `Publicações: ${publications}`;});
