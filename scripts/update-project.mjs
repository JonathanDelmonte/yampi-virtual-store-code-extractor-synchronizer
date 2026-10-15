import path from 'node:path';
import {readFile,writeFile,mkdir,lstat,realpath,readdir,rm,mkdtemp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {unzipSync} from 'fflate';
import {readProject,safeRead,digest} from '../local-runtime/engine.mjs';
import {loadPreview} from '../local-runtime/preview.mjs';
import {isOverrides,emptyOverrides} from '../local-runtime/contract.mjs';
const repository=path.resolve(import.meta.dirname,'..'),runtime=path.join(repository,'local-runtime');
export const tools=['engine.mjs','dev.mjs','pack.mjs','platform.mjs','platform-browser.mjs','twig.mjs','preview.mjs','integrity.mjs','contract.mjs','dependencies.mjs','parity.mjs'];
const RETIRED=['twig'];
const json=v=>JSON.stringify(v,null,2)+'\n';
async function destination(root,relative) {
  const target=path.resolve(root,relative);if(!target.startsWith(root+path.sep))throw new Error('Destino fora do projeto.');
  let current=root;
  for(const part of path.relative(root,target).split(path.sep)){
    current=path.join(current,part);try{if((await lstat(current)).isSymbolicLink())throw new Error('Links não são aceitos no destino da atualização.');}catch(error){if(error.code!=='ENOENT')throw error;}
  }return target;
}
async function existing(root,relative,max){try{return await safeRead(root,relative,max);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function files(root,relative) {
  const output=[];let folder;try{folder=await destination(root,relative);await lstat(folder);}catch(error){if(error.code==='ENOENT')return output;throw error;}
  async function visit(name){for(const entry of await readdir(path.join(folder,name),{withFileTypes:true})){const key=name?name+'/'+entry.name:entry.name;if(entry.isSymbolicLink())throw new Error('Links não são aceitos: '+relative+'/'+key);if(entry.isDirectory())await visit(key);else if(entry.isFile())output.push(relative+'/'+key);else throw new Error('Entrada não suportada: '+key);}}
  await visit('');return output;
}
// Merge the tool lockfile with the trees of dependencies the user added.
function mergeLock(template,old,pkg,toolDependencies) {
  const lock=structuredClone(template),extras=Object.entries({...pkg.dependencies,...pkg.devDependencies,...pkg.optionalDependencies}).filter(([name])=>!(name in toolDependencies)).map(([name])=>name);
  const visit=(name,stack=new Set())=>{
    const key='node_modules/'+name,entry=old.packages?.[key];
    if(!entry)throw new Error('Dependência própria sem entrada no package-lock.json: '+name+'. Execute npm install no projeto antes de atualizar.');
    if(lock.packages[key]&&JSON.stringify(lock.packages[key])!==JSON.stringify(entry))throw new Error('Dependência própria em conflito com as ferramentas: '+name+'. Ajuste package.json/lockfile manualmente.');
    if(stack.has(name))return;lock.packages[key]=entry;
    for(const child of Object.keys({...entry.dependencies,...entry.optionalDependencies}))visit(child,new Set([...stack,name]));
  };
  for(const name of extras)visit(name);
  lock.packages['']={...lock.packages[''],...Object.fromEntries(['dependencies','devDependencies','optionalDependencies'].filter(k=>pkg[k]).map(k=>[k,pkg[k]]))};
  return {lock,extras};
}
// A new export provides preview/; only its preview files are used.
async function previewFromZip(zipPath,project) {
  const entries=unzipSync(new Uint8Array(await readFile(zipPath))),names=Object.keys(entries).filter(name=>!name.endsWith('/'));
  const manifests=names.filter(name=>name==='.yampi-sync/manifest.json'||name.endsWith('/.yampi-sync/manifest.json'));
  if(manifests.length!==1)throw new Error('Use um ZIP exportado pela extensão, com .yampi-sync/manifest.json.');
  const prefix=manifests[0].slice(0,-'.yampi-sync/manifest.json'.length);
  const manifest=JSON.parse(new TextDecoder().decode(entries[manifests[0]]));
  for(const key of ['storeName','previewOrigin','editorOrigin'])if(manifest.context?.[key]!==project.manifest.context[key])throw new Error('A nova exportação pertence a outra loja ou origem.');
  const preview=Object.create(null);
  for(const name of names){
    if(!name.startsWith(prefix))throw new Error('O ZIP contém mais de uma raiz de projeto.');
    const relative=name.slice(prefix.length);
    if(!relative.startsWith('preview/'))continue;
    if(relative.length>300||/[\\\u0000-\u001f:<>"|?*]/.test(relative)||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Caminho inseguro na prévia: '+relative);
    preview[relative]=Buffer.from(entries[name]);
  }
  if(!preview['preview/manifest.json'])throw new Error('A nova exportação não contém preview/manifest.json.');
  // Validate hashes and format before touching the project.
  const temporary=await mkdtemp(path.join(os.tmpdir(),'yampi-preview-check-'));
  try{
    for(const [name,bytes] of Object.entries(preview)){const target=path.join(temporary,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
    const loaded=await loadPreview(temporary,project);if(loaded.version!==2)throw new Error('A nova exportação usa um formato de prévia antigo.');
    const sameTheme=manifest.files?.length===project.manifest.files.length&&manifest.files.every(f=>project.manifest.files.some(o=>o.path===f.path&&o.sha256===f.sha256));
    return {files:preview,summary:{capturedAt:loaded.capturedAt,source:loaded.source,pages:loaded.pages.map(p=>p.kind+(p.context==='search'?' (busca)':'')),resources:loaded.resources.length,themeMatchesBaseline:sameTheme}};
  }finally{await rm(temporary,{recursive:true,force:true});}
}
export async function updateProject(target,{apply=false,preview:previewZip}={}) {
  if(Number(process.versions.node.split('.')[0])<24)throw new Error('Use Node.js 24.');
  if((await lstat(target)).isSymbolicLink())throw new Error('Pasta de destino não pode ser um link.');
  const root=await realpath(target);
  if(root===repository||root.startsWith(repository+path.sep)||repository.startsWith(root+path.sep))throw new Error('Mantenha o projeto da loja fora do repositório público da extensão.');
  const project=await readProject(root),pkgBytes=await safeRead(root,'package.json'),lockBytes=await safeRead(root,'package-lock.json'),pkg=JSON.parse(pkgBytes),lock=JSON.parse(lockBytes);
  const latest=JSON.parse(await readFile(path.join(runtime,'package.json'),'utf8')),template=JSON.parse(await readFile(path.join(runtime,'package-lock.json'),'utf8'));
  if(!lock.packages?.['']||!pkg.scripts||!pkg.dependencies)throw new Error('Pacote local não reconhecido.');
  // Current runtime and explicitly recorded historical tool hashes are trusted.
  // A user-edited tool is refused before writing anything, rather than replaced.
  const history=JSON.parse(await readFile(path.join(import.meta.dirname,'runtime-versions.json'),'utf8'));
  const changes=[],preserved=[],packageChanges=[];
  for(const name of tools) {
    const relative='.yampi-sync/tools/'+name,next=await readFile(path.join(runtime,name)),before=await existing(root,relative);
    if(before&&digest(before)!==digest(next)&&!history[name]?.includes(digest(before))&&!history[name]?.includes(digest(before.toString('utf8').replace(/\r\n/g,'\n'))))throw new Error('Ferramenta modificada pelo usuário; preservada sem atualização: '+relative);
    if(!before||!before.equals(next))changes.push({path:relative,before,next});
  }
  for(const [name,value] of Object.entries(latest.scripts)) {
    const previous=pkg.scripts[name];
    if(!previous||previous===value||previous===`node .yampi-sync/tools/dev.mjs${name==='check'?' --check':''}`){if(previous!==value)packageChanges.push({field:'scripts.'+name,before:previous??null,after:value});pkg.scripts[name]=value;}
    else preserved.push('script personalizado: '+name);
  }
  for(const [name,value] of Object.entries(latest.dependencies))if(pkg.dependencies[name]!==value){packageChanges.push({field:'dependencies.'+name,before:pkg.dependencies[name]??null,after:value});pkg.dependencies[name]=value;}
  // twig.js was replaced by Twing in 0.2.4; other dependencies are the user's own.
  for(const name of RETIRED)if(pkg.dependencies[name]&&!(name in latest.dependencies)){packageChanges.push({field:'dependencies.'+name,before:pkg.dependencies[name],after:null});delete pkg.dependencies[name];}
  if(/^0\.[23]\./.test(pkg.version)){packageChanges.push({field:'version',before:pkg.version,after:latest.version});pkg.version=latest.version;}
  for(const [name,value] of Object.entries(latest.overrides||{}))if(pkg.overrides?.[name]!==value){packageChanges.push({field:'overrides.'+name,before:pkg.overrides?.[name]??null,after:value});pkg.overrides={...pkg.overrides,[name]:value};}
  const merged=mergeLock(template,lock,pkg,latest.dependencies);if(merged.extras.length)preserved.push('dependências próprias mantidas no lockfile: '+merged.extras.join(', '));
  const nextLock={...merged.lock,name:lock.name??pkg.name,version:pkg.version};nextLock.packages['']={...nextLock.packages[''],name:lock.packages[''].name??pkg.name,version:pkg.version};
  const nextPkg=Buffer.from(json(pkg)),nextLockBytes=Buffer.from(json(nextLock));
  if(!pkgBytes.equals(nextPkg))changes.push({path:'package.json',before:pkgBytes,next:nextPkg});
  if(!lockBytes.equals(nextLockBytes))changes.push({path:'package-lock.json',before:lockBytes,next:nextLockBytes});
  let previewSummary=null;
  if(previewZip){
    const incoming=await previewFromZip(previewZip,project);previewSummary=incoming.summary;
    const current=await files(root,'preview');
    for(const relative of current)if(!incoming.files[relative])changes.push({path:relative,before:await safeRead(root,relative,32*1024*1024),next:null});
    for(const [relative,bytes] of Object.entries(incoming.files)){const before=await existing(root,relative,32*1024*1024);if(!before||!before.equals(bytes))changes.push({path:relative,before,next:bytes});}
    // A 0.2/0.3 local.data.json is a full data copy, not overrides. It is kept in
    // the backup and replaced by empty overrides; the plan lists it explicitly.
    const data=await existing(root,'local.data.json');let parsed;try{parsed=data&&JSON.parse(data);}catch{parsed=undefined;}
    if(data&&!isOverrides(parsed))changes.push({path:'local.data.json',before:data,next:Buffer.from(json({$comment:'Somente sobreposições da prévia; o arquivo anterior está no backup da atualização.',...emptyOverrides()})),note:'formato anterior movido para o backup'});
  }
  for(const change of changes)await destination(root,change.path);
  const plan={root,store:project.manifest.context.storeName,version:latest.version,apply,changed:changes.map(c=>({path:c.path,action:!c.before?'create':!c.next?'remove':'replace',...(c.note?{note:c.note}:{})})),packageChanges,preserved,preview:previewSummary,untouched:['tema/','.yampi-sync/baseline/','.yampi-sync/manifest.json','local.config.json',...(previewZip?[]:['preview/','local.data.json'])],visualContext:previewZip?'preview/ será substituída pela captura da nova exportação.':'Sem --preview, a captura existente é mantida. Uma atualização de ferramentas não captura dados ausentes; use --preview com uma nova exportação.'};
  if(!apply||!changes.length)return plan;
  const backup='.yampi-sync/updates/'+new Date().toISOString().replace(/[:.]/g,'-');const journal={...plan,completed:[],status:'prepared',backup,entries:changes.map(c=>({path:c.path,before:c.before?digest(c.before):null,after:c.next?digest(c.next):null}))};
  await mkdir(await destination(root,backup),{recursive:true});
  for(const change of changes)if(change.before){const file=await destination(root,backup+'/before/'+change.path);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,change.before,{flag:'wx'});}
  const journalPath=await destination(root,backup+'/journal.json');await writeFile(journalPath,json(journal),{flag:'wx'});
  try {
    for(const change of changes) {
      // Recheck against concurrent local edits before every replacement.
      const now=await existing(root,change.path,32*1024*1024);
      if(change.before?!now||digest(now)!==digest(change.before):now)throw new Error('Arquivo mudou durante a atualização: '+change.path);
      const file=await destination(root,change.path);
      if(change.next){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,change.next);}else await rm(file);
      journal.completed.push(change.path);await writeFile(journalPath,json(journal));
    }
    await readProject(root);journal.status='complete';await writeFile(journalPath,json(journal));return {...plan,backup};
  }catch(error){journal.status='partial';journal.error=error.message;await writeFile(journalPath,json(journal));throw error;}
}
// Restores every file recorded by an update, refusing files changed afterwards.
export async function rollbackProject(target,backup,{apply=false}={}) {
  const root=await realpath(target);
  if(!/^\.yampi-sync\/updates\/[\w-]+$/.test(backup))throw new Error('Informe a pasta do backup, por exemplo .yampi-sync/updates/2026-10-14T00-00-00-000Z.');
  const journal=JSON.parse(await safeRead(root,backup+'/journal.json',8*1024*1024));
  if(!Array.isArray(journal.entries))throw new Error('Registro de atualização sem a lista de arquivos; desfaça manualmente pelo backup.');
  const completed=new Set(journal.completed||[]),steps=[];
  for(const entry of journal.entries.filter(e=>completed.has(e.path))) {
    const now=await existing(root,entry.path,32*1024*1024);
    if(entry.after?!now||digest(now)!==entry.after:now)throw new Error('Arquivo alterado depois da atualização; nada foi desfeito: '+entry.path);
    steps.push({path:entry.path,restore:entry.before?await safeRead(root,backup+'/before/'+entry.path,32*1024*1024):null});
  }
  for(const step of steps)if(step.restore&&digest(step.restore)!==journal.entries.find(e=>e.path===step.path).before)throw new Error('Backup alterado: '+step.path);
  const plan={root,backup,apply,restore:steps.map(s=>({path:s.path,action:s.restore?'restore':'remove'}))};
  if(!apply)return plan;
  for(const step of steps){const file=await destination(root,step.path);if(step.restore){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,step.restore);}else await rm(file);}
  journal.status='rolled-back';await writeFile(await destination(root,backup+'/journal.json'),json(journal));
  await readProject(root);return plan;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),target=args[0],option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
  if(!target||target.startsWith('--')){console.error('Uso: node scripts/update-project.mjs "C:/caminho/projeto" [--preview nova-exportacao.zip] [--apply]\n     node scripts/update-project.mjs "C:/caminho/projeto" --rollback .yampi-sync/updates/<data> [--apply]\nSem --apply, apenas mostra o plano.');process.exitCode=1;}
  else try{
    const result=args.includes('--rollback')?await rollbackProject(path.resolve(target),option('--rollback'),{apply:args.includes('--apply')}):await updateProject(path.resolve(target),{apply:args.includes('--apply'),preview:option('--preview')&&path.resolve(option('--preview'))});
    console.log(json(result));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
