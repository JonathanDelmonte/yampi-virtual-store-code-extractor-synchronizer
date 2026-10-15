import {describe,test,expect,vi} from 'vitest';
import {zipSync,unzipSync,strToU8} from 'fflate';
import {publicUrl,sanitizeRaw,blockedKey,previewType,demonstration,previewEntries,previewLimits} from '../src/core/preview';
import {staticContext,preparePreview,finishPreview,themeAssetPaths,planApi} from '../src/browser/preview-capture';
import {fetchPublicResource} from '../src/browser/public-fetch';
import {encodeSnapshot,decodeProject} from '../src/core/archive';
import {demoSnapshot} from '../src/demo/sample';
import {installDomParser} from './fixtures/dom';
// @ts-expect-error Embedded runtime is native JavaScript, exercised here at runtime.
import {twigHelpers} from '../local-runtime/platform.mjs';
// @ts-expect-error Embedded runtime is native JavaScript, exercised here at runtime.
import {rewriteCSS} from '../local-runtime/preview.mjs';
const utf8=(text:string)=>new TextEncoder().encode(text);
const fakeDoc=(scripts:string[])=>({querySelectorAll:()=>scripts.map(text=>({textContent:text,id:'',getAttribute:()=>null}))}) as unknown as Document;
const draft=(urls:string[])=>{const bundle=demonstration(demoSnapshot.context,'Teste');bundle.issues=[];bundle.pages=[];return {bundle,resources:urls.map(url=>({url,priority:url.endsWith('.css')?1:4,category:(url.endsWith('.css')?'css':'image') as 'css'|'image',source:'html' as const})),api:[],documents:new Map(),themeAssets:[]};};
describe('contexto visual portátil separado do código',()=>{
  test('parser lê themeConfig, data e merchant sem executar chamadas, getters ou scripts',()=>{
    const data={merchant:{manifest:{name:'Fictícia 🎮'},token:'PRIVATE'},themeConfig:{theme:{params:{color_general_background:'#102030',api_key:'PRIVATE'}}}};
    const parsed=staticContext(fakeDoc(['window.themeConfig=JSON.parse(atob('+JSON.stringify(btoa(unescape(encodeURIComponent(JSON.stringify(data.themeConfig)))))+'));','window.merchant='+JSON.stringify(data.merchant)+';','window.data=executeDangerous();']));
    expect(parsed.raw.merchant).toMatchObject({manifest:{name:'Fictícia 🎮'}});expect(parsed.raw.data).toBeUndefined();expect(parsed.issues.join()).toContain('não é executada');
    const clean=sanitizeRaw(parsed.raw,'https://store.invalid/');expect(JSON.stringify(clean.raw)).not.toContain('PRIVATE');expect(clean.removed.sort()).toEqual(['api_key','token']);
    const spy=vi.fn(),withGetter={};Object.defineProperty(withGetter,'merchant',{get:spy,enumerable:true});sanitizeRaw(withGetter,'x');expect(spy).not.toHaveBeenCalled();
  });
  test('lista de bloqueio remove segredos e rastreamento, mas preserva chaves visuais',()=>{
    for(const key of ['token','session_id','api_key','apiKey','checkout_token','password','auth','Authorization','cookie','csrf','tracking_pixel_id','gtm_id','customer','orders'])expect(blockedKey(key),key).toBeDefined();
    for(const key of ['order','key','cookies_policy','grids_card_style','buttons_style','empty_cart_title','show_email','topbar_show_whatsapp','author','keywords','highlightbar_text','monkey'])expect(blockedKey(key),key).toBeUndefined();
  });
  test('valores pessoais, conteúdo ativo e limites são tratados sem perder a forma',()=>{
    const result=sanitizeRaw({merchant:{logo_url:'https://cdn.invalid/logo.svg?token=SECRET',company:{name:'Pessoa',person_type:'person',cpf:'123.456.789-09',phone:{number:'11999999999'},social:{instagram:'https://instagram.invalid/x'}},manifest:{description:'Fale com contato@loja.invalid'}},data:{content:'<p>ok</p><img src=x onerror="run()"><script>alert(1)</script>',list:Array.from({length:600},(_,i)=>i)}},'x');
    expect(JSON.stringify(result.raw)).not.toMatch(/SECRET|onerror|<script|alert|contato@loja/);
    expect(result.raw.merchant!.company).toEqual({name:'redacted',person_type:'person',cpf:'redacted',phone:{number:'redacted'},social:{instagram:'https://instagram.invalid/x'}});
    expect(result.raw.merchant!.logo_url).toBe('redacted');expect(result.raw.data!.content).toBe('<p>ok</p><img src=x>');
    expect((result.raw.data!.list as number[]).length).toBe(500);expect(result.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['company-redacted','values-redacted','active-content-neutralized','values-limited']));
    for(const url of ['http://cdn.invalid/a.png','https://127.0.0.1/a.png','https://local.local/a.png','https://u:p@cdn.invalid/a.png','https://cdn.invalid/checkout/a','https://cdn.invalid/a?auth=x','https://[::1]/a'])expect(()=>publicUrl(url,'https://store.invalid')).toThrow();
    expect(publicUrl('/image.svg?utm_source=x&_gl=tracking#test','https://store.invalid')).toBe('https://store.invalid/image.svg');expect(()=>previewLimits({resources:201})).toThrow();
  });
  test('configuração do editor tem prioridade em todas as rotas sem trocar o conteúdo',async()=>{
    const theme={theme:{params:{color_primary:'red'}},sections:[{section_alias:'header',position:0,params:{text:'publicado'}}]},merchant={alias:'ficticia',categories:[{id:1,name:'A',url_path:'/category-1'}]};
    const page=(kind:string)=>`<html><body class="ficticia ${kind}"><script>window.themeConfig=${JSON.stringify(theme)};window.merchant=${JSON.stringify(merchant)};window.data=${JSON.stringify({context:kind})};</script></body></html>`;
    const restore=installDomParser();
    try{const result=await preparePreview(demoSnapshot,async url=>{if(url.includes('/busca'))throw new Error('404 fictício');return {url,bytes:utf8(page(url.endsWith('/')?'home':'category')),type:'text/html'};},{editorData:{themeConfig:{theme:{params:{color_primary:'blue'}},sections:[{section_alias:'header',position:0,params:{text:'rascunho'}}]}}});
      expect(result.bundle.pages.map(p=>p.kind)).toEqual(['home','category']);expect(result.bundle.pages.every(p=>(p.raw.themeConfig as any).theme.params.color_primary==='blue'&&(p.raw.themeConfig as any).sections[0].params.text==='rascunho')).toBe(true);
      expect(result.bundle.source.kind).toBe('editor');expect(result.bundle.issues.some(i=>i.code==='published-association')).toBe(true);
      expect(result.bundle.issues.filter(i=>i.code==='page-kind-missing').map(i=>i.resource)).toEqual(['product','pages','promotion','search']);
    }finally{restore();}
  });
  test('recusa SVG ativo, HTML disfarçado, tipos desconhecidos e hashes adulterados',async()=>{
    expect(()=>previewType(utf8('<svg onload="run()"/>'),'image/svg+xml')).toThrow('SVG');
    expect(()=>previewType(utf8('<html>erro</html>'),'image/png')).toThrow();expect(()=>previewType(utf8('unknown'),'text/plain')).toThrow();
    const bundle=demonstration(demoSnapshot.context,'Teste');bundle.resources.push({url:'https://cdn.invalid/a.svg',path:'assets/'+'a'.repeat(64)+'.svg',type:'image/svg+xml',bytes:5,sha256:'a'.repeat(64),category:'image',priority:4});
    await expect(previewEntries(bundle)).rejects.toThrow('Asset');
  });
  test('permissão ausente, timeout, redirecionamento e limite são limitações explícitas',async()=>{
    const result=await finishPreview(draft(['https://cdn.invalid/a.svg','https://cdn.invalid/b.svg','https://other.invalid/c.svg']),async url=>{if(url.endsWith('a.svg'))return {bytes:utf8('<svg/>'),type:'image/svg+xml',url:url+'/redirect'};throw new Error('timeout explícito');},['https://cdn.invalid']);
    expect(result.issues).toHaveLength(3);expect(result.resources).toHaveLength(0);expect(result.issues.map(i=>i.reason).join()).toMatch(/Redirecionamento/);expect(result.issues.map(i=>i.reason).join()).toMatch(/autorizada/);
    const clipped=draft(['https://cdn.invalid/a.svg','https://cdn.invalid/b.svg']);clipped.bundle.limits.resources=1;
    const limited=await finishPreview(clipped,async url=>({bytes:utf8(`<svg><title>${url}</title></svg>`),type:'image/svg+xml',url}),['https://cdn.invalid']);expect(limited.issues.some(i=>i.code==='resource-limit')).toBe(true);
  });
  test('download público é somente GET sem credenciais; streaming não é truncado',async()=>{
    const fetcher=vi.fn(async()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}));
    expect((await fetchPublicResource('https://cdn.invalid/a.svg',['https://cdn.invalid'],fetcher as any)).encoded).toBe(btoa('<svg/>'));
    expect(fetcher).toHaveBeenCalledWith('https://cdn.invalid/a.svg',expect.objectContaining({method:'GET',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'}));
    await expect(fetchPublicResource('https://cdn.invalid/a.svg',[],fetcher as any)).rejects.toThrow('autorizada');
    const large=vi.fn(async()=>new Response(new Uint8Array(2*1024*1024+1)));await expect(fetchPublicResource('https://cdn.invalid/a.svg',['https://cdn.invalid'],large as any)).rejects.toThrow('não foi truncado');
    const redirected=vi.fn(async()=>{const r=new Response('<svg/>');Object.defineProperty(r,'url',{value:'https://other.invalid/a.svg'});return r;});await expect(fetchPublicResource('https://cdn.invalid/a.svg',['https://cdn.invalid'],redirected as any)).rejects.toThrow('redirecionado');
  });
  test('CSS importado referencia o hash final; fontes fora de latin e não capturadas somem',async()=>{
    const resources:Record<string,{bytes:Uint8Array;type:string}>={
      'https://cdn.invalid/a.css':{bytes:utf8('@import "b.css"; .a{color:red;background:url(missing.png)}'),type:'text/css'},
      'https://cdn.invalid/b.css':{bytes:utf8('/* cyrillic */\n@font-face{font-family:Demo;src:url(https://cdn.invalid/cyr.woff2) format("woff2")}\n/* latin */\n@font-face{font-family:Demo;src:url(https://cdn.invalid/eot.eot);src:url(https://cdn.invalid/font.woff2) format("woff2"),url(https://cdn.invalid/font.woff) format("woff")}'),type:'text/css'},
      'https://cdn.invalid/font.woff2':{bytes:utf8('wOF2-fictional'),type:'font/woff2'}
    };
    const requested:string[]=[];
    const captured=await finishPreview(draft(['https://cdn.invalid/a.css']),async url=>{requested.push(url);if(!resources[url])throw new Error('404 fictício');return {...resources[url],url};},['https://cdn.invalid']);
    const a=captured.resources.find(r=>r.url.endsWith('/a.css'))!,b=captured.resources.find(r=>r.url.endsWith('/b.css'))!;
    expect(requested).not.toContain('https://cdn.invalid/cyr.woff2');expect(requested).not.toContain('https://cdn.invalid/font.woff');
    expect(new TextDecoder().decode(captured.assets[a.path])).toContain('/preview/'+b.path);expect(new TextDecoder().decode(captured.assets[a.path])).toContain('placeholder.svg');
    const font=new TextDecoder().decode(captured.assets[b.path]);expect(font).not.toContain('cyr.woff2');expect(font).not.toContain('eot');expect(font.match(/src:/g)).toHaveLength(1);expect(font).toMatch(/src:url\("\/preview\/assets\/[a-f0-9]{64}\.woff2"\) format\("woff2"\)/);
    expect(captured.platform.fontSheets).toEqual([{url:'https://cdn.invalid/b.css',families:['Demo']}]);await expect(previewEntries(captured)).resolves.toBeDefined();
    expect(rewriteCSS('@font-face{font-family:X;src:url(https://cdn.invalid/missing.woff2) format("woff2")}.x{color:red}',{})).not.toContain('placeholder');
    expect(rewriteCSS('@font-face{src:url(https://cdn.invalid/a.woff2)}',{'https://cdn.invalid/a.woff2':'/preview/assets/a.woff2'})).toContain('/preview/assets/a.woff2');
  });
  test('$assets é descoberto pelo Sass e leituras públicas seguem as seções visíveis',()=>{
    expect(themeAssetPaths({'assets/styles/f.scss':"@function image($p){@return $assets + '/icons/' + $p;}",'assets/styles/m.scss':"a{background:url(image('cart.svg'))}b{background:url($assets + '/fonts/a.woff2')}"}).sort()).toEqual(['fonts/a.woff2','icons/cart.svg']);
    const page=(sections:unknown[])=>({id:'page-0',kind:'home' as const,sourceUrl:'https://store.invalid/',raw:{merchant:{alias:'ficticia'},themeConfig:{sections}} as any});
    const plan=planApi([page([{section_alias:'collection',position:1,visible:true,params:{visible_products:4,resource:{ids:[5]}}},{section_alias:'collection',position:1,visible:false,params:{resource:{ids:[6]}}},{section_alias:'grid',position:1,visible:true,params:{grid_collection_resource_banner:{ids:[7]},grid_collection_resource_products:{slugs:['produto-a']}}}])],previewLimits());
    expect(plan.requests.map(r=>r.path+'?'+r.query)).toEqual(['catalog/collections?id%5B%5D=5&limit=4','catalog/banners?status=active&id%5B%5D=7','catalog/products/produto-a?']);
  });
  test('ZIP mantém originais byte a byte; importador ignora preview mesmo em projeto aninhado',async()=>{
    const original=await encodeSnapshot(demoSnapshot,false),project=unzipSync(await encodeSnapshot(demoSnapshot,true));
    const code=unzipSync(original);for(const [key,value] of Object.entries(code))if(key!=='.yampi-sync/manifest.json')expect(project[key]).toEqual(value);
    const report=JSON.parse(new TextDecoder().decode(project['preview/report.json']));expect(report.visual).toBe('not-validated');expect(report.configuration.status).toBe('demonstration');
    project['preview/large.css']=new Uint8Array(3*1024*1024);project['preview/product.json']=strToU8('private fictional data');
    const nested=Object.fromEntries(Object.entries(project).map(([p,b])=>['local/'+p,b]));const decoded=await decodeProject(zipSync(nested));expect(decoded.baseline).toEqual(demoSnapshot);expect(decoded.local).toEqual(demoSnapshot.files);expect(Object.keys(decoded.local).some(p=>p.startsWith('preview'))).toBe(false);
  });
  test('contratos dos helpers respeitam família/peso, estilo/cor e font_link',()=>{
    const helpers=twigHelpers((v:string)=>v).functions;
    expect(helpers.font_weight('Display','bold')).toBe(700);expect(helpers.font_weight('Display','medium')).toBe(500);expect(helpers.font_weight('Display',600)).toBe(600);
    for(const [name,weight] of [['thin',100],['extra light',200],['light',300],['semibold',600],['extrabold',800],['black',900]] as const)expect(helpers.font_weight('Display',name)).toBe(weight);
    expect(helpers.button_bg_color('outline','#aabbcc')).toBe('transparent');expect(helpers.button_bg_color('filled','#123456')).toBe('#123456');expect(helpers.button_bg_color('#654321')).toBe('#654321');
    const trace={fonts:[] as string[]},filters=twigHelpers((v:string)=>v,undefined,{platform:{fontSheets:[{url:'https://f.invalid/a.css',families:['Fictional Sans']}]},map:{'https://f.invalid/a.css':'/preview/assets/a.css'},trace}).filters;
    expect(filters.font_link('"Fictional Sans"')).toBe('/preview/assets/a.css');expect(filters.font_link('Outra')).toBe('/__local/empty.css');expect(trace.fonts).toEqual(['outra']);
    expect(filters.components_url('/css/themes/tema-home-mobile.css')).toBe('/__local/css/themes/tema-home-mobile.css');expect(filters.components_url('components.css')).toBe('/__local/style.css');expect(filters.components_url('/components/A.js')).toBe('/__local/empty.js');
  });
});
