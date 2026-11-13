import {describe, expect, test, vi} from 'vitest';
import {includeSpot, productionIssues, saveIssues, yampiIncludes} from '../local-runtime/dependencies.mjs';
import {makePlan} from '../src/core/planner';
import {applyPlan} from '../src/core/workflow';
import {explainBlock} from '../src/core/explain';
import {FakeEditor, recorder, snapshot} from './fixtures/fake-editor';
import type {Adapter} from '../src/core/model';
// Yampi refused to save a Twig text on 13/11/2026: "Erro ao incluir o arquivo ', priority: '. O
// arquivo não foi encontrado." Its server reads include followed by a quote as an inclusion, even
// in JavaScript. Everything here is fictitious.
const navigation = 'elements/scripts/navigation.twig', home = 'templates/home.twig', head = 'elements/head.twig';
const prefetch = "<script>\n  const prefetch = url => fetch(url, { credentials: 'include', priority: 'low' });\n</script>\n";
describe('o que a Yampi recusa ao salvar um texto', () => {
  test('lê include seguido de aspas como inclusão, também em JavaScript', () => {
    expect(yampiIncludes(prefetch)).toEqual([{name: ', priority: ', file: false, line: 2, excerpt: "…= url => fetch(url, { credentials: 'include', priority: 'low' });"}]);
    const [issue] = saveIssues(navigation, prefetch);
    expect(issue).toContain('Na linha 2');
    expect(issue).toContain('procuraria o arquivo “, priority: ”');
    expect(issue).toContain('credentials: `include`');
    // The same stretch with crases, as the message suggests, passes.
    expect(saveIssues(navigation, prefetch.replace("'include'", '`include`'))).toEqual([]);
  });
  test.each([
    ['inclusão de um arquivo do tema', '{% include "elements/head.twig" %}'],
    ['função include', "{{ include('sections/home/banner.twig') }}"],
    ['arquivo interno da Yampi', "{% include 'yampi-internals/head.twig' %}"],
    ['nome montado', "{% include 'sections/' ~ alias ~ '.twig' %}"],
    ['includes() do JavaScript', "if (lista.includes('x')) abrir('y');"],
    ['include no fim da linha', "fetch(url, {\n  credentials: 'include'\n}).then(r => r.json()); const a = 'b';"],
    ['@include do Sass', "@include fonte('Roboto');"],
  ])('não recusa %s', (_, text) => {
    expect(saveIssues('elements/exemplo.twig', text)).toEqual([]);
  });
  test('conta os outros trechos e vale só para Twig', () => {
    const twice = prefetch + '<div data-modo="include" class="menu"></div>\n';
    expect(yampiIncludes(twice).filter(item => !item.file).map(item => [item.name, item.line])).toEqual([[', priority: ', 2], [' class=', 4]]);
    expect(saveIssues(navigation, twice)[0]).toContain('e há mais 1 trecho assim');
    expect(saveIssues('components/Menu.vue', prefetch)).toEqual([]);
    // What would break in the store is another rule: an unchanged file keeps being included.
    expect(productionIssues(navigation, prefetch)).toEqual([]);
  });
  test('acha o trecho que a recusa nomeia, mesmo um caminho que não existe', () => {
    expect(includeSpot(prefetch, ', priority: ')).toEqual({line: 2, excerpt: "…= url => fetch(url, { credentials: 'include', priority: 'low' });"});
    expect(includeSpot('<main>\n{% include "elements/nao-existe.twig" %}\n</main>', 'elements/nao-existe.twig')).toMatchObject({line: 2});
    expect(includeSpot(prefetch, 'outro')).toBeUndefined();
  });
});
describe('a comparação barra o texto antes de gravar', () => {
  const base = {[navigation]: '<script></script>\n', [home]: '<main>{% include "elements/scripts/navigation.twig" %}</main>\n', [head]: '<meta>\n'};
  test('texto alterado ou novo fica bloqueado, com o motivo; quem depende da versão nova espera', () => {
    const local = {...base, [navigation]: prefetch, [home]: '<main class="nova">{% include "elements/scripts/navigation.twig" %}</main>\n', 'elements/scripts/novo.twig': prefetch};
    const plan = makePlan(snapshot(base), local, snapshot(base));
    const row = plan.rows.find(r => r.path === navigation)!;
    expect(row).toMatchObject({status: 'blocked-dependency', reason: expect.stringContaining('A Yampi recusa salvar este texto')});
    expect(plan.rows.find(r => r.path === 'elements/scripts/novo.twig')).toMatchObject({status: 'blocked-dependency', reason: expect.stringContaining('Na linha 2')});
    const user = plan.rows.find(r => r.path === home)!;
    expect(user).toMatchObject({status: 'blocked-dependency', blockedBy: [navigation]});
    expect(explainBlock(plan, user)?.text).toContain('não pode ser enviado');
  });
  test('um arquivo que não muda e só é incluído não bloqueia ninguém', async () => {
    const store = {...base, [navigation]: prefetch};
    const local = {...store, [home]: '<main class="nova">{% include "elements/scripts/navigation.twig" %}</main>\n'};
    const plan = makePlan(snapshot(store), local, snapshot(store));
    expect(plan.rows.find(r => r.path === home)?.status).toBe('update');
    expect(plan.rows.find(r => r.path === navigation)?.status).toBe('unchanged');
    const editor = new FakeEditor(store), rec = recorder();
    expect((await applyPlan(editor, plan, [home], rec)).status).toBe('completed');
    expect(editor.writes).toEqual([home]);
  });
  test('um envio interrompido com o plano antigo para antes do backup ou de qualquer gravação', async () => {
    // A plan confirmed before this rule, as "Continuar de onde parou" keeps it.
    const plan = {context: snapshot({}).context, createdAt: '', rows: [{path: navigation, status: 'update' as const, local: prefetch, remote: base[navigation]}]};
    const write = vi.fn(), backup = vi.fn(), persist = vi.fn();
    await expect(applyPlan({write} as unknown as Adapter, plan, [navigation], {backup, persist})).rejects.toThrow(`${navigation}: A Yampi recusa salvar este texto`);
    expect(write).not.toHaveBeenCalled(); expect(backup).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
  });
});
