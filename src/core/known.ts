import {MAX_FILES, MAX_FILE_BYTES, sameContext, validateContext, validatePath, type Context, type Journal} from './model';
import {diffLines} from './diff';
import {textHash} from './sha256';
// Versions the project itself had, per path: from its Git history (.yampi-sync/versoes-conhecidas.json,
// written by `npm run versoes:conhecidas`, since the extension never reads Git), from send receipts
// (.yampi-sync/recibos/, which travel with the project in any computer) and from this installation's
// send records. A store text equal to one of them was not changed by anyone else after that version.
export type KnownSource = 'git' | 'recibo' | 'envio';
export interface KnownVersion {sha256: string; source: KnownSource; at?: string; text?: string}
export type Known = Record<string, KnownVersion[]>;
export const KNOWN_FILE = '.yampi-sync/versoes-conhecidas.json';
export const RECEIPTS = '.yampi-sync/recibos';
// What a confirmed send left in the store: the texts as read back after saving.
export interface Receipt {format: 'zirtuno-sync-recibo'; version: 1; context: Context; sentAt: string; journalId: string; files: Record<string, {sha256: string; text: string}>}
const HASH = /^[a-f0-9]{64}$/, date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function mergeKnown(...lists: (Known | undefined)[]): Known {
  const out: Known = {};
  for (const list of lists) for (const [path, versions] of Object.entries(list || {})) {
    const into = out[path] ||= [];
    for (const version of versions) {
      const same = into.find(item => item.sha256 === version.sha256);
      if (!same) into.push({...version});
      else {if (same.text === undefined && version.text !== undefined) same.text = version.text; if (!same.at || version.at && version.at > same.at) same.at = version.at;}
    }
  }
  return out;
}
// Lenient on purpose: the project's own list helps, and a bad entry is left out, never trusted.
export function parseKnownFile(value: unknown): Known {
  const file = value as {format?: string; version?: number; files?: Record<string, unknown>};
  if (!file || file.format !== 'zirtuno-sync-versoes-conhecidas' || file.version !== 1 || !file.files || typeof file.files !== 'object') throw new Error('Lista de versões conhecidas em formato não reconhecido.');
  const out: Known = {};
  for (const [path, versions] of Object.entries(file.files).slice(0, MAX_FILES)) {
    try {validatePath(path);} catch {continue;}
    if (!Array.isArray(versions)) continue;
    for (const item of versions.slice(0, 500)) {
      const entry = typeof item === 'string' ? {sha256: item} : item as {sha256?: unknown; at?: unknown; text?: unknown};
      if (!entry || typeof entry.sha256 !== 'string' || !HASH.test(entry.sha256)) continue;
      const text = typeof entry.text === 'string' && entry.text.length <= MAX_FILE_BYTES && textHash(entry.text) === entry.sha256 ? entry.text : undefined;
      (out[path] ||= []).push({sha256: entry.sha256, source: 'git', ...(date(entry.at) ? {at: entry.at as string} : {}), ...(text !== undefined ? {text} : {})});
    }
  }
  return out;
}
export function parseReceipt(value: unknown): Receipt {
  const receipt = value as Receipt;
  if (!receipt || receipt.format !== 'zirtuno-sync-recibo' || receipt.version !== 1 || !date(receipt.sentAt) || typeof receipt.journalId !== 'string' || !receipt.files || typeof receipt.files !== 'object') throw new Error('Recibo de envio em formato não reconhecido.');
  const files: Receipt['files'] = {};
  for (const [path, item] of Object.entries(receipt.files)) {
    validatePath(path);
    if (!item || typeof item.text !== 'string' || textHash(item.text) !== item.sha256) throw new Error(`Recibo de envio alterado: ${path}`);
    files[path] = {sha256: item.sha256, text: item.text};
  }
  return {format: receipt.format, version: 1, context: validateContext(receipt.context), sentAt: receipt.sentAt, journalId: receipt.journalId, files};
}
export function receiptKnown(receipt: Receipt): Known {
  return Object.fromEntries(Object.entries(receipt.files).map(([path, item]) => [path, [{sha256: item.sha256, source: 'recibo' as const, at: receipt.sentAt, text: item.text}]]));
}
// The texts each confirmed item of a send left in the store.
export function journalKnown(journals: Journal[]): Known {
  const out: Known = {};
  for (const journal of journals) for (const path of journal.verified) {
    const text = journal.after[path];
    if (typeof text === 'string') (out[path] ||= []).push({sha256: textHash(text), source: 'envio', at: journal.startedAt, text});
  }
  return mergeKnown(out);
}
export function makeReceipt(journal: Journal): Receipt {
  const files: Receipt['files'] = {};
  for (const path of journal.verified) {const text = journal.after[path]; if (typeof text === 'string') files[path] = {sha256: textHash(text), text};}
  return {format: 'zirtuno-sync-recibo', version: 1, context: journal.context, sentAt: journal.startedAt, journalId: journal.id, files};
}
export function receiptFor(receipt: Receipt, context: Context): boolean {return sameContext(receipt.context, context);}
// Who changed the store's side of a file, as far as the project's versions tell.
// own: the store holds a version of the project itself. third: the store changed after every known
// version (since: the latest known date); probably someone else. Without any known version, unknown.
export type Origin = {kind: 'own'; source: KnownSource; at?: string} | {kind: 'third'; since?: string};
// The reference a file should be compared with. The store holding a known version: that version
// (the change is the project's own). Otherwise, with known texts, the one closest to the store:
// what the project had when someone else started changing it, so a conflict shows only their change.
// variants: the store text as the project writes it (image paths before the send rewrote them).
export function knownBase(known: Known | undefined, path: string, base: string | undefined, store: string | undefined, variants: string[] = []): {base: string | undefined; origin?: Origin} {
  const plain = (text?: string) => text?.replace(/\r\n?/g, '\n');
  const versions = known?.[path] || [];
  if (store === undefined || plain(store) === plain(base) || !versions.length) return {base};
  const hashes = new Set([store, ...variants].map(textHash));
  const own = versions.filter(version => hashes.has(version.sha256)).sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0];
  if (own) return {base: store, origin: {kind: 'own', source: own.source, ...(own.at ? {at: own.at} : {})}};
  let closest: KnownVersion | undefined, distance = Infinity;
  for (const version of versions) {
    if (version.text === undefined) continue;
    const diff = diffLines(version.text, store), lines = diff.added + diff.removed;
    if (lines < distance) {distance = lines; closest = version;}
  }
  const since = closest?.at ?? versions.map(version => version.at).filter((at): at is string => !!at).sort().at(-1);
  return {base: closest?.text ?? base, origin: {kind: 'third', ...(since ? {since} : {})}};
}
