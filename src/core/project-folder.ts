import {validatePath} from './model';
// The project folder as the extension may touch it, by path from the project root: the texts and
// images of tema/, and the extension's own records in .yampi-sync/ (the reference and the
// versions). Any other path is refused before reaching the disk; tools, package files, preview/
// and node_modules are never written.
export interface ProjectFolder {
  readonly name: string;
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  // Every file below a folder, as paths from the project root.
  list(folder: string): Promise<string[]>;
}
export const MANIFEST = '.yampi-sync/manifest.json';
export const BASELINE = '.yampi-sync/baseline';
// Written before the reference is rewritten and removed after: a reader that finds it knows the
// rewrite stopped midway and which two states each reference file may be in.
export const PENDING = '.yampi-sync/referencia-pendente.json';
export const VERSIONS = '.yampi-sync/versoes';
const RECORD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
export function projectPath(path: string): string {
  const inside = (prefix: string) => path.startsWith(prefix + '/') ? path.slice(prefix.length + 1) : undefined;
  const theme = inside('tema') ?? inside(BASELINE);
  if (theme !== undefined) {validatePath(theme); return path;}
  if (path === MANIFEST || path === PENDING) return path;
  const record = inside(VERSIONS);
  if (record !== undefined && record.split('/').length <= 3 && record.split('/').every(part => RECORD.test(part) && !/^\.+$/.test(part))) return path;
  throw new Error(`Caminho fora do que a extensão grava no projeto: ${path}`);
}
export function projectFolderPath(folder: string): string {
  if (['tema', BASELINE, VERSIONS].includes(folder)) return folder;
  throw new Error(`Pasta fora do que a extensão lê no projeto: ${folder}`);
}
const BOM = String.fromCharCode(0xfeff);
// Texts are read as the comparison reads them: UTF-8, line breaks as \n.
const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
export function readText(bytes: Uint8Array): string {return decoder.decode(bytes).replace(/\r\n?/g, '\n');}
// A text written over an existing file keeps that file's byte order mark and \r\n line breaks,
// as the user's editor left them; a new file is written as given.
export function encodeLike(text: string, existing?: Uint8Array): Uint8Array {
  const bom = !!existing && existing[0] === 0xef && existing[1] === 0xbb && existing[2] === 0xbf;
  const crlf = !!existing && new TextDecoder().decode(existing).includes('\r\n');
  const body = bom && text.startsWith(BOM) ? text.slice(1) : text;
  return new TextEncoder().encode((bom ? BOM : '') + (crlf ? body.replace(/\r?\n/g, '\r\n') : body));
}
