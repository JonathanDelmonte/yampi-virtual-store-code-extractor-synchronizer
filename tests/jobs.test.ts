import 'fake-indexeddb/auto';
import {beforeEach, describe, test, expect} from 'vitest';
import {unzipSync} from 'fflate';
import {runJob, type EngineHost} from '../src/jobs/engine';
import type {Decision, JobRequest, JobState, SendInput} from '../src/jobs/types';
import {makePlan} from '../src/core/planner';
import {demonstration} from '../src/core/preview';
import {changedPaths} from '../src/core/compare';
import {chooseBaseline} from '../src/core/workspace';
import {clearLocal, get, put, journalHistory, loadWorkspace, updateWorkspace} from '../src/storage';
import type {Journal} from '../src/core/model';
import {FakeEditor, context, png, snapshot} from './fixtures/fake-editor';
import {rocketLike, fixtureFetch} from './fixtures/rocket-like';
import {sendRoutes} from '../src/core/preview-links';
import {fetchPublicResource} from '../src/browser/public-fetch';
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
describe('atualizar o projeto: leitura completa da loja', () => {
  test('lê a loja inteira mesmo com caminhos pedidos, guarda à parte e não mexe na revisão do envio', async () => {
    const editor = new FakeEditor({...store, 'elements/novo.twig': 'novo'}, {'assets/images/a.png': png(1)}), {host: h} = host(editor);
    await updateWorkspace(context, workspace => {workspace.baseline = snapshot(store); workspace.review = {reading: {...snapshot(store), inventory: Object.keys(store)}, overrides: ['x'], images: true};});
    const result = await runJob({id: 'atualizar-1', kind: 'compare', scope: 'update', paths: [home]}, context, h, control());
    expect(result).toMatchObject({status: 'completed', title: 'Lendo Loja fictícia para atualizar o projeto', result: {kind: 'compare', full: true, read: 5}});
    expect(editor.writes).toEqual([]);
    const workspace = (await loadWorkspace(context))!;
    expect(workspace.update?.reading?.files).toEqual({...store, 'elements/novo.twig': 'novo'});
    expect(workspace.update?.reading?.assets?.['assets/images/a.png']).toEqual(png(1));
    expect(workspace.update?.reading?.partial).toBeUndefined();
    expect(workspace.update?.choices).toEqual({});
    expect(workspace.review).toMatchObject({overrides: ['x'], images: true});
  });
});
describe('download com a vitrine: autorizar uma vez, sem voltar a contagem', () => {
  // A fictitious storefront whose images and fonts live on three other origins.
  const needed = ['https://cdn.yampi.io', 'https://fonts.gstatic.com', 'https://imagens-ficticias.invalid'];
  function previewHost(granted: Set<string>) {
    const editor = new FakeEditor(store), {host: h, reports} = host(editor), rounds: string[][] = [], questions: string[][] = [];
    h.rpc = async request => {
      if (request.action !== 'preview-allow') throw new Error('O editor fictício é usado diretamente.');
      for (const origin of request.preview!.origins!) if (origin !== context.previewOrigin && !granted.has(origin)) throw new Error('Origem não autorizada no Chrome.');
      return null;
    };
    h.preview = {
      prepare: async () => ({}) as never,
      finish: async (_draft, _fetch, origins, _signal, onProgress) => {
        rounds.push([...origins]);
        for (let done = 1; done <= 40; done++) onProgress?.(done, 40);
        return {...demonstration(context, 'Vitrine fictícia.', Object.keys(store)), missing: needed.filter(origin => !origins.includes(origin))} as never;
      },
      unauthorized: bundle => (bundle as unknown as {missing: string[]}).missing
    };
    const control = {signal: new AbortController().signal, decision: async (waiting: {origins: string[]}): Promise<Decision> => {questions.push(waiting.origins); waiting.origins.forEach(origin => granted.add(origin)); return {action: 'allow', origins: waiting.origins};}};
    return {h, reports, rounds, questions, control};
  }
  test('o que o Chrome já permite não gera pergunta; o resto é perguntado uma vez', async () => {
    const {h, reports, rounds, questions, control} = previewHost(new Set(['https://cdn.yampi.io', 'https://fonts.gstatic.com']));
    const final = await runJob({id: 'baixar-vitrine', kind: 'export', includePreview: true}, context, h, control);
    expect(final.status).toBe('completed');
    expect(rounds[0]).toEqual([context.previewOrigin, 'https://cdn.yampi.io', 'https://fonts.gstatic.com']);
    expect(questions).toEqual([['https://imagens-ficticias.invalid']]);
    expect(rounds).toHaveLength(2);
    // The storefront step never counts back, and the bar reaches 100% only at the end.
    const counts = reports.map(state => state.phases.find(phase => phase.id === 'preview')!.done);
    expect(counts.every((value, index) => index === 0 || value >= counts[index - 1])).toBe(true);
    expect(reports.filter(state => state.status !== 'completed').every(state => state.fraction < 1)).toBe(true);
    expect(final.fraction).toBe(1);
  });
  test('tudo já permitido no Chrome: nenhuma pergunta', async () => {
    const {h, rounds, questions, control} = previewHost(new Set(needed));
    await runJob({id: 'baixar-vitrine-2', kind: 'export', includePreview: true}, context, h, control);
    expect(questions).toEqual([]);
    expect(rounds).toHaveLength(2);
  });
});
describe('páginas da loja, prévia avulsa e links do envio', () => {
  const published = () => ({...demonstration(context, 'Vitrine fictícia.', Object.keys(store)), source: {kind: 'published' as const, origin: context.previewOrigin, association: 'published-unverified' as const}});
  const allowing = (h: EngineHost) => {h.rpc = async request => {if (request.action === 'preview-allow') return null; throw new Error('O editor fictício é usado diretamente.');};};
  test('download mostra "Páginas da loja: N de M" e "Páginas dos produtos: N de M" e lista os links quebrados', async () => {
    const editor = new FakeEditor(store), {host: h, reports} = host(editor);
    allowing(h);
    h.preview = {
      prepare: async () => ({}) as never, finish: async () => published(), unauthorized: () => [],
      expand: async (visual, _files, _fetch, options) => {
        for (let done = 0; done <= 3; done++) options.onProgress?.('store', done, 3);
        for (let done = 0; done <= 2; done++) options.onProgress?.('product', done, 2);
        // The last round of store pages: the category only a product links to.
        options.onProgress?.('store', 3, 4); options.onProgress?.('store', 4, 4);
        return {...visual, stages: {store: {found: 4, captured: 3, byKind: {category: 2, pages: 1}, left: 0, skipped: [{route: '/colecao-encerrada', reason: 'HTTP 404: link quebrado', sources: ['elements/atalhos.twig']}]}, product: {found: 2, captured: 2, byKind: {product: 2}, left: 0, skipped: []}}, issues: [...visual.issues, {code: 'link-broken', resource: '/colecao-encerrada', reason: 'A loja responde HTTP 404: /colecao-encerrada não existe. Linkado em elements/atalhos.twig.'}]};
      }
    };
    const final = await runJob({id: 'baixar-paginas', kind: 'export', includePreview: true}, context, h, control());
    expect(final.status).toBe('completed');
    for (const detail of ['Páginas da loja: 0 de 3', 'Páginas da loja: 3 de 3', 'Páginas dos produtos: 0 de 2', 'Páginas dos produtos: 2 de 2', 'Páginas da loja: 4 de 4']) expect(reports.map(state => state.detail), detail).toContain(detail);
    expect(final.phases.find(p => p.id === 'store')).toMatchObject({label: 'Páginas da loja', status: 'done', done: 4, total: 4});
    expect(final.phases.find(p => p.id === 'products')).toMatchObject({label: 'Páginas dos produtos', status: 'done', done: 2, total: 2});
    const counts = reports.map(state => state.fraction);
    expect(counts.every((value, index) => index === 0 || value >= counts[index - 1])).toBe(true);
    expect(final.result).toMatchObject({kind: 'export', warnings: ['Link quebrado na loja: A loja responde HTTP 404: /colecao-encerrada não existe. Linkado em elements/atalhos.twig.']});
    expect((final.result as {previewDetails: string}).previewDetails).toContain('Páginas da loja: 3 (2 categorias ou vitrines, 1 institucional); 1 de fora: /colecao-encerrada (HTTP 404: link quebrado). Páginas dos produtos: 2 (2 produtos); nenhuma de fora.');
  });
  test('prévia avulsa: só preview/, a partir da referência guardada, sem ler o tema nem mudar a referência', async () => {
    await updateWorkspace(context, workspace => {workspace.baseline = snapshot(store); workspace.lineage = {exportedAt: snapshot(store).capturedAt, journals: []};});
    const editor = new FakeEditor({...store, [home]: 'mudou na loja'}), {host: h, downloads} = host(editor);
    allowing(h);
    let seen: Record<string, string> = {};
    h.preview = {prepare: async value => {seen = value.files; return {} as never;}, finish: async () => published(), unauthorized: () => []};
    const final = await runJob({id: 'previa', kind: 'export', includePreview: true, previewOnly: true}, context, h, control());
    expect(final).toMatchObject({status: 'completed', title: 'Baixando a prévia de Loja fictícia', detail: 'ZIP da prévia baixado', result: {kind: 'export', previewOnly: true, texts: 0}});
    expect(seen[home]).toBe('home'); expect(editor.reads).toEqual([]);
    expect(final.phases.find(p => p.id === 'read')?.status).toBe('skipped');
    expect(downloads.map(d => d.name)).toEqual([expect.stringMatching(/^previa-loja-ficticia-/)]);
    expect(Object.keys(unzipSync(downloads[0].bytes)).every(name => name.startsWith('preview/'))).toBe(true);
    expect((await loadWorkspace(context))!.baseline).toEqual(snapshot(store));
    // Without the storefront's permission, or without a reference, there is nothing to download.
    const denied = await runJob({id: 'previa-2', kind: 'export', previewOnly: true}, context, h, control());
    expect(denied).toMatchObject({status: 'failed', error: expect.stringContaining('Sem a leitura da vitrine')});
    await clearLocal();
    const none = await runJob({id: 'previa-3', kind: 'export', includePreview: true, previewOnly: true}, context, h, control());
    expect(none).toMatchObject({status: 'failed', error: expect.stringContaining('não guarda o tema')});
  });
  test('comparação confere os links do que vai no envio: 404 vira aviso, 429 espera; sem permissão, fica sem conferir', async () => {
    const editor = new FakeEditor(store), {host: h} = host(editor), asked: string[] = [];
    let calm = 1;
    h.rpc = async request => {
      if (request.action !== 'preview-fetch') throw new Error('O editor fictício é usado diretamente.');
      const url = request.preview!.url!; asked.push(url);
      if (url.endsWith('/colecao-encerrada')) throw new Error('Recurso público indisponível: HTTP 404.');
      if (url.endsWith('/ofertas') && calm-- > 0) throw new Error('Recurso público indisponível: HTTP 429; aguardar 1 s.');
      return {encoded: btoa('<html></html>'), type: 'text/html', url};
    };
    const links = [{url: context.previewOrigin + '/colecao-encerrada', files: ['elements/atalhos.twig']}, {url: context.previewOrigin + '/ofertas', files: ['elements/atalhos.twig']}, {url: context.previewOrigin + '/categoria-a', files: [home]}];
    const final = await runJob({id: 'comparar-links', kind: 'compare', scope: 'project', paths: [home], links}, context, h, control());
    expect(final.status).toBe('completed');
    expect(final.result).toMatchObject({kind: 'compare', links: {checked: 3, broken: [links[0]], unchecked: 0}});
    expect(asked.filter(url => url.endsWith('/ofertas'))).toHaveLength(2);
    expect(final.phases.find(p => p.id === 'links')).toMatchObject({status: 'done', done: 3, total: 3});
    expect((await loadWorkspace(context))!.review?.links?.broken).toEqual([links[0]]);
    expect(final.events.some(event => event.tone === 'warn' && event.text === '1 link leva a uma rota que não existe na loja')).toBe(true);
    h.rpc = async request => {if (request.action === 'preview-fetch') throw new Error('Permissão de leitura da vitrine/recurso não concedida.'); throw new Error('O editor fictício é usado diretamente.');};
    const again = await runJob({id: 'comparar-links-2', kind: 'compare', scope: 'project', paths: [home], links}, context, h, control());
    expect(again).toMatchObject({status: 'completed', result: {links: {checked: 0, broken: [], unchecked: 3, reason: 'O Chrome não liberou a leitura da vitrine.'}}});
    // A comparison without links (or an update) has no link step.
    const plain = await runJob({id: 'comparar-sem-links', kind: 'compare', scope: 'project', paths: [home]}, context, h, control());
    expect(plain.phases.find(p => p.id === 'links')?.status).toBe('skipped');
  });
});
describe('envio: link do tema para rota que não existe, com a loja fictícia', () => {
  test('a comparação aponta o arquivo do tema cujo link a loja responde com 404', async () => {
    const fixture = rocketLike(), ctx = fixture.snapshot.context, footer = 'sections/global/footer.twig';
    // The project changed the footer: its links go in the send and are read on the storefront.
    const local = {...fixture.snapshot.files, [footer]: fixture.snapshot.files[footer] + '<p>Rodapé editado no projeto.</p>\n'};
    const links = sendRoutes(local, [footer], ctx.previewOrigin).map(route => ({url: route.url, files: route.sources}));
    expect(links.map(link => new URL(link.url).pathname)).toEqual(expect.arrayContaining(['/busca', '/categoria-removida', '/produto-removido/p']));
    const editor = new FakeEditor(fixture.snapshot.files), {host: h} = host(editor);
    editor.ctx = {...ctx};
    const network = fixtureFetch(fixture.resources);
    h.rpc = async request => {
      if (request.action !== 'preview-fetch') throw new Error('O editor fictício é usado diretamente.');
      return fetchPublicResource(request.preview!.url!, [ctx.previewOrigin], network);
    };
    const final = await runJob({id: 'comparar-rodape', kind: 'compare', scope: 'project', paths: [footer], links}, ctx, h, control());
    expect(final.status).toBe('completed');
    const report = (final.result as {links: {broken: {url: string; files: string[]}[]; checked: number}}).links;
    expect(report.broken).toEqual([{url: ctx.previewOrigin + '/categoria-removida', files: [footer]}, {url: ctx.previewOrigin + '/produto-removido/p', files: [footer]}]);
    expect(report.checked).toBe(links.length);
    expect((await loadWorkspace(ctx))!.review?.links?.broken).toHaveLength(2);
  });
});
