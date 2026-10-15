import {assertContext, safeSnapshot, validatePaths, writable, sameIgnoringWhitespace, type Assets, type Snapshot, type Files, type Plan, type PlanRow} from './model';
import {dependencyReport, resolvedReferences} from '../../local-runtime/dependencies.mjs';
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
  for (const row of rows) if (row.status === 'update' && sameIgnoringWhitespace(row.local!, row.remote!)) row.whitespaceOnly = true;
  // A sent file must not depend on a file the extension will not create.
  const localPaths = [...Object.keys(local), ...Object.keys(localAssets)], remotePaths = [...Object.keys(remote.files), ...Object.keys(remote.assets || {})];
  const report = dependencyReport({targets: rows.filter(r => r.status === 'update').map(r => r.path), texts: local, local: localPaths, remote: remotePaths});
  for (const item of report.blocked) Object.assign(rows.find(r => r.path === item.path)!, {status: 'blocked-dependency', blockedBy: item.dependencies.map(d => d.path)});
  // Modified files that use each other travel together. A dependency that cannot
  // be sent (conflict, block) also blocks the file that uses it.
  const changed = (row?: PlanRow) => !!row && row.local !== undefined && row.remote !== undefined && row.local !== row.remote && !row.whitespaceOnly && !row.image;
  const byPath = new Map(rows.map(row => [row.path, row]));
  const uses = new Map(rows.filter(r => r.status === 'update' || r.status === 'blocked-dependency').map(row => [row.path, resolvedReferences(row.path, row.local!, localPaths).filter(dep => changed(byPath.get(dep)))]));
  for (let changedStatus = true; changedStatus;) {
    changedStatus = false;
    for (const row of rows.filter(r => r.status === 'update' && !r.whitespaceOnly)) {
      const unsendable = (uses.get(row.path) || []).filter(dep => byPath.get(dep)!.status !== 'update');
      if (unsendable.length) {row.status = 'blocked-dependency'; row.blockedBy = unsendable; changedStatus = true;}
    }
  }
  // Whitespace-only differences are cosmetic and never couple other files.
  for (const row of rows) if (row.status === 'update' && !row.whitespaceOnly) {const deps = (uses.get(row.path) || []).filter(dep => byPath.get(dep)!.status === 'update'); if (deps.length) row.dependsOn = deps;}
  return {context: remote.context, createdAt: new Date().toISOString(), rows, warnings: report.warnings};
}
// Coupled modified files must be selected together: never a partial send.
export function selectionIssues(plan: Plan, selected: Iterable<string>): {path: string; requires: string}[] {
  const chosen = new Set(selected), issues: {path: string; requires: string}[] = [];
  for (const row of plan.rows) for (const dep of row.dependsOn || []) if (chosen.has(row.path) !== chosen.has(dep)) issues.push(chosen.has(row.path) ? {path: row.path, requires: dep} : {path: dep, requires: row.path});
  return issues;
}
// Changed files may include (Twig), import (Sass) or mount (Vue) a new text, so one missing from the store blocks every send.
export function missingNewTexts(plan: Plan): string[] {return plan.rows.filter(r => r.status === 'new-local' && !r.image).map(r => r.path);}
