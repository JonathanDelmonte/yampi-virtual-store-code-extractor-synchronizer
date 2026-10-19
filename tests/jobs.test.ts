import 'fake-indexeddb/auto';
import {beforeEach, describe, test, expect} from 'vitest';
import {unzipSync} from 'fflate';
import {runJob, type EngineHost} from '../src/jobs/engine';
import type {Decision, JobRequest, JobState, SendInput} from '../src/jobs/types';
import {makePlan} from '../src/core/planner';
import {changedPaths} from '../src/core/compare';
import {chooseBaseline} from '../src/core/workspace';
import {clearLocal, get, put, journalHistory, loadWorkspace, updateWorkspace} from '../src/storage';
import type {Journal} from '../src/core/model';
import {FakeEditor, context, snapshot} from './fixtures/fake-editor';
const home = 'templates/home.twig', product = 'templates/product.twig';
const store = {[home]: 'home', [product]: 'product', 'elements/head.twig': 'head'};
function host(editor: FakeEditor) {
  const reports: JobState[] = [], downloads: {name: string; bytes: Uint8Array}[] = [];
  const value: EngineHost = {
    rpc: async () => {throw new Error('O editor fictício é usado diretamente.');},
    adapter: () => editor,
    download: async (bytes, name) => {downloads.push({name, bytes});},
    report: state => {reports.push(state);},
    wait: async () => {}
  };
  return {host: value, reports, downloads};
}
const control = (signal = new AbortController().signal) => ({signal, decision: async (): Promise<Decision> => ({action: 'partial'})});
async function prepareSend(local: Record<string, string>, id = 'job-1') {
  const plan = makePlan(snapshot(store), local, snapshot(store));
  const selected = plan.rows.filter(r => r.status === 'update').map(r => r.path);
  await put(`jobinput:${id}`, {plan, selected, scope: 'project'} satisfies SendInput);
  await updateWorkspace(context, workspace => {workspace.baseline = snapshot(store); workspace.lineage = {exportedAt: snapshot(store).capturedAt, journals: []}; workspace.review = {reading: {...snapshot(store), inventory: Object.keys(store)}, overrides: []};});
  return {id, kind: 'send', scope: 'project'} satisfies JobRequest;
}
beforeEach(clearLocal);
describe('operações em segundo plano', () => {
  test('envio completo: progresso por etapa, backup baixado, registro e referência atualizada', async () => {
    const editor = new FakeEditor(store), {host: h, reports, downloads} = host(editor);
    const request = await prepareSend({...store, [home]: 'novo home', [product]: 'novo product'});
    const final = await runJob(request, context, h, control());
    expect(final).toMatchObject({status: 'completed', detail: 'Arquivos salvos e conferidos após recarregar', fraction: 1, result: {kind: 'send', verified: 2, total: 2}});
    expect(final.phases.find(p => p.id === 'save')).toMatchObject({status: 'done', done: 2, total: 2});
    expect(final.phases.find(p => p.id === 'create')?.status).toBe('skipped');
    expect(final.events.filter(e => e.text === 'Salvo e conferido').map(e => e.path)).toEqual([product, home]);
    // Progress is reported while the work happens, not only at the end.
    expect(reports.some(r => r.status === 'running' && r.fraction > 0 && r.fraction < 1)).toBe(true);
    expect(downloads.map(d => d.name)).toEqual([expect.stringMatching(/^backup-antes-do-envio-loja-ficticia-/)]);
    const [journal] = await journalHistory(context);
    expect(journal.status).toBe('completed');
    expect(await get(`sendplan:${journal.id}`)).toMatchObject({selected: [home, product]});
    expect((await get<{bytes: Uint8Array}>(`backup:${journal.id}`))?.bytes.length).toBeGreaterThan(0);
    const workspace = (await loadWorkspace(context))!;
    expect(workspace.baseline?.files[home]).toBe('novo home');
    expect(workspace.lineage).toMatchObject({journals: [journal.id]});
    expect(workspace.review?.reading).toBeUndefined();
    // The next comparison of the same project has nothing left to send and no conflicts.
    const next = makePlan(workspace.baseline!, {...store, [home]: 'novo home', [product]: 'novo product'}, snapshot(editor.files));
    expect(next.rows.filter(r => r.status !== 'unchanged')).toEqual([]);
  });
  test('envio interrompido mostra o registro e continua de onde parou', async () => {
    const editor = new FakeEditor(store), {host: h} = host(editor);
    editor.beforeWrite = path => {if (path === product) throw new Error('Aba do editor fechada');};
    const request = await prepareSend({...store, [home]: 'novo home', [product]: 'novo product'});
    const stopped = await runJob(request, context, h, control());
    expect(stopped).toMatchObject({status: 'failed', error: 'Aba do editor fechada', result: {kind: 'send', verified: 1, total: 2}});
    const journalId = (stopped.result as {journalId: string}).journalId;
    // The confirmed item already moved the reference.
    expect((await loadWorkspace(context))?.baseline?.files[home]).toBe('novo home');
    editor.beforeWrite = undefined;
    const resumed = await runJob({id: 'job-2', kind: 'send', resume: journalId}, context, h, control());
    expect(resumed).toMatchObject({status: 'completed', resumed: true, result: {journalId, verified: 2}});
    expect(resumed.phases.find(p => p.id === 'backup')?.status).toBe('skipped');
    expect(editor.writes).toEqual([home, product]);
    expect((await journalHistory(context))[0]).toMatchObject({id: journalId, status: 'completed'});
    expect((await loadWorkspace(context))?.lineage?.journals).toEqual([journalId]);
  });
  test('backup que não chegou ao computador é refeito ao continuar, antes de qualquer alteração', async () => {
    const editor = new FakeEditor(store), {host: h, downloads} = host(editor);
    h.download = async () => {throw new Error('Download cancelado');};
    const stopped = await runJob(await prepareSend({...store, [home]: 'novo home'}), context, h, control());
    expect(stopped).toMatchObject({status: 'failed', error: 'Download cancelado'});
    expect(editor.writes).toEqual([]);
    const journalId = (await journalHistory(context))[0].id;
    h.download = async (bytes, name) => {downloads.push({name, bytes});};
    const resumed = await runJob({id: 'job-2', kind: 'send', resume: journalId}, context, h, control());
    expect(resumed).toMatchObject({status: 'completed', result: {journalId, verified: 1}});
    expect(resumed.phases.find(p => p.id === 'backup')?.status).toBe('done');
    expect(downloads.map(d => d.name)).toEqual([expect.stringMatching(/^backup-antes-do-envio-/)]);
    expect(editor.writes).toEqual([home]);
  });
  test('interromper a pedido para depois do arquivo atual e fica marcado como interrompido', async () => {
    const editor = new FakeEditor(store), {host: h} = host(editor), controller = new AbortController();
    editor.afterWrite = () => controller.abort();
    const request = await prepareSend({...store, [home]: 'novo home', [product]: 'novo product'});
    const result = await runJob(request, context, h, control(controller.signal));
    expect(result.status).toBe('cancelled'); expect(editor.writes).toEqual([home]);
    expect((await journalHistory(context))[0]).toMatchObject({status: 'stopped', verified: [home]});
  });
  test('comparação lê só o que mudou e guarda a leitura para o painel', async () => {
    const editor = new FakeEditor({...store, 'elements/head.twig': 'mudou só na loja'}), {host: h} = host(editor);
    const local = {...store, [home]: 'novo home'};
    const result = await runJob({id: 'c', kind: 'compare', scope: 'project', paths: changedPaths(snapshot(store), local)}, context, h, control());
    expect(result).toMatchObject({status: 'completed', result: {kind: 'compare', read: 1, listed: 3, full: false}});
    expect(editor.reads).toEqual([home]); expect(editor.refreshes).toBe(1);
    const reading = (await loadWorkspace(context))?.review?.reading;
    expect(reading).toMatchObject({partial: true, files: {[home]: 'home'}, inventory: [ 'elements/head.twig', home, product]});
  });
  test('exportação guarda a referência e baixa o ZIP com o tema', async () => {
    const editor = new FakeEditor(store), {host: h, downloads} = host(editor);
    await updateWorkspace(context, workspace => {workspace.review = {reading: {...snapshot(store), inventory: []}, overrides: ['x']};});
    const result = await runJob({id: 'e', kind: 'export', includePreview: false}, context, h, control());
    expect(result).toMatchObject({status: 'completed', result: {kind: 'export', texts: 3, images: 0}});
    expect(result.phases.find(p => p.id === 'preview')?.status).toBe('skipped');
    const zip = unzipSync(downloads[0].bytes);
    expect(new TextDecoder().decode(zip['tema/templates/home.twig'])).toBe('home');
    const workspace = await loadWorkspace(context);
    expect(Object.keys(workspace!.baseline!.files)).toHaveLength(3);
    expect(workspace!.baseline).not.toHaveProperty('inventory');
    expect(workspace!.review).toMatchObject({overrides: []}); expect(workspace!.review?.reading).toBeUndefined();
  });
  test('loja diferente da esperada para antes de qualquer leitura', async () => {
    const editor = new FakeEditor(store), {host: h} = host(editor);
    editor.ctx.storeName = 'Outra loja';
    const result = await runJob({id: 'x', kind: 'compare', paths: [home]}, context, h, control());
    expect(result.status).toBe('failed'); expect(editor.reads).toEqual([]); expect(editor.refreshes).toBe(0);
  });
  test('download: a barra só avança, listar não vale 18% e o modo de leitura aparece nas etapas', async () => {
    const files: Record<string, string> = Object.fromEntries(Array.from({length: 40}, (_, i) => [`sections/home/s${i}.twig`, `seção ${i}`]));
    const editor = Object.assign(new FakeEditor(files), {direct: {
      open: async () => 'loja-ficticia',
      read: async (paths: string[]) => ({files: Object.fromEntries(paths.map(path => [path, files[path]])), assets: {}, rest: []})
    }});
    const {host: h, reports, downloads} = host(editor);
    const final = await runJob({id: 'export-1', kind: 'export'}, context, h, control());
    expect(final.status).toBe('completed'); expect(downloads).toHaveLength(1);
    const fractions = reports.map(r => r.fraction);
    expect(fractions.every((value, i) => i === 0 || value >= fractions[i - 1])).toBe(true);
    // Before the first read, only the listing counts: about 2 of 51 units, never 18%.
    const listed = reports.filter(r => r.phases.find(p => p.id === 'read')!.done === 0);
    expect(listed.length).toBeGreaterThan(0);
    expect(Math.max(...listed.map(r => r.fraction))).toBeLessThan(0.05);
    expect(reports.some(r => r.phases.find(p => p.id === 'inventory')!.status === 'active')).toBe(true);
    expect(reports.some(r => r.phases.find(p => p.id === 'read')!.label === 'Ler os arquivos direto da Yampi')).toBe(true);
    expect(final.events.some(e => e.tone === 'ok' && e.text.startsWith('Leitura direta conferida com o editor em 1 tipo de arquivo'))).toBe(true);
    expect(editor.reads).toEqual(['sections/home/s0.twig']);
  });
});
describe('referência da pasta do projeto', () => {
  test('a pasta exportada usa a referência avançada pelos envios da mesma exportação', () => {
    const folder = snapshot(store), advanced = {...folder, files: {...store, [home]: 'novo home'}};
    const workspace = {version: 1 as const, context, updatedAt: '', baseline: advanced, lineage: {exportedAt: folder.capturedAt, journals: ['j'], advancedAt: '2026-10-16T00:00:00Z'}};
    expect(chooseBaseline(workspace, folder)).toMatchObject({advanced: true, baseline: advanced});
    expect(chooseBaseline(workspace, {...folder, capturedAt: '2026-11-01T00:00:00Z'})).toMatchObject({advanced: false});
    expect(chooseBaseline(undefined, folder)).toMatchObject({advanced: false, baseline: folder});
  });
  test('registros antigos continuam abrindo: a referência de antes da 0.6.0 vira o espaço de trabalho', async () => {
    const {contextKey} = await import('../src/storage');
    await put(`baseline:${await contextKey(context)}`, snapshot(store));
    expect(await loadWorkspace(context)).toMatchObject({baseline: {files: store}, lineage: {journals: []}});
  });
  test('restauração concluída limpa a revisão de desfazer e mantém o projeto', async () => {
    const editor = new FakeEditor({...store, [home]: 'enviado'}), {host: h} = host(editor);
    const journal = {id: 'antigo', after: {[home]: 'enviado'}, before: {[home]: 'home'}} as unknown as Journal;
    const plan = makePlan(snapshot(journal.after), journal.before, snapshot(editor.files));
    await put('jobinput:r', {plan, selected: [home], scope: 'restore'} satisfies SendInput);
    await updateWorkspace(context, workspace => {workspace.baseline = snapshot({...store, [home]: 'enviado'}); workspace.restore = {journalId: 'antigo', overrides: []}; workspace.project = {local: store, localAssets: {}, name: 'projeto', kind: 'folder', loadedAt: ''};});
    const result = await runJob({id: 'r', kind: 'send', scope: 'restore'}, context, h, control());
    expect(result.status).toBe('completed'); expect(editor.files[home]).toBe('home');
    const workspace = await loadWorkspace(context);
    expect(workspace?.restore).toBeUndefined(); expect(workspace?.project?.name).toBe('projeto');
    expect(workspace?.baseline?.files[home]).toBe('home');
  });
});
