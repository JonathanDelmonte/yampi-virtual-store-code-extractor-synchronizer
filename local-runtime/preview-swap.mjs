import path from 'node:path';
import {readFile, writeFile, mkdir, rm, rename, lstat, realpath} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {readProject} from './engine.mjs';
import {loadPreview, capturesByKind} from './preview.mjs';
// Puts a new preview/ in place from a ZIP of the extension: "Baixar a prévia nova", after
// "Atualizar da loja", or a whole new export of the same store. The extension never writes
// preview/ in the project folder; this tool does, and only there. The new capture is checked in
// full (store, hashes, format) before anything moves; the previous preview/ goes to
// .yampi-sync/updates/<date>-previa/ and can be moved back by hand. tema/ is never touched.
const MAX_ZIP = 80 * 1024 * 1024, MAX_ENTRIES = 4000;
const exists = async target => {try {return await lstat(target);} catch (error) {if (error.code === 'ENOENT') return undefined; throw error;}};
export async function swapPreview(root, zipPath) {
  if (!zipPath) throw new Error('Informe o ZIP da prévia: npm run previa:trocar -- previa-loja.zip');
  const project = await readProject(root), base = await realpath(root);
  const bytes = await readFile(path.resolve(root, zipPath));
  if (bytes.length > MAX_ZIP) throw new Error('ZIP da prévia grande demais.');
  const entries = unzipSync(new Uint8Array(bytes)), names = Object.keys(entries).filter(name => !name.endsWith('/'));
  if (names.length > MAX_ENTRIES) throw new Error('ZIP da prévia com arquivos demais.');
  const manifests = names.filter(name => name === 'preview/manifest.json' || name.endsWith('/preview/manifest.json'));
  if (manifests.length !== 1) throw new Error('Use um ZIP baixado pela extensão, com preview/manifest.json.');
  const prefix = manifests[0].slice(0, -'preview/manifest.json'.length), files = [];
  for (const name of names) {
    if (!name.startsWith(prefix + 'preview/')) continue;
    const relative = name.slice(prefix.length);
    if (relative.length > 300 || /[\\\u0000-\u001f:<>"|?*]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Caminho inseguro na prévia: ' + relative);
    files.push([relative, entries[name]]);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), staging = path.join(base, '.cache', 'previa-nova-' + stamp);
  const current = path.join(base, 'preview'), before = await exists(current);
  if (before && !before.isDirectory()) throw new Error('preview/ não é uma pasta comum; nada foi trocado.');
  await mkdir(staging, {recursive: true});
  try {
    for (const [relative, content] of files) {const target = path.join(staging, relative); await mkdir(path.dirname(target), {recursive: true}); await writeFile(target, content, {flag: 'wx'});}
    // The same checks npm run dev makes: this store, hashes and sizes, format.
    const loaded = await loadPreview(staging, project);
    if (loaded.version < 2) throw new Error('A prévia do ZIP usa um formato antigo.');
    let backup = null;
    if (before) {
      backup = path.join('.yampi-sync', 'updates', stamp + '-previa');
      await mkdir(path.join(base, backup), {recursive: true});
      await rename(current, path.join(base, backup, 'preview'));
    }
    await rename(path.join(staging, 'preview'), current);
    return {capturedAt: loaded.capturedAt, source: loaded.source.kind, pages: loaded.pages.length, byKind: capturesByKind(loaded, 0).map(({name, count}) => ({name, count})), backup: backup && backup.split(path.sep).join('/')};
  } finally {await rm(staging, {recursive: true, force: true});}
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const root = path.resolve(import.meta.dirname, '../..');
  try {
    const result = await swapPreview(root, process.argv[2]);
    console.log(`Prévia trocada: captura de ${result.capturedAt}, ${result.pages} páginas (${result.byKind.map(group => `${group.count} ${group.name.toLowerCase()}`).join(', ')}).`);
    console.log(result.backup ? `A prévia anterior está em ${result.backup}/preview. tema/ não mudou.` : 'Não havia prévia anterior. tema/ não mudou.');
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
