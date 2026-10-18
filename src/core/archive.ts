import {unzipSync, strToU8} from 'fflate';
import {compressArchive,type ArchiveEntries} from './compression';
import {MAX_FILES, MAX_TOTAL_BYTES, MAX_FILE_BYTES, ROOTS, safeFiles, safeSnapshot, hashBytes, imagePath, lineEnding, validateContext, validatePath, type Snapshot, type Manifest, type Files, type Assets} from './model';
import {previewEntries, demonstration, TOOL_VERSION, type PreviewBundle} from './preview';
import {localKit} from './local-kit';
const metaPath = '.yampi-sync/manifest.json';
export interface Project {baseline: Snapshot; local: Files; localAssets: Assets}
export const SKIPPED = [{path: 'logs/', reason: 'Logs do editor não são exportados nem enviados: não fazem parte do tema. Consulte-os no editor da Yampi.'}];
// The theme identity comes from the published storefront when captured; the
// editor does not expose whether it edits a draft, so the state stays unknown.
function themeInfo(preview?: PreviewBundle): Manifest['theme'] {
  const theme = preview?.source.kind === 'demonstration' ? undefined : preview?.pages[0]?.raw.themeConfig?.theme;
  const value = theme && typeof theme === 'object' && !Array.isArray(theme) ? theme : {};
  const pick = (key: string) => typeof value[key] === 'string' || typeof value[key] === 'number' ? value[key] as string | number : null;
  return {alias: typeof value.alias === 'string' ? value.alias : null, id: pick('id'), name: typeof value.name === 'string' ? value.name : null, state: 'unknown', source: theme ? 'published-storefront' : 'unavailable'};
}
export async function encodeSnapshot(snapshot: Snapshot, project = false, preview?: PreviewBundle,options:{signal?:AbortSignal;compress?:(entries:ArchiveEntries,signal?:AbortSignal)=>Promise<Uint8Array>}={}): Promise<Uint8Array> {
  const check=()=>{if(options.signal?.aborted)throw new Error('Preparação do ZIP cancelada. Nenhum arquivo da Yampi foi alterado.');};check();
  const source = safeSnapshot(snapshot);
  const visual = project ? preview || demonstration(source.context, 'Contexto visual não capturado; prévia demonstrativa.', Object.keys(source.files)) : undefined;
  const manifest: Manifest = {format: 'yampi-theme-sync', version: 3, tool: {name: 'yampi-code-sync', version: TOOL_VERSION}, theme: themeInfo(visual), context: source.context, capturedAt: source.capturedAt, files: [], skipped: SKIPPED, ...(visual ? {preview: {manifest: 'preview/manifest.json', format: 2}} : {})};
  const entries: Record<string, Uint8Array> = Object.create(null);
  const all = {...Object.fromEntries(Object.entries(source.files).map(([p, v]) => [p, strToU8(v)])), ...source.assets};
  for (const path of Object.keys(all).sort()) {
    check();
    const bytes = all[path], image = !!source.assets?.[path];
    entries[`tema/${path}`] = bytes;
    entries[`.yampi-sync/baseline/${path}`] = bytes;
    manifest.files.push({path, sha256: await hashBytes(bytes), bytes: bytes.length, kind: image ? 'image' : 'text', ...(image ? {} : lineEnding(source.files[path]))});
  }
  entries[metaPath] = strToU8(JSON.stringify(manifest, null, 2));
  if (visual) {
    for (const [path,value] of Object.entries(localKit(Object.keys(source.files),source.context.storeName,visual))) entries[path]=strToU8(value);
    Object.assign(entries,await previewEntries(visual, source.files));
  }
  check();
  return options.compress?options.compress(entries,options.signal):compressArchive(entries);
}
function safeArchivePath(path: string): void {
  if (!path || path.length > 500 || /[\\\u0000-\u001f\u007f:<>"|?*]/.test(path) || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.')) throw new Error(`Caminho inseguro no ZIP: ${path}`);
}
function irrelevant(path: string): boolean {
  const parts = path.split('/');
  if(path.includes('.yampi-sync/updates/'))return true;
  if (parts.includes('tema') || path.includes('.yampi-sync/baseline/')) return false;
  return parts.some(p => ['node_modules', '.git', '.cache', 'backups', 'exports', 'preview'].includes(p));
}
function unzipSafe(data: Uint8Array): Record<string, Uint8Array> {
  if (data.length > MAX_TOTAL_BYTES * 2 + MAX_FILE_BYTES) throw new Error('ZIP muito grande.');
  const names = new Set<string>();
  let total = 0;
  return unzipSync(data, {filter(file) {
    safeArchivePath(file.name);
    if (irrelevant(file.name) || file.name.endsWith('/')) return false;
    const name = file.name.toLowerCase();
    if (names.has(name)) throw new Error(`Entrada duplicada ou ambígua no ZIP: ${file.name}`);
    names.add(name);
    if (names.size > MAX_FILES * 2 + 100 || file.originalSize > MAX_FILE_BYTES || (total += file.originalSize) > MAX_TOTAL_BYTES * 2 + MAX_FILE_BYTES) throw new Error('ZIP ultrapassa os limites de extração.');
    return true;
  }});
}
const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
function text(data: Uint8Array): string {return decoder.decode(data);}
async function decodeEntries(input: Record<string, Uint8Array>): Promise<Project> {
  const manifests = Object.keys(input).filter(p => p === metaPath || p.endsWith('/' + metaPath));
  if (manifests.length !== 1) throw new Error('Use um único projeto exportado por esta extensão, com .yampi-sync/manifest.json.');
  const prefix = manifests[0].slice(0, -metaPath.length);
  const archive: Record<string, Uint8Array> = Object.create(null);
  for (const [p, value] of Object.entries(input)) {
    if (!p.startsWith(prefix)) throw new Error('O ZIP contém mais de uma raiz de projeto.');
    archive[p.slice(prefix.length)] = value;
  }
  const m = JSON.parse(text(archive[metaPath])) as Manifest;
  if (!m || m.format !== 'yampi-theme-sync' || ![1, 2, 3].includes(m.version) || !Array.isArray(m.files) || !m.files.length || m.files.length > MAX_FILES || typeof m.capturedAt !== 'string' || !Number.isFinite(Date.parse(m.capturedAt))) throw new Error('Formato de exportação não reconhecido.');
  const context = validateContext(m.context);
  const bases: [string, string][] = [], assets: Assets = Object.create(null);
  const seen = new Set<string>();
  for (const f of m.files) {
    if (!f || typeof f.path !== 'string' || !Number.isInteger(f.bytes) || f.bytes < 0 || f.bytes > MAX_FILE_BYTES || typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256) || (f.kind !== undefined && !['text', 'image'].includes(f.kind))) throw new Error('Registro de integridade inválido.');
    validatePath(f.path);
    if (seen.has(f.path.toLowerCase())) throw new Error(`Baseline duplicada: ${f.path}`);
    seen.add(f.path.toLowerCase());
    const value = archive[`.yampi-sync/baseline/${f.path}`];
    if (!value || value.length !== f.bytes || await hashBytes(value) !== f.sha256) throw new Error(`Baseline ausente ou alterada: ${f.path}`);
    if (f.kind === 'image') assets[f.path] = value;
    else bases.push([f.path, text(value)]);
  }
  for (const path of Object.keys(archive).filter(p => p.startsWith('.yampi-sync/baseline/'))) {
    if (!m.files.some(f => path === `.yampi-sync/baseline/${f.path}`)) throw new Error(`Baseline sem registro no manifesto: ${path}`);
  }
  const baseline = safeSnapshot({context, capturedAt: m.capturedAt, files: safeFiles(bases), ...(Object.keys(assets).length ? {assets} : {})});
  const edited = readThemeEntries(Object.entries(archive).filter(([p]) => p.startsWith('tema/')).map(([p, v]) => [p.slice(5), v]));
  safeSnapshot({...baseline, files: edited.files, assets: edited.assets});
  return {baseline, local: edited.files, localAssets: edited.assets};
}
function readThemeEntries(entries: [string, Uint8Array][]): {files: Files; assets: Assets} {
  const files: [string, string][] = [], assets: Assets = Object.create(null);
  for (const [path, value] of entries) {
    validatePath(path);
    if (imagePath(path)) assets[path] = value;
    else files.push([path, text(value).replace(/\r\n?/g, '\n')]);
  }
  return {files: safeFiles(files), assets};
}
export async function decodeProject(data: Uint8Array): Promise<Project> {return decodeEntries(unzipSafe(data));}
// One file of a project folder, from a folder picker, drag and drop or a test: its path inside the
// chosen folder and a way to read it, so only the files that matter are ever read.
export interface ProjectEntry {path: string; size: number; read(): Promise<Uint8Array>}
export function isProjectFile(path: string, project: boolean): boolean {
  return project ? path.startsWith('tema/') || path.startsWith('.yampi-sync/baseline/') || path === metaPath : ROOTS.has(path.split('/')[0]);
}
export async function readProjectEntries(source: ProjectEntry[], onProgress?: (done: number, total: number) => void): Promise<Project | {local: Files; localAssets: Assets}> {
  const project = source.some(f => f.path === metaPath);
  const relevant = project ? source.filter(f => isProjectFile(f.path, true)) : source;
  const entries: Record<string, Uint8Array> = Object.create(null);
  let total = 0, count = 0;
  for (const {path, size} of relevant) {
    if (!project && !ROOTS.has(path.split('/')[0])) throw new Error(`Selecione a raiz do projeto exportado ou a pasta tema. Arquivo fora do tema: ${path}`);
    safeArchivePath(path);
    if (size > MAX_FILE_BYTES || (total += size) > (project ? MAX_TOTAL_BYTES * 2 + MAX_FILE_BYTES : MAX_TOTAL_BYTES) || ++count > MAX_FILES * 2 + 1) throw new Error('A pasta ultrapassa os limites de importação.');
  }
  onProgress?.(0, relevant.length);
  for (const [index, {path, read}] of relevant.entries()) {
    if (entries[path]) throw new Error(`Entrada duplicada: ${path}`);
    entries[path] = await read();
    onProgress?.(index + 1, relevant.length);
  }
  if (!relevant.length) throw new Error('Pasta vazia.');
  if (project) return decodeEntries(entries);
  const edited = readThemeEntries(Object.entries(entries));
  safeSnapshot({context: {storeName: 'Validação local', previewOrigin: 'https://local.invalid', editorOrigin: 'https://local.invalid'}, capturedAt: new Date().toISOString(), files: edited.files, assets: edited.assets});
  return {local: edited.files, localAssets: edited.assets};
}
export async function readProjectDirectory(files: FileList | File[], onProgress?: (done: number, total: number) => void): Promise<Project | {local: Files; localAssets: Assets}> {
  return readProjectEntries(Array.from(files).map(file => ({path: (file.webkitRelativePath || file.name).split('/').slice(1).join('/'), size: file.size, read: async () => new Uint8Array(await file.arrayBuffer())})), onProgress);
}
export async function readDirectory(files: FileList | File[]): Promise<Files> {
  const project = await readProjectDirectory(files);
  if (Object.keys(project.localAssets).length) throw new Error('Use o importador de projeto para carregar imagens.');
  return project.local;
}
