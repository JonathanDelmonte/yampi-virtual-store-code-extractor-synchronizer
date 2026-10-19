import {imagePath} from './model';
// Copying straight from the Yampi server, through the same GET the editor makes to open a file
// (public editor module, read on 18/10/2026). The editor puts that text in CodeMirror, which
// keeps every line break as "\n", and shows an image from the address it receives. It changes
// only JSON, which it reformats before showing: JSON stays with the editor, as do image
// extensions outside assets/.
// Fewer files than this: the checks would cost more than they save.
export const DIRECT_MIN = 8;
// Paths per call. The editor page fetches a few at a time and answers once per call.
export const DIRECT_BATCH = 24;
// The browser's Yampi session moved to another store: the editor would then also open that
// store's files under this one's name, so nothing more is read, by either path.
export const STORE_CHANGED = 'A sessão da Yampi passou para outra loja';
export function storeChanged(error: unknown): boolean {return (error instanceof Error ? error.message : String(error)).includes(STORE_CHANGED);}
// What CodeMirror holds: lines split on \r\n, \r and \n, joined with \n.
export function editorText(raw: string): string {return raw.replace(/\r\n?/g, '\n');}
// The kind each sample stands for: every text extension, and images.
export function directKind(path: string): string | undefined {
  if (imagePath(path)) return 'image';
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase();
  return !extension || ['json', 'png', 'jpg', 'jpeg', 'webp', 'svg'].includes(extension) ? undefined : extension;
}
// One file of each kind, read both ways before the rest: the first one in path order.
export function directSamples(paths: string[]): string[] {
  const samples = new Map<string, string>();
  for (const path of [...paths].sort()) {
    const kind = directKind(path);
    if (kind && !samples.has(kind)) samples.set(kind, path);
  }
  return [...samples.values()];
}
