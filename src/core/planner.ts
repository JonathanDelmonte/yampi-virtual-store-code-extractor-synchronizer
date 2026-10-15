import {assertContext, safeSnapshot, validatePaths, writable, type Assets, type Snapshot, type Files, type Plan, type PlanRow} from './model';
export function makePlan(base: Snapshot, local: Files, remote: Snapshot, localAssets: Assets = {}): Plan {
  assertContext(base.context, remote.context);
  safeSnapshot(base); safeSnapshot(remote); safeSnapshot({...base, files: local, assets: localAssets});
  const paths = [...new Set([...Object.keys(base.files), ...Object.keys(local), ...Object.keys(remote.files), ...Object.keys(base.assets || {}), ...Object.keys(localAssets), ...Object.keys(remote.assets || {})])].sort();
  validatePaths(paths);
  const rows: PlanRow[] = paths.map(path => {
    if (base.assets?.[path] || localAssets[path] || remote.assets?.[path]) {
      const b = base.assets?.[path], l = localAssets[path], r = remote.assets?.[path];
      const equal = (a?: Uint8Array, c?: Uint8Array) => !!a && !!c && a.length === c.length && a.every((v, i) => v === c[i]);
      // A new image uploaded by hand is confirmed by its bytes. Images are never sent.
      const status = !l ? 'missing-local' : !b ? (!r ? 'new-local' : equal(l, r) ? 'already-applied' : 'conflict') : !r ? 'missing-remote' : equal(l, r) ? (equal(l, b) ? 'unchanged' : 'already-applied') : equal(l, b) ? 'remote-only' : !equal(r, b) ? 'conflict' : 'unsupported';
      return {path, status, image: {base: b, local: l, remote: r}};
    }
    const b = base.files[path], l = local[path], r = remote.files[path];
    let status: PlanRow['status'];
    if (l === undefined) status = 'missing-local';
    // A new text reaches the store only when the owner creates it by hand. An empty one has nothing to lose and is filled.
    else if (b === undefined) status = r === undefined ? 'new-local' : l === r ? 'already-applied' : r.trim() ? 'conflict' : writable(path) ? 'update' : 'unsupported';
    else if (r === undefined) status = 'missing-remote';
    else if (l === r) status = l === b ? 'unchanged' : 'already-applied';
    else if (l === b) status = 'remote-only';
    else if (r !== b) status = 'conflict';
    else status = writable(path) ? 'update' : 'unsupported';
    return {path, base: b, local: l, remote: r, status};
  });
  return {context: remote.context, createdAt: new Date().toISOString(), rows};
}
// Changed files may include (Twig), import (Sass) or mount (Vue) a new text, so one missing from the store blocks every send.
export function missingNewTexts(plan: Plan): string[] {return plan.rows.filter(r => r.status === 'new-local' && !r.image).map(r => r.path);}
