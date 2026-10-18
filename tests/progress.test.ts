import {describe, test, expect, vi} from 'vitest';
import {diffLines, splitLines} from '../src/core/diff';
import {ProgressTracker, formatDuration} from '../src/core/progress';
import {retry, retryReads, transient} from '../src/core/retry';
import {FakeEditor} from './fixtures/fake-editor';
describe('diferenças por linha', () => {
  test('mostra só o trecho alterado, com contexto e números de linha', () => {
    const before = Array.from({length: 30}, (_, i) => `linha ${i + 1}`).join('\n') + '\n';
    const after = before.replace('linha 15\n', 'linha quinze\nlinha extra\n');
    const diff = diffLines(before, after);
    expect(diff).toMatchObject({added: 2, removed: 1, identical: false, approximate: false});
    expect(diff.hunks).toHaveLength(1);
    const [hunk] = diff.hunks;
    expect(hunk.aStart).toBe(12); expect(hunk.bStart).toBe(12);
    expect(hunk.lines.map(l => l.kind)).toEqual(['same', 'same', 'same', 'del', 'add', 'add', 'same', 'same', 'same']);
    expect(hunk.lines.find(l => l.kind === 'del')).toMatchObject({text: 'linha 15', a: 15});
    expect(hunk.lines.filter(l => l.kind === 'add').map(l => l.b)).toEqual([15, 16]);
  });
  test('trechos distantes ficam separados; próximos se juntam', () => {
    const lines = Array.from({length: 40}, (_, i) => `l${i}`);
    const far = [...lines]; far[2] = 'x'; far[35] = 'y';
    expect(diffLines(lines.join('\n'), far.join('\n')).hunks).toHaveLength(2);
    const near = [...lines]; near[10] = 'x'; near[15] = 'y';
    expect(diffLines(lines.join('\n'), near.join('\n')).hunks).toHaveLength(1);
  });
  test('arquivos iguais, vazios, e diferença só na quebra de linha', () => {
    expect(diffLines('a\nb\n', 'a\nb\n').identical).toBe(true);
    expect(diffLines('', 'novo\n')).toMatchObject({added: 1, removed: 0});
    expect(diffLines('a\r\nb\r\n', 'a\nb\n').identical).toBe(true);
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b']);
  });
  test('o resultado reconstrói os dois lados', () => {
    const a = 'um\ndois\ntrês\nquatro\ncinco\nseis', b = 'zero\num\ntrês\nquatro mudado\ncinco\nseis\nsete';
    const diff = diffLines(a, b, 1000);
    const lines = diff.hunks.flatMap(h => h.lines);
    expect(lines.filter(l => l.kind !== 'add').map(l => l.text)).toEqual(splitLines(a));
    expect(lines.filter(l => l.kind !== 'del').map(l => l.text)).toEqual(splitLines(b));
  });
  test('arquivos muito diferentes usam a troca do trecho, sem travar', () => {
    const a = Array.from({length: 6000}, (_, i) => `a${i}`).join('\n'), b = Array.from({length: 6000}, (_, i) => `b${i}`).join('\n');
    const started = performance.now(), diff = diffLines(a, b);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(diff).toMatchObject({approximate: true, added: 6000, removed: 6000});
  });
});
describe('progresso ponderado e tempo restante', () => {
  test('etapas com pesos diferentes avançam a barra pelo trabalho, não pela contagem', () => {
    let now = 0;
    const tracker = new ProgressTracker([{id: 'read', label: 'Lendo', weight: 1, total: 10}, {id: 'save', label: 'Salvando', weight: 9, total: 1}], () => now);
    tracker.start('read');
    for (let i = 0; i < 10; i++) {now += 100; tracker.advance('read');}
    expect(tracker.snapshot().fraction).toBeCloseTo(0.526, 2);
    tracker.start('save');
    expect(tracker.snapshot().phases.map(p => p.status)).toEqual(['done', 'active']);
  });
  test('estima o tempo restante pelo ritmo recente, só com histórico suficiente', () => {
    let now = 0;
    const tracker = new ProgressTracker([{id: 'save', label: 'Salvando', weight: 1, total: 100}], () => now);
    tracker.start('save'); now += 1000; tracker.advance('save');
    expect(tracker.snapshot().etaMs).toBeUndefined();
    for (let i = 0; i < 9; i++) {now += 1000; tracker.advance('save');}
    expect(tracker.snapshot().etaMs).toBe(90 * 1000);
  });
  test('etapa sem itens aparece como pulada e o fim completa tudo', () => {
    const tracker = new ProgressTracker([{id: 'create', label: 'Criando', weight: 3}, {id: 'save', label: 'Salvando', weight: 1, total: 2}]);
    tracker.skip('create'); tracker.set('save', 1); tracker.complete();
    expect(tracker.snapshot()).toMatchObject({fraction: 1, phases: [{status: 'skipped'}, {status: 'done', done: 2}]});
  });
  test('tempo legível e estável', () => {
    // Number and unit never split across lines.
    expect([formatDuration(3000), formatDuration(41000), formatDuration(150_000), formatDuration(3_900_000)]).toEqual(['5\u00a0s', '45\u00a0s', '3\u00a0min', '1\u00a0h 05\u00a0min']);
  });
});
describe('repetição segura de leituras', () => {
  const wait = vi.fn(async () => {});
  test('somente falhas de tempo são repetidas', () => {
    expect(transient(new Error('O editor não confirmou a operação dentro do prazo.'))).toBe(true);
    expect(transient(new Error('Could not establish connection. Receiving end does not exist.'))).toBe(true);
    expect(transient(new Error('A loja de destino mudou ou não corresponde à exportação. Operação interrompida.'))).toBe(false);
    expect(transient(new Error('Conflito antes de salvar: templates/home.twig'))).toBe(false);
  });
  test('leitura que falha por tempo é refeita; conflito não', async () => {
    let calls = 0;
    expect(await retry(async () => {if (++calls < 3) throw new Error('Sem resposta do editor.'); return 'ok';}, {wait})).toBe('ok');
    calls = 0;
    await expect(retry(async () => {calls++; throw new Error('Conflito');}, {wait})).rejects.toThrow('Conflito');
    expect(calls).toBe(1);
  });
  test('salvar, criar e enviar imagem nunca são repetidos', async () => {
    const editor = new FakeEditor({'templates/a.twig': 'a'});
    let attempts = 0;
    editor.beforeWrite = () => {attempts++; throw new Error('O editor não confirmou a operação dentro do prazo.');};
    const safe = retryReads(editor, {wait});
    await expect(safe.write('templates/a.twig', 'a', 'b')).rejects.toThrow('prazo');
    expect(attempts).toBe(1);
    let reads = 0; const original = editor.read.bind(editor);
    editor.read = async path => {if (++reads === 1) throw new Error('Componente do editor Yampi não reconhecido. Abra o editor de código e aguarde o carregamento.'); return original(path);};
    expect(await safe.read('templates/a.twig')).toBe('a'); expect(reads).toBe(2);
  });
  test('cancelamento interrompe as novas tentativas', async () => {
    const controller = new AbortController(); controller.abort();
    let calls = 0;
    await expect(retry(async () => {calls++; throw new Error('Sem resposta do editor.');}, {wait, signal: controller.signal})).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
