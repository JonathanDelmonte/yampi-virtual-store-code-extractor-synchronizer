import {publicUrl} from '../core/preview';
const MAX=2*1024*1024;
// Only the message crosses from the worker to the capture, so the status goes in it, in a form
// fetchFailure reads back: "HTTP 404", "HTTP 429; aguardar 5 s", or a redirect not followed.
export const REDIRECTED='Recurso público redirecionado; o redirecionamento não é seguido.';
function retryAfter(value:string|null):number|undefined{
  if(!value)return undefined;
  const seconds=/^\d+$/.test(value.trim())?Number(value):(Date.parse(value)-Date.now())/1000;
  return Number.isFinite(seconds)?Math.max(0,Math.ceil(seconds)):undefined;
}
export function fetchFailure(message:string):{status?:number;retryAfter?:number;redirected?:boolean}{
  const status=message.match(/\bHTTP (\d{3})\b/)?.[1],wait=message.match(/aguardar (\d+) s/)?.[1];
  return {...(status?{status:Number(status)}:{}),...(wait?{retryAfter:Number(wait)}:{}),...(message===REDIRECTED?{redirected:true}:{})};
}
export async function fetchPublicResource(url: string, allowedOrigins: string[], fetcher: typeof fetch = fetch):Promise<{url:string;type:string;encoded:string}> {
  const target=publicUrl(url,url);
  if(!allowedOrigins.includes(new URL(target).origin))throw new Error('Origem de recurso não autorizada para esta captura.');
  // "manual" stops at the first redirect, like "error", but says it was one instead of a network failure.
  const response=await fetcher(target,{method:'GET',credentials:'omit',redirect:'manual',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
  if(response.type==='opaqueredirect'||response.url&&response.url!==target)throw new Error(REDIRECTED);
  if(!response.ok){const wait=[429,503].includes(response.status)?retryAfter(response.headers.get('retry-after')):undefined;throw new Error(`Recurso público indisponível: HTTP ${response.status}${wait!==undefined?`; aguardar ${wait} s`:''}.`);}
  if(Number(response.headers.get('content-length'))>MAX)throw new Error('Recurso público ultrapassa 2 MiB; não foi truncado.');
  const reader=response.body?.getReader();if(!reader)throw new Error('Recurso público sem conteúdo.');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>MAX)throw new Error('Recurso público ultrapassa 2 MiB; não foi truncado.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {url:target,type:response.headers.get('content-type')||'application/octet-stream',encoded:btoa(binary)};
}
