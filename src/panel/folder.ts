import {MAX_FILES, ROOTS, type Context} from '../core/model';
import type {ProjectEntry} from '../core/archive';
import {PENDING, projectFolderPath, projectPath, type ProjectFolder} from '../core/project-folder';
import {contextKey, get, put} from '../storage';
// Project folders through the File System Access API: only tema/ and .yampi-sync/ are walked and
// read, so picking a folder with node_modules is instant, and the folder can be remembered
// for a one-click "read again and compare" next time. Writes, always after a click of the user
// that granted write access, go through openProject: tema/ and the extension's own records.
type Permission = 'granted' | 'denied' | 'prompt';
type Handle = FileSystemHandle & {kind: 'file' | 'directory'; name: string};
type Mode = {mode: 'read' | 'readwrite'};
export type Folder = FileSystemDirectoryHandle & {
  values(): AsyncIterable<Handle>;
  queryPermission?(options: Mode): Promise<Permission>;
  requestPermission?(options: Mode): Promise<Permission>;
};
const SKIP = new Set(['node_modules', '.git', '.cache', 'dist', 'preview', 'backups', 'exports', '.vscode', '.idea']);
const LIMIT = MAX_FILES * 2 + 1;
export const canPickFolders = () => typeof (window as unknown as {showDirectoryPicker?: unknown}).showDirectoryPicker === 'function';
export async function pickFolder(): Promise<Folder | undefined> {
  try {
    const picker = (window as unknown as {showDirectoryPicker: (options: object) => Promise<Folder>}).showDirectoryPicker;
    return await picker({id: 'zirtuno-projeto', mode: 'read', startIn: 'documents'});
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return undefined;
    throw error;
  }
}
async function child(folder: Folder, name: string, kind: 'file' | 'directory'): Promise<Folder | FileSystemFileHandle | undefined> {
  try {return kind === 'directory' ? await folder.getDirectoryHandle(name) as Folder : await folder.getFileHandle(name);} catch {return undefined;}
}
async function isProject(folder: Folder): Promise<boolean> {
  const meta = await child(folder, '.yampi-sync', 'directory') as Folder | undefined;
  return !!meta && !!await child(meta, 'manifest.json', 'file');
}
async function isTheme(folder: Folder): Promise<boolean> {
  for await (const entry of folder.values()) if (entry.kind === 'directory' && ROOTS.has(entry.name)) return true;
  return false;
}
type Found = {path: string; file: File};
// Where the project is in the chosen folder: the folder itself, a folder holding exactly one
// project, or a bare theme (the folder or its tema/). Reading and writing resolve it the same way.
async function locate(root: Folder): Promise<{project?: Folder; theme?: Folder; name: string}> {
  if (await isProject(root)) return {project: root, theme: await child(root, 'tema', 'directory') as Folder | undefined, name: root.name};
  const tema = await child(root, 'tema', 'directory') as Folder | undefined;
  const theme = await isTheme(root) ? root : tema && await isTheme(tema) ? tema : undefined;
  if (theme) return {theme, name: root.name};
  const projects: Folder[] = [];
  for await (const entry of root.values()) if (entry.kind === 'directory' && !SKIP.has(entry.name) && await isProject(entry as Folder)) projects.push(entry as Folder);
  if (projects.length > 1) throw new Error(`Esta pasta tem ${projects.length} projetos (${projects.map(p => p.name).slice(0, 4).join(', ')}). Escolha a pasta de um deles.`);
  if (!projects.length) throw new Error('Não encontrei um projeto exportado nesta pasta. Escolha a pasta extraída do ZIP, a que contém tema/ e .yampi-sync/.');
  return {project: projects[0], theme: await child(projects[0], 'tema', 'directory') as Folder | undefined, name: projects[0].name};
}
async function collect(folder: Folder, prefix: string, out: Found[], signal?: AbortSignal): Promise<void> {
  for await (const entry of folder.values()) {
    if (signal?.aborted) throw new Error('Leitura da pasta cancelada.');
    if (entry.kind === 'directory') {if (!SKIP.has(entry.name)) await collect(entry as Folder, `${prefix}${entry.name}/`, out, signal); continue;}
    if (out.length >= LIMIT) throw new Error('A pasta ultrapassa os limites de importação. Escolha a pasta do projeto, não uma pasta acima dela.');
    out.push({path: prefix + entry.name, file: await (entry as unknown as FileSystemFileHandle).getFile()});
  }
}
// Accepts the project folder itself, its tema/ folder, or a folder holding exactly one project.
export async function folderEntries(root: Folder, signal?: AbortSignal): Promise<{name: string; entries: ProjectEntry[]}> {
  const found: Found[] = [], {project, theme, name} = await locate(root);
  if (!project) {
    await collect(theme!, '', found, signal);
    return {name, entries: found.map(entry)};
  }
  if (theme) await collect(theme, 'tema/', found, signal);
  const meta = await child(project, '.yampi-sync', 'directory') as Folder;
  found.push({path: '.yampi-sync/manifest.json', file: await (await child(meta, 'manifest.json', 'file') as FileSystemFileHandle).getFile()});
  // A reference rewrite that stopped midway: the reader accepts either state per file.
  const pending = await child(meta, PENDING.split('/').pop()!, 'file') as FileSystemFileHandle | undefined;
  if (pending) found.push({path: PENDING, file: await pending.getFile()});
  // The project's own versions: the list made from its Git history and the send receipts.
  const known = await child(meta, 'versoes-conhecidas.json', 'file') as FileSystemFileHandle | undefined;
  if (known) found.push({path: '.yampi-sync/versoes-conhecidas.json', file: await known.getFile()});
  const receipts = await child(meta, 'recibos', 'directory') as Folder | undefined;
  if (receipts) await collect(receipts, '.yampi-sync/recibos/', found, signal);
  const baseline = await child(meta, 'baseline', 'directory') as Folder | undefined;
  if (baseline) await collect(baseline, '.yampi-sync/baseline/', found, signal);
  return {name, entries: found.map(entry)};
}
const missing = (error: unknown) => error instanceof DOMException && ['NotFoundError', 'TypeMismatchError'].includes(error.name);
// The exported project inside the chosen folder, for the writes of an update, a version or a
// restore. A bare theme folder has no reference to update and no place for versions.
export async function openProject(root: Folder): Promise<ProjectFolder> {
  const {project, name} = await locate(root);
  if (!project) throw new Error('Esta pasta não tem .yampi-sync/. Escolha a pasta do projeto baixado pela extensão para atualizar e guardar versões.');
  const walk = async (parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | undefined> => {
    let current: FileSystemDirectoryHandle = project;
    for (const part of parts) {
      try {current = await current.getDirectoryHandle(part, {create});}
      catch (error) {if (!create && missing(error)) return undefined; throw error;}
    }
    return current;
  };
  const split = (path: string) => {const parts = projectPath(path).split('/'); return {parts, file: parts.pop()!};};
  const handle = async (path: string) => {
    const {parts, file} = split(path), folder = await walk(parts, false);
    try {return folder && await folder.getFileHandle(file);} catch (error) {if (missing(error)) return undefined; throw error;}
  };
  return {
    name,
    async read(path) {const found = await handle(path); return found ? new Uint8Array(await (await found.getFile()).arrayBuffer()) : undefined;},
    async write(path, bytes) {
      const {parts, file} = split(path), folder = (await walk(parts, true))!;
      // The browser writes to a temporary file and swaps it in on close: a file is never half written.
      const writer = await (await folder.getFileHandle(file, {create: true})).createWritable();
      try {await writer.write(new Uint8Array(bytes));} catch (error) {await writer.abort().catch(() => {}); throw error;}
      await writer.close();
    },
    async remove(path) {
      const {parts, file} = split(path), folder = await walk(parts, false);
      try {await folder?.removeEntry(file);} catch (error) {if (!missing(error)) throw error;}
    },
    async list(folder) {
      const start = await walk(projectFolderPath(folder).split('/'), false), out: string[] = [];
      const visit = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
        for await (const entry of (dir as Folder).values()) {
          if (entry.kind === 'directory') await visit(entry as unknown as FileSystemDirectoryHandle, `${prefix}${entry.name}/`);
          else out.push(prefix + entry.name);
          if (out.length > LIMIT * 4) throw new Error(`Arquivos demais em ${folder}.`);
        }
      };
      if (start) await visit(start, folder + '/');
      return out.sort();
    }
  };
}
const entry = ({path, file}: Found): ProjectEntry => ({path, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer())});
// Reading again later needs the user's permission once more; a click is enough.
export async function permitted(folder: Folder, ask: boolean, mode: Mode['mode'] = 'read'): Promise<boolean> {
  if (await folder.queryPermission?.({mode}) === 'granted') return true;
  return ask && await folder.requestPermission?.({mode}) === 'granted';
}
// Replaces one existing theme file with a text the user chose to bring from the store. Nothing is
// created, and the file must still hold what the comparison read (compared as the reader sees it,
// with line breaks as \n); its own line breaks and byte order mark are kept.
export async function replaceThemeFile(root: Folder, path: string, expected: string, text: string): Promise<void> {
  const parts = path.split('/'), name = parts.pop()!;
  if (!name || parts.some(part => !part || part === '.' || part === '..')) throw new Error(`Caminho inválido: ${path}`);
  let folder = (await locate(root)).theme;
  for (const part of parts) folder = folder && await child(folder, part, 'directory') as Folder | undefined;
  const handle = folder && await child(folder, name, 'file') as FileSystemFileHandle | undefined;
  if (!handle) throw new Error(`tema/${path} não está mais no projeto. Compare de novo.`);
  const raw = new Uint8Array(await (await handle.getFile()).arrayBuffer());
  const current = new TextDecoder().decode(raw);
  if (current.replace(/\r\n?/g, '\n') !== expected) throw new Error(`tema/${path} mudou no projeto depois da comparação. Compare de novo antes de trazer a versão da loja.`);
  const bom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  const out = (bom ? '\ufeff' : '') + (current.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text);
  const writer = await (handle as FileSystemFileHandle & {createWritable(): Promise<{write(data: string): Promise<void>; close(): Promise<void>}>}).createWritable();
  await writer.write(out);
  await writer.close();
}
export interface Remembered {folder: Folder; name: string; savedAt: string}
export async function rememberFolder(context: Context, folder: Folder, name: string): Promise<void> {
  await put(`folder:${await contextKey(context)}`, {folder, name, savedAt: new Date().toISOString()} satisfies Remembered);
}
export async function recallFolder(context: Context): Promise<Remembered | undefined> {
  return get<Remembered>(`folder:${await contextKey(context)}`).catch(() => undefined);
}
// Drag and drop: the handle must be requested during the drop event itself.
export function droppedItem(event: DragEvent): Promise<Folder | File | undefined> {
  const item = [...event.dataTransfer?.items || []].find(candidate => candidate.kind === 'file');
  if (!item) return Promise.resolve(undefined);
  const withHandle = item as DataTransferItem & {getAsFileSystemHandle?: () => Promise<Handle | null>};
  const file = item.getAsFile();
  if (!withHandle.getAsFileSystemHandle) return Promise.resolve(file || undefined);
  return withHandle.getAsFileSystemHandle().then(handle => handle?.kind === 'directory' ? handle as Folder : file || undefined);
}
