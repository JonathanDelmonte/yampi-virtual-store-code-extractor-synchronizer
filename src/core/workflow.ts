import {assertContext, safeFiles, safeSnapshot, imagePath, writable, validatePaths, freshFile, YAMPI_VUE_TEMPLATE, MAX_TOTAL_BYTES, MAX_FILE_BYTES, type Assets, type Adapter, type ReadAdapter, type Snapshot, type Progress, type Plan, type PlanRow, type Journal} from './model';
import {missingNewTexts, selectionIssues} from './planner';
import {COMPONENTS_FILE as COMPONENTS} from '../../local-runtime/contract.mjs';
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
type Hooks = {signal?: AbortSignal; progress?: (p: Progress) => void};
function check(signal?: AbortSignal) {if (signal?.aborted) throw new Error('Cancelado. Os arquivos já salvos não foram desfeitos.');}
export interface CaptureHooks extends Hooks {
  // Read only these store paths; the others are listed, not opened. A comparison needs only
  // what the project changed: a file the project leaves as exported is never sent.
  only?: Iterable<string>;
}
export type Capture = Snapshot & {inventory: string[]; partial?: boolean};
export async function capture(adapter: ReadAdapter, hooks: CaptureHooks = {}): Promise<Capture> {
  const cancelled = () => {if (hooks.signal?.aborted) throw new Error('Cópia cancelada. Nenhum arquivo da loja foi alterado.');};
  cancelled();
  const context = await adapter.context();
  const inventory = (await adapter.inventory()).sort();
  validatePaths(inventory);
  if (!inventory.length) throw new Error('Nenhum arquivo encontrado no editor.');
  hooks.progress?.({done: 1, total: 1, path: '', phase: 'Listando os arquivos da loja', step: 'inventory'});
  const wanted = hooks.only ? new Set(hooks.only) : undefined;
  const paths = wanted ? inventory.filter(path => wanted.has(path)) : inventory;
  const entries: [string, string][] = [];
  const assets: Assets = Object.create(null);
  let total = 0;
  for (const [index, path] of paths.entries()) {
    cancelled();
    // The editor bridge checks the store on every command; this also covers other adapters.
    if (index % 25 === 0) assertContext(context, await adapter.context());
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
    hooks.progress?.({done: index + 1, total: paths.length, path, phase: 'Lendo arquivos', step: 'read'});
  }
  cancelled();
  assertContext(context, await adapter.context());
  const end = (await adapter.inventory()).sort();
  if (JSON.stringify(inventory) !== JSON.stringify(end)) throw new Error('A árvore de arquivos mudou durante a leitura. Exporte novamente.');
  const snapshot = safeSnapshot({context, capturedAt: new Date().toISOString(), files: safeFiles(entries), ...(Object.keys(assets).length ? {assets} : {})});
  return {...snapshot, inventory, ...(wanted ? {partial: true} : {})};
}
export interface SendHooks extends Hooks {
  persist: (journal: Journal) => Promise<void>;
  backup: (snapshot: Snapshot, journal: Journal) => Promise<void>;
}
export interface SendOptions {
  // An interrupted send to continue. What it already did is skipped; the item it was on is
  // checked against the store first, and anything changed by someone else stops the send.
  previous?: Journal;
  scope?: Journal['scope'];
}
const initialContent = (path: string) => path.endsWith('.vue') ? YAMPI_VUE_TEMPLATE : '';
const add = (list: string[], path: string) => {if (!list.includes(path)) list.push(path);};
const drop = (list: string[], path: string) => {const index = list.indexOf(path); if (index >= 0) list.splice(index, 1);};
// Changes come only after the backup, so a record that shows one was backed up. A record without
// any starts again, with a new preflight and backup: a failed backup also ends as `stopped`.
export const continues = (journal: Journal) => !!(journal.verified.length || journal.created?.length || journal.uploaded?.length || journal.issued?.length || journal.pending);
export async function applyPlan(adapter: Adapter, plan: Plan, selected: string[], hooks: SendHooks, options: SendOptions = {}): Promise<Journal> {
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
  const previous = options.previous;
  if (previous) {
    if (previous.status === 'completed') throw new Error('Este envio já foi concluído.');
    assertContext(previous.context, plan.context);
    if (JSON.stringify([...previous.selected].sort()) !== JSON.stringify([...selected].sort())) throw new Error('A seleção não corresponde ao envio interrompido. Compare novamente.');
  }
  // A send stopped before its first change simply starts again; after that, it continues.
  const resuming = !!previous && continues(previous);
  const emit = (step: string, phase: string, done: number, total: number, path = '') => hooks.progress?.({step, phase, done, total, path});
  check(hooks.signal);
  assertContext(plan.context, await adapter.context());
  emit('prepare', 'Recarregando o editor', 0, 1);
  await adapter.refresh();
  assertContext(plan.context, await adapter.context());
  // The editor shows the server's version right after a reload. Only a change makes it stale again.
  let fresh = true;
  const present = new Set(await adapter.inventory());
  emit('prepare', 'Recarregando o editor', 1, 1);
  let journal: Journal, snapshot: Snapshot | undefined;
  if (!resuming) {
    // Preflight before the first change: every existing file still as compared, every new path still free.
    for (const row of [...creates, ...uploads]) if (present.has(row.path)) throw new Error(`O arquivo apareceu na loja depois da comparação: ${row.path}. Compare novamente.`);
    const updates = texts.filter(r => r.status === 'update'), before: [string, string][] = [];
    emit('preflight', 'Conferindo a loja antes de salvar', 0, updates.length);
    for (const [index, row] of updates.entries()) {
      check(hooks.signal);
      const value = await adapter.read(row.path);
      if (value !== row.remote) throw new Error(`Conflito após a comparação: ${row.path}. Compare novamente.`);
      before.push([row.path, value]);
      emit('preflight', 'Conferindo a loja antes de salvar', index + 1, updates.length, row.path);
    }
    assertContext(plan.context, await adapter.context());
    snapshot = {context: plan.context, capturedAt: new Date().toISOString(), files: safeFiles(before)};
    journal = {version: 1, id: previous?.id ?? crypto.randomUUID(), context: plan.context, startedAt: snapshot.capturedAt, status: 'prepared', selected, verified: [], before: {...snapshot.files}, after: safeFiles(texts.map(r => [r.path, r.local!])), created: [], uploaded: [], issued: [], ...(options.scope ? {scope: options.scope} : {})};
  } else {
    journal = structuredClone(previous!);
    journal.status = 'running'; delete journal.error; delete journal.pending;
    journal.created ||= []; journal.uploaded ||= []; journal.issued ||= [];
    journal.resumedAt = [...journal.resumedAt || [], new Date().toISOString()];
  }
  const created = journal.created!, uploaded = journal.uploaded!, issued = journal.issued!;
  try {
    if (snapshot) {
      await hooks.persist(journal);
      emit('backup', 'Guardando o backup', 0, 1);
      await hooks.backup(snapshot, journal); // Must persist successfully BEFORE a change. Covers existing selected texts.
      emit('backup', 'Guardando o backup', 1, 1);
      journal.status = 'running';
    }
    await hooks.persist(journal);
    // 1. New texts, through the editor's own "Adicionar arquivo"; 2. new images, through its uploader.
    // The editor lists each one before the next; one reload per group then confirms them all.
    const issue = async (rows: PlanRow[], done: string[], step: string, label: string, action: (row: PlanRow) => Promise<void>) => {
      let count = rows.filter(r => done.includes(r.path)).length;
      const batch: PlanRow[] = [];
      emit(step, label, count, rows.length);
      for (const row of rows) {
        if (done.includes(row.path)) continue;
        // Already in the store when continuing: done by the interrupted run, confirmed below.
        if (!present.has(row.path)) {
          check(hooks.signal);
          assertContext(plan.context, await adapter.context());
          journal.pending = row.path; add(issued, row.path); await hooks.persist(journal);
          await action(row); fresh = false;
          delete journal.pending; await hooks.persist(journal);
        }
        batch.push(row);
        emit(step, label, ++count, rows.length, row.source || row.path);
      }
      if (!batch.length) return;
      check(hooks.signal);
      if (!fresh) {await adapter.refresh(); fresh = true;}
      assertContext(plan.context, await adapter.context());
      const listed = new Set(await adapter.inventory());
      for (const row of batch) {
        journal.pending = row.path;
        emit(step, 'Conferindo após recarregar', rows.length, rows.length, row.source || row.path);
        if (!listed.has(row.path)) throw new Error(`A Yampi não manteve o arquivo enviado: ${row.path}`);
        if (row.status === 'create') {
          const content = await adapter.read(row.path);
          if (freshFile(row.path, content)) journal.before[row.path] = content;
          // Created and already filled by the interrupted run.
          else if (resuming && content === row.local) journal.before[row.path] = initialContent(row.path);
          else throw new Error(`A Yampi criou o arquivo com conteúdo inesperado: ${row.path}`);
        } else if (!adapter.readAsset || !sameBytes(await adapter.readAsset(row.path), row.image!.local!)) throw new Error(`Imagem diferente após o envio: ${row.path}`);
        add(done, row.path); drop(issued, row.path); delete journal.pending;
        await hooks.persist(journal);
      }
    };
    await issue(creates, created, 'create', 'Criando arquivos', row => adapter.create!(row.path));
    await issue(uploads, uploaded, 'upload', 'Enviando imagens', row => adapter.upload!(row.path, row.image!.local!));
    // 3. Texts, new ones first. The bridge checks the expected content again right before saving,
    // and a reload after each save confirms it on the platform before the next file.
    let saved = texts.filter(r => journal.verified.includes(r.path)).length;
    emit('save', 'Salvando e conferindo', saved, texts.length);
    for (const row of texts) {
      if (journal.verified.includes(row.path)) continue;
      check(hooks.signal);
      const expected = row.status === 'create' ? journal.before[row.path] : row.remote!;
      if (expected === undefined) throw new Error(`Conteúdo inicial desconhecido: ${row.path}. Compare novamente.`);
      if (!fresh) {await adapter.refresh(); fresh = true;}
      assertContext(plan.context, await adapter.context());
      journal.pending = row.path; await hooks.persist(journal);
      if (resuming) {
        const current = await adapter.read(row.path);
        if (current !== row.local && current !== expected) throw new Error(`${row.path} mudou na loja depois que o envio começou. Compare novamente antes de continuar.`);
        if (current === row.local) {
          journal.verified.push(row.path); delete journal.pending; await hooks.persist(journal);
          emit('save', 'Salvando e conferindo', ++saved, texts.length, row.path);
          continue;
        }
      }
      await adapter.write(row.path, expected, row.local!); fresh = false;
      // CodeMirror can keep text the server rejected. Confirm on the platform before the next file.
      await adapter.refresh(); fresh = true;
      assertContext(plan.context, await adapter.context());
      if (await adapter.read(row.path) !== row.local) throw new Error(`Arquivo não persistiu após recarregar: ${row.path}`);
      journal.verified.push(row.path); delete journal.pending; await hooks.persist(journal);
      emit('save', 'Salvando e conferindo', ++saved, texts.length, row.path);
    }
    // Every text again, from the platform: a later save must not have touched an earlier file.
    check(hooks.signal);
    if (!fresh) {await adapter.refresh(); fresh = true;}
    assertContext(plan.context, await adapter.context());
    emit('final', 'Conferência final', 0, texts.length);
    for (const [index, row] of texts.entries()) {
      check(hooks.signal);
      if (await adapter.read(row.path) !== row.local) throw new Error(`Arquivo não persistiu após recarregar: ${row.path}`);
      emit('final', 'Conferência final', index + 1, texts.length, row.path);
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
