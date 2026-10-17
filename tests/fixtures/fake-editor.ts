import {YAMPI_VUE_TEMPLATE, type Adapter, type Context, type Files, type Journal, type Snapshot} from '../../src/core/model';
// Fictitious editor for workflow tests: same rules as the Yampi editor (existing folder, no
// duplicates, new files with Yampi's initial content) and counters for every operation.
export const context: Context = {storeName: 'Loja fictícia', editorOrigin: 'https://app.yampi.com.br', previewOrigin: 'https://loja.invalid'};
export const snapshot = (files: Files, assets?: Record<string, Uint8Array>): Snapshot => ({context, capturedAt: '2026-01-01T00:00:00Z', files, ...(assets ? {assets} : {})});
export const png = (last: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, last]);
export class FakeEditor implements Adapter {
  files: Files; assets: Record<string, Uint8Array>; ctx = {...context};
  writes: string[] = []; created: string[] = []; uploaded: string[] = []; reads: string[] = []; refreshes = 0;
  // Everything the editor was asked to do, in order, to check reload placement.
  log: string[] = [];
  beforeWrite?: (path: string) => void; afterWrite?: (path: string) => void; refreshHook?: () => void;
  constructor(files: Files, assets: Record<string, Uint8Array> = {}) {this.files = {...files}; this.assets = {...assets};}
  async context() {return this.ctx;}
  async inventory() {return [...Object.keys(this.files), ...Object.keys(this.assets)];}
  async read(path: string) {this.reads.push(path); this.log.push('read:' + path); if (!(path in this.files)) throw new Error('ausente'); return this.files[path];}
  async readAsset(path: string) {this.log.push('readAsset:' + path); if (!(path in this.assets)) throw new Error('ausente'); return this.assets[path];}
  async write(path: string, expected: string, content: string) {
    this.beforeWrite?.(path);
    if (this.files[path] !== expected) throw new Error('conflito no último momento');
    this.files[path] = content; this.writes.push(path); this.log.push('write:' + path);
    this.afterWrite?.(path);
  }
  async refresh() {this.refreshes++; this.log.push('refresh'); this.refreshHook?.();}
  async create(path: string) {
    if (path in this.files) throw new Error('já existe');
    if (!Object.keys(this.files).some(p => p.startsWith(path.slice(0, path.lastIndexOf('/') + 1)))) throw new Error('pasta inexistente');
    this.files[path] = path.endsWith('.vue') ? YAMPI_VUE_TEMPLATE : ''; this.created.push(path); this.log.push('create:' + path);
  }
  async upload(path: string, bytes: Uint8Array) {
    if (path in this.assets || !/^assets\/images\/[^/]+$/.test(path)) throw new Error('recusado');
    this.assets[path] = new Uint8Array(bytes); this.uploaded.push(path); this.log.push('upload:' + path);
  }
}
export function recorder() {
  const journals: Journal[] = [], backups: Snapshot[] = [];
  return {journals, backups, last: () => journals.at(-1)!, persist: async (journal: Journal) => {journals.push(structuredClone(journal));}, backup: async (value: Snapshot) => {backups.push(value);}};
}
