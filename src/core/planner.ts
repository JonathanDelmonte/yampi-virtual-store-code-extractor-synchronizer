import {assertContext, safeSnapshot, validatePaths, writable, sameIgnoringWhitespace, creatableName, freshFile, uploadablePath, yampiImageName, type Assets, type Snapshot, type Files, type Plan, type PlanRow} from './model';
import {dependencyReport, resolvedReferences} from '../../local-runtime/dependencies.mjs';
import {COMPONENTS_FILE} from '../../local-runtime/contract.mjs';
export interface PlanOptions {overrides?: Iterable<string>}
const equalBytes = (a?: Uint8Array, b?: Uint8Array) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const parent = (path: string) => path.slice(0, path.lastIndexOf('/'));
// Rows the extension can carry out: fill or update a text, create a text, upload an image.
export const sendable = (row?: PlanRow) => !!row && (row.status === 'update' || row.status === 'create' || row.status === 'upload');
// Yampi keeps images only directly in assets/images, under the names its uploader gives.
// A new local image anywhere else gets a store path there: its own name when free, else
// its folders joined by "-". Images the store already has never move.
export function imageMoves(localAssets: Assets, baseAssets: Assets = {}, remoteAssets: Assets = {}): Map<string, string> {
  const moves = new Map<string, string>(), taken = new Map<string, Uint8Array>(Object.entries({...baseAssets, ...remoteAssets}));
  const stays = (path: string) => path in baseAssets || uploadablePath(path);
  for (const path of Object.keys(localAssets)) if (stays(path)) taken.set(path, localAssets[path]);
  for (const path of Object.keys(localAssets).sort()) {
    if (stays(path)) continue;
    const bytes = localAssets[path], relative = path.replace(/^assets\/(?:images\/)?/, '');
    for (const name of [yampiImageName(relative), yampiImageName(relative.replace(/\//g, '-'))]) {
      const target = 'assets/images/' + name, other = taken.get(target);
      if (!uploadablePath(target) || other && !equalBytes(other, bytes)) continue;
      moves.set(path, target); taken.set(target, bytes); break;
    }
  }
  return moves;
}
// Literal references follow their image: "images/hero/a.jpg" becomes "images/a.jpg" wherever
// the whole old path appears. A path built at runtime cannot be followed and is reported.
export function rewriteImageReferences(texts: Files, moves: Map<string, string>): {files: Files; rewritten: Record<string, number>; leftovers: Record<string, string[]>} {
  const files: Files = Object.create(null), rewritten: Record<string, number> = {}, leftovers: Record<string, string[]> = {};
  const pairs = new Map([...moves].map(([from, to]) => [from.slice('assets/'.length), to.slice('assets/'.length)]));
  const sorted = [...pairs.keys()].sort((a, b) => b.length - a.length);
  const pattern = sorted.length ? new RegExp(`(?<![A-Za-z0-9_-])(?:${sorted.map(escape).join('|')})(?![A-Za-z0-9_.-])`, 'g') : undefined;
  // What may still point at a moved image afterwards: its old folder ("images/hero/", built at
  // runtime) or its path inside images/ ("hero/a.jpg", as some helpers take). "images/" stays valid.
  const left = [...new Set(sorted.map(from => from.slice(0, from.lastIndexOf('/') + 1)))].filter(folder => folder && folder !== 'images/');
  const inner = sorted.filter(from => from.startsWith('images/') && from.indexOf('/', 'images/'.length) > 0).map(from => from.slice('images/'.length));
  const stale = [...left.map(folder => ({label: folder, test: new RegExp(`(?<![A-Za-z0-9_-])${escape(folder)}`)})), ...inner.map(name => ({label: name, test: new RegExp(`(?<![A-Za-z0-9_./-])${escape(name)}(?![A-Za-z0-9_.-])`)}))];
  for (const [path, text] of Object.entries(texts)) {
    let count = 0;
    const next = pattern ? text.replace(pattern, match => {count++; return pairs.get(match)!;}) : text;
    files[path] = next;
    if (count) rewritten[path] = count;
    const found = stale.filter(item => item.test.test(next)).map(item => item.label);
    if (found.length) leftovers[path] = found;
  }
  return {files, rewritten, leftovers};
}
// Three versions per path: original export (B), local project (L) and the store now (R).
// Local texts are compared as they will reach the store, with image references adjusted.
export function makePlan(base: Snapshot, local: Files, remote: Snapshot, localAssets: Assets = {}, options: PlanOptions = {}): Plan {
  assertContext(base.context, remote.context);
  safeSnapshot(base); safeSnapshot(remote); safeSnapshot({...base, files: local, assets: localAssets});
  const baseAssets = base.assets || {}, remoteAssets = remote.assets || {};
  const moves = imageMoves(localAssets, baseAssets, remoteAssets);
  const {files: texts, rewritten, leftovers} = rewriteImageReferences(local, moves);
  const storeAssets: Assets = Object.create(null), source = new Map<string, string>();
  for (const [path, bytes] of Object.entries(localAssets)) {const target = moves.get(path) || path; storeAssets[target] = bytes; if (target !== path) source.set(target, path);}
  // Yampi cannot create folders: a new file needs a folder that already holds something.
  const folders = new Set<string>();
  for (const path of [...Object.keys(remote.files), ...Object.keys(remoteAssets)]) for (let folder = parent(path); folder; folder = parent(folder)) folders.add(folder);
  const overrides = new Set(options.overrides || []);
  const paths = [...new Set([...Object.keys(base.files), ...Object.keys(texts), ...Object.keys(remote.files), ...Object.keys(baseAssets), ...Object.keys(storeAssets), ...Object.keys(remoteAssets)])].sort();
  validatePaths(paths);
  const rows: PlanRow[] = paths.map(path => {
    if (path in baseAssets || path in storeAssets || path in remoteAssets) {
      const b = baseAssets[path], l = storeAssets[path], r = remoteAssets[path];
      let status: PlanRow['status'], reason: string | undefined;
      if (!l) status = 'missing-local';
      else if (!b) {
        if (r) status = equalBytes(l, r) ? 'already-applied' : 'conflict';
        else if (uploadablePath(path)) status = 'upload';
        else {status = 'new-local'; reason = 'A Yampi guarda imagens só direto em assets/images, e outra imagem já usa esse nome.';}
      }
      else if (!r) status = 'missing-remote';
      else if (equalBytes(l, r)) status = equalBytes(l, b) ? 'unchanged' : 'already-applied';
      else if (equalBytes(l, b)) status = 'remote-only';
      else if (!equalBytes(r, b)) status = 'conflict';
      else {status = 'unsupported'; reason = 'A Yampi não substitui uma imagem existente. Salve a nova versão com outro nome no projeto.';}
      return {path, status, image: {base: b, local: l, remote: r}, ...(source.has(path) ? {source: source.get(path)} : {}), ...(reason ? {reason} : {})};
    }
    const b = base.files[path], l = texts[path], r = remote.files[path];
    let status: PlanRow['status'], reason: string | undefined, override = false;
    const resolve = (): PlanRow['status'] => writable(path) && overrides.has(path) ? (override = true, 'update') : 'conflict';
    if (l === undefined) status = 'missing-local';
    else if (b === undefined) {
      if (r !== undefined) status = l === r ? 'already-applied' : freshFile(path, r) ? (writable(path) ? 'update' : 'unsupported') : resolve();
      else if (!creatableName(path)) {status = 'new-local'; reason = 'A Yampi só cria arquivos .twig, .vue e .scss, com letras, números, "-" ou "_" no nome.';}
      else if (!folders.has(parent(path))) {status = 'new-local'; reason = `A pasta ${parent(path)} não existe na loja, e a Yampi não permite criar pastas.`;}
      else status = 'create';
    }
    else if (r === undefined) status = 'missing-remote';
    else if (l === r) status = l === b ? 'unchanged' : 'already-applied';
    else if (l === b) status = 'remote-only';
    else if (r !== b) status = resolve();
    else status = writable(path) ? 'update' : 'unsupported';
    // Yampi rewrites this list itself whenever a component is created; sending it would race that.
    if (path === COMPONENTS_FILE && (status === 'update' || status === 'conflict')) {status = 'unsupported'; reason = 'A Yampi gera este arquivo sozinha, com os componentes que existem na loja. A extensão não o envia.';}
    if (leftovers[path] && (status === 'update' || status === 'create')) {status = 'blocked-dependency'; reason = `Usa imagens que vão direto para assets/images por um caminho que a extensão não consegue ajustar (${leftovers[path].join(', ')}). Escreva no código o caminho completo, como 'images/pasta/arquivo.jpg'.`;}
    return {path, status, base: b, local: l, remote: r, ...(rewritten[path] ? {rewritten: rewritten[path]} : {}), ...(override ? {override} : {}), ...(reason ? {reason} : {})};
  });
  for (const row of rows) if (row.status === 'update' && sameIgnoringWhitespace(row.local!, row.remote!)) row.whitespaceOnly = true;
  // A sent file must not depend on a file that will not exist in the store.
  const localPaths = [...Object.keys(texts), ...Object.keys(storeAssets)];
  const remotePaths = [...Object.keys(remote.files), ...Object.keys(remoteAssets), ...rows.filter(r => r.status === 'create' || r.status === 'upload').map(r => r.path)];
  const report = dependencyReport({targets: rows.filter(r => r.status === 'update' || r.status === 'create').map(r => r.path), texts, local: localPaths, remote: remotePaths});
  for (const item of report.blocked) Object.assign(rows.find(r => r.path === item.path)!, {status: 'blocked-dependency', blockedBy: item.dependencies.map(d => d.path)});
  // Files that use each other travel together. A dependency that cannot be sent
  // (conflict, block) also blocks the file that uses it.
  const byPath = new Map(rows.map(row => [row.path, row]));
  // The store's components.twig is authoritative (Yampi writes it), so files including it never wait for ours.
  const changes = (row?: PlanRow) => !!row && row.path !== COMPONENTS_FILE && (row.status === 'create' || row.status === 'upload' || row.local !== undefined && row.remote !== undefined && row.local !== row.remote && !row.whitespaceOnly && !row.image);
  const uses = new Map(rows.filter(r => r.local !== undefined && (r.status === 'update' || r.status === 'create' || r.status === 'blocked-dependency')).map(row => [row.path, resolvedReferences(row.path, row.local!, localPaths).filter(dep => changes(byPath.get(dep)))]));
  const carried = (row: PlanRow) => row.status === 'update' && !row.whitespaceOnly || row.status === 'create';
  for (let again = true; again;) {
    again = false;
    for (const row of rows.filter(carried)) {
      const unsendable = (uses.get(row.path) || []).filter(dep => !sendable(byPath.get(dep)));
      if (unsendable.length) {row.status = 'blocked-dependency'; row.blockedBy = unsendable; again = true;}
    }
  }
  // Whitespace-only differences are cosmetic and never couple other files.
  for (const row of rows.filter(carried)) {const deps = (uses.get(row.path) || []).filter(dep => sendable(byPath.get(dep))); if (deps.length) row.dependsOn = deps;}
  return {context: remote.context, createdAt: new Date().toISOString(), rows, warnings: report.warnings};
}
// Coupled files must be selected together: never a partial send.
export function selectionIssues(plan: Plan, selected: Iterable<string>): {path: string; requires: string}[] {
  const chosen = new Set(selected), issues: {path: string; requires: string}[] = [];
  for (const row of plan.rows) for (const dep of row.dependsOn || []) if (chosen.has(row.path) !== chosen.has(dep)) issues.push(chosen.has(row.path) ? {path: row.path, requires: dep} : {path: dep, requires: row.path});
  return issues;
}
// New texts the extension cannot create (name, type or missing folder). Changed files may
// include, import or mount them, so any of them blocks every send until the project is fixed.
export function missingNewTexts(plan: Plan): string[] {return plan.rows.filter(r => r.status === 'new-local' && !r.image).map(r => r.path);}
