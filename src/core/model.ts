export type Files = Record<string, string>;
export type Assets = Record<string, Uint8Array>;
export interface Context {
  storeName: string;
  previewOrigin: string;
  editorOrigin: string;
}
export interface Snapshot {
  context: Context;
  capturedAt: string;
  files: Files;
  assets?: Assets;
}
export type LineEnding = 'lf' | 'crlf' | 'cr' | 'mixed' | 'none';
export interface FileHash {path: string; sha256: string; bytes: number; kind?: 'text' | 'image'; eol?: LineEnding; finalNewline?: boolean}
// Version 3 adds tool/theme metadata, line-ending facts, skipped paths and the
// preview link. Versions 1 and 2 remain readable.
export interface Manifest {
  format: 'yampi-theme-sync';
  version: 1 | 2 | 3;
  context: Context;
  capturedAt: string;
  files: FileHash[];
  tool?: {name: string; version: string};
  theme?: {alias: string | null; id: string | number | null; name: string | null; state: 'draft' | 'published' | 'unknown'; source: string};
  skipped?: {path: string; reason: string}[];
  preview?: {manifest: string; format: number};
}
export type Status = 'update' | 'create' | 'upload' | 'unchanged' | 'remote-only' | 'already-applied' | 'conflict' | 'missing-local' | 'missing-remote' | 'new-local' | 'unsupported' | 'blocked-dependency' | 'whitespace-only';
// source: local path of an image the store keeps elsewhere. rewritten: image references adjusted in a text.
// override: a conflict the user chose to resolve with the project version. reason: why a row cannot be sent.
export interface PlanRow {path: string; status: Status; base?: string; local?: string; remote?: string; image?: {base?: Uint8Array; local?: Uint8Array; remote?: Uint8Array}; whitespaceOnly?: boolean; blockedBy?: string[]; dependsOn?: string[]; source?: string; rewritten?: number; override?: boolean; reason?: string}
export interface Plan {context: Context; rows: PlanRow[]; createdAt: string; warnings?: {path: string; message: string}[]}
export interface Adapter {
  context(): Promise<Context>;
  inventory(): Promise<string[]>;
  read(path: string): Promise<string>;
  readAsset?(path: string): Promise<Uint8Array>;
  write(path: string, expected: string, content: string): Promise<void>;
  refresh(): Promise<void>;
  // Through the editor's own controls: a text in an existing folder, an image in assets/images.
  create?(path: string): Promise<void>;
  upload?(path: string, bytes: Uint8Array): Promise<void>;
}
export type ReadAdapter = Pick<Adapter, 'context' | 'inventory' | 'read' | 'readAsset'>;
export interface Progress {done: number; total: number; path: string; phase: string}
export interface Journal {
  version: 1; id: string; context: Context; startedAt: string;
  status: 'prepared' | 'running' | 'completed' | 'stopped';
  selected: string[]; verified: string[]; pending?: string; error?: string;
  before: Files; after: Files;
  // Files the extension created (their "before" is the content Yampi gave them) and images it uploaded.
  created?: string[]; uploaded?: string[]; warnings?: string[];
}
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_FILES = 3000;
export const ROOTS = new Set(['assets', 'components', 'elements', 'sections', 'templates']);
export function validatePath(path: string): string {
  if (!path || path.length > 240 || path !== path.normalize('NFC') || /[\\\u0000-\u001f\u007f:<>"|?*]/.test(path)) throw new Error(`Caminho inválido: ${path}`);
  const parts = path.split('/');
  if (parts.length < 2 || !ROOTS.has(parts[0]) || parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw new Error(`Caminho fora do tema ou inseguro: ${path}`);
  return path;
}
export function validatePaths(paths: string[]): void {
  if (paths.length > MAX_FILES) throw new Error('Limite de arquivos excedido.');
  const seen = new Set<string>();
  for (const path of paths) {
    validatePath(path);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`Caminho duplicado ou ambíguo no Windows: ${path}`);
    seen.add(key);
  }
  // A file cannot also act as a directory for a second entry.
  for (const path of paths) for (let i = path.indexOf('/'); i >= 0; i = path.indexOf('/', i + 1)) {
    if (seen.has(path.slice(0, i).toLowerCase())) throw new Error(`Arquivo e pasta com o mesmo caminho: ${path}`);
  }
}
export function writable(path: string): boolean {return /\.(twig|vue|css|scss)$/i.test(path)}
export function lineEnding(text: string): {eol: LineEnding; finalNewline: boolean} {
  const crlf = (text.match(/\r\n/g) || []).length, cr = (text.match(/\r(?!\n)/g) || []).length, lf = (text.match(/(?<!\r)\n/g) || []).length;
  const kinds = [crlf && 'crlf', cr && 'cr', lf && 'lf'].filter(Boolean) as LineEnding[];
  return {eol: kinds.length > 1 ? 'mixed' : kinds[0] || 'none', finalNewline: /[\r\n]$/.test(text)};
}
// Editors may reindent, trim trailing spaces or toggle the final newline. Such a
// difference is shown separately and can be discarded before sending.
export function sameIgnoringWhitespace(a: string, b: string): boolean {
  const normalize = (text: string) => text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).join('\n');
  return normalize(a) === normalize(b);
}
export function imagePath(path: string): boolean {return /^assets\/.*\.(png|jpe?g|webp|svg)$/i.test(path)}
// What the Yampi editor itself accepts (public editor module, read on 15/10/2026).
// "Adicionar arquivo" creates `<folder>/<name>.<ext>` in an existing folder; the name takes
// letters, digits, "_" and "-". The extension creates only what it can fill: Twig, Vue, SCSS.
export const YAMPI_VUE_TEMPLATE = '<template>\n    <div>\n\n    </div>\n</template>\n\n<script>\n    export default {\n        \n    }\n</script>\n\n<style lang="scss" scoped>\n\n</style>';
export function creatableName(path: string): boolean {return /^[A-Za-z0-9_-]+\.(?:twig|vue|scss)$/.test(path.split('/').at(-1)!)}
// A file Yampi has just created holds nothing to lose: empty, or its default Vue component.
export function freshFile(path: string, content: string): boolean {return !content.trim() || /\.vue$/.test(path) && sameIgnoringWhitespace(content, YAMPI_VUE_TEMPLATE)}
// The uploader always saves to assets/images/<name>, lowercased, other characters as "-".
export function yampiImageName(fileName: string): string {
  const parts = fileName.split(/[/\\]/).at(-1)!.split('.'), last = parts.length > 1 ? parts.pop()! : '';
  const extension = last ? '.' + last.toLowerCase() : '';
  return parts.join('.').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + extension;
}
export function uploadablePath(path: string): boolean {
  const name = path.split('/').at(-1)!;
  return imagePath(path) && path === 'assets/images/' + name && yampiImageName(name) === name && !name.startsWith('.');
}
export function imageType(path: string): string {
  const extension = path.split('.').at(-1)!.toLowerCase();
  return extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : extension === 'svg' ? 'image/svg+xml' : 'image/jpeg';
}
// The Yampi editor shows a stored image as a data: URL. Decode it in place: the editor
// page's security policy blocks fetch() even for data: URLs ("Failed to fetch").
export function dataUrlBytes(href: string): Uint8Array {
  const comma = href.indexOf(',');
  if (!/^data:/i.test(href) || comma < 0) throw new Error('Imagem em formato não reconhecido.');
  const meta = href.slice('data:'.length, comma), payload = href.slice(comma + 1);
  if (!/;base64$/i.test(meta)) return new TextEncoder().encode(decodeURIComponent(payload));
  let binary: string;
  try {binary = atob(payload);} catch {throw new Error('Imagem com codificação inválida.');}
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export function validateImage(path: string, bytes: Uint8Array): void {
  if (!imagePath(path) || !bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error(`Imagem inválida ou grande demais: ${path}`);
  const hex = Array.from(bytes.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
  const extension = path.split('.').at(-1)!.toLowerCase();
  const valid = extension === 'png' ? hex.startsWith('89504e470d0a1a0a')
    : ['jpg', 'jpeg'].includes(extension) ? hex.startsWith('ffd8ff')
    : extension === 'webp' ? hex.startsWith('52494646') && hex.slice(16, 24) === '57454250'
    : /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  if (!valid) throw new Error(`Conteúdo não corresponde ao tipo da imagem: ${path}`);
}
export function safeSnapshot(snapshot: Snapshot): Snapshot {
  const files = safeFiles(Object.entries(snapshot.files));
  const assets: Assets = Object.create(null);
  validatePaths([...Object.keys(files), ...Object.keys(snapshot.assets || {})]);
  let total = Object.values(files).reduce((n, v) => n + new TextEncoder().encode(v).length, 0);
  for (const [path, bytes] of Object.entries(snapshot.assets || {})) {
    validateImage(path, bytes);
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error('O tema ultrapassa o limite de 32 MiB.');
    assets[path] = new Uint8Array(bytes);
  }
  return {...snapshot, context: validateContext(snapshot.context), files, ...(Object.keys(assets).length ? {assets} : {})};
}
export function sameContext(a: Context, b: Context): boolean {
  return a.storeName === b.storeName && a.previewOrigin === b.previewOrigin && a.editorOrigin === b.editorOrigin;
}
export function assertContext(a: Context, b: Context): void {
  if (!sameContext(a, b)) throw new Error('A loja de destino mudou ou não corresponde à exportação. Operação interrompida.');
}
export function validateContext(value: unknown): Context {
  const c = value as Context;
  if (!c || typeof c.storeName !== 'string' || !c.storeName.trim() || c.storeName.length > 200) throw new Error('Identificação da loja inválida.');
  for (const key of ['previewOrigin', 'editorOrigin'] as const) {
    const u = new URL(c[key]);
    if (!['https:', 'http:'].includes(u.protocol) || u.origin !== c[key]) throw new Error('Origem da loja inválida.');
  }
  return {storeName: c.storeName, previewOrigin: c.previewOrigin, editorOrigin: c.editorOrigin};
}
export function safeFiles(entries: [string, string][]): Files {
  validatePaths(entries.map(([p]) => p));
  const result: Files = Object.create(null);
  let size = 0;
  for (const [p, content] of entries) {
    const bytes = new TextEncoder().encode(content).length;
    if (bytes > MAX_FILE_BYTES || content.includes('\u0000')) throw new Error(`Arquivo binário ou grande demais: ${p}`);
    size += bytes;
    if (size > MAX_TOTAL_BYTES) throw new Error('O tema ultrapassa o limite de 32 MiB.');
    result[p] = content;
  }
  return result;
}
export async function sha256(text: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(text));
}
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
