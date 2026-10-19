import {describe, test, expect, afterEach} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {unzipSync} from 'fflate';
import {encodeSnapshot, readProjectEntries, type Project} from '../src/core/archive';
import {folderEntries, openProject} from '../src/panel/folder';
import {applyJoin, applyUpdate, fileMerge, planUpdate} from '../src/core/update';
import {KNOWN_FILE, journalKnown, makeReceipt, parseReceipt, type Known} from '../src/core/known';
import {makePlan, MARKED} from '../src/core/planner';
import {applyPlan} from '../src/core/workflow';
import {textHash} from '../src/core/sha256';
import type {Capture} from '../src/core/workflow';
import type {Files, Journal, Manifest} from '../src/core/model';
// @ts-expect-error -- plain JavaScript of the project's local tools, without type declarations.
import {knownVersions} from '../local-runtime/known.mjs';
import {FakeEditor, context, png, recorder} from './fixtures/fake-editor';
import {asFolder, contents, memoryFolder, type MemoryDir} from './fixtures/memory-folder';
const lines = (...items: string[]) => items.map(item => item + '\n').join('');
const x = 'sections/home/vitrine.twig', other = 'elements/head.twig', created = 'sections/home/novidade.twig';
// D0: the download. D7: the project sent its redesign of X (from a ZIP, in another installation).
const d0: Files = {[x]: lines('<section>', '  <h2>Mais vendidos</h2>', '  <p>Texto antigo</p>', '  <a>Ver</a>', '</section>'), [other]: '<meta name="description" content="Loja">\n'};
const sentX = lines('<section class="vitrine">', '  <h2>Os mais vendidos</h2>', '  <p>Texto novo</p>', '  <a>Ver</a>', '</section>');
const sentCreated = '<section>Novidade do projeto</section>\n';
const known = (files: Record<string, string>, at = '2026-10-07T10:00:00.000Z'): Known => Object.fromEntries(Object.entries(files).map(([file, text]) => [file, [{sha256: textHash(text), source: 'git' as const, at, text}]]));
const reading = (files: Files): Capture => ({context, capturedAt: '2026-10-11T12:00:00.000Z', files, inventory: Object.keys(files).sort()});
async function project(local: Record<string, string>, extra: Record<string, string | Uint8Array> = {}, manifestVersion?: 2): Promise<MemoryDir> {
  const entries: Record<string, string | Uint8Array> = unzipSync(await encodeSnapshot({context, capturedAt: '2026-10-01T12:00:00.000Z', files: d0}));
  for (const [file, value] of Object.entries(local)) entries[`tema/${file}`] = value;
  if (manifestVersion) {
    // A download made before version 3 of the manifest: no line-ending facts, no tool metadata.
    const manifest = JSON.parse(new TextDecoder().decode(entries['.yampi-sync/manifest.json'] as Uint8Array)) as Manifest;
    entries['.yampi-sync/manifest.json'] = JSON.stringify({format: manifest.format, version: 2, context: manifest.context, capturedAt: manifest.capturedAt, files: manifest.files.map(({path: file, sha256, bytes, kind}) => ({path: file, sha256, bytes, kind}))});
  }
  return memoryFolder('projeto', {...entries, ...extra});
}
const read = async (root: MemoryDir) => await readProjectEntries((await folderEntries(asFolder(root))).entries) as Project;
const kind = (rows: {path: string; kind: string}[], file: string) => rows.find(row => row.path === file)?.kind;
describe('referência atrasada: versões conhecidas do projeto', () => {
  test('1. envio feito em outra instalação, listado pelo Git: o arquivo é nosso, sem conflito', async () => {
    const ours = sentX.replace('Texto novo', 'Texto novo, ajustado depois');
    const p = await read(await project({[x]: ours}));
    expect(kind(planUpdate(p.baseline, p.local, p.localAssets, reading({...d0, [x]: sentX})).rows, x)).toBe('conflict');
    const plan = planUpdate(p.baseline, p.local, p.localAssets, reading({...d0, [x]: sentX}), {known: known({[x]: sentX})});
    expect(plan.rows.find(row => row.path === x)).toMatchObject({kind: 'mine', origin: {kind: 'own', source: 'git'}});
  });
  test('2. alguém mudou outro trecho de X na loja: juntado, e só a mudança dessa pessoa entra na pasta', async () => {
    const ours = sentX.replace('Os mais vendidos', 'Os mais vendidos da semana'), theirs = sentX.replace('  <a>Ver</a>', '  <a>Ver todos</a>');
    const p = await read(await project({[x]: ours}));
    const plan = planUpdate(p.baseline, p.local, p.localAssets, reading({...d0, [x]: theirs}), {known: known({[x]: sentX})});
    const row = plan.rows.find(item => item.path === x)!;
    expect(row).toMatchObject({kind: 'merged', origin: {kind: 'third', since: '2026-10-07T10:00:00.000Z'}});
    expect(row.merged).toBe(ours.replace('  <a>Ver</a>', '  <a>Ver todos</a>'));
  });
  test('3. alguém mudou as mesmas linhas: conflito com a origem "depois do último envio conhecido"', async () => {
    const ours = sentX.replace('Texto novo', 'Texto nosso'), theirs = sentX.replace('Texto novo', 'Texto do cliente');
    const p = await read(await project({[x]: ours}));
    const row = planUpdate(p.baseline, p.local, p.localAssets, reading({...d0, [x]: theirs}), {known: known({[x]: sentX})}).rows.find(item => item.path === x)!;
    expect(row).toMatchObject({kind: 'conflict', conflicts: 1, origin: {kind: 'third', since: '2026-10-07T10:00:00.000Z'}});
    expect(row.hunks).toEqual([{id: expect.any(String), mine: ['  <p>Texto nosso</p>'], theirs: ['  <p>Texto do cliente</p>']}]);
  });
  test('4. arquivo criado pelo projeto, ausente da referência, com a versão enviada na loja: nosso, nunca conflito do arquivo inteiro', async () => {
    const ours = sentCreated.replace('Novidade', 'Novidade revisada');
    const p = await read(await project({[created]: ours}));
    const store = {...d0, [created]: sentCreated}, list = known({[created]: sentCreated});
    expect(kind(planUpdate(p.baseline, p.local, p.localAssets, reading(store)).rows, created)).toBe('conflict');
    expect(kind(planUpdate(p.baseline, p.local, p.localAssets, reading(store), {known: list}).rows, created)).toBe('mine');
    const sending = makePlan(p.baseline, p.local, {context, capturedAt: '', files: store}, {}, {known: list});
    expect(sending.rows.find(row => row.path === created)).toMatchObject({status: 'update', origin: {kind: 'own'}});
  });
  test('5. enviar um arquivo só: junta X na pasta, move a referência só de X, e só X vai para a loja', async () => {
    const ours = sentX.replace('Os mais vendidos', 'Os mais vendidos da semana'), theirs = sentX.replace('  <a>Ver</a>', '  <a>Ver todos</a>');
    const root = await project({[x]: ours, [other]: '<meta name="description" content="Nossa">\n'});
    const p = await read(root), store = {...d0, [x]: theirs, [other]: '<meta name="description" content="Do cliente">\n'};
    const review = makePlan(p.baseline, p.local, {context, capturedAt: '', files: store}, {}, {known: known({[x]: sentX})});
    const row = review.rows.find(item => item.path === x)!;
    expect(row.status).toBe('conflict');
    const merge = fileMerge(row.base, row.local!, row.remote!);
    expect(merge.conflicts).toBe(0);
    await applyJoin(await openProject(asFolder(root)), p, x, p.local[x], merge.text, theirs);
    const after = await read(root);
    expect(after.local[x]).toBe(ours.replace('  <a>Ver</a>', '  <a>Ver todos</a>'));
    expect(after.baseline.files[x]).toBe(theirs);
    expect(after.baseline.files[other]).toBe(d0[other]);
    const next = makePlan(after.baseline, after.local, {context, capturedAt: '', files: store});
    expect(next.rows.find(item => item.path === x)?.status).toBe('update');
    expect(next.rows.find(item => item.path === other)?.status).toBe('conflict');
    const editor = new FakeEditor(store);
    await applyPlan(editor, next, [x], recorder());
    expect(editor.files).toEqual({...store, [x]: after.local[x]});
  });
  test('6. projeto antigo, com manifesto versão 2: continua versão 2 depois de atualizar a pasta', async () => {
    const root = await project({[x]: sentX}, {}, 2), p = await read(root);
    expect(p.manifest?.version).toBe(2);
    await applyUpdate(await openProject(asFolder(root)), planUpdate(p.baseline, p.local, p.localAssets, reading({...d0, [other]: '<meta name="description" content="Nova">\n'})), p);
    const manifest = JSON.parse(new TextDecoder().decode(contents(root)['.yampi-sync/manifest.json'])) as Manifest;
    // The check the tools exported before version 3 make: version 1 or 2, and the known file fields.
    expect([1, 2]).toContain(manifest.version);
    expect(manifest.files.every(file => Object.keys(file).every(key => ['path', 'sha256', 'bytes', 'kind'].includes(key)))).toBe(true);
    expect((await read(root)).baseline.files[other]).toBe('<meta name="description" content="Nova">\n');
  });
  test('7. a escolha de um trecho continua valendo numa nova leitura da loja, se aquele trecho não mudou', async () => {
    const ours = sentX.replace('Texto novo', 'Texto nosso'), theirs = sentX.replace('Texto novo', 'Texto do cliente');
    const p = await read(await project({[x]: ours})), list = known({[x]: sentX});
    const first = planUpdate(p.baseline, p.local, p.localAssets, reading({...d0, [x]: theirs}), {known: list}).rows.find(item => item.path === x)!;
    const hunks = {[x]: {[first.hunks![0].id]: 'theirs' as const}};
    // Read again later: another file changed in the store, this stretch did not.
    const again = planUpdate(p.baseline, p.local, p.localAssets, reading({...d0, [x]: theirs, [other]: 'mudou\n'}), {known: list, hunks}).rows.find(item => item.path === x)!;
    expect(again).toMatchObject({conflicts: 0, merged: theirs});
    // The stretch changed in the store: the old choice no longer applies.
    const changed = planUpdate(p.baseline, p.local, p.localAssets, reading({...d0, [x]: sentX.replace('Texto novo', 'Outro texto do cliente')}), {known: list, hunks}).rows.find(item => item.path === x)!;
    expect(changed.conflicts).toBe(1);
  });
  test('8. nada com marcações vai para a loja, nem depois de juntar um arquivo com trecho marcado', async () => {
    const ours = sentX.replace('Texto novo', 'Texto nosso'), theirs = sentX.replace('Texto novo', 'Texto do cliente');
    const root = await project({[x]: ours}), p = await read(root);
    const review = makePlan(p.baseline, p.local, {context, capturedAt: '', files: {...d0, [x]: theirs}}, {}, {known: known({[x]: sentX})});
    const row = review.rows.find(item => item.path === x)!, merge = fileMerge(row.base, row.local!, row.remote!);
    expect(merge.conflicts).toBe(1);
    await applyJoin(await openProject(asFolder(root)), p, x, p.local[x], merge.text, theirs);
    const after = await read(root);
    expect(makePlan(after.baseline, after.local, {context, capturedAt: '', files: {...d0, [x]: theirs}}).rows.find(item => item.path === x)).toMatchObject({status: 'blocked-dependency', reason: MARKED});
  });
  test('9. texto que só difere da loja nos caminhos de imagem que o envio reescreve: já está na loja', async () => {
    const folderText = `<img src="{{ 'images/banners/natal.png' | assets_url }}">\n`, storeText = `<img src="{{ 'images/natal.png' | assets_url }}">\n`;
    const p = await read(await project({[x]: folderText}, {'tema/assets/images/banners/natal.png': png(4)}));
    const store = {...d0, [x]: storeText}, storeImages = {'assets/images/natal.png': png(4)};
    expect(makePlan(p.baseline, p.local, {context, capturedAt: '', files: store, assets: storeImages}, p.localAssets).rows.find(row => row.path === x)?.status).toBe('already-applied');
    const plan = planUpdate(p.baseline, p.local, p.localAssets, {...reading(store), assets: storeImages, inventory: [...Object.keys(store), ...Object.keys(storeImages)]});
    expect(kind(plan.rows, x)).toBe('same');
    // A Git version with the folder's paths is recognized in the store, rewritten.
    const ours = folderText.replace('<img', '<img class="banner"');
    const later = await read(await project({[x]: ours}, {'tema/assets/images/banners/natal.png': png(4)}));
    expect(planUpdate(later.baseline, later.local, later.localAssets, {...reading(store), assets: storeImages, inventory: [...Object.keys(store), ...Object.keys(storeImages)]}, {known: known({[x]: folderText})}).rows.find(row => row.path === x)).toMatchObject({kind: 'mine', origin: {kind: 'own'}});
  });
});
describe('recibos de envio e lista de versões na pasta', () => {
  const journal: Journal = {version: 1, id: 'envio-d7-ficticio', context, startedAt: '2026-10-07T10:00:00.000Z', status: 'completed', selected: [x, other], verified: [x], before: {}, after: {[x]: sentX, [other]: 'não conferido\n'}};
  test('o recibo traz só o que foi conferido, e a pasta o reconhece em qualquer computador', async () => {
    const receipt = makeReceipt(journal);
    expect(Object.keys(receipt.files)).toEqual([x]);
    expect(parseReceipt(JSON.parse(JSON.stringify(receipt)))).toEqual(receipt);
    expect(() => parseReceipt({...receipt, files: {[x]: {...receipt.files[x], text: 'mexido'}}})).toThrow('Recibo de envio alterado');
    const foreign = makeReceipt({...journal, context: {...context, storeName: 'Outra loja'}});
    const root = await project({[x]: sentX.replace('Texto novo', 'Ajuste')}, {'.yampi-sync/recibos/d7.json': JSON.stringify(receipt), '.yampi-sync/recibos/outra.json': JSON.stringify(foreign), [KNOWN_FILE]: '{"format":"outro"}'});
    const p = await read(root);
    expect(p.known?.[x]?.[0]).toMatchObject({source: 'recibo', at: journal.startedAt});
    expect(p.notes).toEqual([expect.stringContaining('versoes-conhecidas.json ficou de fora'), expect.stringContaining('outra.json é de outra loja')]);
    expect(kind(planUpdate(p.baseline, p.local, p.localAssets, reading({...d0, [x]: sentX}), {known: p.known}).rows, x)).toBe('mine');
  });
  test('o registro de envios desta instalação conta só os itens conferidos', () => {
    expect(Object.keys(journalKnown([journal]))).toEqual([x]);
  });
});
describe('npm run versoes:conhecidas', () => {
  let temporary: string | undefined;
  afterEach(async () => {if (temporary) await rm(temporary, {recursive: true, force: true}); temporary = undefined;});
  test('lista cada versão que o Git teve de cada texto de tema/, com data e texto', async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'zirtuno-known-'));
    const git = (...args: string[]) => {const result = spawnSync('git', ['-C', temporary!, ...args], {encoding: 'utf8'}); if (result.status !== 0) throw new Error(result.stderr);};
    git('init', '-q'); git('config', 'user.email', 'teste@exemplo.invalid'); git('config', 'user.name', 'Teste'); git('config', 'core.autocrlf', 'false');
    await mkdir(path.join(temporary, 'tema/sections/home'), {recursive: true});
    await writeFile(path.join(temporary, 'tema', x), d0[x]); git('add', '.'); git('commit', '-q', '-m', 'D0');
    await writeFile(path.join(temporary, 'tema', x), sentX.replace(/\n/g, '\r\n')); await writeFile(path.join(temporary, 'tema', created), sentCreated); git('add', '.'); git('commit', '-q', '-m', 'D7');
    const files = await knownVersions(temporary) as Record<string, {sha256: string; at: string; text: string}[]>;
    expect(files[x].map(version => version.sha256).sort()).toEqual([textHash(d0[x]), textHash(sentX)].sort());
    expect(files[x].find(version => version.sha256 === textHash(sentX))?.text).toBe(sentX);
    expect(files[created]).toEqual([{sha256: textHash(sentCreated), at: expect.any(String), text: sentCreated}]);
  });
});
