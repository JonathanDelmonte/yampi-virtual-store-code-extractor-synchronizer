import {describe, test, expect, afterEach} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {unzipSync} from 'fflate';
import {encodeSnapshot, readProjectEntries, type Project} from '../src/core/archive';
import {folderEntries, openProject} from '../src/panel/folder';
import {applyUpdate, planUpdate, type Resolution} from '../src/core/update';
import {listVersions, versionFiles} from '../src/core/versions';
import {makePlan, MARKED} from '../src/core/planner';
import {MARKS, hasConflictMarks} from '../src/core/merge';
import {PENDING} from '../src/core/project-folder';
import type {Capture} from '../src/core/workflow';
import type {Files} from '../src/core/model';
// @ts-expect-error -- plain JavaScript of the project's local tools, without type declarations.
import {readProject} from '../local-runtime/engine.mjs';
import {context, png} from './fixtures/fake-editor';
import {asFolder, contents, memoryFolder, text, type MemoryDir} from './fixtures/memory-folder';
const lines = (...items: string[]) => items.map(item => item + '\n').join('');
const banner = 'sections/home/banner.twig', vitrine = 'sections/home/vitrine.twig', head = 'elements/head.twig', scss = 'assets/styles/global/main.scss';
const antigo = 'components/Antigo.vue', rodape = 'elements/rodape.twig', nova = 'sections/home/nova.twig', minha = 'sections/home/minha.twig', home = 'templates/home.twig';
// The store when the project was downloaded (fictitious).
const original: Files = {
  [banner]: lines('<section class="banner">', '  <div class="faixa">Frete grátis</div>', '  <h1>Coleção de verão</h1>', '  <p>Peças leves</p>', '</section>'),
  [vitrine]: lines('<section>', '  <h2>Mais vendidos</h2>', '</section>'),
  [home]: lines('<main>', '{% include "sections/home/banner.twig" %}', '{% include "sections/home/vitrine.twig" %}', '</main>'),
  [head]: '<meta name="description" content="Loja fictícia">\n',
  [scss]: '$cor: #222;\nbody { color: $cor; }\n',
  [antigo]: '<template><div>antigo</div></template>\n',
  [rodape]: '<footer>Rodapé</footer>\n'
};
const images = {'assets/images/banner.png': png(1), 'assets/images/logo.png': png(2)};
// What the developer changed in the folder since.
const edits: Record<string, string | undefined> = {
  [banner]: original[banner].replace('Peças leves', 'Peças leves e frescas'),
  [vitrine]: original[vitrine].replace('Mais vendidos', 'Mais vendidos da semana'),
  [scss]: original[scss].replace('#222', '#111'),
  [rodape]: '<footer>Rodapé com redes sociais</footer>\n',
  [minha]: '<section>Seção nova da pasta</section>\n'
};
// What the client changed in the store since: removed the "faixa" block, renamed the showcase,
// changed the head, removed two files, added one and replaced the banner image.
const storeFiles: Files = {
  [banner]: original[banner].replace('  <div class="faixa">Frete grátis</div>\n', ''),
  [vitrine]: original[vitrine].replace('Mais vendidos', 'Destaques'),
  [home]: original[home],
  [head]: '<meta name="description" content="Loja fictícia — nova descrição">\n',
  [scss]: original[scss],
  [nova]: '<section>Seção criada pelo cliente</section>\n'
};
const storeImages = {'assets/images/banner.png': png(3), 'assets/images/logo.png': png(2)};
const reading = (files = storeFiles, assets = storeImages): Capture => ({context, capturedAt: '2026-10-18T15:00:00.000Z', files, assets, inventory: [...Object.keys(files), ...Object.keys(assets)].sort()});
async function exported(local: Record<string, string | undefined> = edits, localImages: Record<string, Uint8Array> = {'assets/images/meu.png': png(9)}): Promise<MemoryDir> {
  const entries: Record<string, string | Uint8Array> = unzipSync(await encodeSnapshot({context, capturedAt: '2026-10-01T12:00:00.000Z', files: original, assets: images}));
  for (const [file, value] of Object.entries(local)) if (value === undefined) delete entries[`tema/${file}`]; else entries[`tema/${file}`] = value;
  for (const [file, bytes] of Object.entries(localImages)) entries[`tema/${file}`] = bytes;
  return memoryFolder('loja-ficticia', entries);
}
async function read(root: MemoryDir): Promise<Project> {return await readProjectEntries((await folderEntries(asFolder(root))).entries) as Project;}
async function update(root: MemoryDir, choices: Record<string, Resolution> = {}) {
  const project = await read(root), plan = planUpdate(project.baseline, project.local, project.localAssets, reading(), choices);
  return {project, plan, result: await applyUpdate(await openProject(asFolder(root)), plan, project)};
}
let temporary: string | undefined;
afterEach(async () => {if (temporary) await rm(temporary, {recursive: true, force: true}); temporary = undefined;});
describe('atualizar a pasta do projeto com as mudanças da loja', () => {
  test('cada arquivo recebe o que a loja mudou, sem perder o trabalho da pasta', async () => {
    const root = await exported(), project = await read(root);
    const plan = planUpdate(project.baseline, project.local, project.localAssets, reading());
    expect(Object.fromEntries(plan.rows.map(row => [row.path, row.kind]))).toEqual({
      [antigo]: 'removed', 'assets/images/banner.png': 'store', 'assets/images/logo.png': 'same', 'assets/images/meu.png': 'mine', [scss]: 'mine',
      [rodape]: 'removed-edited', [head]: 'store', [banner]: 'merged', [minha]: 'mine', [nova]: 'store', [vitrine]: 'conflict', [home]: 'same'
    });
    expect(plan.rows.find(row => row.path === rodape)?.resolution).toBe('store');
    const result = await applyUpdate(await openProject(asFolder(root)), plan, project);
    expect(result.marked).toEqual([vitrine]);
    const after = await read(root);
    // The client removed the "faixa" block; the folder's change to the text stays.
    expect(after.local[banner]).toBe(lines('<section class="banner">', '  <h1>Coleção de verão</h1>', '  <p>Peças leves e frescas</p>', '</section>'));
    expect(after.local[vitrine]).toBe(lines('<section>', MARKS.local, '  <h2>Mais vendidos da semana</h2>', MARKS.split, '  <h2>Destaques</h2>', MARKS.store, '</section>'));
    expect(after.local[head]).toBe(storeFiles[head]);
    expect(after.local[scss]).toBe(edits[scss]);
    expect(after.local[nova]).toBe(storeFiles[nova]);
    expect(after.local[minha]).toBe(edits[minha]);
    expect(after.local[antigo]).toBeUndefined();
    expect(after.local[rodape]).toBeUndefined();
    expect(after.localAssets['assets/images/banner.png']).toEqual(png(3));
    expect(after.localAssets['assets/images/meu.png']).toEqual(png(9));
    // The reference is now the store as read, written in the folder itself, and the local tools still read it.
    expect(after.baseline.files).toEqual(storeFiles);
    expect(after.baseline.assets).toEqual(storeImages);
    expect(after.baseline.capturedAt).toBe('2026-10-18T15:00:00.000Z');
    expect(after.manifest?.reference).toMatchObject({reason: 'update'});
    expect(after.interrupted).toBeUndefined();
    expect(contents(root)[PENDING]).toBeUndefined();
    temporary = await mkdtemp(path.join(os.tmpdir(), 'zirtuno-update-'));
    for (const [file, bytes] of Object.entries(contents(root))) {await mkdir(path.dirname(path.join(temporary, file)), {recursive: true}); await writeFile(path.join(temporary, file), bytes);}
    expect(Object.keys((await readProject(temporary)).baseline).sort()).toEqual([...Object.keys(storeFiles), ...Object.keys(storeImages)].sort());
    // The next comparison: the unresolved conflict never goes; the folder's own work is ready; the store's is applied.
    const next = makePlan(after.baseline, after.local, {context, capturedAt: '2026-10-18T15:00:00.000Z', files: storeFiles, assets: storeImages}, after.localAssets);
    const status = (file: string) => next.rows.find(row => row.path === file);
    expect(status(vitrine)).toMatchObject({status: 'blocked-dependency', reason: MARKED});
    expect(status(scss)?.status).toBe('update');
    expect(status(banner)?.status).toBe('update');
    expect(status(head)?.status).toBe('unchanged');
    expect(status(minha)?.status).toBe('create');
    expect(status(nova)?.status).toBe('unchanged');
  });
  test('antes de mudar a pasta, guarda versões da referência, da pasta e da loja; sem imagens', async () => {
    const root = await exported(), {project, result} = await update(root), access = await openProject(asFolder(root));
    const {versions, skipped} = await listVersions(access, context);
    expect(skipped).toEqual([]);
    expect(versions.map(version => [version.kind, version.origin]).sort()).toEqual([['antes-de-atualizar', 'pasta'], ['loja', 'loja'], ['referencia', 'loja']]);
    expect(result.versions.map(version => version.id).sort()).toEqual(versions.map(version => version.id).sort());
    expect(await versionFiles(access, versions.find(version => version.kind === 'antes-de-atualizar')!)).toEqual(project.local);
    expect(await versionFiles(access, versions.find(version => version.kind === 'referencia')!)).toEqual(original);
    expect(await versionFiles(access, versions.find(version => version.kind === 'loja')!)).toEqual(storeFiles);
    // Each text stored once, by hash; no image bytes anywhere in the versions.
    const stored = Object.entries(contents(root)).filter(([file]) => file.startsWith('.yampi-sync/versoes/objetos/'));
    const distinct = new Set([...Object.values(project.local), ...Object.values(original), ...Object.values(storeFiles)]);
    expect(stored.length).toBe(distinct.size);
    expect(stored.some(([, bytes]) => bytes[0] === 0x89 && bytes[1] === 0x50)).toBe(false);
  });
  test('arquivo mudado na pasta depois da leitura: nada é gravado', async () => {
    const root = await exported(), project = await read(root);
    const plan = planUpdate(project.baseline, project.local, project.localAssets, reading());
    const changed = {...project, local: {...project.local, [head]: '<meta name="description" content="editado agora">\n'}};
    await expect(applyUpdate(await openProject(asFolder(root)), plan, changed)).rejects.toThrow(`tema/${head} mudou depois da leitura`);
    expect(root.writes).toEqual([]); expect(root.removals).toEqual([]);
  });
  test('escolhas: manter a sua, usar a da loja, manter o arquivo que a loja removeu', async () => {
    const root = await exported();
    await update(root, {[vitrine]: 'mine', [rodape]: 'mine'});
    let after = await read(root);
    expect(after.local[vitrine]).toBe(edits[vitrine]);
    expect(after.local[rodape]).toBe(edits[rodape]);
    // "Keep mine" is explicit: the next send replaces the store's version (which the send backs up).
    expect(makePlan(after.baseline, after.local, {context, capturedAt: '', files: storeFiles}).rows.find(row => row.path === vitrine)?.status).toBe('update');
    const other = await exported();
    await update(other, {[vitrine]: 'store'});
    after = await read(other);
    expect(after.local[vitrine]).toBe(storeFiles[vitrine]);
  });
  test('arquivo apagado na pasta e mudado na loja volta com a versão da loja', async () => {
    const root = await exported({...edits, [head]: undefined}), project = await read(root);
    const plan = planUpdate(project.baseline, project.local, project.localAssets, reading());
    expect(plan.rows.find(row => row.path === head)).toMatchObject({kind: 'deleted-changed', resolution: 'store'});
    await applyUpdate(await openProject(asFolder(root)), plan, project);
    expect((await read(root)).local[head]).toBe(storeFiles[head]);
  });
  test('arquivo ainda com marcações não é juntado de novo, e a referência dele não avança', async () => {
    const root = await exported();
    await update(root);
    const newer = {...storeFiles, [vitrine]: original[vitrine].replace('Mais vendidos', 'Lançamentos')};
    const project = await read(root), plan = planUpdate(project.baseline, project.local, project.localAssets, reading(newer));
    expect(plan.rows.find(row => row.path === vitrine)?.kind).toBe('marked');
    await applyUpdate(await openProject(asFolder(root)), plan, project);
    const after = await read(root);
    expect(after.local[vitrine]).toBe(project.local[vitrine]);
    expect(after.local[vitrine].split(MARKS.local).length).toBe(2);
    expect(after.baseline.files[vitrine]).toBe(storeFiles[vitrine]);
    // Once resolved, the newer store change is a conflict to decide, never silently replaced.
    const resolved = {...after.local, [vitrine]: edits[vitrine]!};
    expect(makePlan(after.baseline, resolved, {context, capturedAt: '', files: newer}).rows.find(row => row.path === vitrine)?.status).toBe('conflict');
  });
  test('parada no meio da referência: a pasta continua legível e a próxima atualização termina', async () => {
    const root = await exported();
    let count = 0;
    root.failWrite = file => file.startsWith('.yampi-sync/baseline/') && ++count === 2;
    await expect(update(root)).rejects.toThrow('Gravação interrompida');
    root.failWrite = undefined;
    expect(contents(root)[PENDING]).toBeDefined();
    const interrupted = await read(root);
    expect(interrupted.interrupted).toBe(true);
    // tema/ was finished before the reference: the files the update brought are already there.
    expect(interrupted.local[head]).toBe(storeFiles[head]);
    const plan = planUpdate(interrupted.baseline, interrupted.local, interrupted.localAssets, reading());
    expect(plan.rows.filter(row => ['conflict', 'removed-edited', 'deleted-changed'].includes(row.kind))).toEqual([]);
    await applyUpdate(await openProject(asFolder(root)), plan, interrupted);
    const after = await read(root);
    expect(after.interrupted).toBeUndefined();
    expect(contents(root)[PENDING]).toBeUndefined();
    expect(after.local[vitrine].split(MARKS.local).length).toBe(2);
    expect(hasConflictMarks(after.local[vitrine])).toBe(true);
  });
  test('uma leitura parcial da loja não serve para atualizar', () => {
    expect(() => planUpdate({context, capturedAt: '', files: original}, original, {}, {...reading(), partial: true})).toThrow('leitura completa');
  });
});
describe('referência alterada sem marcação', () => {
  test('um original adulterado continua recusado', async () => {
    const entries = contents(await exported({}, {}));
    entries[`.yampi-sync/baseline/${head}`] = new TextEncoder().encode('adulterado\n');
    await expect(read(memoryFolder('loja-ficticia', entries))).rejects.toThrow(`Baseline ausente ou alterada: ${head}`);
    expect(text(entries[`tema/${head}`])).toBe(original[head]);
  });
});
describe('envios da própria extensão não viram conflito', () => {
  test('a loja tem o que a extensão enviou e a pasta continuou dali: fica a da pasta, sem conflito', async () => {
    // The reference is the old download; the store holds an earlier send of the folder's own text.
    const sentHead = '<meta name="description" content="Enviado pela extensão">\n';
    const later = sentHead.replace('Enviado pela extensão', 'Enviado e depois ajustado');
    const root = await exported({[head]: later}, {}), project = await read(root);
    const store = {...original, [head]: sentHead};
    const without = planUpdate(project.baseline, project.local, project.localAssets, reading(store, images));
    expect(without.rows.find(row => row.path === head)?.kind).toBe('conflict');
    const withHistory = planUpdate(project.baseline, project.local, project.localAssets, reading(store, images), {}, {[head]: ['outro texto antigo\n', sentHead]});
    expect(withHistory.rows.find(row => row.path === head)).toMatchObject({kind: 'mine'});
    // A text the store has that the extension never sent is still the client's change.
    expect(planUpdate(project.baseline, project.local, project.localAssets, reading(store, images), {}, {[head]: ['outro texto\n']}).rows.find(row => row.path === head)?.kind).toBe('conflict');
  });
});
