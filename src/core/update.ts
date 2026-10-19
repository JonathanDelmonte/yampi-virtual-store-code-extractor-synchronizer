import {assertContext, safeSnapshot, type Assets, type Context, type Files, type Manifest, type Snapshot} from './model';
import type {Project} from './archive';
import {hasConflictMarks, mergeTexts} from './merge';
import {encodeLike, type ProjectFolder} from './project-folder';
import {writeReference} from './reference';
import {listVersions, saveVersion, type NewVersion, type Version} from './versions';
import type {Capture} from './workflow';
// Bringing the store's changes into the project folder before working on top of them, so the next
// send starts from the store as it is and never undoes what someone changed there. Three versions
// per path, as in the comparison: the reference (B, the store as last known), the folder (L) and the
// store now (R, read in full).
// marked: the folder's file still has conflict marks from an earlier update. It is left alone, and its
// reference does not move, so a newer change of the store still shows as a conflict once resolved.
export type UpdateKind = 'same' | 'mine' | 'store' | 'removed' | 'merged' | 'conflict' | 'removed-edited' | 'deleted-changed' | 'marked';
// marks: both versions in the file, between conflict marks, to finish in the code editor (nothing
// with marks is ever sent). mine: the folder's version stays, and replaces the store's on the next
// send. store: the store's version replaces the folder's.
export type Resolution = 'marks' | 'mine' | 'store';
// Where the update cannot decide alone; the first choice is the default. No default undoes a
// change made in the store: a conflict keeps both versions in the file, and a file the store
// removed or changed follows the store (the folder's version stays in the version kept before).
export const CHOICES: Partial<Record<UpdateKind, Resolution[]>> = {conflict: ['marks', 'mine', 'store'], 'removed-edited': ['store', 'mine'], 'deleted-changed': ['store', 'mine']};
export interface UpdateRow {
  path: string; kind: UpdateKind;
  base?: string; local?: string; store?: string;
  image?: {local?: Uint8Array; store?: Uint8Array};
  merged?: string; conflicts?: number;
  resolution?: Resolution;
}
// remote: the store as read. reference: what the reference becomes, the store as read except for
// files left marked, which keep theirs.
export interface UpdatePlan {context: Context; base: Snapshot; remote: Snapshot; reference: Snapshot; rows: UpdateRow[]}
const same = (a?: Uint8Array, b?: Uint8Array) => a === b || !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
const plain = (text?: string) => text?.replace(/\r\n?/g, '\n');
export function planUpdate(base: Snapshot, local: Files, localAssets: Assets, reading: Capture, picked: Record<string, Resolution> = {}): UpdatePlan {
  if (reading.partial) throw new Error('A atualização precisa da leitura completa da loja. Leia a loja de novo.');
  assertContext(base.context, reading.context);
  const remote = safeSnapshot({context: reading.context, capturedAt: reading.capturedAt, files: reading.files, ...(reading.assets && Object.keys(reading.assets).length ? {assets: reading.assets} : {})});
  const baseAssets = base.assets || {}, remoteAssets = remote.assets || {}, rows: UpdateRow[] = [];
  for (const path of new Set([...Object.keys(base.files), ...Object.keys(local), ...Object.keys(remote.files)])) {
    const b = base.files[path], l = local[path], r = remote.files[path], [pb, pl, pr] = [plain(b), plain(l), plain(r)];
    const row: UpdateRow = {path, kind: 'same', ...(b !== undefined ? {base: b} : {}), ...(l !== undefined ? {local: l} : {}), ...(r !== undefined ? {store: r} : {})};
    if (pl === pr) row.kind = 'same';
    else if (l !== undefined && hasConflictMarks(l)) row.kind = 'marked';
    else if (pl === pb) row.kind = r === undefined ? 'removed' : 'store';
    else if (pr === pb) row.kind = 'mine';
    else if (r === undefined) row.kind = 'removed-edited';
    else if (l === undefined) row.kind = 'deleted-changed';
    else {const merge = mergeTexts(b ?? '', l, r); row.merged = merge.text; row.conflicts = merge.conflicts; row.kind = merge.conflicts ? 'conflict' : 'merged';}
    const options = CHOICES[row.kind];
    if (options) row.resolution = options.includes(picked[path]) ? picked[path] : options[0];
    rows.push(row);
  }
  // Images serve the local preview: the store's comes in where the folder kept the old one, and an
  // image changed in the folder stays (images are never merged, and never sent by an update).
  for (const path of new Set([...Object.keys(baseAssets), ...Object.keys(localAssets), ...Object.keys(remoteAssets)])) {
    const b = baseAssets[path], l = localAssets[path], r = remoteAssets[path];
    rows.push({path, kind: same(l, r) ? 'same' : same(l, b) ? (r ? 'store' : 'removed') : 'mine', image: {...(l ? {local: l} : {}), ...(r ? {store: r} : {})}});
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  const files = {...remote.files};
  for (const row of rows.filter(item => item.kind === 'marked')) {if (row.base === undefined) delete files[row.path]; else files[row.path] = row.base;}
  return {context: remote.context, base, remote, reference: safeSnapshot({...remote, files}), rows};
}
// What the folder gets for a row: a text or an image to write, a file to remove, or nothing.
export type FolderChange = {write: string | Uint8Array} | {remove: true} | undefined;
export function folderChange(row: UpdateRow): FolderChange {
  if (row.image) return row.kind === 'store' ? {write: row.image.store!} : row.kind === 'removed' ? {remove: true} : undefined;
  if (row.kind === 'store') return {write: row.store!};
  if (row.kind === 'removed') return {remove: true};
  if (row.kind === 'merged') return {write: row.merged!};
  if (row.kind === 'conflict') return row.resolution === 'marks' ? {write: row.merged!} : row.resolution === 'store' ? {write: row.store!} : undefined;
  if (row.kind === 'removed-edited') return row.resolution === 'store' ? {remove: true} : undefined;
  if (row.kind === 'deleted-changed') return row.resolution === 'store' ? {write: row.store!} : undefined;
  return undefined;
}
export interface UpdateResult {written: string[]; removed: string[]; marked: string[]; versions: Version[]; manifest: Manifest}
// In this order, so a stop at any point loses nothing: (1) the folder must still be as the plan read
// it, (2) versions keep the reference, the folder and the store as they are now, (3) tema/ changes,
// (4) the reference becomes the store as read. Stopped after (3), the files the update brought
// already match the store, and the comparison sees them as already applied.
export async function applyUpdate(folder: ProjectFolder, plan: UpdatePlan, project: Project, progress?: (done: number, total: number) => void): Promise<UpdateResult> {
  if (!project.manifest) throw new Error('A pasta não tem o manifesto da exportação (.yampi-sync/manifest.json).');
  assertContext(project.baseline.context, plan.context);
  const changes = plan.rows.flatMap(row => {const change = folderChange(row); return change ? [{row, change}] : [];});
  for (const {row} of changes) {
    const unchanged = row.image ? same(project.localAssets[row.path], row.image.local) : project.local[row.path] === row.local;
    if (!unchanged) throw new Error(`tema/${row.path} mudou depois da leitura. Nada foi gravado: atualize de novo.`);
  }
  const known = (await listVersions(folder, plan.context)).versions, versions: Version[] = [];
  const keep = async (input: Omit<NewVersion, 'context'>) => {
    const {version, created} = await saveVersion(folder, {...input, context: plan.context}, known);
    if (created) known.unshift(version);
    versions.push(version);
  };
  await keep({kind: 'referencia', origin: 'loja', label: 'Loja antes da atualização', files: plan.base.files, capturedAt: plan.base.capturedAt});
  await keep({kind: 'antes-de-atualizar', origin: 'pasta', label: 'Pasta antes de atualizar da loja', files: project.local});
  await keep({kind: 'loja', origin: 'loja', label: 'Loja na atualização', files: plan.remote.files, capturedAt: plan.remote.capturedAt});
  const written: string[] = [], removed: string[] = [], marked: string[] = [];
  let done = 0;
  // Files leave before others arrive: a name that only changes case never loses the new file on Windows.
  for (const {row, change} of changes) if (change && 'remove' in change) {await folder.remove(`tema/${row.path}`); removed.push(row.path); progress?.(++done, changes.length);}
  for (const {row, change} of changes) {
    if (!change || !('write' in change)) continue;
    const path = `tema/${row.path}`;
    await folder.write(path, typeof change.write === 'string' ? encodeLike(change.write, await folder.read(path)) : change.write);
    written.push(row.path);
    if (row.kind === 'conflict' && row.resolution === 'marks') marked.push(row.path);
    progress?.(++done, changes.length);
  }
  const manifest = await writeReference(folder, project.baseline, plan.reference, project.manifest, 'update');
  return {written, removed, marked, versions, manifest};
}
