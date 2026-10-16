import {assertContext, safeFiles, safeSnapshot, imagePath, writable, validatePaths, freshFile, MAX_TOTAL_BYTES, MAX_FILE_BYTES, type Assets, type Adapter, type ReadAdapter, type Snapshot, type Progress, type Plan, type PlanRow, type Journal} from './model';
import {missingNewTexts, selectionIssues} from './planner';
import {COMPONENTS_FILE as COMPONENTS} from '../../local-runtime/contract.mjs';
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
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
  if (missing.length) throw new Error(`Arquivos novos que a Yampi não permite criar: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` e mais ${missing.length - 3}` : ''}. Ajuste-os no projeto e compare novamente.`);
  const rows = selected.map(path => {
    const matches = plan.rows.filter(r => r.path === path), row = matches[0];
    const eligible = matches.length === 1 && (
      row.status === 'update' && writable(path) && !row.image && row.local !== undefined && row.remote !== undefined ||
      row.status === 'create' && writable(path) && !row.image && row.local !== undefined && row.remote === undefined ||
      row.status === 'upload' && !!row.image?.local && !row.image.remote);
    if (!eligible) throw new Error(`Arquivo não elegível para envio: ${path}`);
    return row;
  });
  // Files that use each other are sent together or not at all.
  const partial = selectionIssues(plan, selected);
  if (partial.length) throw new Error('Envio parcial bloqueado: ' + partial.map(p => `${p.path} precisa ir junto com ${p.requires}`).join('; ') + '. Selecione os arquivos juntos.');
  const creates = rows.filter(r => r.status === 'create'), uploads = rows.filter(r => r.status === 'upload');
  // Fill new files first, so the files that use them stop pointing to empty ones as early as possible.
  const texts = rows.filter(r => r.status !== 'upload').sort((a, b) => Number(b.base === undefined) - Number(a.base === undefined));
  if (creates.length && !adapter.create || uploads.length && !adapter.upload) throw new Error('Este editor não permite criar arquivos pela extensão.');
  check(hooks.signal);
  assertContext(plan.context, await adapter.context());
  await adapter.refresh();
  // Preflight before the first mutation: every existing file still as compared, every new path still free.
  if (creates.length || uploads.length) {
    const present = new Set(await adapter.inventory());
    for (const row of [...creates, ...uploads]) if (present.has(row.path)) throw new Error(`O arquivo apareceu na loja depois da comparação: ${row.path}. Compare novamente.`);
  }
  const before: [string, string][] = [];
  for (const row of texts.filter(r => r.status === 'update')) {
    check(hooks.signal);
    assertContext(plan.context, await adapter.context());
    const value = await adapter.read(row.path);
    if (value !== row.remote) throw new Error(`Conflito após a comparação: ${row.path}. Compare novamente.`);
    before.push([row.path, value]);
  }
  const snapshot: Snapshot = {context: plan.context, capturedAt: new Date().toISOString(), files: safeFiles(before)};
  const journal: Journal = {version: 1, id: crypto.randomUUID(), context: plan.context, startedAt: snapshot.capturedAt, status: 'prepared', selected, verified: [], before: {...snapshot.files}, after: safeFiles(texts.map(r => [r.path, r.local!])), created: [], uploaded: []};
  const total = rows.length + creates.length;
  const step = async (row: PlanRow, phase: string, action: () => Promise<void>) => {
    check(hooks.signal);
    assertContext(plan.context, await adapter.context());
    journal.pending = row.path;
    await hooks.persist(journal);
    await action();
    delete journal.pending;
    await hooks.persist(journal);
    hooks.progress?.({done: journal.created!.length + journal.uploaded!.length + journal.verified.length, total, path: row.source || row.path, phase});
  };
  try {
    await hooks.persist(journal);
    await hooks.backup(snapshot); // Must persist successfully BEFORE a write. A backup only covers existing selected texts.
    journal.status = 'running';
    await hooks.persist(journal);
    // 1. New texts, through the editor's own "Adicionar arquivo". Yampi gives each one a fresh content.
    for (const row of creates) await step(row, 'Criando arquivos', async () => {
      await adapter.create!(row.path);
      await adapter.refresh();
      assertContext(plan.context, await adapter.context());
      const fresh = await adapter.read(row.path);
      if (!freshFile(row.path, fresh)) throw new Error(`A Yampi criou o arquivo com conteúdo inesperado: ${row.path}`);
      journal.before[row.path] = fresh; journal.created!.push(row.path);
    });
    // 2. New images, through the editor's own uploader, which keeps them in assets/images.
    for (const row of uploads) await step(row, 'Enviando imagens', async () => {
      await adapter.upload!(row.path, row.image!.local!);
      await adapter.refresh();
      assertContext(plan.context, await adapter.context());
      if (!adapter.readAsset || !sameBytes(await adapter.readAsset(row.path), row.image!.local!)) throw new Error(`Imagem diferente após o envio: ${row.path}`);
      journal.uploaded!.push(row.path);
    });
    // 3. Texts. The adapter checks the expected content again inside the editor right before saving.
    for (const row of texts) await step(row, 'Salvando no editor', async () => {
      await adapter.write(row.path, row.status === 'create' ? journal.before[row.path] : row.remote!, row.local!);
      // CodeMirror can keep text the server rejected. Confirm on the platform before the next file.
      await adapter.refresh();
      assertContext(plan.context, await adapter.context());
      if (await adapter.read(row.path) !== row.local) throw new Error(`Arquivo não persistiu após recarregar: ${row.path}`);
      journal.verified.push(row.path);
    });
    // Reopen from the platform after reload, avoiding a false positive from CodeMirror's own buffer.
    check(hooks.signal);
    await adapter.refresh();
    for (const row of texts) {
      check(hooks.signal);
      assertContext(plan.context, await adapter.context());
      if (await adapter.read(row.path) !== row.local) throw new Error(`Arquivo não persistiu após recarregar: ${row.path}`);
    }
    // Yampi lists components in components.twig itself; report the ones it has not listed yet.
    const components = creates.filter(r => r.path.endsWith('.vue'));
    if (components.length) {
      const list = await adapter.read(COMPONENTS).catch(() => undefined);
      const unlisted = components.filter(r => !list?.includes('/' + r.path.replace(/\.vue$/, '.js')));
      if (unlisted.length) journal.warnings = [`A Yampi ainda não listou em ${COMPONENTS}: ${unlisted.map(r => r.path).join(', ')}. Confira em Ver prévia; se o componente não aparecer, abra-o no editor da Yampi e salve de novo.`];
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
