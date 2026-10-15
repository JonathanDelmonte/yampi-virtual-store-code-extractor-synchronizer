import {hashBytes, validateContext, type Context, type Assets} from './model';
export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
export type Data = {[key: string]: Json};
export interface PreviewIssue {code: string; resource?: string; reason: string}
export interface PreviewPage {id: string; kind: string; sourceUrl: string; data: Data}
export interface PreviewResource {url: string; path: string; type: string; bytes: number; sha256: string}
export interface PreviewBundle {
  format: 'yampi-local-preview'; version: 1; toolVersion: string; capturedAt: string;
  source: {kind: 'editor' | 'published' | 'demonstration'; origin: string; association: 'same-editor' | 'published-unverified' | 'unavailable'};
  limits: PreviewLimits; data: Data; pages: PreviewPage[]; assets: Assets; resources: PreviewResource[];
  styles: string[]; issues: PreviewIssue[];
}
export interface PreviewLimits {pages: number; products: number; resources: number; resourceBytes: number; totalBytes: number; jsonBytes: number; timeoutMs: number}
export const PREVIEW_LIMITS: PreviewLimits = {pages: 7, products: 24, resources: 120, resourceBytes: 2 * 1024 * 1024, totalBytes: 24 * 1024 * 1024, jsonBytes: 2 * 1024 * 1024, timeoutMs: 15000};
export function previewLimits(input: Partial<PreviewLimits> = {}): PreviewLimits {
  const output = {...PREVIEW_LIMITS, ...input};
  for (const key of Object.keys(PREVIEW_LIMITS) as (keyof PreviewLimits)[]) if (!Number.isInteger(output[key]) || output[key] < 1 || output[key] > PREVIEW_LIMITS[key]) throw new Error('Limite de prévia inválido: ' + key);
  return output;
}
export function publicUrl(value: string, base: string): string {
  if (value.length > 2000 || /[\u0000-\u0020\\]/.test(value)) throw new Error('URL insegura.');
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|.*\.localhost|.*\.local|\d+(?:\.\d+){3}|\[.*\])$/i.test(url.hostname) || /(?:^|\/)(?:admin|checkout|cart|carrinho|account|customer|orders|login)(?:\/|$)/i.test(url.pathname)) throw new Error('URL fora da vitrine pública.');
  if ([...url.searchParams.keys()].some(k => /token|secret|auth|session|password|key|signature|credential/i.test(k))) throw new Error('URL contém parâmetro de sessão ou credencial.');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|_gl$|fbclid$|gclid$)/.test(key)) url.searchParams.delete(key);
  return url.href;
}
const scalar = (v: unknown): Json | undefined => typeof v === 'string' && v.length <= 100000 && !/[?&](?:token|secret|auth|session|password|key|signature|credential)[^=]*=/i.test(v) && !/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(v) ? v : typeof v === 'boolean' || v === null ? v : typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const forbidden = /(?:token|secret|password|authorization|cookie|credential|customer|orders?|session|^api$|^scripts?$|services|email)/i;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
function bounded(v: unknown, allowed: Set<string>, depth = 0): Json | undefined {
  const atom = scalar(v); if (atom !== undefined) {
    if(typeof atom==='string'&&/<(?:script|iframe|object|embed|base|meta)\b|\bon\w+\s*=|javascript:/i.test(atom))return undefined;
    if(typeof atom==='string'&&/^(?:https?:)?\/\//i.test(atom))try{publicUrl(atom,'https://visual-example.invalid');}catch{return undefined;}
    return atom;
  }
  if (depth > 12) throw new Error('Dados de prévia aninhados além do limite.');
  if (Array.isArray(v)) {if (v.length > 100) throw new Error('Lista da prévia ultrapassa 100 registros.'); return v.map(x => bounded(x, allowed, depth + 1) ?? null);}
  if (!plain(v)) return undefined;
  const out: Data = Object.create(null);
  for (const key of Object.keys(v)) {
    if (!allowed.has(key) || forbidden.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const desc = Object.getOwnPropertyDescriptor(v, key); if (!desc || !('value' in desc)) continue;
    const child = bounded(desc.value, allowed, depth + 1); if (child !== undefined) out[key] = child;
  }
  return out;
}
const entity = new Set(('data meta total count current_page last_page per_page limit links id name slug title url url_path link description content active visible order position section_alias alias params image_url image_mobile_url images logo_url src src_zoom src_thumb width height alt mime size children parent category categories collections products banners brand attributes attribute value values min max range price_from price_to priceRange price_min price_max prices price price_formated sale_price sale_price_formated price_sale price_discount price_sale_formated price_discount_formated price_billet price_billet_formated price_pix price_pix_formated has_promotion discount billet_discount pix_discount credit_card installments installment payment_method payment_methods amount quantity sku skus blocked_sale allow_sell_without_customization days_availability_formated availability warranty texts flags extras variations reviews specifications customizations breadcrumbs name_url dimensions resource first_banner collection collection_id ids label color selected selected_sku_id').split(' '));
const merchantFields = new Set(('id alias domain base_url logo_url manifest name description theme theme_id new_search store_search_v1 categories pages promotion pricing payment_methods payments cashbacks').split(' '));
const paramKey = /^(?:color_|fonts?_|button_|border_|radius_|card_|product_|price_|old_price|small_cents|space_between|highlight_|show_|cart_type$|custom_css$|header_|footer_|menu_|logo_|text_|background_|alignment|align_|layout$|title$|resource$|collection|banner|slider_|visible_|desktop_|mobile_|categories_|searchbar_|filters_|theme_)/;
function params(value: unknown): Data {
  if (!plain(value)) return {};
  const out: Data = Object.create(null);
  for (const key of Object.keys(value)) {
    if (!paramKey.test(key) || forbidden.test(key)) continue;
    const desc = Object.getOwnPropertyDescriptor(value, key); if (!desc || !('value' in desc)) continue;
    const v = bounded(desc.value, entity); if (v !== undefined) out[key] = v;
  }
  return out;
}
function theme(value: unknown): Data {
  if (!plain(value)) return {};
  return { ...(typeof value.id === 'string' || typeof value.id === 'number' ? {id: value.id} : {}), ...(typeof value.alias === 'string' ? {alias: value.alias} : {}), params: params(value.params)};
}
function sections(value: unknown): Json {
  if (Array.isArray(value)) return value.slice(0, 100).map(section => {
    if (!plain(section)) throw new Error('Seção inválida.');
    return {...bounded(section,entity) as Data, params: params(section.params)};
  });
  if (!plain(value)) return [];
  return Object.fromEntries(Object.entries(value).filter(([key]) => /^(header|footer|global|main|home|product|category|promotion|pages)$/.test(key)).map(([k,v]) => [k, Array.isArray(v) ? sections(v) : plain(v) ? {...bounded(v,entity) as Data, params:params(v.params)} : []]));
}
function inert(value:unknown,depth=0):unknown {
  if(depth>14)throw new Error('Contexto visual aninhado além do limite.');
  if(Array.isArray(value)) {
    if(value.length>100)throw new Error('Lista visual ultrapassa 100 registros; não foi truncada.');
    return Array.from({length:value.length},(_,i)=>inert(Object.getOwnPropertyDescriptor(value,String(i))?.value,depth+1));
  }
  if(!plain(value))return scalar(value);
  return Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(value)).filter(([key,d])=>'value' in d&&!forbidden.test(key)&&!['__proto__','prototype','constructor'].includes(key)).map(([key,d])=>[key,inert(d.value,depth+1)]));
}
export function visualData(input: unknown): Data {
  input=inert(input);
  if (!plain(input)) throw new Error('Contexto visual inválido.');
  const out: Data = Object.create(null);
  const merchant = input.merchantData ?? input.merchant;
  if (plain(merchant)) {
    const identity=Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(merchant)).filter(([k,d])=>merchantFields.has(k)&&'value' in d).map(([k,d])=>[k,d.value]));
    out.merchantData = bounded(identity,new Set([...entity,...merchantFields])) as Data;
  }
  const config = input.pageConfig ?? input.themeConfig;
  if (plain(config)) {
    const rawTheme = plain(config.data) && plain(config.data.theme) ? config.data.theme : config.theme;
    const t = theme(rawTheme); out.pageConfig = {page: typeof config.page === 'string' ? config.page : 'home', theme: t, data:{theme:t}};
    if (config.sections) out.sections = sections(config.sections);
  }
  if(Array.isArray(input.bodyClasses)&&input.bodyClasses.length<=30)out.bodyClasses=input.bodyClasses.filter(v=>typeof v==='string'&&/^[a-z0-9_-]{1,100}$/i.test(v)) as Json[];
  if (input.sections) out.sections = sections(input.sections);
  for (const key of ['products','product','categories','sorted_categories','featured_categories','banners','collections','content','filters','priceRange','navigation'] as const) if (input[key] !== undefined) out[key] = bounded(input[key],entity) ?? null;
  if (new TextEncoder().encode(JSON.stringify(out)).length > PREVIEW_LIMITS.jsonBytes) throw new Error('JSON da prévia ultrapassa o limite; não foi truncado.');
  return out;
}
export function previewPath(value: string): string {
  if (!/^assets\/[a-f0-9]{64}\.(?:png|jpg|webp|svg|woff2?|ttf|otf|css)$/.test(value)) throw new Error('Caminho de asset de prévia inválido.'); return value;
}
export function previewType(bytes: Uint8Array, mime: string): string {
  const hex=Array.from(bytes.slice(0,12),b=>b.toString(16).padStart(2,'0')).join('');
  if (hex.startsWith('89504e470d0a1a0a')) return 'png'; if(hex.startsWith('ffd8ff'))return 'jpg';
  if(hex.startsWith('52494646')&&hex.slice(16,24)==='57454250')return 'webp';
  if(hex.startsWith('774f4632'))return 'woff2'; if(hex.startsWith('774f4646'))return 'woff'; if(hex.startsWith('00010000'))return 'ttf'; if(hex.startsWith('4f54544f'))return 'otf';
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) {
    if (/<(?:script|foreignObject|iframe)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']?(?:https?:|\/\/|javascript:|data:)/i.test(text)) throw new Error('SVG ativo ou externo rejeitado.'); return 'svg';
  }
  if(mime.split(';')[0]==='text/css'&&!/<\/?(?:script|html)\b/i.test(text))return 'css';
  throw new Error('Tipo do recurso não suportado ou conteúdo inválido.');
}
export function demonstration(context: Context, reason: string): PreviewBundle {
  validateContext(context);
  return {format:'yampi-local-preview',version:1,toolVersion:'0.3.6',capturedAt:new Date().toISOString(),source:{kind:'demonstration',origin:context.previewOrigin,association:'unavailable'},limits:{...PREVIEW_LIMITS},data:{},pages:[],assets:{},resources:[],styles:[],issues:[{code:'visual-context-unavailable',reason}]};
}
export async function previewEntries(bundle: PreviewBundle): Promise<Assets> {
  if(bundle.format!=='yampi-local-preview'||bundle.version!==1||!Number.isFinite(Date.parse(bundle.capturedAt)))throw new Error('Prévia inválida.');
  const limits=previewLimits(bundle.limits), entries: Assets = {}, seen=new Set<string>(); let total=0;
  if(bundle.pages.length>limits.pages||bundle.resources.length>limits.resources)throw new Error('Prévia ultrapassa limites.');
  for(const item of bundle.resources) {
    publicUrl(item.url,bundle.source.origin); previewPath(item.path);
    const bytes=bundle.assets[item.path]; if(!bytes||bytes.length!==item.bytes||bytes.length>limits.resourceBytes||await hashBytes(bytes)!==item.sha256||previewType(bytes,item.type)!==item.path.split('.').at(-1))throw new Error('Asset de prévia inválido: '+item.path);
    if(!seen.has(item.path)){if((total+=bytes.length)>limits.totalBytes)throw new Error('Assets ultrapassam limite total.');seen.add(item.path);entries['preview/'+item.path]=bytes;}
  }
  if(Object.keys(bundle.assets).some(p=>!seen.has(p)))throw new Error('Asset sem registro.');
  const {assets: omitted, data, pages, ...manifest}=bundle; void omitted;
  const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v,null,2)+'\n');
  entries['preview/data.json']=encode({data:visualData(data),pages:pages.map(p=>({...p,data:visualData(p.data)}))});
  if(entries['preview/data.json'].length>limits.jsonBytes)throw new Error('JSON de prévia grande demais.');
  for(const page of pages) {if(!/^page-\d+$/.test(page.id)||!['home','category','product','promotion','pages'].includes(page.kind)||new URL(publicUrl(page.sourceUrl,bundle.source.origin)).origin!==bundle.source.origin)throw new Error('Página de prévia inválida.');}
  entries['preview/manifest.json']=encode({...manifest,dataFile:{path:'data.json',bytes:entries['preview/data.json'].length,sha256:await hashBytes(entries['preview/data.json'])}});
  entries['preview/report.json']=encode({code:{integrity:'hashes-and-sizes',completeness:'stable-editor-inventory; independent remote inventory not verified'},configuration:{source:bundle.source,status:bundle.source.kind==='demonstration'?'demonstration':'partial'},assets:{included:seen.size,issues:bundle.issues},compilation:'not-run',initialization:'not-run',visual:'not-validated',capturedAt:bundle.capturedAt,toolVersion:bundle.toolVersion,limits});
  return entries;
}
