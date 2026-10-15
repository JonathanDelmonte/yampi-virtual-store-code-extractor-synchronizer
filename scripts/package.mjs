import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {zipSync} from 'fflate';
import {createHash} from 'node:crypto';
import {extensionFiles} from './distribution.mjs';
const root = path.resolve(import.meta.dirname, '..');
const entries = Object.create(null);
// Allowlist excludes the development demo, source, dependencies, and any client exports.
for (const name of extensionFiles) entries[name] = new Uint8Array(await readFile(path.join(root, 'dist', name)));
entries['INSTRUCOES.md'] = new Uint8Array(await readFile(path.join(root, 'docs/INSTALACAO.md')));
entries['TERCEIROS.md'] = new Uint8Array(await readFile(path.join(root, 'docs/TERCEIROS.md')));
const bytes = zipSync(entries, {level: 6});
// Temporary distribution artifacts. The durable download is the GitHub release.
// Installed unpacked folders are separate and must never be removed here.
const out = path.join(root, '.cache', 'package');
await mkdir(out, {recursive: true});
const {version} = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
const sha256 = createHash('sha256').update(bytes).digest('hex');
for (const name of [`zirtuno-sync-yampi-${version}.zip`, 'zirtuno-sync-yampi.zip']) {
  await writeFile(path.join(out, name), bytes);
  await writeFile(path.join(out, name + '.sha256'), sha256 + '  ' + name + '\n');
}
// Keep the unpacked installation at the same path across future versions.
const installed = path.join(root, 'releases', 'zirtuno-sync-yampi');
for (const [name, contents] of Object.entries(entries)) {
  const target = path.join(installed, name);
  await mkdir(path.dirname(target), {recursive: true});
  await writeFile(target, contents);
}
console.log(`Extensão ${version} pronta para carregar no Chrome: releases/zirtuno-sync-yampi/`);
console.log('Download para o GitHub: .cache/package/zirtuno-sync-yampi.zip e .zip.sha256');
console.log(`Pacote com versão: .cache/package/zirtuno-sync-yampi-${version}.zip`);
