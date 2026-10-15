import {describe,test,expect,vi} from 'vitest';
import {finishPreview,type PreviewDraft} from '../src/browser/preview-capture';
import {demonstration,previewEntries} from '../src/core/preview';
import {encodeSnapshot,decodeProject} from '../src/core/archive';
import {unzipSync} from 'fflate';
import {demoSnapshot,demoImage} from '../src/demo/sample';
const bytes=(text:string)=>new TextEncoder().encode(text);
const draft=(urls:string[]):PreviewDraft=>{const bundle=demonstration(demoSnapshot.context,'Fictício');bundle.issues=[];return {bundle,resources:urls.map(url=>({url,priority:/.css$/.test(url)?1:4,category:/.css$/.test(url)?'css':'image',source:'html'})),api:[],documents:new Map(),themeAssets:[]};};
describe('extração mais rápida com os mesmos limites e originais',()=>{
  test('recursos públicos têm no máximo quatro GETs simultâneos e mantêm ordem e hashes',async()=>{
    let active=0,peak=0;const urls=Array.from({length:9},(_,i)=>`https://cdn.invalid/${i}.svg`);
    const result=await finishPreview(draft(urls),async url=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return {url,type:'image/svg+xml',bytes:bytes(`<svg><title>${url}</title></svg>`)};},['https://cdn.invalid']);
    expect(peak).toBe(4);expect(result.resources.map(r=>r.url)).toEqual(urls);expect(result.issues).toEqual([]);await expect(previewEntries(result)).resolves.toBeDefined();
  });
  test('segunda autorização reutiliza bytes válidos sem perder URLs originais ou fontes do CSS',async()=>{
    const css='https://cdn.invalid/a.css',font='https://font.invalid/a.woff2';const input=draft([css]);input.bundle.pages=[{id:'page-0',kind:'home',sourceUrl:demoSnapshot.context.previewOrigin+'/',raw:{merchant:{logo_url:'https://cdn.invalid/logo.svg'}}}];
    const fetcher=vi.fn(async(url:string)=>({url,type:url===css?'text/css':'font/woff2',bytes:bytes(url===css?'@font-face{font-family:Demo;src:url('+font+')}':'wOF2-fictitious')}));
    const partial=await finishPreview(input,fetcher,['https://cdn.invalid']);expect(partial.issues.some(i=>i.code==='asset-unavailable')).toBe(true);
    const result=await finishPreview(input,fetcher,['https://cdn.invalid','https://font.invalid']);
    expect(fetcher.mock.calls.map(([url])=>url)).toEqual([css,font]);expect(result.issues).toEqual([]);expect(result.platform.fontSheets).toHaveLength(1);
    expect((input.bundle.pages[0].raw.merchant as any).logo_url).toBe('https://cdn.invalid/logo.svg');expect(result.pages[0].raw).toEqual(input.bundle.pages[0].raw);expect(input.bundle.assets).toEqual({});
    const sheet=result.resources.find(r=>r.url===css)!,face=result.resources.find(r=>r.url===font)!;
    expect(new TextDecoder().decode(result.assets[sheet.path])).toContain('/preview/'+face.path);await expect(previewEntries(result)).resolves.toBeDefined();
    const denied=await finishPreview(input,fetcher,[]);expect(denied.resources).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  test('falhas não entram no cache e outra exportação nunca reutiliza respostas da anterior',async()=>{
    const url='https://cdn.invalid/a.svg',input=draft([url]);let calls=0;
    const fetcher=async()=>{if(++calls===1)throw Error('Falha fictícia');return {url,type:'image/svg+xml',bytes:bytes('<svg></svg>')};};
    expect((await finishPreview(input,fetcher,['https://cdn.invalid'])).resources).toEqual([]);
    expect((await finishPreview(input,fetcher,['https://cdn.invalid'])).resources).toHaveLength(1);
    await finishPreview(draft([url]),fetcher,['https://cdn.invalid']);expect(calls).toBe(3);
  });
  test('limites globais são determinísticos; URLs com bytes iguais ocupam uma única cópia',async()=>{
    const urls=['https://cdn.invalid/slow.svg','https://cdn.invalid/fast.svg','https://cdn.invalid/duplicate.svg'];const input=draft(urls),first=bytes('<svg><title>A</title></svg>');input.bundle.limits.totalBytes=first.length;
    const result=await finishPreview(input,async url=>{await new Promise(r=>setTimeout(r,url.includes('slow')?15:1));return {url,type:'image/svg+xml',bytes:url.includes('fast')?bytes('<svg><title>B</title></svg>'):first};},['https://cdn.invalid']);
    expect(result.resources.map(r=>r.url)).toEqual([urls[0],urls[2]]);expect(Object.keys(result.assets)).toHaveLength(1);expect(result.issues).toHaveLength(1);await expect(previewEntries(result)).resolves.toBeDefined();
  });
  test('cancelamento aguarda os GETs emitidos e não começa outra rodada',async()=>{
    const control=new AbortController(),releases:(()=>void)[]=[],calls:string[]=[];
    const promise=finishPreview(draft(Array.from({length:8},(_,i)=>`https://cdn.invalid/${i}.svg`)),async url=>{calls.push(url);await new Promise<void>(r=>releases.push(r));return {url,type:'image/svg+xml',bytes:bytes('<svg/>')};},['https://cdn.invalid'],control.signal);
    const outcome=promise.then(()=>true,error=>error.message);await vi.waitFor(()=>expect(calls).toHaveLength(4));control.abort();let settled=false;void outcome.then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);releases.forEach(r=>r());expect(await outcome).toContain('cancelada');expect(calls).toHaveLength(4);
  });
  test('ZIP armazena PNG sem recompressão e mantém baseline/importação byte a byte',async()=>{
    const zip=await encodeSnapshot(demoSnapshot),methods:Record<string,number>={};unzipSync(zip,{filter:file=>{methods[file.name]=file.compression;return false;}});
    expect(methods['tema/assets/images/example.png']).toBe(0);expect(methods['.yampi-sync/baseline/assets/images/example.png']).toBe(0);expect(methods['tema/templates/home.twig']).toBe(8);
    expect((await decodeProject(zip)).baseline).toEqual(demoSnapshot);expect(demoSnapshot.assets!['assets/images/example.png']).toEqual(demoImage);
    const control=new AbortController();control.abort();await expect(encodeSnapshot(demoSnapshot,true,undefined,{signal:control.signal})).rejects.toThrow('cancelada');
  });
});
