import type {Folder} from '../../src/panel/folder';
// An in-memory folder shaped like the File System Access handles the panel receives: directories
// created on request, files swapped in on close (as the browser does), and a hook to make a write
// fail, to stop an operation midway.
const missing = (name: string) => new DOMException(`Ausente: ${name}`, 'NotFoundError');
export class MemoryFile {
  readonly kind = 'file';
  constructor(readonly name: string, public bytes: Uint8Array, private root: MemoryDir, private path: string) {}
  async getFile() {const bytes = this.bytes; return {size: bytes.length, arrayBuffer: async () => bytes.slice().buffer};}
  async createWritable() {
    const chunks: Uint8Array[] = [];
    return {
      write: async (data: Uint8Array | string) => {chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));},
      close: async () => {
        if (this.root.failWrite?.(this.path)) throw new DOMException('Gravação interrompida (teste)', 'AbortError');
        const size = chunks.reduce((n, chunk) => n + chunk.length, 0), out = new Uint8Array(size);
        let at = 0; for (const chunk of chunks) {out.set(chunk, at); at += chunk.length;}
        this.bytes = out; this.root.writes.push(this.path);
      },
      abort: async () => {}
    };
  }
}
export class MemoryDir {
  readonly kind = 'directory';
  readonly entries = new Map<string, MemoryDir | MemoryFile>();
  writes: string[] = []; removals: string[] = [];
  failWrite?: (path: string) => boolean;
  constructor(readonly name: string, private root?: MemoryDir, private path = '') {}
  private top(): MemoryDir {return this.root ?? this;}
  async getDirectoryHandle(name: string, options: {create?: boolean} = {}) {
    const found = this.entries.get(name);
    if (found instanceof MemoryDir) return found;
    if (found) throw new DOMException('É um arquivo', 'TypeMismatchError');
    if (!options.create) throw missing(name);
    const dir = new MemoryDir(name, this.top(), this.path + name + '/');
    this.entries.set(name, dir); return dir;
  }
  async getFileHandle(name: string, options: {create?: boolean} = {}) {
    const found = this.entries.get(name);
    if (found instanceof MemoryFile) return found;
    if (found) throw new DOMException('É uma pasta', 'TypeMismatchError');
    if (!options.create) throw missing(name);
    const file = new MemoryFile(name, new Uint8Array(), this.top(), this.path + name);
    this.entries.set(name, file); return file;
  }
  async removeEntry(name: string) {
    if (!this.entries.has(name)) throw missing(name);
    this.entries.delete(name); this.top().removals.push(this.path + name);
  }
  async *values() {yield* this.entries.values();}
  async queryPermission() {return 'granted' as const;}
  async requestPermission() {return 'granted' as const;}
}
export function memoryFolder(name: string, files: Record<string, string | Uint8Array>): MemoryDir {
  const root = new MemoryDir(name);
  for (const [path, value] of Object.entries(files)) {
    const parts = path.split('/'), file = parts.pop()!;
    let dir = root, prefix = '';
    for (const part of parts) {
      prefix += part + '/';
      if (!dir.entries.has(part)) dir.entries.set(part, new MemoryDir(part, root, prefix));
      dir = dir.entries.get(part) as MemoryDir;
    }
    dir.entries.set(file, new MemoryFile(file, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value), root, path));
  }
  return root;
}
// Every file below the folder, by path.
export function contents(root: MemoryDir): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const visit = (dir: MemoryDir, prefix: string) => {for (const [name, entry] of dir.entries) entry instanceof MemoryDir ? visit(entry, prefix + name + '/') : out[prefix + name] = entry.bytes;};
  visit(root, ''); return out;
}
export const text = (bytes?: Uint8Array) => bytes && new TextDecoder().decode(bytes);
export const asFolder = (dir: MemoryDir) => dir as unknown as Folder;
