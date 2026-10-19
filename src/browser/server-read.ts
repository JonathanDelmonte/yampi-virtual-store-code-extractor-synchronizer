import {editorText, STORE_CHANGED} from '../core/direct';
import {dataUrlBytes, imagePath, validateImage, MAX_FILE_BYTES, type Context} from '../core/model';
// The Yampi editor's own server (public editor module, read on 18/10/2026). Each request leaves
// the editor page with the browser's cookies for that server, exactly as the editor's own do:
// the extension never reads, keeps or sends a token. Only GETs that read the draft.
export const YAMPI_SERVER = 'https://bart.yampi.com.br/v1';
// Requests at once: fewer than the editor's own batches of 10 when it indexes the theme.
const PARALLEL = 6;
// Characters per answer (images travel as base64). Past it, a call starts no new file.
const BUDGET = 6 * 1024 * 1024;
const RETRY = [429, 500, 502, 503, 504];
export interface Server {base: string; fetch: (url: string, init: RequestInit) => Promise<Response>; wait?: (ms: number) => Promise<void>}
export type Download = (url: URL) => Promise<Uint8Array>;
export interface DirectAnswer {files: Record<string, string>; images: Record<string, string>; rest: string[]}
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const pause = (server: Server, ms: number) => server.wait ? server.wait(ms) : new Promise<void>(resolve => setTimeout(resolve, ms));
async function get(server: Server, route: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(server.base + route);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('preview', 'true');
  for (let attempt = 1; ; attempt++) {
    let response: Response | undefined;
    try {response = await server.fetch(url.href, {method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000)});}
    catch {if (attempt >= 3) throw new Error('O servidor da Yampi não respondeu.');}
    if (response?.ok) {
      try {return await response.json();} catch {throw new Error('O servidor da Yampi respondeu num formato inesperado.');}
    }
    if (response?.status === 401 || response?.status === 403) throw new Error(`A sessão da Yampi não permitiu a leitura (HTTP ${response.status}). Recarregue o editor e entre de novo.`);
    if (response && (!RETRY.includes(response.status) || attempt >= 3)) throw new Error(`O servidor da Yampi recusou a leitura (HTTP ${response.status}).`);
    // Busy or briefly down: wait as asked, or a little longer each time.
    const asked = Number(response?.headers.get('retry-after'));
    await pause(server, asked > 0 ? Math.min(asked, 10) * 1000 : attempt * 700);
  }
}
// The store of the browser's session: the same check the editor makes when its tab comes back.
export async function sessionStore(server: Server): Promise<string> {
  const alias = record(record(await get(server, '/merchant/theme/merchant-identity'))?.data)?.alias;
  if (typeof alias !== 'string' || !/^[\w-]{1,100}$/.test(alias)) throw new Error('O servidor da Yampi não informou a loja da sessão.');
  return alias;
}
// The editor's header shows this store's name and its "Ver prévia" link: both must be the ones
// the extension connected to. Only these fields are kept from the answer.
export async function openSession(server: Server, context: Context): Promise<string> {
  const store = record(record(await get(server, '/merchant/theme/data-merchant-theme'))?.data);
  const name = store?.name, link = store?.url, alias = store?.alias;
  if (typeof name !== 'string' || typeof link !== 'string' || typeof alias !== 'string') throw new Error('O servidor da Yampi não identificou a loja.');
  let origin = '';
  try {origin = new URL(link).origin;} catch { /* A broken link never matches. */ }
  if (name.trim() !== context.storeName || origin !== context.previewOrigin) throw new Error(`${STORE_CHANGED}, diferente da que o editor mostra. Nada foi copiado: recarregue o editor da loja certa e baixe de novo.`);
  if (await sessionStore(server) !== alias) throw new Error(`${STORE_CHANGED}. Nada foi copiado: recarregue o editor da loja certa e baixe de novo.`);
  return alias;
}
// The editor shows an image from the address it receives: the same rules as reading its preview.
export async function imageBase64(path: string, source: string, download: Download, base: string): Promise<string> {
  if (source.length > MAX_FILE_BYTES * 1.5) throw new Error(`Imagem grande demais: ${path}`);
  let url: URL;
  try {url = new URL(source, base);} catch {throw new Error(`Endereço de imagem inválido: ${path}`);}
  if (url.username || url.password || !['https:', 'data:'].includes(url.protocol)) throw new Error(`Origem da imagem não permitida: ${path}`);
  const bytes = url.protocol === 'data:' ? dataUrlBytes(source) : await download(url);
  validateImage(path, bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
// Several files at once, between two checks of the session's store.
export async function readFiles(server: Server, paths: string[], store: string, download: Download, base: string): Promise<DirectAnswer> {
  const same = async () => {if (await sessionStore(server) !== store) throw new Error(`${STORE_CHANGED} durante a cópia. Nada foi alterado: recarregue o editor da loja certa e baixe de novo.`);};
  await same();
  const answer: DirectAnswer = {files: {}, images: {}, rest: []};
  let used = 0, next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++];
      if (used >= BUDGET) {answer.rest.push(path); continue;}
      const data = record(await get(server, '/merchant/file/get', {path_file: path}))?.data;
      if (typeof data !== 'string') throw new Error(`O servidor da Yampi não devolveu o conteúdo de ${path}.`);
      if (imagePath(path)) {
        const encoded = await imageBase64(path, data, download, base);
        used += encoded.length; answer.images[path] = encoded;
      } else {
        const text = editorText(data);
        if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error(`Arquivo grande demais: ${path}`);
        used += text.length; answer.files[path] = text;
      }
    }
  };
  await Promise.all(Array.from({length: Math.min(PARALLEL, paths.length)}, worker));
  await same();
  return answer;
}
