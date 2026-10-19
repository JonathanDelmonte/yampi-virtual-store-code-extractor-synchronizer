import {describe, test, expect} from 'vitest';
import {capture} from '../src/core/workflow';
import {DIRECT_BATCH, STORE_CHANGED, directKind, directSamples, editorText} from '../src/core/direct';
import {imageBase64, openSession, readFiles, sessionStore, type Server} from '../src/browser/server-read';
import type {Assets, DirectReader, Files, Progress} from '../src/core/model';
import {FakeEditor, context, png} from './fixtures/fake-editor';
// Fictitious server answers in the format of the Yampi editor's own server. Nothing here reaches Yampi.
const merchant = {name: context.storeName, url: `${context.previewOrigin}/?preview=true`, alias: 'loja-ficticia', can_edit: true, expiration: 1};
function fakeServer(files: Record<string, string>, options: {alias?: () => string; status?: (path: string, attempt: number) => number; merchant?: Record<string, unknown>} = {}) {
  const calls: {url: URL; init: RequestInit}[] = [], attempts = new Map<string, number>();
  let active = 0, peak = 0;
  const server: Server = {
    base: 'https://servidor-ficticio.invalid/v1',
    wait: async () => {},
    fetch: async (href, init) => {
      const url = new URL(href); calls.push({url, init});
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
      if (url.pathname.endsWith('/merchant/theme/merchant-identity')) return json(200, {data: {alias: options.alias?.() ?? merchant.alias}});
      if (url.pathname.endsWith('/merchant/theme/data-merchant-theme')) return json(200, {data: options.merchant ?? merchant});
      const path = url.searchParams.get('path_file')!, attempt = (attempts.get(path) ?? 0) + 1;
      attempts.set(path, attempt);
      const status = options.status?.(path, attempt) ?? 200;
      if (status !== 200) return json(status, {message: 'falha fictícia'});
      return path in files ? json(200, {data: files[path]}) : json(404, {message: 'ausente'});
    }
  };
  return {server, calls, peak: () => peak};
}
const pngData = (last: number) => 'data:image/png;base64,' + btoa(String.fromCharCode(...png(last)));
const unexpected = async (): Promise<Uint8Array> => {throw new Error('Nenhum download esperado.');};
describe('servidor do editor: só leitura, com a loja conferida', () => {
  test('identifica a loja pelo nome e pelo link de prévia do cabeçalho', async () => {
    const {server, calls} = fakeServer({});
    expect(await openSession(server, context)).toBe('loja-ficticia');
    expect(calls.every(c => c.init.method === 'GET' && c.init.credentials === 'include' && c.init.cache === 'no-store' && c.url.searchParams.get('preview') === 'true')).toBe(true);
  });
  test('outra loja na sessão para tudo; resposta sem os campos só desativa a leitura direta', async () => {
    await expect(openSession(fakeServer({}, {merchant: {...merchant, name: 'Outra loja'}}).server, context)).rejects.toThrow(STORE_CHANGED);
    await expect(openSession(fakeServer({}, {merchant: {...merchant, url: 'https://outra.invalid/'}}).server, context)).rejects.toThrow(STORE_CHANGED);
    await expect(openSession(fakeServer({}, {alias: () => 'outra-loja'}).server, context)).rejects.toThrow(STORE_CHANGED);
    const missing = openSession(fakeServer({}, {merchant: {alias: 'loja-ficticia'}}).server, context);
    await expect(missing).rejects.toThrow('não identificou');
    await expect(missing).rejects.not.toThrow(STORE_CHANGED);
  });
  test('textos como o editor mostra; imagem pelo endereço que o editor exibe; poucos pedidos de cada vez', async () => {
    const files = Object.fromEntries(Array.from({length: 20}, (_, i) => [`sections/s${i}.twig`, `linha 1\r\nlinha ${i}\rfim\n`]));
    files['assets/images/a.png'] = pngData(7);
    const {server, calls, peak} = fakeServer(files);
    const answer = await readFiles(server, Object.keys(files), 'loja-ficticia', unexpected, 'https://app.yampi.com.br/store/code-editor/');
    expect(answer.files['sections/s3.twig']).toBe('linha 1\nlinha 3\nfim\n');
    expect(Uint8Array.from(atob(answer.images['assets/images/a.png']), c => c.charCodeAt(0))).toEqual(png(7));
    expect(answer.rest).toEqual([]);
    expect(peak()).toBeLessThanOrEqual(6);
    expect(calls.filter(c => c.url.pathname.endsWith('/merchant/file/get')).map(c => c.url.searchParams.get('path_file')).sort()).toEqual(Object.keys(files).sort());
  });
  test('servidor ocupado é repetido; sessão expirada e arquivo ausente param com o motivo', async () => {
    const busy = fakeServer({'templates/a.twig': 'a'}, {status: (_, attempt) => attempt < 3 ? 503 : 200});
    expect((await readFiles(busy.server, ['templates/a.twig'], 'loja-ficticia', unexpected, 'https://app.yampi.com.br/')).files).toEqual({'templates/a.twig': 'a'});
    await expect(readFiles(fakeServer({'templates/a.twig': 'a'}, {status: () => 401}).server, ['templates/a.twig'], 'loja-ficticia', unexpected, 'https://app.yampi.com.br/')).rejects.toThrow('HTTP 401');
    await expect(readFiles(fakeServer({}).server, ['templates/a.twig'], 'loja-ficticia', unexpected, 'https://app.yampi.com.br/')).rejects.toThrow('HTTP 404');
  });
  test('a loja da sessão é conferida antes e depois de cada lote', async () => {
    let checks = 0;
    const {server} = fakeServer({'templates/a.twig': 'a'}, {alias: () => ++checks > 1 ? 'outra-loja' : 'loja-ficticia'});
    await expect(readFiles(server, ['templates/a.twig'], 'loja-ficticia', unexpected, 'https://app.yampi.com.br/')).rejects.toThrow(STORE_CHANGED);
    expect(await sessionStore(fakeServer({}).server)).toBe('loja-ficticia');
  });
  test('resposta grande fica dividida: o que não coube volta para a próxima chamada', async () => {
    const files = Object.fromEntries(Array.from({length: 10}, (_, i) => [`templates/t${i}.twig`, 'x'.repeat(1_600_000)]));
    const answer = await readFiles(fakeServer(files).server, Object.keys(files), 'loja-ficticia', unexpected, 'https://app.yampi.com.br/');
    expect(Object.keys(answer.files).length).toBeGreaterThan(0);
    expect(answer.rest.length).toBeGreaterThan(0);
    expect([...Object.keys(answer.files), ...answer.rest].sort()).toEqual(Object.keys(files).sort());
  });
  test('imagem: só https ou data:, sem credenciais no endereço, e com o conteúdo do tipo certo', async () => {
    const base = 'https://app.yampi.com.br/store/code-editor/';
    await expect(imageBase64('assets/images/a.png', 'http://cdn.invalid/a.png', unexpected, base)).rejects.toThrow('não permitida');
    await expect(imageBase64('assets/images/a.png', 'https://user:senha@cdn.invalid/a.png', unexpected, base)).rejects.toThrow('não permitida');
    await expect(imageBase64('assets/images/a.png', 'javascript:alert(1)', unexpected, base)).rejects.toThrow('não permitida');
    await expect(imageBase64('assets/images/a.png', 'data:image/png;base64,' + btoa('<svg></svg>'), unexpected, base)).rejects.toThrow('tipo');
    let asked = '';
    const encoded = await imageBase64('assets/images/a.png', '/imagens/a.png', async url => {asked = url.href; return png(2);}, base);
    expect(asked).toBe('https://app.yampi.com.br/imagens/a.png');
    expect(encoded).toBe(btoa(String.fromCharCode(...png(2))));
  });
});
describe('regras da leitura direta', () => {
  test('o texto segue o CodeMirror: toda quebra de linha vira \\n', () => {
    expect(editorText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
  test('JSON e imagens fora de assets ficam com o editor; amostra: um arquivo de cada tipo', () => {
    expect(directKind('templates/a.twig')).toBe('twig');
    expect(directKind('assets/images/a.PNG')).toBe('image');
    expect(directKind('sections/data.json')).toBeUndefined();
    expect(directKind('templates/logo.png')).toBeUndefined();
    expect(directSamples(['templates/b.twig', 'components/z.vue', 'templates/a.twig', 'assets/images/x.png', 'sections/d.json'])).toEqual(['assets/images/x.png', 'components/z.vue', 'templates/a.twig']);
  });
});
// Fictitious editor with the direct path: the same files, and switches for each kind of failure.
class DirectEditor extends FakeEditor {
  served: Files; directCalls: string[][] = []; opens = 0;
  openStore: () => string = () => 'loja-ficticia';
  failAfter?: number; failure = 'O servidor da Yampi não respondeu.'; budget?: number;
  constructor(files: Files, assets: Record<string, Uint8Array> = {}) {super(files, assets); this.served = {...files};}
  direct: DirectReader = {
    open: async () => {this.opens++; return this.openStore();},
    read: async (paths, store) => {
      this.directCalls.push(paths);
      if (store !== 'loja-ficticia') throw new Error(STORE_CHANGED);
      if (this.failAfter !== undefined && this.directCalls.length > this.failAfter) throw new Error(this.failure);
      const files: Files = {}, assets: Assets = {}, rest: string[] = [];
      for (const [index, path] of paths.entries()) {
        if (this.budget !== undefined && index >= this.budget) {rest.push(path); continue;}
        if (path in this.assets) assets[path] = this.assets[path]; else files[path] = this.served[path];
      }
      return {files, assets, rest};
    }
  };
}
const theme = (count: number): Files => ({
  ...Object.fromEntries(Array.from({length: count}, (_, i) => [`sections/home/s${String(i).padStart(3, '0')}.twig`, `<section>${i}</section>\n`])),
  'assets/styles/main.scss': 'body {}\n', 'components/Card.vue': '<template><div/></template>\n', 'sections/home/config.json': '{"a": 1}'
});
const events = () => {const list: {text: string; tone: string}[] = []; return {list, notice: (text: string, tone: string) => {list.push({text, tone});}};};
describe('cópia pelo servidor da Yampi, conferida com o editor', () => {
  test('um arquivo de cada tipo é lido pelos dois caminhos; o restante vem em lotes; JSON pelo editor', async () => {
    const editor = new DirectEditor(theme(60), {'assets/images/logo.png': png(1)}), log = events(), progress: Progress[] = [];
    const result = await capture(editor, {notice: log.notice, progress: p => {progress.push(p);}});
    expect(result.files).toEqual(theme(60));
    expect(result.assets).toEqual({'assets/images/logo.png': png(1)});
    expect(editor.reads.sort()).toEqual(['assets/styles/main.scss', 'components/Card.vue', 'sections/home/config.json', 'sections/home/s000.twig']);
    expect(editor.log.filter(entry => entry.startsWith('readAsset:'))).toEqual(['readAsset:assets/images/logo.png']);
    const batches = editor.directCalls.filter(paths => paths.length > 1);
    expect(batches.every(paths => paths.length <= DIRECT_BATCH)).toBe(true);
    expect(batches.flat().sort()).toEqual(Object.keys(theme(60)).filter(p => /s0(?!00)\d\d\.twig$/.test(p)).sort());
    expect(log.list).toEqual([{text: expect.stringContaining('Leitura direta conferida com o editor em 4 tipos de arquivo'), tone: 'ok'}]);
    expect(editor.opens).toBe(2);
    const reads = progress.filter(p => p.step === 'read');
    expect(reads.map(p => p.done)).toEqual(Array.from({length: 64}, (_, i) => i + 1));
    expect(reads.filter(p => p.label).map(p => p.label)).toEqual(['Ler os arquivos direto da Yampi', 'Ler os arquivos pelo editor']);
    expect(progress.find(p => p.step === 'inventory' && p.done === 1)?.next).toEqual({step: 'read', total: 64});
  });
  test('conteúdo diferente na amostra: tudo pelo editor, com o aviso', async () => {
    const editor = new DirectEditor(theme(20)), log = events();
    editor.served['components/Card.vue'] = '<template><div/></template>\r\n';
    const result = await capture(editor, {notice: log.notice});
    expect(result.files).toEqual(theme(20));
    expect(editor.reads.length).toBe(23);
    expect(editor.directCalls.filter(paths => paths.length > 1)).toEqual([]);
    expect(log.list).toEqual([{text: expect.stringContaining('components/Card.vue diferente do que o editor mostra'), tone: 'warn'}]);
  });
  test('servidor indisponível no início: tudo pelo editor, sem erro', async () => {
    const editor = new DirectEditor(theme(20)), log = events();
    editor.direct.open = async () => {throw new Error('Leitura direta disponível só no editor da Yampi.');};
    const result = await capture(editor, {notice: log.notice});
    expect(result.files).toEqual(theme(20));
    expect(editor.directCalls).toEqual([]);
    expect(log.list).toEqual([{text: 'Leitura direta indisponível (Leitura direta disponível só no editor da Yampi). Tudo será lido pelo editor, arquivo por arquivo.', tone: 'info'}]);
  });
  test('falha no meio: o restante vem pelo editor, e a cópia sai completa', async () => {
    const editor = new DirectEditor(theme(80)), log = events();
    editor.failAfter = 5; // 3 samples, then two batches, then the server stops answering
    const result = await capture(editor, {notice: log.notice});
    expect(result.files).toEqual(theme(80));
    // Samples (scss, vue, one twig), the JSON, and the twig files the two batches did not cover.
    expect(editor.reads.length).toBe(3 + 1 + (80 - 1 - 2 * DIRECT_BATCH));
    expect(log.list.map(e => e.tone)).toEqual(['ok', 'warn']);
    expect(log.list[1].text).toBe('Leitura direta interrompida (O servidor da Yampi não respondeu). O restante será lido pelo editor, arquivo por arquivo.');
  });
  test('o primeiro lote falha: a etapa não diz "direto da Yampi" enquanto lê pelo editor', async () => {
    const editor = new DirectEditor(theme(20)), log = events(), progress: Progress[] = [];
    editor.failAfter = 3;
    expect((await capture(editor, {notice: log.notice, progress: p => {progress.push(p);}})).files).toEqual(theme(20));
    expect(progress.some(p => p.label)).toBe(false);
    expect(progress.filter(p => p.step === 'read').every(p => p.phase === 'Lendo arquivos')).toBe(true);
    expect(log.list.map(e => e.tone)).toEqual(['ok', 'info']);
  });
  test('o que não coube numa resposta volta para a próxima', async () => {
    const editor = new DirectEditor(theme(40));
    editor.budget = 5;
    expect((await capture(editor)).files).toEqual(theme(40));
    expect(editor.reads.length).toBe(4);
  });
  test('troca de loja na sessão: nada é entregue, em qualquer momento', async () => {
    const atStart = new DirectEditor(theme(20));
    atStart.direct.open = async () => {throw new Error(`${STORE_CHANGED}, diferente da que o editor mostra.`);};
    await expect(capture(atStart)).rejects.toThrow(STORE_CHANGED);
    expect(atStart.reads).toEqual([]);
    const midway = new DirectEditor(theme(80));
    midway.failAfter = 4; midway.failure = `${STORE_CHANGED} durante a cópia.`;
    await expect(capture(midway)).rejects.toThrow(STORE_CHANGED);
    const atEnd = new DirectEditor(theme(20));
    atEnd.openStore = () => atEnd.opens > 1 ? 'outra-loja' : 'loja-ficticia';
    await expect(capture(atEnd)).rejects.toThrow(STORE_CHANGED);
  });
  test('poucos arquivos, comparação parcial e cancelamento', async () => {
    const few = new DirectEditor({'templates/a.twig': 'a', 'templates/b.twig': 'b'});
    expect((await capture(few)).files).toEqual({'templates/a.twig': 'a', 'templates/b.twig': 'b'});
    expect(few.opens).toBe(0);
    const partial = new DirectEditor(theme(60));
    expect(Object.keys((await capture(partial, {only: ['sections/home/s001.twig', 'sections/home/s002.twig']})).files)).toEqual(['sections/home/s001.twig', 'sections/home/s002.twig']);
    expect(partial.opens).toBe(0);
    const controller = new AbortController(), cancelled = new DirectEditor(theme(80));
    const read = cancelled.direct.read;
    cancelled.direct.read = async (paths, store) => {if (paths.length > 1) controller.abort(); return read(paths, store);};
    await expect(capture(cancelled, {signal: controller.signal})).rejects.toThrow('Cópia cancelada');
  });
});
