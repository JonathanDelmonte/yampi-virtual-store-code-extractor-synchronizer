import {MAX_FILES, MAX_FILE_BYTES, hashBytes, safeFiles, sameContext, validateContext, validatePath, type Context, type Files} from './model';
import {VERSIONS, encodeLike, readText, type ProjectFolder} from './project-folder';
// Versions of the project's texts, kept in the project folder (.yampi-sync/versoes/) so they go
// wherever the folder goes and survive the browser's data being cleared. Each text is stored once,
// named by its SHA-256 (objetos/ab/abcd…); a version is a small record listing path → hash, so a
// new version only takes the space of the texts that changed. Images are left out on purpose: they
// serve the local preview, and bringing a text back never needs them.
export type VersionKind = 'referencia' | 'antes-de-atualizar' | 'loja' | 'envio' | 'antes-de-restaurar' | 'manual';
// pasta: the texts of tema/ (work that may not be in the store). loja: what the store had, read
// from it or confirmed after a send.
export type VersionOrigin = 'pasta' | 'loja';
export interface VersionFile {path: string; sha256: string; bytes: number}
export interface Version {
  format: 'zirtuno-sync-versao'; version: 1;
  id: string; createdAt: string; kind: VersionKind; origin: VersionOrigin; label: string;
  context: Context; tree: string; files: VersionFile[];
  // When the store's texts were read (origin loja), and the sends a version records.
  capturedAt?: string; journals?: string[];
}
export interface NewVersion {kind: VersionKind; origin: VersionOrigin; label: string; context: Context; files: Files; capturedAt?: string; journals?: string[]}
const KINDS = new Set<VersionKind>(['referencia', 'antes-de-atualizar', 'loja', 'envio', 'antes-de-restaurar', 'manual']);
const HASH = /^[a-f0-9]{64}$/, RECORD = /^\.yampi-sync\/versoes\/([A-Za-z0-9][A-Za-z0-9._-]*)\.json$/;
export const objectPath = (hash: string) => `${VERSIONS}/objetos/${hash.slice(0, 2)}/${hash}`;
const encoder = new TextEncoder(), exact = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
const treeOf = (files: VersionFile[]) => hashBytes(encoder.encode(files.map(f => f.path + '\t' + f.sha256 + '\n').join('')));
function versionId(createdAt: string, kind: VersionKind): string {
  return `${createdAt.replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d+)Z$/, '-$1')}-${kind}-${crypto.randomUUID().slice(0, 8)}`;
}
async function validVersion(value: unknown, id: string): Promise<Version> {
  const v = value as Version, invalid = () => new Error('Registro de versão inválido.');
  if (!v || v.format !== 'zirtuno-sync-versao' || v.version !== 1 || v.id !== id || !KINDS.has(v.kind) || !['pasta', 'loja'].includes(v.origin) || typeof v.label !== 'string' || v.label.length > 200 || typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt)) || typeof v.tree !== 'string' || !HASH.test(v.tree) || !Array.isArray(v.files) || v.files.length > MAX_FILES) throw invalid();
  if (v.capturedAt !== undefined && (typeof v.capturedAt !== 'string' || !Number.isFinite(Date.parse(v.capturedAt)))) throw invalid();
  if (v.journals !== undefined && (!Array.isArray(v.journals) || v.journals.length > 100 || v.journals.some(item => typeof item !== 'string' || item.length > 64))) throw invalid();
  const seen = new Set<string>(), files: VersionFile[] = [];
  for (const f of v.files) {
    if (!f || typeof f.path !== 'string' || typeof f.sha256 !== 'string' || !HASH.test(f.sha256) || !Number.isInteger(f.bytes) || f.bytes < 0 || f.bytes > MAX_FILE_BYTES) throw invalid();
    validatePath(f.path);
    if (seen.has(f.path.toLowerCase())) throw invalid();
    seen.add(f.path.toLowerCase()); files.push({path: f.path, sha256: f.sha256, bytes: f.bytes});
  }
  if (await treeOf(files) !== v.tree) throw invalid();
  return {format: v.format, version: 1, id, createdAt: v.createdAt, kind: v.kind, origin: v.origin, label: v.label, context: validateContext(v.context), tree: v.tree, files, ...(v.capturedAt ? {capturedAt: v.capturedAt} : {}), ...(v.journals ? {journals: [...v.journals]} : {})};
}
// The versions of this store, newest first. A record that cannot be read, or that belongs to
// another store, is set aside and named, never shown as this project's history.
export async function listVersions(folder: ProjectFolder, context: Context): Promise<{versions: Version[]; skipped: string[]}> {
  const versions: Version[] = [], skipped: string[] = [];
  for (const path of await folder.list(VERSIONS)) {
    const id = RECORD.exec(path)?.[1];
    if (!id) continue;
    try {
      const version = await validVersion(JSON.parse(readText((await folder.read(path))!)), id);
      if (sameContext(version.context, context)) versions.push(version); else skipped.push(path);
    } catch {skipped.push(path);}
  }
  versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return {versions, skipped};
}
// Texts are stored before the record that lists them, so a record never points to a missing text.
// An automatic version equal to the latest one of the same origin is not repeated: the existing
// one is returned. A version the user names is always kept.
export async function saveVersion(folder: ProjectFolder, input: NewVersion, existing?: Version[]): Promise<{version: Version; created: boolean}> {
  const context = validateContext(input.context), texts = safeFiles(Object.entries(input.files));
  const label = input.label.trim().slice(0, 200) || 'Versão sem nome';
  const files: VersionFile[] = [], bodies = new Map<string, Uint8Array>();
  for (const path of Object.keys(texts).sort()) {
    const bytes = encoder.encode(texts[path]), sha256 = await hashBytes(bytes);
    files.push({path, sha256, bytes: bytes.length}); bodies.set(sha256, bytes);
  }
  const tree = await treeOf(files);
  const known = existing ?? (await listVersions(folder, context)).versions;
  const latest = known.find(item => item.origin === input.origin);
  if (input.kind !== 'manual' && latest?.tree === tree) return {version: latest, created: false};
  const stored = new Set(await folder.list(VERSIONS));
  for (const [hash, bytes] of bodies) if (!stored.has(objectPath(hash))) await folder.write(objectPath(hash), bytes);
  const createdAt = new Date().toISOString();
  const version: Version = {format: 'zirtuno-sync-versao', version: 1, id: versionId(createdAt, input.kind), createdAt, kind: input.kind, origin: input.origin, label, context, tree, files, ...(input.capturedAt ? {capturedAt: input.capturedAt} : {}), ...(input.journals?.length ? {journals: [...input.journals]} : {})};
  await folder.write(`${VERSIONS}/${version.id}.json`, encoder.encode(JSON.stringify(version, null, 2) + '\n'));
  return {version, created: true};
}
// Every text of a version, each checked against its hash: a missing or changed text stops here.
export async function versionFiles(folder: ProjectFolder, version: Version): Promise<Files> {
  const out: [string, string][] = [];
  for (const file of version.files) {
    const bytes = await folder.read(objectPath(file.sha256));
    if (!bytes || bytes.length !== file.bytes || await hashBytes(bytes) !== file.sha256) throw new Error(`A versão “${version.label}” está incompleta ou foi alterada: ${file.path}.`);
    out.push([file.path, exact.decode(bytes)]);
  }
  return safeFiles(out);
}
// How the texts of a version differ from the project now: changed since, missing now (deleted
// since) or added since. Line breaks do not count, as in the comparison.
export type VersionChange = {path: string; change: 'changed' | 'missing-now' | 'added-since'};
export function versionChanges(saved: Files, current: Files): VersionChange[] {
  const paths = [...new Set([...Object.keys(saved), ...Object.keys(current)])].sort();
  return paths.flatMap((path): VersionChange[] => saved[path] === undefined ? [{path, change: 'added-since'}] : current[path] === undefined ? [{path, change: 'missing-now'}] : saved[path].replace(/\r\n?/g, '\n') !== current[path] ? [{path, change: 'changed'}] : []);
}
// Brings texts of a version back into tema/. The texts of the project now are kept first as a
// version; every chosen file must still be as the panel read it (absent included), or nothing is
// written. A file absent now is created, with its folders inside tema/. Nothing is deleted.
export async function restoreVersion(folder: ProjectFolder, version: Version, paths: string[], current: Files): Promise<{restored: string[]; safety: Version}> {
  if (!paths.length) throw new Error('Escolha o que trazer desta versão.');
  const saved = await versionFiles(folder, version), existing = new Map<string, Uint8Array | undefined>();
  for (const path of paths) {
    if (saved[path] === undefined) throw new Error(`${path} não existe nesta versão.`);
    const bytes = await folder.read(`tema/${path}`), now = bytes ? readText(bytes) : undefined;
    if (now !== current[path]) throw new Error(`tema/${path} mudou depois da leitura da pasta. Leia a pasta de novo antes de trazer a versão.`);
    existing.set(path, bytes);
  }
  const {version: safety} = await saveVersion(folder, {kind: 'antes-de-restaurar', origin: 'pasta', label: `Antes de trazer de “${version.label}”`, context: version.context, files: current});
  for (const path of paths) await folder.write(`tema/${path}`, encodeLike(saved[path], existing.get(path)));
  return {restored: [...paths], safety};
}
