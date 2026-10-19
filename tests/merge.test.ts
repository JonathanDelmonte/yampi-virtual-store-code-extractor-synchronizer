import {describe, test, expect} from 'vitest';
import {MARKS, hasConflictMarks, mergeTexts} from '../src/core/merge';
const lines = (...items: string[]) => items.map(item => item + '\n').join('');
const base = lines('<section>', '  <div class="faixa">Frete grátis</div>', '  <h1>Título</h1>', '  <p>Texto</p>', '</section>');
describe('junção linha a linha entre a pasta e a loja', () => {
  test('o cliente apagou um bloco e você mudou outro trecho: as duas mudanças ficam', () => {
    const store = lines('<section>', '  <h1>Título</h1>', '  <p>Texto</p>', '</section>');
    const local = lines('<section>', '  <div class="faixa">Frete grátis</div>', '  <h1>Título</h1>', '  <p>Texto revisado</p>', '</section>');
    expect(mergeTexts(base, local, store)).toEqual({text: lines('<section>', '  <h1>Título</h1>', '  <p>Texto revisado</p>', '</section>'), conflicts: 0});
  });
  test('a mesma mudança dos dois lados não é conflito', () => {
    const changed = base.replace('Título', 'Novo título');
    expect(mergeTexts(base, changed, changed)).toEqual({text: changed, conflicts: 0});
    // Plus another change of your own, with an unchanged line between: still no conflict.
    const local = changed.replace('</section>', '</section><!-- fim -->');
    expect(mergeTexts(base, local, changed)).toEqual({text: local, conflicts: 0});
  });
  test('as mesmas linhas mudadas dos dois jeitos viram marcações, com as duas versões', () => {
    const local = base.replace('Título', 'Título da pasta'), store = base.replace('Título', 'Título da loja');
    const merged = mergeTexts(base, local, store);
    expect(merged.conflicts).toBe(1);
    expect(merged.text).toBe(lines('<section>', '  <div class="faixa">Frete grátis</div>', MARKS.local, '  <h1>Título da pasta</h1>', MARKS.split, '  <h1>Título da loja</h1>', MARKS.store, '  <p>Texto</p>', '</section>'));
    expect(hasConflictMarks(merged.text)).toBe(true);
  });
  test('mudanças em linhas vizinhas, sem linha igual entre elas, também pedem decisão', () => {
    const local = base.replace('Título', 'Título da pasta'), store = base.replace('Texto', 'Texto da loja');
    expect(mergeTexts(base, local, store).conflicts).toBe(1);
  });
  test('inserções no mesmo lugar: iguais juntam, diferentes viram conflito', () => {
    const add = (text: string) => base.replace('</section>', `  ${text}\n</section>`);
    expect(mergeTexts(base, add('<a>Ver</a>'), add('<a>Ver</a>')).conflicts).toBe(0);
    expect(mergeTexts(base, add('<a>Ver mais</a>'), add('<a>Comprar</a>')).conflicts).toBe(1);
  });
  test('linhas iguais nas bordas do conflito ficam fora das marcações', () => {
    const local = base.replace('  <h1>Título</h1>\n', '  <h1>A</h1>\n  <hr>\n'), store = base.replace('  <h1>Título</h1>\n', '  <h1>B</h1>\n  <hr>\n');
    const {text} = mergeTexts(base, local, store);
    expect(text).toContain(`${MARKS.store}\n  <hr>\n`);
    expect(text.split('<hr>').length).toBe(2);
  });
  test('começo e fim mudados em lados diferentes juntam sem conflito', () => {
    const local = '{# topo #}\n' + base, store = base + '<footer></footer>\n';
    expect(mergeTexts(base, local, store)).toEqual({text: '{# topo #}\n' + base + '<footer></footer>\n', conflicts: 0});
  });
  test('quebra final de linha: vale a mudança de quem mexeu nela', () => {
    const local = base.slice(0, -1), store = base.replace('Texto', 'Texto da loja');
    expect(mergeTexts(base, local, store).text.endsWith('</section>')).toBe(true);
    expect(mergeTexts(base, base.replace('Título', 'T'), store).text.endsWith('</section>\n')).toBe(true);
  });
  test('quebras de linha \\r\\n da loja não atrapalham a junção', () => {
    const store = base.replace('Texto', 'Texto da loja').replace(/\n/g, '\r\n'), local = base.replace('Frete grátis', 'Frete grátis acima de R$ 99');
    expect(mergeTexts(base, local, store)).toEqual({text: base.replace('Frete grátis', 'Frete grátis acima de R$ 99').replace('Texto', 'Texto da loja'), conflicts: 0});
  });
  test('arquivo criado nos dois lados com conteúdos diferentes é um conflito do arquivo inteiro', () => {
    const merged = mergeTexts('', 'pasta\n', 'loja\n');
    expect(merged).toEqual({text: lines(MARKS.local, 'pasta', MARKS.split, 'loja', MARKS.store), conflicts: 1});
  });
  test('sem mudança de um lado, devolve o outro sem tocar nas quebras de linha', () => {
    const crlf = base.replace(/\n/g, '\r\n');
    expect(mergeTexts(base, base, crlf).text).toBe(crlf);
    expect(mergeTexts(base, crlf, base).text).toBe(crlf);
  });
  test('arquivos muito diferentes: comparação simplificada vira conflito, nunca junção errada', () => {
    const big = Array.from({length: 3000}, (_, i) => `<p>${i}</p>`), rewritten = big.map(line => line.replace('<p>', '<p class="x">'));
    const store = [...big]; store[10] = '<p>loja</p>';
    const merged = mergeTexts(big.join('\n') + '\n', rewritten.join('\n') + '\n', store.join('\n') + '\n');
    expect(merged.conflicts).toBe(1);
    expect(merged.text).toContain('<p>loja</p>');
    expect(merged.text).toContain('<p class="x">2999</p>');
  });
  test('marcações reconhecidas só na forma completa', () => {
    expect(hasConflictMarks('a\n=======\nb\n')).toBe(false);
    expect(hasConflictMarks('<<<<<<< HEAD\r\na\r\n=======\r\nb\r\n>>>>>>> main\r\n')).toBe(true);
    expect(hasConflictMarks('// <<<<<<< não é marcação\n=======\n>>>>>>>\n')).toBe(false);
  });
});
