import {describe, test, expect} from 'vitest';
import {zipSync, unzipSync, strToU8} from 'fflate';
import {encodeSnapshot, decodeProject, readProjectDirectory} from '../src/core/archive';
import {safeSnapshot, type Assets, type Adapter} from '../src/core/model';
import {makePlan} from '../src/core/planner';
import {capture, applyPlan} from '../src/core/workflow';
import {demoSnapshot, demoImage} from '../src/demo/sample';
const imagePath = 'assets/images/example.png';
const clone = () => structuredClone(demoSnapshot);
function picked(path: string, bytes: Uint8Array): File {
  return {name: path.split('/').at(-1), webkitRelativePath: 'projeto/' + path, size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer} as File;
}
describe('projeto executável e retorno completo', () => {
  test('exporta ferramentas e lockfile; lê tema e imagens sem misturá-los com código', async () => {
    const bytes = await encodeSnapshot(clone(), true), entries = unzipSync(bytes);
    expect(entries['package-lock.json']).toBeDefined();
    expect(entries['.yampi-sync/tools/dev.mjs']).toBeDefined();
    expect(JSON.parse(new TextDecoder().decode(entries['preview/raw/page-0.json'])).merchant.manifest.name).toBe(demoSnapshot.context.storeName);
    expect(JSON.parse(new TextDecoder().decode(entries['local.data.json'])).format).toBe('yampi-local-overrides');
    expect(entries['README.md']).toBeDefined(); expect(entries['loja-de-testes.code-workspace']).toBeDefined();
    const result = await decodeProject(bytes);
    expect(result.baseline).toEqual(demoSnapshot); expect(result.localAssets[imagePath]).toEqual(demoImage);
  });
  test('dependências do projeto são portáteis e nunca apontam para o computador da extensão', async () => {
    const entries = unzipSync(await encodeSnapshot(clone(), true));
    const pkg = JSON.parse(new TextDecoder().decode(entries['package.json']));
    const lock = JSON.parse(new TextDecoder().decode(entries['package-lock.json']));
    expect(Object.values(pkg.dependencies).every(v => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v))).toBe(true);
    for (const [name, dependency] of Object.entries(lock.packages) as [string, {resolved?: string; link?: boolean}][]) {
      expect(name === '' || name.startsWith('node_modules/')).toBe(true);
      expect(dependency.link).not.toBe(true);
      if (dependency.resolved) expect(dependency.resolved.startsWith('https://registry.npmjs.org/')).toBe(true);
    }
  });
  test('aceita pasta inteira com dependências sem ler arquivos alheios ao tema', async () => {
    const entries = unzipSync(await encodeSnapshot(clone(), true));
    const ignored = picked('node_modules/fake/file', new Uint8Array());
    ignored.arrayBuffer = async () => {throw new Error('Dependências nunca são lidas');};
    const result = await readProjectDirectory([...Object.entries(entries).map(([p, b]) => picked(p, b)), ignored]);
    expect('baseline' in result).toBe(true); expect(result.local).toEqual(demoSnapshot.files);
  });
  test('aceita somente tema incluindo PNG e normaliza CRLF de texto', async () => {
    const result = await readProjectDirectory([picked('templates/home.twig', strToU8('a\r\nb\r')), picked(imagePath, demoImage)]);
    expect(result.local['templates/home.twig']).toBe('a\nb\n'); expect(result.localAssets[imagePath]).toEqual(demoImage);
  });
  test('deixa de fora, com aviso, binários que a Yampi não guarda; arquivos do sistema, sem aviso', async () => {
    const binary = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0xff, 0xfe]);
    const result = await readProjectDirectory([picked('templates/home.twig', strToU8('a')), picked('assets/models/cena.glb', binary), picked('assets/.DS_Store', binary), picked('Thumbs.db', binary), picked(imagePath, demoImage)]);
    expect(Object.keys(result.local)).toEqual(['templates/home.twig']);
    expect(result.localAssets[imagePath]).toEqual(demoImage);
    expect('notes' in result && result.notes).toEqual(['assets/models/cena.glb ficou de fora: a Yampi guarda só textos e imagens PNG, JPEG, WebP ou SVG.']);
  });
  test('binário grande que a Yampi não guarda nem chega a ser lido', async () => {
    const video = {name: 'intro.mp4', webkitRelativePath: 'projeto/assets/videos/intro.mp4', size: 3 * 1024 * 1024, arrayBuffer: async () => {throw new Error('Nunca é lido');}} as unknown as File;
    const result = await readProjectDirectory([picked('templates/home.twig', strToU8('a')), video]);
    expect(Object.keys(result.local)).toEqual(['templates/home.twig']);
    expect('notes' in result && result.notes?.[0]).toContain('assets/videos/intro.mp4 ficou de fora');
  });
  test('texto do tema que não é UTF-8 para a leitura e diz qual é', async () => {
    await expect(readProjectDirectory([picked('sections/hero.twig', new Uint8Array([0x61, 0xe9, 0x62]))])).rejects.toThrow('sections/hero.twig não pôde ser lido como texto UTF-8');
    await expect(readProjectDirectory([picked('sections/hero.twig', new Uint8Array([0x61, 0x00]))])).rejects.toThrow('sections/hero.twig');
  });
  test('projeto exportado com binário em tema/: compara o resto e avisa', async () => {
    const entries = unzipSync(await encodeSnapshot(clone()));
    entries['tema/assets/models/cena.glb'] = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x00, 0xff]);
    const result = await decodeProject(zipSync(entries));
    expect(result.local).toEqual(demoSnapshot.files);
    expect(result.notes).toEqual(['assets/models/cena.glb ficou de fora: a Yampi guarda só textos e imagens PNG, JPEG, WebP ou SVG.']);
  });
  test('aceita ZIP criado ao compactar a pasta externa do projeto', async () => {
    const entries = unzipSync(await encodeSnapshot(clone(), true));
    const wrapped = Object.fromEntries(Object.entries(entries).map(([p, b]) => ['MinhaLoja/' + p, b]));
    expect((await decodeProject(zipSync(wrapped))).baseline).toEqual(demoSnapshot);
  });
  test('ignora node_modules em ZIP sem descompactar conteúdo grande', async () => {
    const entries = unzipSync(await encodeSnapshot(clone()));
    entries['node_modules/ficticio/grande'] = new Uint8Array(5 * 1024 * 1024);
    expect((await decodeProject(zipSync(entries))).local).toEqual(demoSnapshot.files);
  });
  test('imagem original adulterada é rejeitada pelo hash', async () => {
    const entries = unzipSync(await encodeSnapshot(clone()));
    entries['.yampi-sync/baseline/' + imagePath][20] ^= 1;
    await expect(decodeProject(zipSync(entries))).rejects.toThrow('Baseline');
  });
  test('rejeita caminho com caixa ambígua e dois projetos no mesmo ZIP', async () => {
    const entries = unzipSync(await encodeSnapshot(clone()));
    entries['tema/templates/HOME.twig'] = strToU8('x');
    await expect(decodeProject(zipSync(entries))).rejects.toThrow('ambígu');
    delete entries['tema/templates/HOME.twig'];
    entries['outro/.yampi-sync/manifest.json'] = entries['.yampi-sync/manifest.json'];
    await expect(decodeProject(zipSync(entries))).rejects.toThrow('único');
  });
  test('manifesto versão 1 continua legível', async () => {
    const source = clone(); delete source.assets;
    const entries = unzipSync(await encodeSnapshot(source));
    const m = JSON.parse(new TextDecoder().decode(entries['.yampi-sync/manifest.json']));
    m.version = 1; m.files.forEach((f: {kind?: string}) => delete f.kind);
    entries['.yampi-sync/manifest.json'] = strToU8(JSON.stringify(m));
    expect((await decodeProject(zipSync(entries))).baseline).toEqual(source);
  });
  test('manifesto versão 3 registra ferramenta, tema, quebras de linha, ignorados e prévia; versão 2 continua legível', async () => {
    const source = clone(); source.files['templates/sem-final.twig'] = 'a\r\nb';
    const entries = unzipSync(await encodeSnapshot(source, true)), m = JSON.parse(new TextDecoder().decode(entries['.yampi-sync/manifest.json']));
    expect(m).toMatchObject({version: 3, tool: {name: 'yampi-code-sync', version: '0.10.6'}, theme: {state: 'unknown', source: 'unavailable'}, skipped: [{path: 'logs/'}], preview: {manifest: 'preview/manifest.json', format: 3}});
    expect(m.files.find((f: {path: string}) => f.path === 'templates/home.twig')).toMatchObject({eol: 'lf', finalNewline: true});
    expect(m.files.find((f: {path: string}) => f.path === 'templates/sem-final.twig')).toMatchObject({eol: 'crlf', finalNewline: false});
    expect(m.files.find((f: {path: string}) => f.path === imagePath).eol).toBeUndefined();
    const legacy = {...m, version: 2}; delete legacy.tool; delete legacy.theme; delete legacy.skipped; delete legacy.preview; legacy.files.forEach((f: {eol?: string; finalNewline?: boolean}) => {delete f.eol; delete f.finalNewline;});
    entries['.yampi-sync/manifest.json'] = strToU8(JSON.stringify(legacy));
    expect((await decodeProject(zipSync(entries))).baseline).toEqual(source);
  });
  test('rejeita arquivo com assinatura de imagem incompatível', () => {
    expect(() => safeSnapshot({...clone(), assets: {[imagePath]: strToU8('não é PNG')}})).toThrow('tipo');
  });
  test('rejeita colisão entre texto e binário', () => {
    expect(() => safeSnapshot({...clone(), files: {...demoSnapshot.files, [imagePath]: 'texto'}})).toThrow('ambíguo');
  });
});
describe('captura e comparação de imagens', () => {
  const adapter = (): Adapter => ({
    context: async () => demoSnapshot.context, inventory: async () => [...Object.keys(demoSnapshot.files), imagePath],
    read: async p => demoSnapshot.files[p], readAsset: async () => demoImage,
    write: async () => {throw new Error('Não deve gravar');}, refresh: async () => {}
  });
  test('captura todos os textos e imagens, conferindo a árvore', async () => {
    const result = await capture(adapter()); expect(result.files).toEqual(demoSnapshot.files); expect(result.assets).toEqual(demoSnapshot.assets);
  });
  test('imagem ilegível impede exportação parcial', async () => {
    await expect(capture({...adapter(), readAsset: undefined})).rejects.toThrow('imagem');
    await expect(capture({...adapter(), readAsset: async () => {throw new Error('sem CORS');}})).rejects.toThrow('CORS');
  });
  test('imagem alterada fica bloqueada; imagem igual fica sem alterações', () => {
    const assets: Assets = {[imagePath]: new Uint8Array(demoImage)}; assets[imagePath][20] ^= 1;
    expect(makePlan(clone(), demoSnapshot.files, clone(), assets).rows.find(r => r.path === imagePath)?.status).toBe('unsupported');
    expect(makePlan(clone(), demoSnapshot.files, clone(), demoSnapshot.assets).rows.find(r => r.path === imagePath)?.status).toBe('unchanged');
  });
  test('conflito de imagem e ausência local nunca geram uma gravação', async () => {
    const remote = clone(); remote.assets![imagePath][21] ^= 1;
    const assets: Assets = {[imagePath]: new Uint8Array(demoImage)}; assets[imagePath][20] ^= 1;
    const plan = makePlan(clone(), demoSnapshot.files, remote, assets);
    expect(plan.rows.find(r => r.path === imagePath)?.status).toBe('conflict');
    const row = plan.rows.find(r => r.path === imagePath)!; row.status = 'update'; row.local = 'forjado'; row.remote = 'forjado';
    await expect(applyPlan(adapter(), plan, [imagePath], {persist: async () => {}, backup: async () => {}})).rejects.toThrow('elegível');
    expect(makePlan(clone(), demoSnapshot.files, clone()).rows.find(r => r.path === imagePath)?.status).toBe('missing-local');
  });
});
