import {imageMoves, rewriteImageReferences} from './planner';
import {yampiImageName, type Assets, type Files, type Snapshot} from './model';
import {resolvedReferences} from '../../local-runtime/dependencies.mjs';
import type {Capture} from './workflow';
const equalBytes = (a?: Uint8Array, b?: Uint8Array) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
// The store files a comparison has to read: those the project changes or adds, and the texts they
// use. A file the project leaves as exported is never sent, so its store version only matters for
// display, and reading hundreds of untouched files was most of the time a comparison took. A text
// the store changed still blocks the changed files that use it, as in a full comparison.
export function changedPaths(base: Snapshot, local: Files, localAssets: Assets = {}): string[] {
  const baseAssets = base.assets || {}, wanted = new Set<string>(), texts = Object.keys(local);
  const moves = imageMoves(localAssets, baseAssets);
  const {files: rewritten} = rewriteImageReferences(local, moves);
  for (const [path, text] of Object.entries(local)) if (base.files[path] !== text || rewritten[path] !== base.files[path]) {
    wanted.add(path);
    for (const used of resolvedReferences(path, rewritten[path] ?? text, texts)) wanted.add(used);
  }
  for (const [path, bytes] of Object.entries(localAssets)) {
    const target = moves.get(path) || path;
    if (equalBytes(baseAssets[target], bytes)) continue;
    wanted.add(target);
    // With another image under the first name in the store, the uploader name uses the folders.
    if (target !== path) wanted.add('assets/images/' + yampiImageName(path.replace(/^assets\/(?:images\/)?/, '').replace(/\//g, '-')));
  }
  return [...wanted].sort();
}
// A partial reading becomes a full remote snapshot: what was read is the store's version; what
// was not read but the store lists is taken as exported and marked, so the review says so.
export function remoteFromCapture(base: Snapshot, observed: Capture): {remote: Snapshot; assumed: string[]} {
  const files: Files = Object.create(null), assets: Assets = Object.create(null), assumed: string[] = [];
  for (const path of observed.inventory) {
    if (path in observed.files) files[path] = observed.files[path];
    else if (observed.assets?.[path]) assets[path] = observed.assets[path];
    else if (!observed.partial) continue;
    else if (path in base.files) {files[path] = base.files[path]; assumed.push(path);}
    else if (base.assets?.[path]) {assets[path] = base.assets[path]; assumed.push(path);}
  }
  return {remote: {context: observed.context, capturedAt: observed.capturedAt, files, ...(Object.keys(assets).length ? {assets} : {})}, assumed};
}
