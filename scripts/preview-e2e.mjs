import assert from 'node:assert/strict';
import {build,stop} from 'esbuild';
import {chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {unzipSync} from 'fflate';
const repository=path.resolve(import.meta.dirname,'..'),temporary=await mkdtemp(path.join(os.tmpdir(),'yampi-preview-ficticio-'));
const evidence=path.join(repository,'.cache/visual-validation');await mkdir(evidence,{recursive:true});
let browser,harnessServer,localServer;const buildStops=[];
const raw={name:'raw',setup(b){b.onResolve({filter:/\?raw$/},a=>({path:path.resolve(a.resolveDir,a.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}};
function command(args,cwd) {
  return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),...args],{cwd,stdio:'pipe'});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(log):reject(new Error(log)));});
}
async function extract(bytes,destination){await mkdir(destination);for(const [p,b] of Object.entries(unzipSync(bytes))){const target=path.resolve(destination,p);assert.ok(target.startsWith(destination+path.sep));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,b);}}
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
async function visualComparison(context,actual,referenceHtml,filename) {
  const reference=await context.newPage();await reference.setContent(referenceHtml);await reference.evaluate(()=>document.fonts.ready);await reference.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
  const ref=await reference.locator('#store').screenshot(),local=await actual.locator('#store').screenshot();
  await writeFile(path.join(evidence,filename+'-reference.png'),ref);await writeFile(path.join(evidence,filename+'-local.png'),local);
  const difference=await reference.evaluate(async({a,b})=>{
    const load=async data=>{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));return createImageBitmap(new Blob([bytes],{type:'image/png'}));};
    const x=await load(a),y=await load(b);if(x.width!==y.width||x.height!==y.height)return {dimensions:false,ratio:1};
    const pixels=bitmap=>{const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;};
    const p=pixels(x),q=pixels(y);let bad=0;for(let i=0;i<p.length;i+=4)if(Math.max(Math.abs(p[i]-q[i]),Math.abs(p[i+1]-q[i+1]),Math.abs(p[i+2]-q[i+2]))>8)bad++;
    return {dimensions:true,ratio:bad/(p.length/4)};
  },{a:ref.toString('base64'),b:local.toString('base64')});
  assert.equal(difference.dimensions,true,'Dimensões visuais distintas');assert.ok(difference.ratio<0.01,'Diferença visual acima de 1%: '+JSON.stringify(difference));await reference.close();return difference;
}
function referenceHTML(fixture) {
  const {expected:e,snapshot:s}=fixture,cdn='https://'+e.tone+'-cdn.invalid';
  const fontCSS=fixture.resources[cdn+'/fonts.css'].text.replace(/url\('display.woff2'\)/g,`url('${cdn}/display.woff2')`);
  return `<!doctype html><html><head><style>${fontCSS}\n${s.files['assets/styles/global/main.scss']}\n:root{--bg:${e.background};--ink:${e.ink};--accent:${e.accent};--display:'${e.font}'} .custom-button{background:${e.buttonBackground};font-weight:700}.custom-button{color:${e.ink};border:2px solid ${e.accent};letter-spacing:2px}</style></head><body><main id="store"><header><img id="logo" src="${cdn}/logo.svg" alt="Logo"><h1>${e.title}</h1><nav>${e.categories.map(c=>`<a class="category-link" href="${c.url_path}">${c.name}</a>`).join('')}</nav><i class="icon">&#xe001;</i></header><h2 id="page-title">${e.tone==='dark'?'Noite de teste':'Manhã de teste'}</h2><img id="banner" src="${cdn}/banner.svg" alt="Banner"><button class="custom-button">Botão fictício</button><section id="catalog"><span class="search-state">${e.tone==='dark'?'new-search':'classic-search'}</span><span class="price-state">priced</span><span class="filter-state">1</span><span class="sample-state">1</span><span class="cache-state">160x120</span><div class="cards">${e.products.map(p=>`<a class="product-link" href="${p.url_path}"><span class="custom-image"><img src="${p.images.data[0].url}" alt="${p.name}"></span><b>${p.name}</b><span>${p.prices.data.price_formated}</span></a>`).join('')}</div></section><footer>Exemplo inteiramente fictício</footer></main></body></html>`;
}
try {
  const harness=await build({entryPoints:[path.join(repository,'tests/fixtures/visual-harness.ts')],bundle:true,format:'iife',globalName:'VisualHarness',write:false,plugins:[raw],target:'chrome120'});
  harnessServer=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/harness.js'?'text/javascript':'text/html');res.end(req.url==='/harness.js'?harness.outputFiles[0].text:'<!doctype html><script src="/harness.js"></script>');});await new Promise(r=>harnessServer.listen(0,'127.0.0.1',r));
  const harnessOrigin='http://127.0.0.1:'+harnessServer.address().port;
  browser=await chromium.launch({headless:true});const captureContext=await browser.newContext();const capturePage=await captureContext.newPage();await capturePage.goto(harnessOrigin);
  const fixtures={dark:await capturePage.evaluate(()=>VisualHarness.visualStore('dark')),light:await capturePage.evaluate(()=>VisualHarness.visualStore('light'))};
  // Real-format store: served theme CSS is compiled here with the platform-like minifier.
  await build({entryPoints:[path.join(repository,'tests/fixtures/rocket-like.ts')],bundle:true,platform:'node',format:'esm',outfile:path.join(temporary,'rocket-like.mjs'),logLevel:'silent'});
  const rocketModule=await import(pathToFileURL(path.join(temporary,'rocket-like.mjs'))),{compileStyles}=await import(pathToFileURL(path.join(repository,'local-runtime/engine.mjs')));
  const rocket=rocketModule.rocketLike({flagsRoute:true}),rocketResources={...rocket.resources,...Object.fromEntries(Object.entries(rocket.themeSheets).map(([url,entries])=>[url,{type:'text/css',text:entries.length?rocketModule.platformMinify(compileStyles(rocket.snapshot.files,entries,{style:'compressed',assets:rocketModule.ASSETS})):''}]))};
  const network=[],throttled=new Map();
  // The fictional store answers like a store: any order or page of a path (?sort_by=, ?page=), a 404, a 302 to another site, and 429 with Retry-After before answering.
  const storePath=url=>{const parsed=new URL(url);if(parsed.origin!==rocketModule.STORE)return url;for(const key of [...parsed.searchParams.keys()])if(key!=='q')parsed.searchParams.delete(key);return parsed.href;};
  await captureContext.route('https://**/*',async route=>{const url=route.request().url(),resource=fixtures.dark.resources[url]||fixtures.light.resources[url]||rocketResources[url]||rocketResources[storePath(url)];assert.ok(resource,'URL externa inesperada: '+url);assert.equal(route.request().method(),'GET');assert.equal(route.request().headers()['cookie'],undefined);network.push(url);
    const seen=throttled.get(url)||0;if(resource.throttle&&seen<resource.throttle){throttled.set(url,seen+1);await route.fulfill({status:429,contentType:'text/plain',body:'Calma',headers:{'Retry-After':'1','Access-Control-Allow-Origin':'*'}});return;}
    await route.fulfill({status:resource.status||200,contentType:resource.type,body:resource.base64?Buffer.from(resource.base64,'base64'):resource.text,headers:{'Access-Control-Allow-Origin':'*',...resource.headers}});});
  const captures={dark:await capturePage.evaluate(()=>VisualHarness.capture('dark')),light:await capturePage.evaluate(()=>VisualHarness.capture('light'))},rocketCapture=await capturePage.evaluate(()=>VisualHarness.captureRocket());
  assert.ok(!network.some(url=>/\.scss|fictional-cyrillic/.test(url)),'Requisição derivada de Sass ou fonte fora de latin.');
  await captureContext.close();await new Promise(r=>harnessServer.close(r));harnessServer=null;
  const summary=[];
  for(const tone of ['dark','light']) {
    const captured=captures[tone],fixture=fixtures[tone],source=path.join(temporary,tone+'-source'),moved=path.join(temporary,tone+'-moved');
    assert.equal(captured.source.association,'published-unverified');assert.deepEqual(captured.pages.map(p=>p.kind+(p.context?':'+p.context:'')),['home','category','product','category:search','product','category']);assert.equal(captured.resources.length,6);assert.deepEqual(captured.issues.map(i=>i.code).sort(),['page-kind-missing','page-kind-missing','published-association']);
    await extract(Buffer.from(captured.zip,'base64'),source);
    // Move the entire ZIP project before installing dependencies. The exporter,
    // network cache and original extraction directory are unavailable thereafter.
    await cp(source,moved,{recursive:true});assert.ok(source.startsWith(temporary+path.sep));await rm(source,{recursive:true});
    console.log('Prévia '+tone+': npm ci e checks no projeto movido, usando apenas ferramentas do ZIP.');
    await command(['ci','--ignore-scripts','--no-audit','--no-fund'],moved);
    const integrity=await command(['run','check:integrity'],moved);assert.match(integrity,/'?published-unverified'?/);
    await command(['run','check'],moved);await command(['run','pack'],moved);
    const returned=unzipSync(new Uint8Array(await readFile(path.join(moved,'retorno-yampi.zip'))));assert.ok(Object.keys(returned).every(p=>p.startsWith('tema/')||p.startsWith('.yampi-sync/baseline/')||p==='.yampi-sync/manifest.json'));
    for(const [p,text] of Object.entries(fixture.snapshot.files)){assert.equal(Buffer.from(returned['tema/'+p]).toString(),text);assert.equal(Buffer.from(returned['.yampi-sync/baseline/'+p]).toString(),text);}
    const {createLocalServer}=await import(pathToFileURL(path.join(moved,'.yampi-sync/tools/dev.mjs')));const compiler=await import(pathToFileURL(path.join(moved,'node_modules/esbuild/lib/main.js')));buildStops.push(compiler.stop||compiler.default.stop);const local=await createLocalServer(moved);localServer=local.server;await new Promise(r=>localServer.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+localServer.address().port;
    const context=await browser.newContext(),actual=await context.newPage(),foreign=[],errors=[];
    await context.route('**/*',route=>{if(route.request().url().startsWith(base+'/'))return route.continue();foreign.push(route.request().url());return route.abort();});
    actual.on('pageerror',e=>errors.push(e.message));actual.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await actual.goto(base+'/preview?page=home');await actual.waitForFunction(()=>window.__yampiLocalReady===true);await actual.locator('.cache-state').filter({hasText:'160x120'}).waitFor();await actual.evaluate(()=>document.fonts.ready);
    const measurements=await actual.evaluate(()=>({body:getComputedStyle(document.body).backgroundColor,ink:getComputedStyle(document.body).color,button:getComputedStyle(document.querySelector('button')).backgroundColor,weight:getComputedStyle(document.querySelector('button')).fontWeight,spacing:getComputedStyle(document.querySelector('button')).letterSpacing,font:getComputedStyle(document.querySelector('h1')).fontFamily,fontLoaded:document.fonts.check('16px '+getComputedStyle(document.querySelector('h1')).fontFamily),iconLoaded:document.fonts.check('16px FixtureIcons'),fontFaces:[...document.fonts].map(f=>({family:f.family,status:f.status})),images:[...document.images].map(i=>({src:i.currentSrc,width:i.naturalWidth,height:i.naturalHeight})),loading:document.querySelectorAll('.-loading').length,messages:window.__yampiLocalMessages||[]}));
    await writeFile(path.join(evidence,tone+'-rendered.html'),await actual.content());await writeFile(path.join(evidence,tone+'-compiled.css'),await (await fetch(base+'/__local/style.css')).text());await writeFile(path.join(evidence,tone+'-measurements.json'),JSON.stringify({measurements,errors,foreign},null,2));
    const e=captured.expected;assert.equal(measurements.body,'rgb('+rgb(e.background).join(', ')+')');assert.equal(measurements.ink,'rgb('+rgb(e.ink).join(', ')+')');assert.equal(measurements.button,tone==='dark'?'rgba(0, 0, 0, 0)':'rgb('+rgb(e.accent).join(', ')+')');assert.equal(measurements.weight,'700');assert.equal(measurements.spacing,'2px');assert.equal(measurements.font,e.font);assert.equal(measurements.fontLoaded,true);assert.equal(measurements.iconLoaded,true);assert.ok(measurements.fontFaces.length>=2);assert.ok(measurements.fontFaces.every(f=>f.status==='loaded'));assert.equal(measurements.loading,0);assert.ok(measurements.images.every(i=>i.src.includes('/preview/assets/')&&i.width>0&&i.height>0));assert.deepEqual(measurements.messages,[]);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
    assert.equal(await actual.locator('.filter-state').textContent(),'1');assert.equal(await actual.locator('.sample-state').textContent(),'1');assert.equal(await actual.locator('.search-state').textContent(),tone==='dark'?'new-search':'classic-search');
    const filters=await actual.evaluate(()=>window.__yampiLocalApp.$store.state.filters.searchFilters);assert.deepEqual(filters.priceRange,{min:35,max:95,source:'captured-sample'});assert.equal(filters.categories.length,2);assert.equal(filters.attributes.length,1);
    const variants=await actual.evaluate(async()=>{const vm=window.__yampiLocalApp.$children.find(c=>c.$options.name==='FixtureCatalog');const original=vm.selectedSku;vm.setSelectedSku({id:99,price_sale:80,price_formated:'R$ 80,00'});await vm.$nextTick();const selected=vm.selectedPrice;vm.setSelectedSku(original);await vm.$nextTick();return {selected,restored:vm.selectedPrice};});assert.equal(variants.selected,'R$ 80,00');assert.match(variants.restored,/35,00/);
    const productLinks=await actual.locator('.product-link').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),categoryLinks=await actual.locator('.category-link').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));assert.equal(new Set(productLinks).size,2);assert.equal(new Set(categoryLinks).size,2);
    for(let i=0;i<2;i++){await actual.goto(base+'/preview?page=home');await actual.waitForFunction(()=>window.__yampiLocalReady);await actual.locator('.product-link').nth(i).click();await actual.waitForURL(base+productLinks[i]);await actual.waitForFunction(()=>window.__yampiLocalReady);assert.equal(await actual.locator('#page-title').textContent(),e.products[i].name);await actual.goto(base+'/preview?page=home');await actual.waitForFunction(()=>window.__yampiLocalReady);await actual.locator('.category-link').nth(i).click();await actual.waitForURL(base+categoryLinks[i]);await actual.waitForFunction(()=>window.__yampiLocalReady);assert.equal(await actual.locator('#page-title').textContent(),e.categories[i].name);}
    const visuals=[];
    // Use a distinct reference context for each viewport; its synthetic network
    // is isolated from the offline local page under test.
    for(const [name,viewport] of [['desktop',{width:1200,height:900}],['mobile',{width:390,height:844}]]) {
      await actual.setViewportSize(viewport);await actual.goto(base+'/preview?page=home');await actual.locator('.cache-state').filter({hasText:'160x120'}).waitFor();await actual.evaluate(()=>document.fonts.ready);
      const refContext=await browser.newContext({viewport});await refContext.route('https://**/*',async route=>{const resource=fixture.resources[route.request().url()];assert.ok(resource);return route.fulfill({contentType:resource.type,body:resource.base64?Buffer.from(resource.base64,'base64'):resource.text});});
      visuals.push({viewport:name,...await visualComparison(refContext,actual,referenceHTML(fixture),tone+'-'+name)});await refContext.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);await context.close();await new Promise(r=>localServer.close(r));localServer=null;
    summary.push({store:e.title,source:captured.source,pages:captured.pages.length,assets:captured.resources.length,portable:true,integrity:true,returnExcludesPreview:true,offline:true,measurements,visuals});
    console.log('Prévia '+tone+': identidade, CSS, fontes, imagens/cache, filtros, rotas distintas e comparação visual passaram.');
  }
  // Section 9.3: real capture format in a browser, using only the tools of the exported ZIP.
  const rocketSource=path.join(temporary,'rocket-source'),rocketMoved=path.join(temporary,'rocket-moved');
  await extract(Buffer.from(rocketCapture.zip,'base64'),rocketSource);await cp(rocketSource,rocketMoved,{recursive:true});await rm(rocketSource,{recursive:true});
  console.log('Prévia formato real: npm ci e checks no projeto movido.');
  await command(['ci','--ignore-scripts','--no-audit','--no-fund'],rocketMoved);
  const rocketCheck=await command(['run','check'],rocketMoved);assert.match(rocketCheck,/published-verified-by-css/);assert.doesNotMatch(rocketCheck,/Seções visíveis não renderizadas/);
  const {createLocalServer:createRocketServer}=await import(pathToFileURL(path.join(rocketMoved,'.yampi-sync/tools/dev.mjs'))+'?rocket');const rocketCompiler=await import(pathToFileURL(path.join(rocketMoved,'node_modules/esbuild/lib/main.js')));buildStops.push(rocketCompiler.stop||rocketCompiler.default.stop);const rocketLocal=await createRocketServer(rocketMoved);localServer=rocketLocal.server;await new Promise(r=>localServer.listen(0,'127.0.0.1',r));const rocketBase='http://127.0.0.1:'+localServer.address().port;
  const rocketContext=await browser.newContext(),rocketForeign=[];await rocketContext.route('**/*',route=>{if(route.request().url().startsWith(rocketBase+'/'))return route.continue();rocketForeign.push(route.request().url());return route.abort();});
  const rocketPages=[];
  // The stages read the store's pages and every product page: a 404 became a broken link, the 302 was not followed and category D waited out its two 429s.
  assert.ok(rocketCapture.pages.filter(p=>p.stage==='store').length>=10,JSON.stringify(rocketCapture.stages));assert.equal(rocketCapture.pages.filter(p=>p.kind==='product').length,13);
  assert.deepEqual(rocketCapture.issues.filter(i=>i.code==='link-broken').map(i=>i.resource),['/categoria-removida','/produto-removido/p']);assert.ok(rocketCapture.pages.some(p=>p.sourceUrl===rocketModule.STORE+'/categoria-d'));assert.equal(throttled.get(rocketModule.STORE+'/categoria-d'),2);
  assert.ok(!network.some(url=>url.startsWith('https://parceiro-ficticio.invalid')),'Redirecionamento seguido para outra origem.');
  for(const [route,expectedSections] of [['/',3],['/categoria-a',1],['/produto-ficticio-1/p',2],['/sobre',1],['/promocao',1]]) {
    const page=await rocketContext.newPage(),consoleMessages=[];page.on('console',message=>consoleMessages.push(message.text()));page.on('pageerror',error=>consoleMessages.push(error.message));
    await page.goto(rocketBase+route);await page.waitForFunction(()=>window.__yampiLocalState);await page.waitForLoadState('networkidle');
    if(route==='/produto-ficticio-1/p')await page.locator('.flags').filter({hasText:'rota ausente'}).waitFor();
    if(route==='/')await page.locator('.shelf-image').nth(1).waitFor();
    const state=await page.evaluate(async()=>{await document.fonts.load('16px "Fictional Sans"');await document.fonts.ready;const icon=document.querySelector('.icon-cart');const iconUrl=icon&&getComputedStyle(icon).backgroundImage.match(/url\("?([^")]+)"?\)/)?.[1];return {ready:window.__yampiLocalReady,local:window.__yampiLocalState,fonts:[...document.fonts].filter(f=>f.family.includes('Fictional')).map(f=>f.status),images:[...document.images].map(i=>({src:i.currentSrc,width:i.naturalWidth})),iconStatus:iconUrl?(await fetch(iconUrl)).status:0,iconUrl,summary:document.querySelector('#yampi-preview-status [data-summary]')?.textContent};});
    assert.equal(state.ready,true,route+': '+JSON.stringify(state.local));assert.equal(state.local.renderedSections,expectedSections,route);assert.equal(state.local.expectedSections,expectedSections,route);
    assert.ok(state.fonts.length&&state.fonts.every(status=>status==='loaded'),route+' fontes: '+state.fonts);assert.ok(!consoleMessages.some(text=>/OTS|Failed to decode downloaded font/.test(text)),route+': '+consoleMessages.join(' | '));
    assert.ok(state.images.length&&state.images.every(image=>image.src.includes('/preview/assets/')&&image.width>0),route+' imagens: '+JSON.stringify(state.images));assert.equal(state.local.placeholders,0);
    assert.equal(state.iconStatus,200,route+' ícone '+state.iconUrl);assert.ok(state.iconUrl.includes('/__platform/assets/img/themes/vitrine/icons/cart.svg'));
    if(route==='/produto-ficticio-1/p')assert.deepEqual(state.local.missingRoutes,['GET catalog/products/1/flags']);else assert.deepEqual(state.local.missingRoutes,[],route);
    rocketPages.push({route,state});await page.close();
  }
  // Every link a visitor follows opens its own page: the menu, the subcategories, the footer, "Ver tudo", a product card, the way back from the product and a search the theme writes.
  const clicks=[];
  const follow=async(page,selector,title,expected)=>{const link=page.locator(selector).first();await link.waitFor();const href=await link.getAttribute('href');await link.click();await page.waitForURL(rocketBase+(expected??href));await page.waitForFunction(()=>window.__yampiLocalState);const shown=(await page.locator('.page-title').first().textContent())?.trim();assert.equal(shown,title,selector+' '+href);clicks.push({selector,href,title:shown});};
  // Tall enough that the preview's fixed status bar never covers the footer.
  const visitor=await rocketContext.newPage();await visitor.setViewportSize({width:1280,height:2400});
  const at=async route=>{await visitor.goto(rocketBase+route);await visitor.waitForFunction(()=>window.__yampiLocalState);};
  await at('/');await follow(visitor,'.category-link:text("Categoria C")','Categoria C');
  await at('/');await follow(visitor,'.subcategory-link:text("Subcategoria C1")','Subcategoria C1');
  await at('/');await follow(visitor,'.subcategory-link:text("Subcategoria C2")','Subcategoria C2');
  await at('/');await follow(visitor,'.category-link:text("Categoria D")','Categoria D');
  await at('/');await follow(visitor,'.page-link:text("Trocas")','Trocas');
  await at('/');await follow(visitor,'.page-link:text("Privacidade")','Privacidade');
  await at('/');await follow(visitor,'.see-all','Destaques fictícios');
  await at('/');await follow(visitor,'.search-shortcut','Busca');
  await at('/categoria-c?sort_by=best_sellers');await follow(visitor,'.grid-product:has-text("Produto Fictício 5")','Produto Fictício 5');await follow(visitor,'.back-link','Categoria Oculta');
  await at('/categoria-d');await follow(visitor,'.grid-product:has-text("Produto Fictício 9")','Produto Fictício 9');await follow(visitor,'.back-link','Categoria D');
  await at('/');await follow(visitor,'.shelf-product:has-text("Produto Fictício 3")','Produto Fictício 3');await follow(visitor,'.back-link','Categoria B');
  await at('/');await visitor.locator('.old-shortcut').click();await visitor.waitForURL(rocketBase+'/categoria-removida');assert.match(await visitor.content(),/Rota não capturada/);
  const index=await (await fetch(rocketBase+'/__local/')).text();assert.match(index,/<strong>Produtos<\/strong>: 13/);
  await visitor.close();
  console.log('Prévia formato real: '+clicks.length+' cliques em menu, subcategorias, rodapé, Ver tudo, busca, produtos e voltar abriram a própria página.');
  // A template that stops rendering its sections is reported as incomplete.
  await writeFile(path.join(rocketMoved,'tema/templates/promotion.twig'),'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"><p>Sem seções</p></div></body></html>');
  const broken=await rocketContext.newPage();await broken.goto(rocketBase+'/promocao');await broken.waitForFunction(()=>window.__yampiLocalState);
  assert.equal(await broken.evaluate(()=>window.__yampiLocalReady),false);assert.match(await broken.locator('#yampi-preview-status [data-summary]').textContent(),/Prévia incompleta: 0 de 1 seções/);
  const uncaptured=await fetch(rocketBase+'/rota-que-nao-existe');assert.equal(uncaptured.status,404);assert.match(await uncaptured.text(),/Rota não capturada/);
  assert.deepEqual(rocketForeign,[]);await rocketContext.close();await new Promise(r=>localServer.close(r));localServer=null;
  console.log('Prévia formato real: seções, fontes latin, ícones de $assets, imagens capturadas, rota ausente explícita e prontidão estrutural conferidas.');
  summary.push({store:'Loja Fictícia Vitrine',format:'real',pages:rocketCapture.pages.map(p=>p.kind),stages:rocketCapture.stages,clicks,assets:rocketCapture.resources.length,cssParity:'published-verified-by-css',checks:rocketPages.map(p=>({route:p.route,sections:p.state.local.renderedSections+'/'+p.state.local.expectedSections}))});
  await writeFile(path.join(evidence,'report.json'),JSON.stringify({fictionalOnly:true,realStoreVisualValidation:false,networkRequests:network.length,stores:summary},null,2));console.log('Três lojas fictícias validadas: duas com comparação visual e uma no formato real da vitrine. Evidências em .cache/visual-validation/. Nenhuma certificação visual de loja real.');
} catch(error) {console.error('Falha na validação visual:',error);throw error;
} finally {
  await browser?.close();if(harnessServer)await new Promise(r=>harnessServer.close(r));if(localServer)await new Promise(r=>localServer.close(r));
  stop();for(const finish of buildStops)finish();
  assert.ok(temporary.startsWith(path.resolve(os.tmpdir())+path.sep+'yampi-preview-ficticio-'));await rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(error=>console.error('Pasta fictícia preservada por bloqueio do Windows:',temporary,error.code));
}
