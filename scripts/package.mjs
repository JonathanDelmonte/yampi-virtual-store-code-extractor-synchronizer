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
const name = `zirtuno-sync-yampi-${version}.zip`;
await writeFile(path.join(out, name), bytes);
await writeFile(path.join(out, name + '.sha256'), createHash('sha256').update(bytes).digest('hex') + '  ' + name + '\n');
console.log('Pacote temporário pronto: .cache/package/' + name);
