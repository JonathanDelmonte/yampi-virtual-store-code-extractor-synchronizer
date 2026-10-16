import {preparePreview, finishPreview, unauthorizedOrigins, type PreviewDraft, type PreviewFetch} from './browser/preview-capture';
import {demonstration, publicUrl, type PreviewBundle} from './core/preview';
import {BrowserAdapter, type RPC} from './browser/adapter';
import {PanelConnection} from './browser/panel-connection';
import {zipInWorker} from './browser/zip-client';
import {capture, applyPlan} from './core/workflow';
import {encodeSnapshot, decodeProject, readProjectDirectory} from './core/archive';
import {makePlan, missingNewTexts, selectionIssues, sendable} from './core/planner';
import {COMPONENTS_FILE} from '../local-runtime/contract.mjs';
import {assertContext, writable, MAX_TOTAL_BYTES, MAX_FILE_BYTES, type Context, type Assets, type Snapshot, type Files, type Plan, type PlanRow, type Journal, type Progress} from './core/model';
import {put, get, clearLocal, saveJournal, journalHistory, contextKey} from './storage';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const isDemo = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('demo') === '1';
let session: string | undefined;
let currentContext: Context | undefined;
let pendingPreview: {snapshot:Snapshot;draft:PreviewDraft;bundle:PreviewBundle;origins:string[]} | undefined;
const editorTab = new URLSearchParams(location.search).get('tab');
let baseline: Snapshot | undefined, local: Files | undefined, plan: Plan | undefined, journal: Journal | undefined;
let working = false, connected = false, controller: AbortController | undefined;
let localAssets: Assets = {}, history: Journal[] = [];
// The store as last compared, and the conflicts the user chose to settle with the project version.
let remote: Snapshot | undefined;
const selected = new Set<string>(), overrides = new Set<string>();
let rpc: RPC;
let connection: PanelConnection | undefined;
if (isDemo) {
  $('demo-notice').hidden = false;
  $('fixture').hidden = false;
  const frame = $<HTMLIFrameElement>('fixture-frame');
  frame.src = 'fixture.html';
  await new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), {once: true}));
  rpc = async request => {
    if (request.action === 'lock' || request.action === 'unlock') return null;
    if (request.action === 'refresh') {
      await new Promise<void>(resolve => {frame.addEventListener('load', () => resolve(), {once: true}); frame.contentWindow!.location.reload();});
      return null;
    }
    const api = (frame.contentWindow as unknown as {YampiThemeSyncBridge: {command: (r: unknown) => Promise<{ok: boolean; value: unknown; error?: string}>}}).YampiThemeSyncBridge;
    const reply = await api.command(request.command);
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  };
} else {
  connection = new PanelConnection(chrome.runtime, () => {
    const wasConnected = connected; connected = false;
    controller?.abort(); $('connection-state').textContent = 'Editor desconectado';
    // Preserve the precise initial diagnostic instead of replacing it with a generic disconnect.
    if (wasConnected && !working) status('Conexão encerrada', 'Clique em Tentar conectar novamente. Nenhum envio será retomado automaticamente.', true);
    controls();
  });
  rpc = connection.request;
  window.addEventListener('pagehide', () => connection?.close());
}
const adapter = new BrowserAdapter(rpc);
document.addEventListener('keydown', () => {document.body.dataset.input = 'keyboard';});
document.addEventListener('pointerdown', () => {delete document.body.dataset.input;});
function mode(importing: boolean, pointerClick = false): void {
  const incoming = $(importing ? 'import-section' : 'export-section');
  const changed = incoming.hidden;
  $('export-section').hidden = importing; $('import-section').hidden = !importing;
  $('mode-export').setAttribute('aria-pressed', String(!importing)); $('mode-import').setAttribute('aria-pressed', String(importing));
  $('review').hidden = !importing || !plan; $('confirm-panel').hidden = true;
  if (!importing) {$('diff').hidden = true; $('done').hidden = true;}
  if (changed) incoming.getAnimations().forEach(animation => animation.cancel());
  if (changed && pointerClick && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    incoming.animate([{opacity: 0, transform: 'translateY(4px)'}, {opacity: 1, transform: 'translateY(0)'}], {duration: 180, easing: 'cubic-bezier(.23,1,.32,1)'});
  }
}
$('mode-export').addEventListener('click', event => mode(false, event.detail > 0));
for (const id of ['mode-import', 'go-import']) $(id).addEventListener('click', event => mode(true, event.detail > 0));
if (isDemo) $('demo-local').addEventListener('click', () => {
  if (working || !baseline) {status('Exporte a loja fictícia primeiro.'); return;}
  const sample = {...baseline.files};
  sample['elements/head.twig'] += '<!-- Redesign local -->\n';
  sample['sections/home/main_banner.twig'] += '<!-- Banner revisado -->\n';
  sample['assets/styles/global/main.scss'] += 'body { background: white; }\n';
  sample['assets/images/readme.md'] += 'Mudança não suportada\n';
  sample['templates/new.twig'] = '<p>Novo</p>\n<img src="{{ \'images/demo/nova.png\' | assets_url }}" alt="">\n';
  const assets: Assets = {...baseline.assets, 'assets/images/demo/nova.png': baseline.assets?.['assets/images/example.png'] || new Uint8Array()};
  setLocal(sample, assets); controls(); status('Alterações fictícias carregadas', 'Amostra com alterações de código, um arquivo novo, uma imagem em subpasta e um tipo sem suporte.');
});
function status(text: string, detail = '', error = false): void {
  $('status').textContent = text; $('detail').textContent = detail;
  document.querySelector('.activity')!.classList.toggle('error', error);
}
function progress(p: Progress): void {
  const bar = $<HTMLProgressElement>('progress');
  bar.hidden = false; bar.max = p.total; bar.value = p.done;
  status(`${p.phase} · ${p.done}/${p.total}`, p.path);
}
function controls(): void {
  $('export').toggleAttribute('disabled', working || !connected || !!pendingPreview);
  $('export').title = working ? 'Aguarde a operação atual terminar.' : !connected ? 'Abra o Editor de código da Yampi e conecte a extensão.' : pendingPreview ? 'Finalize ou descarte a captura visual em preparação.' : 'Ler os arquivos da loja e baixar uma cópia em ZIP.';
  const missing = plan ? missingNewTexts(plan).length : 0;
  $('include-preview').toggleAttribute('disabled',working);
  $('preview-pending').hidden=!pendingPreview;
  for(const id of ['preview-allow','preview-partial','preview-discard'])$(id).toggleAttribute('disabled',working||!pendingPreview);
  $('compare').toggleAttribute('disabled', working || !connected || !baseline || !local);
  const partial = plan ? selectionIssues(plan, selected) : [], blocked = !!missing || partial.length > 0;
  $('apply').toggleAttribute('disabled', working || !connected || !plan || !selected.size || blocked);
  $('apply').textContent = plan && selected.size ? `Enviar ${selected.size} ${selected.size === 1 ? 'item' : 'itens'} para ${plan.context.storeName}` : 'Enviar para a loja';
  $('apply').title = working ? 'Aguarde a operação atual terminar.' : !connected ? 'Conecte ao Editor de código da Yampi.' : !plan || !selected.size ? 'Nada pronto para enviar. Confira o resumo.' : missing ? 'Ajuste no projeto os arquivos novos que a Yampi não permite criar.' : partial.length ? 'Arquivos que usam uns aos outros precisam ser enviados juntos.' : 'Revise e confirme o envio.';
  if (working || !plan || !selected.size || blocked) $('confirm-panel').hidden = true;
  $('confirm-send').toggleAttribute('disabled', working || !connected);
  $('discard-whitespace').hidden = !plan?.rows.some(r => r.status === 'update' && r.whitespaceOnly);
  $('discard-whitespace').toggleAttribute('disabled', working);
  for (const id of ['baseline', 'folder', 'cancel-send', 'clear', 'filter', 'demo-local', 'history', 'download-journal', 'retry', 'mode-export', 'mode-import', 'go-import']) $(id).toggleAttribute('disabled', working);
  $('retry').hidden = connected || !editorTab && !isDemo;
  $('restore').toggleAttribute('disabled', working || !connected || !journal);
  $('undo').toggleAttribute('disabled', working || !connected || !journal);
  $('download-backup').toggleAttribute('disabled', working || !journal);
  $('download-journal').toggleAttribute('disabled', working || !journal);
  $('cancel').hidden = !working;
  document.querySelectorAll<HTMLInputElement>('#rows input').forEach(input => {
    const path = input.getAttribute('aria-label')?.slice(7);
    input.disabled = working || !sendable(plan?.rows.find(r => r.path === path));
  });
}
async function run(job: () => Promise<void>, needsEditor = true, prepare?: () => Promise<void>, access: 'read' | 'write' = 'read'): Promise<void> {
  if (working) return;
  working = true; controller = new AbortController(); controls();
  let locked = false;
  try {await prepare?.(); if (needsEditor) {await rpc({action: 'lock', access}); locked = true;} await job();}
  catch (error) {status('Operação interrompida', error instanceof Error ? error.message : String(error), true);}
  finally {
    if (locked) await rpc({action: 'unlock'}).catch(() => {});
    working = false; controller = undefined; $('progress').hidden = true; controls();
  }
}
function fileName(prefix: string, storeName = baseline?.context.storeName || 'tema'): string {
  const store = storeName.normalize('NFKD').replace(/[^\w-]+/g, '-').toLowerCase();
  return `${prefix}-${store}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
}
async function download(bytes: Uint8Array, name: string, type = 'application/zip'): Promise<void> {
  const blob = new Blob([new Uint8Array(bytes)], {type});
  const url = URL.createObjectURL(blob);
  try {
    if (isDemo) {
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      // The demo has no browser download API. IndexedDB backup is still persisted before saving.
      await new Promise(r => setTimeout(r, 100));
    } else {
      const id = await chrome.downloads.download({url, filename: name, saveAs: false, conflictAction: 'uniquify'});
      const start = Date.now();
      for (;;) {
        const [item] = await chrome.downloads.search({id});
        if (item?.state === 'complete') break;
        if (item?.state === 'interrupted') throw new Error('Download cancelado ou interrompido. Nenhum envio foi iniciado.');
        if (Date.now() - start > 120000) throw new Error('O download do backup não foi confirmado. Nenhum envio foi iniciado.');
        await new Promise(r => setTimeout(r, 250));
      }
    }
  } finally {URL.revokeObjectURL(url);}
}
function setBaseline(snapshot: Snapshot): void {
  baseline = snapshot; plan = undefined; selected.clear(); $('review').hidden = true; $('diff').hidden = true; $('done').hidden = true;
  const images = Object.keys(snapshot.assets || {}).length;
  $('baseline-info').textContent = `${Object.keys(snapshot.files).length} textos e ${images} ${images === 1 ? 'imagem' : 'imagens'} · ${snapshot.context.storeName} · ${new Date(snapshot.capturedAt).toLocaleString('pt-BR')}`;
}
function setLocal(files: Files, assets: Assets = {}): void {
  local = files; localAssets = assets; plan = undefined; selected.clear(); $('review').hidden = true; $('diff').hidden = true; $('done').hidden = true;
  const images = Object.keys(assets).length;
  $('local-info').textContent = `${Object.keys(files).length} textos e ${images} ${images === 1 ? 'imagem' : 'imagens'} carregados do computador.`;
}
const labels: Record<PlanRow['status'], string> = {
  update: 'Pronto para envio', create: 'Novo · será criado', upload: 'Imagem nova · será enviada', unchanged: 'Sem alterações', 'remote-only': 'Mudou apenas na loja', 'already-applied': 'Já está na loja', conflict: 'Conflito', 'missing-local': 'Ausente no projeto · preservado', 'missing-remote': 'Removido na loja · bloqueado', 'new-local': 'Novo · a Yampi não permite criar', unsupported: 'Sem suporte · bloqueado', 'blocked-dependency': 'Bloqueado', 'whitespace-only': 'Só espaço em branco · descartado'
};
const label = (row: PlanRow) => row.status === 'update' && row.override ? 'Usará a versão do projeto' : row.status === 'update' && row.base === undefined ? 'Novo · será preenchido' : labels[row.status];
const short = (path: string) => path.replace(/^assets\//, '');
function rowNote(row: PlanRow): string {
  return [row.source ? `Do projeto: ${row.source}` : '', row.rewritten ? `${row.rewritten} ${row.rewritten === 1 ? 'referência de imagem ajustada' : 'referências de imagem ajustadas'}` : '', row.reason || '', row.blockedBy?.length ? 'Depende de: ' + row.blockedBy.join(', ') : '', row.dependsOn?.length ? 'Vai junto com: ' + row.dependsOn.join(', ') : ''].filter(Boolean).join(' · ');
}
function showDiff(row: PlanRow, pointerClick: boolean): void {
  $('diff-title').textContent = row.source ? `${row.source} → ${row.path}` : row.path;
  for (const [kind, id] of [['base', 'diff-base'], ['local', 'diff-local'], ['remote', 'diff-remote']] as const) {
    if (row.image) {const bytes = row.image[kind]; $(id).textContent = bytes ? `Imagem · ${bytes.length} bytes` : '(ausente)';}
    else $(id).textContent = row[kind] ?? '(ausente)';
  }
  $('diff').hidden = false;
  $('diff').scrollIntoView({behavior: pointerClick && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant', block: 'nearest'});
}
function item(text: string, ...actions: HTMLElement[]): HTMLLIElement {
  const li = document.createElement('li'), span = document.createElement('span'); span.textContent = text; li.append(span, ...actions); return li;
}
function action(text: string, run: (event: MouseEvent) => void): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = text; button.addEventListener('click', run); return button;
}
// Only what needs a decision or a fix in the project, in plain words, with the action that solves it.
function attention(): HTMLLIElement[] {
  if (!plan) return [];
  const items: HTMLLIElement[] = [];
  for (const row of plan.rows) {
    const view = action('Ver versões', event => showDiff(row, event.detail > 0));
    if (row.override) items.push(item(`${row.path}: vai a versão do projeto. A versão da loja fica no backup do envio.`, view, action('Manter a versão da loja', () => {overrides.delete(row.path); replan();})));
    else if (row.status === 'conflict' && !row.image && writable(row.path)) items.push(item(`${row.path} mudou na loja depois da sua cópia. Sem escolha, fica a versão da loja.`, view, action('Usar a versão do projeto', () => {
      if (!confirm(`Usar a versão do projeto em ${row.path}? A versão atual da loja fica no backup do envio.`)) return;
      overrides.add(row.path); replan();
    })));
    else if (row.status === 'conflict') items.push(item(`${row.path} mudou na loja depois da sua cópia, e a extensão não pode substituí-lo.`, view));
    else if (row.status === 'new-local' || row.status === 'blocked-dependency' || row.status === 'unsupported' && row.reason && row.path !== COMPONENTS_FILE) items.push(item(`${row.source || row.path}: ${row.reason || (row.blockedBy?.length ? `usa ${row.blockedBy.join(', ')}, que não pode ser enviado.` : 'não pode ser enviado.')}`, view));
    else if (row.status === 'missing-remote') items.push(item(`${row.path} foi removido da loja e não será recriado.`, view));
  }
  for (const issue of selectionIssues(plan, selected)) items.push(item(`${issue.path} precisa ir junto com ${issue.requires}.`));
  for (const warning of plan.warnings || []) items.push(item(`${warning.path}: ${warning.message}`));
  return items;
}
function replan(): void {
  if (!baseline || !local || !remote) return;
  plan = makePlan(baseline, local, remote, localAssets, {overrides});
  // Whitespace-only differences start unselected; coupled files start together.
  selected.clear(); plan.rows.filter(r => sendable(r) && !r.whitespaceOnly).forEach(r => selected.add(r.path));
  renderPlan(); controls();
}
function renderPlan(): void {
  if (!plan) return;
  const count = (test: (row: PlanRow) => boolean) => plan!.rows.filter(test).length;
  const changed = count(r => r.status === 'update' && !r.whitespaceOnly && r.base !== undefined), created = count(r => r.status === 'create' || r.status === 'update' && r.base === undefined);
  const images = count(r => r.status === 'upload'), same = count(r => ['unchanged', 'already-applied', 'missing-local', 'remote-only'].includes(r.status));
  const conflicts = count(r => r.status === 'conflict'), blocked = count(r => ['blocked-dependency', 'new-local', 'missing-remote'].includes(r.status) || r.status === 'unsupported' && !!r.reason && r.path !== COMPONENTS_FILE), whitespace = count(r => r.status === 'update' && !!r.whitespaceOnly);
  $('count-update').textContent = String(changed); $('count-create').textContent = String(created); $('count-upload').textContent = String(images); $('count-same').textContent = String(same);
  $('summary').textContent = `${selected.size} para enviar · ${changed} alterados · ${created} novos · ${images} imagens · ${conflicts} conflitos · ${blocked} bloqueados${whitespace ? ` · ${whitespace} só espaço em branco` : ''} · ${plan.rows.length} caminhos comparados`;
  const moved = plan.rows.filter(r => r.status === 'upload' && r.source);
  $('moves-title').textContent = moved.length ? `${moved.length} ${moved.length === 1 ? 'imagem vai' : 'imagens vão'} direto para assets/images, porque a Yampi não aceita subpastas. As referências nos arquivos enviados são ajustadas automaticamente.` : '';
  $('moves-list').replaceChildren(...moved.map(r => item(`${short(r.source!)} → ${short(r.path)}`)));
  $('moves').hidden = !moved.length;
  const items = attention();
  $('attention-list').replaceChildren(...items);
  $('attention').hidden = !items.length;
  $('review-title').textContent = missingNewTexts(plan).length ? 'Ajuste o projeto antes de enviar.' : !selected.size ? 'Nada para enviar.' : items.length ? 'Revise antes de enviar.' : 'Pronto para enviar.';
  const filter = $<HTMLSelectElement>('filter').value;
  $('rows').replaceChildren();
  for (const row of plan.rows) {
    if (filter === 'changes' && ['unchanged', 'already-applied', 'missing-local'].includes(row.status)) continue;
    if (filter === 'update' && !sendable(row) || filter === 'conflict' && row.status !== 'conflict' || filter === 'whitespace' && !row.whitespaceOnly && row.status !== 'whitespace-only' || filter === 'blocked' && !['blocked-dependency', 'new-local', 'missing-remote', 'unsupported'].includes(row.status)) continue;
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', `Enviar ${row.path}`);
    checkbox.disabled = !sendable(row) || working; checkbox.checked = selected.has(row.path);
    checkbox.addEventListener('change', () => {checkbox.checked ? selected.add(row.path) : selected.delete(row.path); renderPlan(); controls();});
    td.append(checkbox);
    const pathCell = document.createElement('td'); pathCell.className = 'path'; pathCell.textContent = row.path;
    const result = document.createElement('td'), badge = document.createElement('span'); badge.className = `row-status ${row.status}`; badge.textContent = label(row) + (row.status === 'update' && row.whitespaceOnly ? ' · só espaço em branco' : ''); result.append(badge);
    const detail = rowNote(row);
    if (detail) {const note = document.createElement('small'); note.className = 'row-detail'; note.textContent = detail; result.append(note);}
    const cell = document.createElement('td'), button = document.createElement('button'); button.textContent = 'Ver versões'; button.addEventListener('click', event => showDiff(row, event.detail > 0)); cell.append(button);
    tr.append(td, pathCell, result, cell); $('rows').append(tr);
  }
  $('review').hidden = false;
  $('target-store').textContent = plan.context.storeName;
}
async function compare(): Promise<void> {
  if (!baseline || !local) throw new Error('Carregue a exportação original e a pasta editada.');
  status('Relendo o estado atual da loja…');
  $('done').hidden = true; $('confirm-panel').hidden = true;
  await adapter.refresh();
  remote = await capture(adapter, {signal: controller?.signal, progress});
  overrides.clear(); replan();
  const created = plan!.rows.filter(r => r.status === 'create').length, images = plan!.rows.filter(r => r.status === 'upload').length;
  status('Comparação concluída', missingNewTexts(plan!).length ? 'Há arquivos novos que a Yampi não permite criar. Veja abaixo o que ajustar no projeto.' : selected.size ? `Confira o resumo e clique em enviar.${created || images ? ` A extensão cria ${created} ${created === 1 ? 'arquivo' : 'arquivos'} e envia ${images} ${images === 1 ? 'imagem' : 'imagens'} pelo próprio editor da Yampi.` : ''}` : 'Nada para enviar: a loja já está igual ao projeto, ou os itens abaixo precisam de ajuste.');
}
function journalInfo(): void {
  $('journal-info').textContent = journal ? `${journal.verified.length + (journal.uploaded?.length || 0)}/${journal.selected.length} conferidos · ${journal.status === 'completed' ? 'concluído' : 'envio interrompido ou pendente'} · ${new Date(journal.startedAt).toLocaleString('pt-BR')}` : 'Nenhum envio nesta instalação.';
}
async function updateHistory(): Promise<void> {
  if (!journal) return;
  history = await journalHistory(journal.context);
  const picker = $<HTMLSelectElement>('history'); picker.replaceChildren();
  for (const item of history) {
    const option = document.createElement('option'); option.value = item.id;
    option.textContent = `${new Date(item.startedAt).toLocaleString('pt-BR')} · ${item.status} · ${item.verified.length}/${item.selected.length}`;
    picker.append(option);
  }
  picker.value = journal.id;
}
function requestScopes(origins:string[]):Promise<boolean> {
  if(isDemo)return Promise.resolve(false);
  return chrome.permissions.request({origins:origins.map(origin=>publicUrl(origin,origin).replace(/\/$/,'')+'/*')}).catch(()=>false);
}
function remoteFetch(snapshot:Snapshot):PreviewFetch {
  // The authenticated worker checks the same context before AND after every GET.
  return async url=>{if(controller?.signal.aborted)throw new Error('Cancelado.');
    const reply=await rpc({action:'preview-fetch',preview:{url,context:snapshot.context}}) as {encoded:string;type:string;url:string};
    return {bytes:Uint8Array.from(atob(reply.encoded),c=>c.charCodeAt(0)),type:reply.type,url:reply.url};};
}
async function deliverProject(snapshot:Snapshot,visual:PreviewBundle):Promise<void> {
  assertContext(snapshot.context,await adapter.context());
  status('Preparando ZIP…','Compactação local em segundo plano. O código e as imagens originais são preservados.');
  const bytes=await encodeSnapshot(snapshot,true,visual,{signal:controller?.signal,compress:zipInWorker});
  await put(`baseline:${await contextKey(snapshot.context)}`,snapshot);
  await download(bytes,fileName('exportacao',snapshot.context.storeName));
  setBaseline(snapshot);pendingPreview=undefined;
  const source=visual.source.kind==='demonstration'?'demonstrativa':'parcial — '+(visual.source.kind==='editor'?'dados do editor':'vitrine publicada, rascunho não vinculado');
  const kinds=[...new Set(visual.pages.map(p=>p.kind+(p.context==='search'?' (busca)':'')))].join(', ')||'nenhuma';
  const megabytes=(Object.values(visual.assets).reduce((sum,bytes)=>sum+bytes.length,0)/1048576).toFixed(1).replace('.',',');
  $('preview-info').textContent=`Prévia ${source}. ${visual.pages.length} páginas (${kinds}); ${Object.keys(visual.assets).length} recursos locais (${megabytes} MB); ${visual.api.length} leituras públicas gravadas; ${visual.issues.length} observações. Relatório: preview/report.json. Execute npm run check para conferir seções e CSS. Fidelidade visual não validada automaticamente.`;
  status('ZIP da loja baixado','Código preservado. '+$('preview-info').textContent);
}
async function completeVisual(snapshot:Snapshot,draft:PreviewDraft,origins:string[]):Promise<void> {
  await rpc({action:'preview-allow',preview:{origins,context:snapshot.context}});
  const bundle=await finishPreview(draft,remoteFetch(snapshot),origins,controller?.signal,(done,total)=>progress({done,total,path:'Imagens, fontes e estilos',phase:'Baixando recursos visuais'}));
  const missing=unauthorizedOrigins(bundle);
  if(missing.length) {
    pendingPreview={snapshot,draft,bundle,origins};
    $('preview-origins').textContent=missing.join(', ');
    status('Código copiado; recursos visuais aguardam autorização','Autorize somente as origens listadas para incluir imagens/fontes no ZIP, ou baixe uma prévia parcial. Nenhum arquivo da Yampi foi alterado.');
  } else await deliverProject(snapshot,bundle);
}
async function exportProject(permission:Promise<boolean>):Promise<void> {
  if(!connected)throw new Error('Abra o editor de código Yampi e clique no ícone da extensão.');
  const snapshot=await capture(adapter,{signal:controller?.signal,progress});
  const enabled=await permission;
  if(!enabled){await deliverProject(snapshot,demonstration(snapshot.context,'Captura visual não autorizada ou desativada. Código exportado; configurações, catálogo de amostra, imagens e fontes visuais não foram capturados.',Object.keys(snapshot.files)));return;}
  status('Capturando contexto visual público…','Somente leituras, sem scripts da vitrine. A publicação pode diferir do rascunho.');
  const editorData=await adapter.visual();
  const draft=await preparePreview(snapshot,remoteFetch(snapshot),{editorData,enabled:true,signal:controller?.signal});
  await completeVisual(snapshot,draft,[snapshot.context.previewOrigin]);
}
$('export').addEventListener('click',()=>{const permission=$<HTMLInputElement>('include-preview').checked&&currentContext?requestScopes([currentContext.previewOrigin]):Promise.resolve(false);void run(()=>exportProject(permission));});
$('preview-allow').addEventListener('click',()=>{const pending=pendingPreview;if(!pending)return;
  const missing=unauthorizedOrigins(pending.bundle);
  const permission=requestScopes(missing);
  void run(async()=>{if(!await permission){status('Permissão não concedida','Você pode baixar com a prévia parcial.');return;}
    const origins=[...new Set([...pending.origins,...missing])];
    await completeVisual(pending.snapshot,pending.draft,origins);});
});
$('preview-partial').addEventListener('click',()=>{const pending=pendingPreview;if(pending)void run(()=>deliverProject(pending.snapshot,pending.bundle));});
$('preview-discard').addEventListener('click',()=>{pendingPreview=undefined;controls();status('Preparação visual descartada','Nenhum arquivo da Yampi foi alterado.');});
$('baseline').addEventListener('change', () => void run(async () => {
  const file = $<HTMLInputElement>('baseline').files?.[0]; if (!file) return;
  if (file.size > MAX_TOTAL_BYTES * 2 + MAX_FILE_BYTES) throw new Error('ZIP muito grande.');
  status('Conferindo a exportação original…');
  const project = await decodeProject(new Uint8Array(await file.arrayBuffer()));
  if (connected) assertContext(project.baseline.context, await adapter.context());
  setBaseline(project.baseline); setLocal(project.local, project.localAssets); await put(`baseline:${await contextKey(project.baseline.context)}`, project.baseline);
  mode(true);
  if (connected) await compare();
  else status('Projeto ZIP carregado', 'Conecte ao editor para comparar e enviar as alterações.');
}, connected));
$('folder').addEventListener('change', () => void run(async () => {
  const files = $<HTMLInputElement>('folder').files; if (!files?.length) return;
  status('Lendo os arquivos locais…');
  const project = await readProjectDirectory(files);
  if ('baseline' in project) {
    if (connected) assertContext(project.baseline.context, await adapter.context());
    setBaseline(project.baseline); await put(`baseline:${await contextKey(project.baseline.context)}`, project.baseline);
  }
  setLocal(project.local, project.localAssets); mode(true);
  if (connected) await compare();
  else status('Pasta local carregada', 'Conecte ao editor para comparar e enviar as alterações.');
}, connected));
$('compare').addEventListener('click', () => void run(compare));
$('discard-whitespace').addEventListener('click', () => {
  if (!plan || working) return;
  for (const row of plan.rows) if (row.status === 'update' && row.whitespaceOnly) {row.status = 'whitespace-only'; selected.delete(row.path);}
  renderPlan(); controls(); status('Alterações só de espaço em branco descartadas', 'Esses arquivos não serão enviados. Compare novamente para reavaliar.');
});
$('filter').addEventListener('change', renderPlan);
$('close-diff').addEventListener('click', () => {$('diff').hidden = true;});
$('cancel').addEventListener('click', () => {controller?.abort(); status('Interrupção solicitada', 'A operação para após conferir o arquivo em andamento.');});
$('apply').addEventListener('click', () => {
  if (!plan || !selected.size || working) return;
  $('target-store').textContent = plan.context.storeName; $('confirm-panel').hidden = false; $('confirm-send').focus();
});
$('cancel-send').addEventListener('click', () => {$('confirm-panel').hidden = true; $('apply').focus();});
$('confirm-send').addEventListener('click', () => void run(async () => {
  if (!plan) throw new Error('Compare novamente antes de enviar.');
  const current = plan;
  // Freeze selection and invalidate the plan; retries always require another comparison.
  const chosen = [...selected]; plan = undefined; selected.clear(); $('confirm-panel').hidden = true; $('review').hidden = true; $('diff').hidden = true;
  const result = await applyPlan(adapter, current, chosen, {
    signal: controller?.signal, progress,
    persist: async value => {await saveJournal(value); journal = structuredClone(value); journalInfo(); await updateHistory();},
    backup: async value => {const zip = await encodeSnapshot(value); await put(`backup:${journal!.id}`, {journalId: journal!.id, bytes: zip}); await download(zip, fileName('backup-antes-do-envio'));}
  });
  const texts = result.verified.length, created = result.created?.length || 0, images = result.uploaded?.length || 0;
  $('done-summary').textContent = `${texts} ${texts === 1 ? 'arquivo salvo' : 'arquivos salvos'}${created ? `, ${created} ${created === 1 ? 'deles criado' : 'deles criados'} pela extensão` : ''}${images ? ` e ${images} ${images === 1 ? 'imagem enviada' : 'imagens enviadas'}` : ''}. Cada item foi conferido na Yampi depois de recarregar o editor.`;
  $('done-warnings').replaceChildren(...(result.warnings || []).map(text => item(text)));
  $('done-warnings').hidden = !result.warnings?.length;
  $('done').hidden = false;
  status('Arquivos salvos e conferidos após recarregar', 'Abra Ver prévia na Yampi e valide a loja. A extensão não publicou as alterações.');
}, true, undefined, 'write'));
$('download-backup').addEventListener('click', () => void run(async () => {
  const stored = await get<{journalId: string; bytes: Uint8Array}>(`backup:${journal?.id}`);
  if (!stored || stored.journalId !== journal?.id) throw new Error('O backup deste envio não foi concluído. Consulte o registro ou a exportação original.');
  await download(stored.bytes, fileName('backup')); status('Backup baixado');
}, false));
$('history').addEventListener('change', () => {journal = history.find(j => j.id === $<HTMLSelectElement>('history').value); journalInfo(); controls();});
$('download-journal').addEventListener('click', () => void run(async () => {
  if (!journal) throw new Error('Selecione um envio no histórico.');
  await download(new TextEncoder().encode(JSON.stringify(journal, null, 2)), `registro-${journal.id}.json`, 'application/json');
  status('Registro do envio baixado', 'Contém versões anteriores, propostas e caminhos pendentes para recuperação. Guarde fora do repositório.');
}, false));
// Undo is a new comparison from the send record: the sent version becomes the original, the previous one the project.
async function prepareRestore(): Promise<void> {
  if (!journal) return;
  setBaseline({context: journal.context, capturedAt: journal.startedAt, files: journal.after});
  setLocal(journal.before); mode(true); await compare();
  status('Restauração preparada para revisão', 'Apenas arquivos ainda iguais ao último envio voltam ao estado anterior; alterações posteriores ficam como conflitos. Arquivos criados voltam a ficar vazios, e imagens enviadas continuam na loja.');
}
for (const id of ['restore', 'undo']) $(id).addEventListener('click', () => void run(prepareRestore));
$('clear').addEventListener('click', async () => {
  if (!confirm('Apagar as cópias originais e o último backup guardados nesta extensão? Os ZIPs já baixados continuam no computador. Nenhum arquivo da loja será alterado.')) return;
  await clearLocal(); baseline = undefined; local = undefined; localAssets = {}; plan = undefined; journal = undefined; history = []; $('history').replaceChildren(); selected.clear();
  remote = undefined; overrides.clear();
  $('review').hidden = true; $('diff').hidden = true; $('done').hidden = true; $('baseline-info').textContent = 'Nenhuma exportação concluída.'; $('local-info').textContent = 'Nenhum projeto escolhido.';
  journalInfo(); status('Dados locais da extensão apagados'); controls();
});
async function connect(): Promise<void> {
  if (working) return;
  connected = false; $('connection-state').textContent = 'Editor desconectado';
  await run(async () => {
  status('Conectando ao editor…');
  const context = await adapter.context(); currentContext=context; connected = true;
  $('store').textContent = context.storeName; $('connection-state').textContent = 'Editor conectado';
  const previous = await get<Snapshot>(`baseline:${await contextKey(context)}`) || await get<Snapshot>('baseline');
  if (previous) try {assertContext(previous.context, context); setBaseline(previous);} catch { /* A backup from another shop is never selected implicitly. */ }
  history = await journalHistory(context); journal = history[0] || await get<Journal>('journal');
  if (journal) try {assertContext(journal.context, context);} catch {journal = undefined;}
  if (journal && !history.length) {await saveJournal(journal); const backup = await get('lastBackup'); if (backup) await put(`backup:${journal.id}`, backup);}
  await updateHistory(); journalInfo(); status('Editor conectado', 'A cópia aguarda sua confirmação. Confira a loja e clique em Confirmar e baixar ZIP para começar.');
  }, true, async () => {if (connection) {await connection.connect(); session = connection.token;}});
  if (!connected) $('store').textContent = 'Editor indisponível';
}
$('retry').addEventListener('click', () => void connect());
if (!isDemo && editorTab) chrome.runtime.onMessage.addListener(message => {
  if (message?.editorClicked === session && !working) {
    mode(false);
    if (!connected) void connect();
    else status('Aguardando sua confirmação', 'Clique em Confirmar e baixar ZIP para copiar os arquivos para o computador.');
  }
});
if (isDemo || editorTab) await connect();
else {status('Abra pelo ícone da extensão', 'No editor de código da Yampi, clique no ícone para conectar e baixar o tema.'); controls();}
