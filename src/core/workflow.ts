import {assertContext, safeFiles, safeSnapshot, imagePath, writable, validatePaths, MAX_TOTAL_BYTES, MAX_FILE_BYTES, type Assets, type Adapter, type ReadAdapter, type Snapshot, type Progress, type Plan, type Journal} from './model';
import {missingNewTexts} from './planner';
type Hooks = {signal?: AbortSignal; progress?: (p: Progress) => void};
function check(signal?: AbortSignal) {if (signal?.aborted) throw new Error('Cancelado. Os arquivos já salvos não foram desfeitos.');}
export async function capture(adapter: ReadAdapter, hooks: Hooks = {}): Promise<Snapshot> {
  if (hooks.signal?.aborted) throw new Error('Cópia cancelada. Nenhum arquivo da loja foi alterado.');
  const context = await adapter.context();
  const paths = (await adapter.inventory()).sort();
  validatePaths(paths);
  if (!paths.length) throw new Error('Nenhum arquivo encontrado no editor.');
  const entries: [string, string][] = [];
  const assets: Assets = Object.create(null);
  let total = 0;
  let done = 0;
  for (const path of paths) {
    if (hooks.signal?.aborted) throw new Error('Cópia cancelada. Nenhum arquivo da loja foi alterado.');
    assertContext(context, await adapter.context());
    if (imagePath(path)) {
      if (!adapter.readAsset) throw new Error(`O adaptador não consegue exportar a imagem: ${path}`);
      const bytes = await adapter.readAsset(path);
      total += bytes.length; assets[path] = bytes;
    } else {
      const content = await adapter.read(path);
      const size = new TextEncoder().encode(content).length;
      if (size > MAX_FILE_BYTES) throw new Error(`Arquivo grande demais: ${path}`);
      total += size; entries.push([path, content]);
    }
    if (total > MAX_TOTAL_BYTES) throw new Error('O tema ultrapassa o limite de 32 MiB.');
    hooks.progress?.({done: ++done, total: paths.length, path, phase: 'Lendo arquivos'});
  }
  if (hooks.signal?.aborted) throw new Error('Cópia cancelada. Nenhum arquivo da loja foi alterado.');
  assertContext(context, await adapter.context());
  const end = (await adapter.inventory()).sort();
  if (JSON.stringify(paths) !== JSON.stringify(end)) throw new Error('A árvore de arquivos mudou durante a leitura. Exporte novamente.');
  return safeSnapshot({context, capturedAt: new Date().toISOString(), files: safeFiles(entries), ...(Object.keys(assets).length ? {assets} : {})});
}
export async function applyPlan(adapter: Adapter, plan: Plan, selected: string[], hooks: Hooks & {
  persist: (journal: Journal) => Promise<void>;
  backup: (snapshot: Snapshot) => Promise<void>;
}): Promise<Journal> {
  if (!selected.length || new Set(selected).size !== selected.length) throw new Error('Selecione arquivos sem duplicatas.');
  validatePaths(selected);
  const missing = missingNewTexts(plan);
  if (missing.length) throw new Error(`Crie vazios no editor da Yampi os arquivos novos e compare novamente: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` e mais ${missing.length - 3}` : ''}.`);
  const rows = selected.map(path => {
    const matches = plan.rows.filter(r => r.path === path);
    if (matches.length !== 1 || matches[0].status !== 'update' || !writable(path) || matches[0].image || matches[0].local === undefined || matches[0].remote === undefined) throw new Error(`Arquivo não elegível para envio: ${path}`);
    return matches[0];
  });
  // Fill new files first, so the files that use them stop pointing to empty ones as early as possible.
  rows.sort((a, b) => Number(b.base === undefined) - Number(a.base === undefined));
  check(hooks.signal);
  assertContext(plan.context, await adapter.context());
  await adapter.refresh();
  // Preflight every selected file before the first mutation.
  const before: [string, string][] = [];
  for (const row of rows) {
    check(hooks.signal);
    assertContext(plan.context, await adapter.context());
    const value = await adapter.read(row.path);
    if (value !== row.remote) throw new Error(`Conflito após a comparação: ${row.path}. Compare novamente.`);
    before.push([row.path, value]);
  }
  const snapshot: Snapshot = {context: plan.context, capturedAt: new Date().toISOString(), files: safeFiles(before)};
  const journal: Journal = {version: 1, id: crypto.randomUUID(), context: plan.context, startedAt: snapshot.capturedAt, status: 'prepared', selected, verified: [], before: snapshot.files, after: safeFiles(rows.map(r => [r.path, r.local!]))};
  try {
    await hooks.persist(journal);
    await hooks.backup(snapshot); // Must persist successfully BEFORE a write. A backup only covers selected paths.
    journal.status = 'running';
    await hooks.persist(journal);
    for (const row of rows) {
      check(hooks.signal);
      assertContext(plan.context, await adapter.context());
      journal.pending = row.path;
      await hooks.persist(journal);
      // Adapter checks the expected content again inside the editor immediately before saving.
      await adapter.write(row.path, row.remote!, row.local!);
      // CodeMirror can keep text the server rejected. Confirm on the platform before the next file.
      await adapter.refresh();
      assertContext(plan.context, await adapter.context());
      if (await adapter.read(row.path) !== row.local) throw new Error(`Arquivo não persistiu após recarregar: ${row.path}`);
      journal.verified.push(row.path);
      delete journal.pending;
      await hooks.persist(journal);
      hooks.progress?.({done: journal.verified.length, total: rows.length, path: row.path, phase: 'Salvando no editor'});
    }
    // Reopen from the platform after reload, avoiding a false positive from CodeMirror's own buffer.
    check(hooks.signal);
    await adapter.refresh();
    for (const row of rows) {
      check(hooks.signal);
      assertContext(plan.context, await adapter.context());
      if (await adapter.read(row.path) !== row.local) throw new Error(`Arquivo não persistiu após recarregar: ${row.path}`);
    }
    journal.status = 'completed';
    await hooks.persist(journal);
    return journal;
  } catch (error) {
    journal.status = 'stopped';
    journal.error = error instanceof Error ? error.message : String(error);
    await hooks.persist(journal);
    throw error;
  }
}
