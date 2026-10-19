import {describe, test, expect} from 'vitest';
import {openProject} from '../src/panel/folder';
import {listVersions, objectPath, restoreVersion, saveVersion, versionChanges, versionFiles} from '../src/core/versions';
import {projectPath, PENDING} from '../src/core/project-folder';
import {context} from './fixtures/fake-editor';
import {asFolder, contents, memoryFolder, text} from './fixtures/memory-folder';
const banner = 'sections/home/banner.twig', head = 'elements/head.twig';
const project = (files: Record<string, string>) => memoryFolder('loja-ficticia', {'.yampi-sync/manifest.json': '{}', ...Object.fromEntries(Object.entries(files).map(([path, value]) => [`tema/${path}`, value]))});
const natal = {[banner]: '<section>Banner de Natal</section>\n', [head]: '<meta name="description" content="Natal">\n'};
describe('versões do projeto na própria pasta', () => {
  test('nomeada pelo usuário: lista, conteúdo conferido e só os textos que mudaram ocupam espaço', async () => {
    const root = project(natal), folder = await openProject(asFolder(root));
    const first = await saveVersion(folder, {kind: 'manual', origin: 'pasta', label: 'Banner de Natal — aprovado', context, files: natal});
    const second = await saveVersion(folder, {kind: 'manual', origin: 'pasta', label: 'Depois do Natal', context, files: {...natal, [banner]: '<section>Banner de verão</section>\n'}});
    expect(first.created && second.created).toBe(true);
    const objects = Object.keys(contents(root)).filter(path => path.includes('/objetos/'));
    expect(objects).toHaveLength(3);
    const {versions} = await listVersions(folder, context);
    expect(versions.map(version => version.label)).toEqual(['Depois do Natal', 'Banner de Natal — aprovado']);
    expect(await versionFiles(folder, versions[1])).toEqual(natal);
    expect(versionChanges(natal, {...natal, [banner]: 'outro\n', 'elements/novo.twig': 'x'})).toEqual([{path: 'elements/novo.twig', change: 'added-since'}, {path: banner, change: 'changed'}]);
    expect(versionChanges(natal, {[head]: natal[head]})).toEqual([{path: banner, change: 'missing-now'}]);
  });
  test('automática igual à última da mesma origem não se repete; nomeada sempre é guardada', async () => {
    const folder = await openProject(asFolder(project(natal)));
    const one = await saveVersion(folder, {kind: 'antes-de-atualizar', origin: 'pasta', label: 'Pasta antes de atualizar', context, files: natal});
    const again = await saveVersion(folder, {kind: 'antes-de-restaurar', origin: 'pasta', label: 'Antes de trazer', context, files: natal});
    expect(again).toEqual({version: one.version, created: false});
    expect((await saveVersion(folder, {kind: 'loja', origin: 'loja', label: 'Loja', context, files: natal})).created).toBe(true);
    expect((await saveVersion(folder, {kind: 'manual', origin: 'pasta', label: 'De novo', context, files: natal})).created).toBe(true);
    expect((await listVersions(folder, context)).versions).toHaveLength(3);
  });
  test('texto alterado, versão de outra loja ou registro estragado nunca aparecem como histórico válido', async () => {
    const root = project(natal), folder = await openProject(asFolder(root));
    const {version} = await saveVersion(folder, {kind: 'manual', origin: 'pasta', label: 'Natal', context, files: natal});
    await saveVersion(folder, {kind: 'manual', origin: 'pasta', label: 'Outra loja', context: {...context, storeName: 'Outra loja fictícia'}, files: natal});
    await folder.write('.yampi-sync/versoes/quebrado.json', new TextEncoder().encode('{"format":"zirtuno-sync-versao"'));
    const listed = await listVersions(folder, context);
    expect(listed.versions.map(item => item.label)).toEqual(['Natal']);
    expect(listed.skipped).toHaveLength(2);
    await folder.write(objectPath(version.files.find(file => file.path === banner)!.sha256), new TextEncoder().encode('<section>Mexido</section>\n'));
    await expect(versionFiles(folder, version)).rejects.toThrow(`está incompleta ou foi alterada: ${banner}`);
  });
  test('trazer de uma versão: guarda a pasta antes, recria o que foi apagado e mantém as quebras de linha', async () => {
    const now = {[banner]: '<section>Banner de verão</section>\r\n'};
    const root = project(now), folder = await openProject(asFolder(root));
    const {version} = await saveVersion(folder, {kind: 'manual', origin: 'pasta', label: 'Natal', context, files: natal});
    const current = {[banner]: '<section>Banner de verão</section>\n'};
    const {restored, safety} = await restoreVersion(folder, version, [banner, head], current);
    expect(restored).toEqual([banner, head]);
    expect(text(contents(root)[`tema/${banner}`])).toBe('<section>Banner de Natal</section>\r\n');
    expect(text(contents(root)[`tema/${head}`])).toBe(natal[head]);
    expect(safety.kind).toBe('antes-de-restaurar');
    expect(await versionFiles(folder, safety)).toEqual(current);
  });
  test('trazer recusa arquivo mudado depois da leitura, sem gravar nada', async () => {
    const root = project({[banner]: 'editado no VS Code\n'}), folder = await openProject(asFolder(root));
    const {version} = await saveVersion(folder, {kind: 'manual', origin: 'pasta', label: 'Natal', context, files: natal});
    const before = root.writes.length;
    await expect(restoreVersion(folder, version, [banner], {[banner]: 'como a pasta foi lida\n'})).rejects.toThrow('mudou depois da leitura');
    expect(root.writes.length).toBe(before);
  });
  test('a extensão só grava em tema/ e nos seus registros de .yampi-sync/', async () => {
    for (const path of ['tema/sections/home/banner.twig', '.yampi-sync/baseline/elements/head.twig', '.yampi-sync/manifest.json', PENDING, '.yampi-sync/versoes/20261019-010203-004-manual-1a2b3c4d.json', `.yampi-sync/versoes/objetos/ab/${'ab'.padEnd(64, '0')}`]) expect(projectPath(path)).toBe(path);
    for (const path of ['package.json', 'local.config.json', '.yampi-sync/tools/dev.mjs', 'preview/manifest.json', 'tema/../package.json', 'tema/node_modules/x.js', '.yampi-sync/versoes/../manifest.json', '.yampi-sync/versoes/a/b/c/d.json', 'tema/sections/con.twig']) expect(() => projectPath(path), path).toThrow();
    const folder = await openProject(asFolder(project(natal)));
    await expect(folder.write('package.json', new Uint8Array())).rejects.toThrow('Caminho fora');
    await expect(folder.list('preview')).rejects.toThrow('Pasta fora');
  });
  test('pasta de tema solta, sem .yampi-sync/, não recebe versões', async () => {
    await expect(openProject(asFolder(memoryFolder('tema', {[banner]: 'x'})))).rejects.toThrow('não tem .yampi-sync/');
  });
});
