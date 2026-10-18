import {sha256, type Context, type Journal, type Snapshot} from './core/model';
import {emptyWorkspace, type Workspace} from './core/workspace';
export async function contextKey(context: Context): Promise<string> {return sha256(JSON.stringify([context.editorOrigin, context.previewOrigin, context.storeName]));}
export async function saveJournal(journal: Journal): Promise<void> {
  const key = await contextKey(journal.context), database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('records', 'readwrite'), records = tx.objectStore('records');
    const index = records.get(`history:${key}`);
    index.onsuccess = () => {
      const ids = (index.result || []) as string[];
      records.put([journal.id, ...ids.filter(id => id !== journal.id)], `history:${key}`);
      records.put(journal, `journal:${key}:${journal.id}`);
    };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Registro não persistiu.'));
  });
}
export async function journalHistory(context: Context): Promise<Journal[]> {
  const key = await contextKey(context), ids = await get<string[]>(`history:${key}`) || [];
  return (await Promise.all(ids.map(id => get<Journal>(`journal:${key}:${id}`)))).filter((j): j is Journal => !!j);
}
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return database ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('yampi-theme-sync', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('records');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}
export async function put(key: string, value: unknown): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('records', 'readwrite');
    tx.objectStore('records').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Backup local não persistiu.'));
  });
}
export async function get<T>(key: string): Promise<T | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction('records').objectStore('records').get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}
export async function clearLocal(): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('records', 'readwrite');
    tx.objectStore('records').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
// The workspace of a store, read and changed in one transaction: the panel and the background
// runner can both update it, and neither may lose the other's change.
export async function loadWorkspace(context: Context): Promise<Workspace | undefined> {
  const key = await contextKey(context), stored = await get<Workspace>(`workspace:${key}`);
  if (stored) return stored;
  // Before 0.6.0 only the reference export was kept.
  const baseline = await get<Snapshot>(`baseline:${key}`);
  return baseline ? {...emptyWorkspace(context), baseline, lineage: {exportedAt: baseline.capturedAt, journals: []}} : undefined;
}
export async function updateWorkspace(context: Context, change: (workspace: Workspace) => void): Promise<Workspace> {
  const current = await loadWorkspace(context);
  const key = await contextKey(context), database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('records', 'readwrite'), records = tx.objectStore('records');
    const request = records.get(`workspace:${key}`);
    let result: Workspace;
    request.onsuccess = () => {
      result = (request.result as Workspace | undefined) || current || emptyWorkspace(context);
      change(result);
      result.updatedAt = new Date().toISOString();
      records.put(result, `workspace:${key}`);
    };
    tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Os dados da loja não foram salvos.'));
  });
}
export async function remove(key: string): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('records', 'readwrite');
    tx.objectStore('records').delete(key);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
