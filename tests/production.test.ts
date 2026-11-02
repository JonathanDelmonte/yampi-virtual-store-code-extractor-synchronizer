import {describe, expect, test, vi} from 'vitest';
import {productionIssues, resolvedReferences} from '../local-runtime/dependencies.mjs';
import {makePlan, selectionIssues} from '../src/core/planner';
import {applyPlan} from '../src/core/workflow';
import {context, png} from './fixtures/fake-editor';
import type {Adapter, Files, Snapshot} from '../src/core/model';
// @ts-expect-error The portable runtime is native JavaScript.
import {renderPage, compileComponents} from '../local-runtime/engine.mjs';

const home = 'templates/home.twig', image = 'assets/images/capa.png';
const snapshot = (files: Files): Snapshot => ({context, capturedAt: '', files});
describe('compatibilidade de produção, antes de gravar', () => {
  test.each(['images/capa.png', '/images/capa.png', 'assets/images/capa.png'])('não disfarça assets_url incompatível: %s', value => {
    const text = `{{ '${value}' | assets_url }}`;
    const plan = makePlan(snapshot({[home]: 'antes'}), {[home]: text}, snapshot({[home]: 'antes'}));
    expect(plan.rows[0]).toMatchObject({status: 'blocked-dependency', reason: expect.stringContaining('/assets/images/capa.png')});
    expect(() => renderPage({[home]: text}, home, {})).toThrow('assets_url');
  });
  test('caminhos literais e montados usam o mesmo contrato, sem executar o tema', () => {
    expect(productionIssues(home, `{{ ('images/' ~ file) | assets_url }}`)).toHaveLength(1);
    expect(productionIssues(home, `{# {{ 'images/x.png' | assets_url }} #}`)).toEqual([]);
    const text = `{{ ('/assets/images/' ~ file) | assets_url }}`;
    expect(productionIssues(home, text)).toEqual([]);
    expect(renderPage({[home]: text}, home, {file: 'capa.png'})).toBe('/tema/assets/images/capa.png');
  });
  test.each(['IconHeader', 'IconFooter', 'IconPlus', 'IconVideo'])('impede que %s descarte o conteúdo na Yampi', async name => {
    const component = `components/${name}.vue`, before = {[home]: '<main/>'};
    const local = {[home]: `<${name}><p>conteúdo</p></${name}>`, [component]: '<template><div><slot/></div></template>'};
    const plan = makePlan(snapshot(before), local, snapshot({...before, 'components/Example.vue': ''}));
    expect(plan.rows.find(r => r.path === component)).toMatchObject({status: 'blocked-dependency', reason: expect.stringContaining('Nome reservado')});
    expect(plan.rows.find(r => r.path === home)).toMatchObject({status: 'blocked-dependency', blockedBy: [component]});
    await expect(compileComponents(local, process.cwd())).rejects.toThrow('Nome reservado');
    expect(productionIssues('components/MinhaCabecalho.vue', local[component])).toEqual([]);
  });
  test('nomes reservados antigos sem uso não impedem componentes com nome próprio', async () => {
    const files = {'components/IconHeader.vue': '<template><p/></template>', [home]: '<minha-cabecalho/>'};
    // No reserved tag is mounted; no source is removed or renamed.
    expect(resolvedReferences(home, files[home], ['components/IconHeader.vue'])).toEqual([]);
    expect(makePlan(snapshot({[home]: 'antes'}), {[home]: 'depois'}, snapshot({[home]: 'antes'})).rows[0].status).toBe('update');
  });
  test('um template alterado também espera um componente reservado ou caminho incompatível já presentes na referência', () => {
    const component = 'components/IconHeader.vue', child = 'elements/capas.twig';
    const before = {[home]: '<main/>', [component]: '<template><div><slot/></div></template>', [child]: `{{ 'images/capa.png' | assets_url }}`};
    const local = {...before, [home]: `<icon-header/>{% include '${child}' %}`};
    const plan = makePlan(snapshot(before), local, snapshot(before));
    expect(plan.rows.find(r => r.path === home)).toMatchObject({status: 'blocked-dependency', blockedBy: expect.arrayContaining([component, child])});
  });
  test.each([
    ['assets/styles/main.scss', '.capa { background: url("../images/capa.png"); }'],
    ['assets/styles/parts/main.scss', '.capa { background: url(../../images/capa.png); }'],
    ['components/MinhaCapa.vue', '<template><img src="/assets/images/capa.png"></template>'],
    [home, `{% set capas = {'a': 'capa.png'} %}{{ ('/assets/images/' ~ capas.a) | assets_url }}`],
  ])('%s espera a imagem nova e exige seleção conjunta', (path, text) => {
    const before = {[path]: 'antes'}, local = {[path]: text}, assets = {[image]: png(1)};
    const off = makePlan(snapshot(before), local, snapshot(before), assets, {uploads: false});
    expect(off.rows.find(r => r.path === path)).toMatchObject({status: 'blocked-dependency', blockedBy: [image]});
    const on = makePlan(snapshot(before), local, snapshot(before), assets, {uploads: true});
    expect(selectionIssues(on, [path])).toContainEqual({path, requires: image});
  });
  test('texto espera uma imagem alterada que a Yampi não pode substituir', () => {
    const before = {...snapshot({[home]: 'antes'}), assets: {[image]: png(1)}};
    const plan = makePlan(before, {[home]: `{{ '/assets/images/capa.png' | assets_url }}`}, before, {[image]: png(2)});
    expect(plan.rows.find(r => r.path === home)).toMatchObject({status: 'blocked-dependency', blockedBy: [image]});
  });
  test('plano antigo ou retomado incompatível para antes do backup ou qualquer gravação', async () => {
    const text = `{{ 'images/capa.png' | assets_url }}`;
    const plan = {context, createdAt: '', rows: [{path: home, status: 'update' as const, local: text, remote: 'antes'}]};
    const write = vi.fn(), backup = vi.fn(), persist = vi.fn();
    await expect(applyPlan({write} as unknown as Adapter, plan, [home], {backup, persist})).rejects.toThrow('assets_url');
    expect(write).not.toHaveBeenCalled(); expect(backup).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
  });
  test('um plano antigo sem vínculos também confere as dependências que não mudaram', async () => {
    const child = 'elements/capas.twig', bad = `{{ 'images/capa.png' | assets_url }}`;
    const plan = {context, createdAt: '', rows: [
      {path: home, status: 'update' as const, local: `{% include '${child}' %}`, remote: 'antes'},
      {path: child, status: 'unchanged' as const, local: bad, remote: bad},
    ]};
    const persist = vi.fn(), backup = vi.fn();
    await expect(applyPlan({} as Adapter, plan, [home], {persist, backup})).rejects.toThrow('assets_url');
    expect(persist).not.toHaveBeenCalled(); expect(backup).not.toHaveBeenCalled();
  });
});
