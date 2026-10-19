import {hashBytes, lineEnding, safeSnapshot, type FileHash, type Manifest, type Snapshot} from './model';
import {TOOL_VERSION} from './preview';
import {BASELINE, MANIFEST, PENDING, type ProjectFolder} from './project-folder';
// The reference — .yampi-sync/manifest.json and the files in .yampi-sync/baseline/ — is the store
// as last known: the download, then each update from the store and each confirmed send. The
// comparison uses it to tell who changed what, so it moves forward in the project folder itself,
// not only in this browser.
export interface PendingReference {format: 'zirtuno-sync-referencia'; version: 1; startedAt: string; current: FileHash[]; next: Manifest}
const encoder = new TextEncoder();
const bytesOf = (snapshot: Snapshot, path: string) => snapshot.assets?.[path] ?? encoder.encode(snapshot.files[path]);
async function hashes(snapshot: Snapshot): Promise<FileHash[]> {
  const out: FileHash[] = [];
  for (const path of [...Object.keys(snapshot.files), ...Object.keys(snapshot.assets || {})].sort()) {
    const image = !!snapshot.assets?.[path], bytes = bytesOf(snapshot, path);
    out.push({path, sha256: await hashBytes(bytes), bytes: bytes.length, kind: image ? 'image' : 'text', ...(image ? {} : lineEnding(snapshot.files[path]))});
  }
  return out;
}
// The download's metadata (tool, theme, skipped paths, preview) stays; files, capture time and
// the record of the move are the new reference's.
export async function referenceManifest(next: Snapshot, previous: Manifest, reason: 'update' | 'send'): Promise<Manifest> {
  const source = safeSnapshot(next);
  return {format: 'yampi-theme-sync', version: 3, ...(previous.tool ? {tool: previous.tool} : {}), ...(previous.theme ? {theme: previous.theme} : {}), context: source.context, capturedAt: source.capturedAt, files: await hashes(source), ...(previous.skipped ? {skipped: previous.skipped} : {}), ...(previous.preview ? {preview: previous.preview} : {}), reference: {updatedAt: new Date().toISOString(), reason, tool: TOOL_VERSION}};
}
// Rewrites only what changes. Order: the marker (with the hashes of both states), the files that
// leave the reference, the files that change, the manifest, and the marker's removal. Cut at any
// point, the folder still reads: each reference file is in one of the two states the marker names
// (see decodeEntries), and the next update finishes the job. Files leave before others arrive, so
// a name that only changes case never loses the new file on Windows.
export async function writeReference(folder: ProjectFolder, current: Snapshot, next: Snapshot, previous: Manifest, reason: 'update' | 'send'): Promise<Manifest> {
  const manifest = await referenceManifest(next, previous, reason), before = await hashes(safeSnapshot(current));
  const old = new Map(before.map(file => [file.path, file])), fresh = new Set(manifest.files.map(file => file.path));
  const leaving = before.filter(file => !fresh.has(file.path));
  const arriving = manifest.files.filter(file => old.get(file.path)?.sha256 !== file.sha256);
  const pending: PendingReference = {format: 'zirtuno-sync-referencia', version: 1, startedAt: new Date().toISOString(), current: before, next: manifest};
  await folder.write(PENDING, encoder.encode(JSON.stringify(pending) + '\n'));
  for (const file of leaving) await folder.remove(`${BASELINE}/${file.path}`);
  for (const file of arriving) await folder.write(`${BASELINE}/${file.path}`, bytesOf(next, file.path));
  await folder.write(MANIFEST, encoder.encode(JSON.stringify(manifest, null, 2)));
  await folder.remove(PENDING);
  return manifest;
}
