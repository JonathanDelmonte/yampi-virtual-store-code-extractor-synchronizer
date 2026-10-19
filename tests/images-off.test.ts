import {describe, test, expect} from 'vitest';
import {makePlan, selectionIssues, IMAGES_OFF, MARKED} from '../src/core/planner';
import {explainBlock} from '../src/core/explain';
import {MARKS} from '../src/core/merge';
import {context, png} from './fixtures/fake-editor';
import type {Files, Snapshot} from '../src/core/model';
const snapshot = (files: Files): Snapshot => ({context, capturedAt: '2026-01-01T00:00:00Z', files});
const home = 'templates/home.twig', image = 'assets/images/capa.png';
const store = {[home]: '<main></main>\n'};
const local = {[home]: `<main><img src="{{ 'images/capa.png' | assets_url }}"></main>\n`};
describe('imagens novas fora do envio, a menos que o usuário ligue', () => {
  test('desligado: a imagem fica no projeto, com o motivo, e o texto que a usa espera, explicado', () => {
    const plan = makePlan(snapshot(store), local, snapshot(store), {[image]: png(1)}, {uploads: false});
    const row = (path: string) => plan.rows.find(item => item.path === path)!;
    expect(row(image)).toMatchObject({status: 'new-local', reason: IMAGES_OFF});
    expect(row(home)).toMatchObject({status: 'blocked-dependency', blockedBy: [image]});
    expect(explainBlock(plan, row(home))).toMatchObject({images: [image], text: expect.stringContaining('“Enviar imagens novas” estiver desligado')});
    expect(plan.rows.filter(item => item.status === 'upload')).toEqual([]);
  });
  test('ligado: a imagem é enviada junto do texto que a usa, como antes', () => {
    const plan = makePlan(snapshot(store), local, snapshot(store), {[image]: png(1)}, {uploads: true});
    expect(plan.rows.find(item => item.path === image)?.status).toBe('upload');
    expect(plan.rows.find(item => item.path === home)).toMatchObject({status: 'update', dependsOn: [image]});
    expect(selectionIssues(plan, [home])).toEqual([{path: home, requires: image}]);
  });
  test('texto independente segue pronto com as imagens desligadas', () => {
    const plan = makePlan(snapshot({...store, 'elements/head.twig': 'a'}), {...store, 'elements/head.twig': 'b'}, snapshot({...store, 'elements/head.twig': 'a'}), {[image]: png(1)}, {uploads: false});
    expect(plan.rows.find(item => item.path === 'elements/head.twig')?.status).toBe('update');
  });
});
describe('marcações de conflito nunca vão para a loja', () => {
  test('arquivo com marcações fica bloqueado com o motivo; resolvido, volta a ficar pronto', () => {
    const marked = `<main>\n${MARKS.local}\n<h1>pasta</h1>\n${MARKS.split}\n<h1>loja</h1>\n${MARKS.store}\n</main>\n`;
    expect(makePlan(snapshot(store), {[home]: marked}, snapshot(store)).rows[0]).toMatchObject({status: 'blocked-dependency', reason: MARKED});
    expect(makePlan(snapshot(store), {[home]: '<main><h1>pasta</h1></main>\n'}, snapshot(store)).rows[0].status).toBe('update');
  });
});
