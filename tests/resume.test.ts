import {describe, test, expect} from 'vitest';
import {makePlan} from '../src/core/planner';
import {applyPlan, capture} from '../src/core/workflow';
import {changedPaths, remoteFromCapture} from '../src/core/compare';
import {YAMPI_VUE_TEMPLATE, type Files} from '../src/core/model';
import {FakeEditor, recorder, snapshot, png} from './fixtures/fake-editor';
const home = 'templates/home.twig', product = 'templates/product.twig', card = 'elements/card.twig';
const store = {[home]: 'home', [product]: 'product', [card]: 'card', 'elements/head.twig': 'head'};
const sendable = (plan: ReturnType<typeof makePlan>) => plan.rows.filter(r => ['update', 'create', 'upload'].includes(r.status)).map(r => r.path);
describe('envio mais rápido, com a mesma conferência', () => {
  test('recarrega uma vez por grupo de criações e imagens e uma vez por texto salvo; nunca antes de salvar', async () => {
    const editor = new FakeEditor(store), local: Files = {...store, [home]: 'novo home', [product]: 'novo product', 'elements/novo.twig': 'novo'};
    const plan = makePlan(snapshot(store), local, snapshot(store), {'assets/images/capa.png': png(1)});
    const result = await applyPlan(editor, plan, sendable(plan), recorder());
    expect(result.status).toBe('completed');
    // Start, creations, images and one per saved text (the new one and two changed).
    expect(editor.refreshes).toBe(1 + 1 + 1 + 3);
    // Every save comes right after a reload or a confirmation read, never after another save.
    const log = editor.log;
    for (const [index, entry] of log.entries()) if (entry.startsWith('write:')) expect(log.slice(0, index).reverse().find(e => e.startsWith('write:') || e === 'refresh')).toBe('refresh');
    // And every save is followed by a reload and a read of the same file.
    for (const [index, entry] of log.entries()) if (entry.startsWith('write:')) expect(log.slice(index + 1, index + 3)).toEqual(['refresh', 'read:' + entry.slice(6)]);
  });
  test('as criações são conferidas antes de enviar imagens', async () => {
    const editor = new FakeEditor(store), plan = makePlan(snapshot(store), {...store, 'elements/novo.twig': 'novo'}, snapshot(store), {'assets/images/capa.png': png(1)});
    await applyPlan(editor, plan, sendable(plan), recorder());
    const log = editor.log;
    expect(log.indexOf('read:elements/novo.twig')).toBeLessThan(log.indexOf('upload:assets/images/capa.png'));
  });
});
describe('continuar um envio interrompido', () => {
  test('continua do arquivo em que parou, sem repetir os já conferidos e sem novo backup', async () => {
    const editor = new FakeEditor(store), local = {...store, [home]: 'novo home', [product]: 'novo product'}, rec = recorder();
    const plan = makePlan(snapshot(store), local, snapshot(store));
    editor.beforeWrite = path => {if (path === product) throw new Error('Conexão perdida');};
    await expect(applyPlan(editor, plan, [home, product], rec)).rejects.toThrow('Conexão perdida');
    const stopped = rec.last();
    expect(stopped).toMatchObject({status: 'stopped', verified: [home], pending: product});
    editor.beforeWrite = undefined; editor.writes = [];
    const again = recorder();
    const result = await applyPlan(editor, plan, [home, product], again, {previous: stopped});
    expect(result).toMatchObject({id: stopped.id, status: 'completed', verified: [home, product]});
    expect(result.resumedAt).toHaveLength(1);
    expect(editor.writes).toEqual([product]);
    expect(again.backups).toEqual([]);
    expect(editor.files[product]).toBe('novo product');
  });
  test('o salvamento que chegou à loja antes da interrupção é conferido, não repetido', async () => {
    const editor = new FakeEditor(store), local = {...store, [home]: 'novo home', [product]: 'novo product'}, rec = recorder();
    const plan = makePlan(snapshot(store), local, snapshot(store));
    // The save reaches the platform, then the extension stops before confirming it.
    editor.afterWrite = path => {if (path === product) throw new Error('Extensão reiniciada');};
    await expect(applyPlan(editor, plan, [home, product], rec)).rejects.toThrow('reiniciada');
    expect(editor.files[product]).toBe('novo product');
    editor.afterWrite = undefined; editor.writes = [];
    const result = await applyPlan(editor, plan, [home, product], recorder(), {previous: rec.last()});
    expect(result.status).toBe('completed'); expect(editor.writes).toEqual([]);
  });
  test('alteração feita na loja durante a interrupção para o envio, sem sobrescrever', async () => {
    const editor = new FakeEditor(store), local = {...store, [home]: 'novo home', [product]: 'novo product'}, rec = recorder();
    const plan = makePlan(snapshot(store), local, snapshot(store));
    editor.beforeWrite = path => {if (path === product) throw new Error('Conexão perdida');};
    await expect(applyPlan(editor, plan, [home, product], rec)).rejects.toThrow();
    editor.beforeWrite = undefined; editor.files[product] = 'feito por outra pessoa';
    await expect(applyPlan(editor, plan, [home, product], recorder(), {previous: rec.last()})).rejects.toThrow('mudou na loja');
    expect(editor.files[product]).toBe('feito por outra pessoa');
  });
  test('arquivo criado antes da interrupção é conferido e preenchido, sem criar de novo', async () => {
    const editor = new FakeEditor(store), local = {...store, 'components/Novo.vue': '<template><p/></template>'}, rec = recorder();
    editor.files['components/A.vue'] = '<template/>';
    const base = {...store, 'components/A.vue': '<template/>'};
    const plan = makePlan(snapshot(base), {...local, 'components/A.vue': '<template/>'}, snapshot(base));
    // Interrupted right after Yampi created the file, before the confirmation.
    let first = true;
    editor.refreshHook = () => {if (editor.created.length && first) {first = false; throw new Error('Aba do editor fechada');}};
    await expect(applyPlan(editor, plan, ['components/Novo.vue'], rec)).rejects.toThrow('fechada');
    expect(rec.last()).toMatchObject({status: 'stopped', issued: ['components/Novo.vue'], created: []});
    editor.created = [];
    const result = await applyPlan(editor, plan, ['components/Novo.vue'], recorder(), {previous: rec.last()});
    expect(editor.created).toEqual([]);
    expect(result).toMatchObject({status: 'completed', created: ['components/Novo.vue'], issued: []});
    expect(result.before['components/Novo.vue']).toBe(YAMPI_VUE_TEMPLATE);
    expect(editor.files['components/Novo.vue']).toBe('<template><p/></template>');
  });
  test('envio que parou antes da primeira alteração recomeça com backup', async () => {
    const editor = new FakeEditor(store), plan = makePlan(snapshot(store), {...store, [home]: 'novo'}, snapshot(store)), rec = recorder();
    await expect(applyPlan(editor, plan, [home], {...rec, backup: async () => {throw new Error('Download cancelado');}})).rejects.toThrow('Download');
    // A failed backup also ends as stopped: continuing must back up before the first change.
    const stopped = rec.last();
    expect(stopped).toMatchObject({status: 'stopped', verified: [], issued: []});
    const again = recorder();
    const result = await applyPlan(editor, plan, [home], {...again, backup: async value => {editor.log.push('backup'); await again.backup(value);}}, {previous: stopped});
    expect(result.status).toBe('completed'); expect(again.backups).toHaveLength(1); expect(result.id).toBe(stopped.id);
    expect(editor.log.indexOf('backup')).toBeLessThan(editor.log.indexOf('write:' + home));
  });
  test('seleção diferente da do envio interrompido é recusada', async () => {
    const editor = new FakeEditor(store), local = {...store, [home]: 'novo home', [product]: 'novo product'}, rec = recorder();
    const plan = makePlan(snapshot(store), local, snapshot(store));
    editor.beforeWrite = path => {if (path === product) throw new Error('Conexão perdida');};
    await expect(applyPlan(editor, plan, [home, product], rec)).rejects.toThrow();
    await expect(applyPlan(editor, plan, [home], recorder(), {previous: rec.last()})).rejects.toThrow('seleção');
  });
});
describe('comparação que lê só o que o projeto mudou', () => {
  const many: Files = Object.fromEntries(Array.from({length: 40}, (_, i) => [`sections/s${i}.twig`, `secao ${i}`]));
  const base = {...store, ...many};
  test('lê apenas os arquivos alterados e chega ao mesmo envio da comparação completa', async () => {
    const editor = new FakeEditor({...base, 'sections/s3.twig': 'mudou só na loja'}, {'assets/images/logo.png': png(1)});
    const local = {...base, [home]: 'novo home', 'elements/novo.twig': 'novo'};
    const paths = changedPaths(snapshot(base, {'assets/images/logo.png': png(1)}), local, {'assets/images/logo.png': png(1)});
    expect(paths).toEqual(['elements/novo.twig', home]);
    const observed = await capture(editor, {only: paths});
    expect(editor.reads).toEqual([home]);
    expect(observed.inventory).toHaveLength(Object.keys(editor.files).length + 1);
    const baseline = snapshot(base, {'assets/images/logo.png': png(1)});
    const {remote, assumed} = remoteFromCapture(baseline, observed);
    expect(assumed).toContain('sections/s3.twig'); expect(assumed).not.toContain(home);
    const quick = makePlan(baseline, local, remote, {'assets/images/logo.png': png(1)}, {assumed, inventory: observed.inventory});
    const full = makePlan(baseline, local, await capture(new FakeEditor(editor.files, editor.assets)), {'assets/images/logo.png': png(1)});
    expect(sendable(quick)).toEqual(sendable(full));
    expect(quick.rows.find(r => r.path === 'sections/s3.twig')).toMatchObject({status: 'unchanged', assumed: true});
    expect(full.rows.find(r => r.path === 'sections/s3.twig')?.status).toBe('remote-only');
  });
  test('dependência que só a loja mudou é lida e continua bloqueando quem a usa', async () => {
    const used = 'sections/s3.twig', editor = new FakeEditor({...base, [used]: 'mudou só na loja'});
    const local = {...base, [home]: `{% include '${used}' %} novo`}, baseline = snapshot(base);
    const paths = changedPaths(baseline, local);
    expect(paths).toEqual([used, home]);
    const observed = await capture(editor, {only: paths});
    const {remote, assumed} = remoteFromCapture(baseline, observed);
    const quick = makePlan(baseline, local, remote, {}, {assumed, inventory: observed.inventory});
    const full = makePlan(baseline, local, await capture(new FakeEditor(editor.files)));
    expect(quick.rows.find(r => r.path === home)).toMatchObject({status: 'blocked-dependency', blockedBy: [used]});
    expect(sendable(quick)).toEqual(sendable(full));
  });
  test('arquivo removido da loja continua aparecendo como removido', async () => {
    const editor = new FakeEditor(store), local = {...base, [home]: 'novo'};
    const baseline = snapshot(base), observed = await capture(editor, {only: changedPaths(baseline, local)});
    const {remote, assumed} = remoteFromCapture(baseline, observed);
    const plan = makePlan(baseline, local, remote, {}, {assumed, inventory: observed.inventory});
    expect(plan.rows.find(r => r.path === 'sections/s0.twig')?.status).toBe('missing-remote');
    expect(plan.rows.find(r => r.path === home)?.status).toBe('update');
  });
  test('imagem nova em subpasta: o texto que a usa e os dois nomes possíveis entram na leitura', () => {
    const local = {...store, [card]: "<img src=\"{{ 'images/hero/capa.png' | assets_url }}\">"};
    const paths = changedPaths(snapshot(store), {...store, [card]: store[card]}, {'assets/images/hero/capa.png': png(2)});
    expect(paths).toEqual(['assets/images/capa.png', 'assets/images/hero-capa.png']);
    expect(changedPaths(snapshot(store), local, {'assets/images/hero/capa.png': png(2)})).toContain(card);
  });
  test('texto que só muda pela referência ajustada também é lido', () => {
    const text = "<img src=\"{{ 'images/hero/capa.png' | assets_url }}\">", base2 = {...store, [card]: text};
    expect(changedPaths(snapshot(base2), base2, {'assets/images/hero/capa.png': png(2)})).toContain(card);
  });
});
