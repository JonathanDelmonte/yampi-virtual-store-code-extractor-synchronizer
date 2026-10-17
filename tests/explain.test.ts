import {describe, test, expect} from 'vitest';
import {makePlan} from '../src/core/planner';
import {explainBlock} from '../src/core/explain';
import {snapshot} from './fixtures/fake-editor';
const home = 'templates/home.twig', hero = 'sections/hero.twig', card = 'elements/card.twig';
const base = {[home]: `{% include '${hero}' %} home`, [hero]: 'hero', [card]: 'card'};
const row = (plan: ReturnType<typeof makePlan>, path: string) => plan.rows.find(r => r.path === path)!;
describe('motivo do bloqueio no painel', () => {
  test('arquivo usado que mudou só na loja: diz que mudou na loja e qual ver', () => {
    const plan = makePlan(snapshot(base), {...base, [home]: `{% include '${hero}' %} novo`}, snapshot({...base, [hero]: 'hero da loja'}));
    expect(row(plan, hero).status).toBe('remote-only');
    expect(explainBlock(plan, row(plan, home))).toEqual({text: `${home} usa ${hero}, que mudou na loja depois da sua cópia.`, storeOnly: [hero], conflicts: []});
  });
  test('arquivo usado em conflito: pede a decisão sobre ele', () => {
    const plan = makePlan(snapshot(base), {...base, [home]: `{% include '${hero}' %} novo`, [hero]: 'hero do projeto'}, snapshot({...base, [hero]: 'hero da loja'}));
    expect(explainBlock(plan, row(plan, home))).toEqual({text: `${home} usa ${hero}, que mudou na loja e no projeto.`, storeOnly: [], conflicts: [hero]});
  });
  test('vários motivos ficam numa frase, separados', () => {
    const local = {...base, [home]: `{% include '${hero}' %}{% include '${card}' %} novo`, [card]: 'card do projeto'};
    const plan = makePlan(snapshot(base), local, snapshot({...base, [hero]: 'hero da loja', [card]: 'card da loja'}));
    expect(explainBlock(plan, row(plan, home))?.text).toBe(`${home} usa ${hero}, que mudou na loja depois da sua cópia; ${card}, que mudou na loja e no projeto.`);
  });
  test('sem bloqueio não há explicação', () => {
    const plan = makePlan(snapshot(base), {...base, [home]: `{% include '${hero}' %} novo`}, snapshot(base));
    expect(row(plan, home).status).toBe('update');
    expect(explainBlock(plan, row(plan, home))).toBeUndefined();
  });
});
