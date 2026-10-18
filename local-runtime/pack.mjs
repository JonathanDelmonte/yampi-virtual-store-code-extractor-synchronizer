import path from 'node:path';
import {writeFile, access} from 'node:fs/promises';
import {zipSync, strToU8} from 'fflate';
import {readProject, digest} from './engine.mjs';
import {dependencyReport} from './dependencies.mjs';
export async function packProject(root) {
  const {manifest, baseline, files} = await readProject(root);
  const entries = Object.create(null);
  entries['.yampi-sync/manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  for (const [name, value] of Object.entries(baseline)) entries['.yampi-sync/baseline/' + name] = value;
  for (const [name, value] of Object.entries(files)) entries['tema/' + name] = value;
  // Lossless ZIP STORE avoids recompressing PNG/JPEG/WebP; originals stay intact.
  const input=Object.fromEntries(Object.entries(entries).map(([name,bytes])=>[name,/\.(?:png|jpe?g|webp|woff2)$/i.test(name)?[bytes,{level:0}]:bytes]));
  return zipSync(input, {level: 6});
}
// Added files are created by the extension; the comparison there shows anything it cannot create.
export async function returnSummary(root) {
  const {manifest, baseline, files} = await readProject(root);
  const modified = manifest.files.filter(f => files[f.path] && digest(files[f.path]) !== f.sha256).map(f => f.path);
  const added = Object.keys(files).filter(p => !baseline[p]).sort();
  const texts = Object.fromEntries(Object.entries(files).filter(([p]) => /\.(?:twig|vue|s?css)$/.test(p)).map(([p, b]) => [p, b.toString('utf8')]));
  return {modified, added, ...dependencyReport({targets: modified, texts, local: Object.keys(files), remote: Object.keys(baseline)})};
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const root = path.resolve(import.meta.dirname, '../..'), bytes = await packProject(root), summary = await returnSummary(root);
    let name = 'retorno-yampi.zip';
    try {await access(path.join(root, name)); name = `retorno-yampi-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;} catch (error) {if (error.code !== 'ENOENT') throw error;}
    await writeFile(path.join(root, name), bytes, {flag: 'wx'});
    await writeFile(path.join(root, name + '.sha256'), digest(bytes) + '  ' + name + '\n', {flag: 'wx'});
    console.log(`Pronto: ${name}. ${summary.modified.length} modificados; ${summary.added.length} adicionados. Ao enviar, a extensão cria os textos novos em pastas que já existem na loja e envia as imagens novas para assets/images, ajustando as referências.`);
    for (const warning of summary.warnings) console.log(`Aviso: ${warning.path} — ${warning.message}`);
    console.log('Importe este ZIP na extensão e compare com a loja.');
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
