import {build} from 'esbuild';
import {mkdir, cp, writeFile, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {writeIcons} from './icons.mjs';
import {fontFiles} from './distribution.mjs';
const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
await mkdir(dist, {recursive: true});
// Only these generated files are removed; never touch client files or exports.
for (const name of ['background.js', 'bridge.js', 'panel.js', 'guide.js', 'runner.js', 'zip-worker.js', 'fixture.js']) await rm(path.join(dist, name), {force: true});
await cp(path.join(root, 'extension'), dist, {recursive: true});
await writeIcons(dist);
// Bundled typefaces (SIL OFL 1.1): no font is ever loaded from the network.
await mkdir(path.join(dist, 'fonts'), {recursive: true});
for (const file of fontFiles) await cp(path.join(root, 'node_modules', file.package, 'files', file.name), path.join(dist, 'fonts', file.name));
const raw = {name: 'raw', setup(builder) {
  builder.onResolve({filter: /\?raw$/}, args => ({path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw'}));
  builder.onLoad({filter: /.*/, namespace: 'raw'}, async args => ({contents: await readFile(args.path, 'utf8'), loader: 'text'}));
}};
const common = {bundle: true, target: 'chrome120', sourcemap: false, minify: true, legalComments: 'eof', logLevel: 'warning', plugins: [raw]};
await build({...common, entryPoints: [path.join(root, 'src/browser/background.ts')], outfile: path.join(dist, 'background.js'), format: 'esm'});
await build({...common, entryPoints: [path.join(root, 'src/browser/bridge.ts')], outfile: path.join(dist, 'bridge.js'), format: 'iife', globalName: 'YampiThemeSyncBridge'});
await build({...common, entryPoints: [path.join(root, 'src/panel.ts')], outfile: path.join(dist, 'panel.js'), format: 'esm'});
await build({...common, entryPoints: [path.join(root, 'src/browser/runner.ts')], outfile: path.join(dist, 'runner.js'), format: 'esm'});
await build({...common, entryPoints: [path.join(root, 'src/browser/zip-worker.ts')], outfile: path.join(dist, 'zip-worker.js'), format: 'esm'});
await build({...common, entryPoints: [path.join(root, 'src/guide.ts')], outfile: path.join(dist, 'guide.js'), format: 'esm'});
await build({...common, entryPoints: [path.join(root, 'src/demo/fixture.ts')], outfile: path.join(dist, 'fixture.js'), format: 'esm'});
const html = await readFile(path.join(root, 'extension/panel.html'), 'utf8');
await writeFile(path.join(dist, 'demo.html'), html);
await cp(path.join(root, 'src/demo/fixture.html'), path.join(dist, 'fixture.html'));
let notices = '# Componentes de terceiros\n\nLicenças dos componentes incluídos nos arquivos JavaScript da extensão. Ferramentas usadas apenas para desenvolvimento não são distribuídas no pacote.\n';
for (const name of ['fflate', 'acorn', ...new Set(fontFiles.map(file => file.package))]) {
  const folder = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
  const license = await readFile(path.join(folder, 'LICENSE'), 'utf8');
  notices += `\n## ${name} ${pkg.version}\n\n${license.trim()}\n`;
}
await mkdir(path.join(root, 'docs'), {recursive: true});
const noticesFile=path.join(root,'docs/TERCEIROS.md');
let existingNotices;try{existingNotices=await readFile(noticesFile,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(existingNotices!==notices)await writeFile(noticesFile, notices);
await writeFile(path.join(dist, 'TERCEIROS.md'), notices);
console.log('Build pronto: dist/ (extensão) e http://127.0.0.1:5181/demo.html?demo=1 (teste).');
