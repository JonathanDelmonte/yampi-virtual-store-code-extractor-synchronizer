import {visualStore} from './visual-stores';
import {rocketLike} from './rocket-like';
import {preparePreview,finishPreview} from '../../src/browser/preview-capture';
import {encodeSnapshot} from '../../src/core/archive';
import {fetchPublicResource} from '../../src/browser/public-fetch';
import type {Snapshot} from '../../src/core/model';
export {visualStore};
async function captureStore(snapshot:Snapshot,origins:string[]) {
  const fetcher=async(url:string)=>{const result=await fetchPublicResource(url,origins);return {url:result.url,type:result.type,bytes:Uint8Array.from(atob(result.encoded),c=>c.charCodeAt(0))};};
  const draft=await preparePreview(snapshot,fetcher),preview=await finishPreview(draft,fetcher,origins);
  const zip=await encodeSnapshot(snapshot,true,preview);
  let binary='';for(let i=0;i<zip.length;i+=8192)binary+=String.fromCharCode(...zip.subarray(i,i+8192));
  return {zip:btoa(binary),resources:preview.resources,issues:preview.issues,pages:preview.pages,source:preview.source,aliases:preview.aliases,platform:preview.platform};
}
export async function capture(tone:'dark'|'light') {
  const fixture=visualStore(tone);
  return {...await captureStore(fixture.snapshot,[fixture.snapshot.context.previewOrigin,'https://'+tone+'-cdn.invalid']),expected:fixture.expected};
}
// Real storefront format; served theme CSS is supplied by the Node test runner.
export async function captureRocket() {
  const fixture=rocketLike({flagsRoute:true});
  return captureStore(fixture.snapshot,fixture.origins);
}
