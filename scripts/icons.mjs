import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {iconSizes} from './distribution.mjs';
// Resize the exact owner-provided logo locally; preserve its proportions and alpha.
// sharp is a development dependency and is never shipped in the extension.
const source = path.resolve(import.meta.dirname, '../assets/zirtuno-sync-yampi-logo.png');
export async function writeIcons(dist) {
  const directory=path.join(dist,'icons');await mkdir(directory,{recursive:true});
  for(const size of iconSizes) await sharp(source)
    .resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}})
    .png().toFile(path.join(directory,`icon${size}.png`));
  const brand=path.join(dist,'brand');await mkdir(brand,{recursive:true});
  // A 72px rendition is sufficient for the 18px signature at 4x density.
  // Preserve the original in assets; only the small rendition is distributed.
  await sharp(path.resolve(import.meta.dirname,'../assets/zirtuno-logo-source.png'))
    .resize(72,72,{fit:'inside',withoutEnlargement:true}).png()
    .toFile(path.join(brand,'zirtuno-logo.png'));
}
