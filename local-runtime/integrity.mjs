import path from 'node:path';
import {checkIntegrity} from './preview.mjs';
const root = path.resolve(import.meta.dirname, '../..'), args = process.argv.slice(2);
const zip = args.includes('--return-zip') ? args[args.indexOf('--return-zip') + 1] : undefined;
// --original: the theme must equal the export. --return-zip <name>: the return
// ZIP must contain exactly manifest + baseline + tema with the same hashes.
try {
  if (args.includes('--return-zip') && !zip) throw new Error('Informe o nome do ZIP após --return-zip.');
  console.log(JSON.stringify(await checkIntegrity(root, {original: args.includes('--original'), returnZip: zip}), null, 2));
} catch (error) {console.error(error.message); process.exitCode = 1;}
