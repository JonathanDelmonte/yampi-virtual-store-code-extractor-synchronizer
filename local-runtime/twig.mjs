// Twing 7.3.1 targets Locutus 2, which has critical advisories. The project pins
// the patched Locutus 3 and adapts only Twing's own require() calls. Every
// adapted export is verified on load; another Twing version fails explicitly.
import {createRequire, registerHooks} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const file = require.resolve('twing'), entry = pathToFileURL(file).href;
const VERIFIED = '7.3.1', INDEX_MEMBERS = {'locutus/php/strings': ['htmlspecialchars'], 'locutus/php/math': ['min', 'max']};
const version = JSON.parse(readFileSync(path.join(path.dirname(file), 'package.json'), 'utf8')).version;
if (version !== VERIFIED) throw new Error(`Twing ${version} não verificado com o adaptador Locutus 3 (esperado ${VERIFIED}). Use o package-lock.json da exportação.`);
export const adaptedLocutus = [...new Set([...readFileSync(file, 'utf8').matchAll(/require\('(locutus\/[^']+)'\)/g)].map(m => m[1]))].sort();
// Locutus 3 exports {name: fn}; Twing 7 expects module.exports = fn.
for (const name of adaptedLocutus) {
  const module = require(INDEX_MEMBERS[name] ? name + '/index' : name), value = module.default || module[name.split('/').at(-1)] || module;
  const valid = INDEX_MEMBERS[name] ? INDEX_MEMBERS[name].every(member => typeof value[member] === 'function') : typeof value === 'function';
  if (!valid) throw new Error('Adaptador Twing/Locutus incompatível: ' + name);
}
// Twig PHP casts booleans to "1"/"" when concatenating and adds numeric strings.
// Twing 7.3.1 prints "true"/"false" and rejects "5" + 1. Exact snippets only.
const SYNC_ADD = 'case "add": {\n            const leftValue = execute(left, executionContext);\n            const leftValueType = typeof leftValue;\n            if (leftValueType === "string") {\n                throw (createRuntimeError(`Unsupported operand type "${leftValueType}"`, left, template.source));\n            }\n            const rightValue = execute(right, executionContext);\n            const rightValueType = typeof rightValue;\n            if (rightValueType === "string") {\n                throw (createRuntimeError(`Unsupported operand type "${rightValueType}"`, right, template.source));\n            }\n            return leftValue + rightValue;\n        }';
const PATCHES = [
  ['    return String(object1) + String(object2);\n', "    return String(object1 === true ? '1' : object1 === false ? '' : object1) + String(object2 === true ? '1' : object2 === false ? '' : object2);\n"],
  [SYNC_ADD, 'case "add": {\n            return phpOperand(execute(left, executionContext), left, template) + phpOperand(execute(right, executionContext), right, template);\n        }'],
];
const PHP_OPERAND = '\nfunction phpOperand(value, node, template) { if (value === undefined || value === null) return 0; if (typeof value !== "string") return value; if (/^\\s*[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?\\s*$/i.test(value)) return Number(value); throw createRuntimeError(`Unsupported operand type "string"`, node, template.source); }\n';
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === entry && /^locutus\/php\/(strings|math)$/.test(specifier)) specifier += '/index';
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== entry) return next(url, context);
    let source = readFileSync(fileURLToPath(url), 'utf8').replace(/require\(('locutus\/[^']+')\)/g, 'localLocutus($1)');
    for (const [from, to] of PATCHES) {
      if (source.split(from).length !== 2) throw new Error('Twing 7.3.1 com conteúdo inesperado; adaptação ao Twig PHP não aplicada.');
      source = source.split(from).join(to);
    }
    return {format: 'commonjs', shortCircuit: true, source: source + PHP_OPERAND + '\nfunction localLocutus(p) { const m = require(p); return m.default || m[p.split("/").at(-1)] || m; }\n'};
  }
});
let twing;
try {twing = require('twing');} finally {hooks.deregister();}
export const {createSynchronousEnvironment, createSynchronousArrayLoader, createSynchronousFilter, createSynchronousFunction} = twing;
