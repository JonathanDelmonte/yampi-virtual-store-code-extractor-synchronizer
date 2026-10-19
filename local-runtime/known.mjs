// npm run versoes:conhecidas — every version each text of tema/ had in the project's Git history, in
// .yampi-sync/versoes-conhecidas.json. The extension never reads Git; it reads this list. A store
// text equal to one of these versions is the project's own (sent earlier, from any computer), not a
// change made by someone else, and the closest one is the right base for merging a real change.
// Run in the project folder, or pass it: node .yampi-sync/tools/known.mjs "caminho/do/projeto".
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const SEPARATOR = String.fromCharCode(1), MAX_TEXT = 2 * 1024 * 1024;
const BINARY = /\.(png|jpe?g|webp|svg|gif|ico|woff2?|ttf|otf|eot|zip)$/i;
export async function knownVersions(root) {
  const git = (args, input) => {
    const result = spawnSync('git', ['-c', 'core.quotepath=off', '-C', root, ...args], {input, maxBuffer: 1 << 30});
    if (result.error || result.status !== 0) throw new Error((result.stderr?.toString() || result.error?.message || 'git falhou').trim());
    return result.stdout;
  };
  const top = git(['rev-parse', '--show-toplevel']).toString().trim();
  const prefix = path.relative(path.resolve(top), path.resolve(root, 'tema')).split(path.sep).join('/');
  if (prefix.startsWith('..')) throw new Error('tema/ não está dentro do repositório Git desta pasta.');
  // Each commit that touched tema/, with its date and the files it changed.
  const log = git(['log', '--format=%x01%H%x09%cI', '--name-only', '--', prefix + '/']).toString();
  const wanted = [];
  for (const block of log.split(SEPARATOR).slice(1)) {
    const [head, ...names] = block.split('\n'), [commit, at] = head.split('\t');
    for (const name of names) if (name.startsWith(prefix + '/') && !BINARY.test(name)) wanted.push({commit, at, file: name});
  }
  const files = {};
  if (!wanted.length) return files;
  // One git process for every version: "<sha> blob <size>\n<bytes>\n", or "<name> missing" for a deletion.
  const output = git(['cat-file', '--batch'], wanted.map(item => `${item.commit}:${item.file}`).join('\n') + '\n');
  let offset = 0;
  for (const item of wanted) {
    const end = output.indexOf(10, offset), header = output.subarray(offset, end).toString();
    offset = end + 1;
    if (header.endsWith(' missing')) continue;
    const size = Number(header.split(' ')[2]), bytes = output.subarray(offset, offset + size);
    offset += size + 1;
    if (size > MAX_TEXT || bytes.includes(0)) continue;
    let text;
    try {text = new TextDecoder('utf-8', {fatal: true}).decode(bytes).replace(/\r\n?/g, '\n');} catch {continue;}
    const relative = item.file.slice(prefix.length + 1), sha256 = createHash('sha256').update(text).digest('hex');
    const list = files[relative] ||= [], same = list.find(version => version.sha256 === sha256);
    if (!same) list.push({sha256, at: item.at, text});
    else if (item.at > same.at) same.at = item.at;
  }
  return files;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))) {
  const root = path.resolve(process.argv[2] || process.cwd());
  try {
    const files = await knownVersions(root), count = Object.values(files).reduce((sum, list) => sum + list.length, 0);
    await writeFile(path.join(root, '.yampi-sync/versoes-conhecidas.json'), JSON.stringify({format: 'zirtuno-sync-versoes-conhecidas', version: 1, generatedAt: new Date().toISOString(), files}, null, 2) + '\n');
    console.log(`${count} versões de ${Object.keys(files).length} arquivos de tema/ em .yampi-sync/versoes-conhecidas.json. Leia a pasta de novo na extensão.`);
  } catch (error) {
    console.error(`Não foi possível listar as versões conhecidas: ${error.message}`);
    process.exitCode = 1;
  }
}
