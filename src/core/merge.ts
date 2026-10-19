import {editScript, splitLines} from './diff';
// Three-way merge by lines, as Git does. Changes from the project and from the store that touch
// different lines are both kept. Changes to the same lines, or to lines with no unchanged line
// between them, become a conflict marked in the text, to be resolved in the code editor (VS Code
// offers "Accept Current/Incoming Change" on these marks). The same change on both sides is no conflict.
export const MARKS = {local: '<<<<<<< pasta (sua versão)', split: '=======', store: '>>>>>>> loja (Yampi)'} as const;
interface Hunk {side: 'local' | 'store'; oStart: number; oEnd: number; start: number; end: number}
// Each run of changed lines as base[oStart, oEnd) replaced by side[start, end).
function hunks(base: string[], other: string[], side: Hunk['side']): Hunk[] {
  const out: Hunk[] = [], {steps} = editScript(base, other);
  let i = 0, j = 0;
  for (let k = 0; k < steps.length;) {
    if (steps[k] === 'same') {i++; j++; k++; continue;}
    const oStart = i, start = j;
    for (; k < steps.length && steps[k] !== 'same'; k++) if (steps[k] === 'del') i++; else j++;
    out.push({side, oStart, oEnd: i, start, end: j});
  }
  return out;
}
const finalNewline = (text: string) => /[\r\n]$/.test(text);
export interface Merge {text: string; conflicts: number}
export function mergeTexts(base: string, local: string, store: string): Merge {
  if (local === store || store === base) return {text: local, conflicts: 0};
  if (local === base) return {text: store, conflicts: 0};
  const o = splitLines(base), sides = {local: splitLines(local), store: splitLines(store)};
  const all = [...hunks(o, sides.local, 'local'), ...hunks(o, sides.store, 'store')].sort((x, y) => x.oStart - y.oStart || x.oEnd - y.oEnd);
  const out: string[] = [];
  let at = 0, conflicts = 0;
  for (let index = 0; index < all.length;) {
    const group = [all[index++]];
    const start = group[0].oStart;
    let end = group[0].oEnd;
    while (index < all.length && all[index].oStart <= end) {end = Math.max(end, all[index].oEnd); group.push(all[index++]);}
    out.push(...o.slice(at, start)); at = end;
    // What each side has in place of base[start, end). Outside its own changes a side follows the
    // base line for line, so the edges of the region map by offset.
    const version = (side: Hunk['side']) => {
      const own = group.filter(h => h.side === side);
      if (!own.length) return o.slice(start, end);
      const first = own[0], last = own.at(-1)!;
      return sides[side].slice(first.start - (first.oStart - start), last.end + (end - last.oEnd));
    };
    const mine = version('local'), theirs = version('store');
    if (!group.some(h => h.side === 'store')) {out.push(...mine); continue;}
    if (!group.some(h => h.side === 'local')) {out.push(...theirs); continue;}
    if (mine.length === theirs.length && mine.every((line, i) => line === theirs[i])) {out.push(...mine); continue;}
    // Lines both sides agree on at the edges stay outside the marks.
    let head = 0, tail = 0;
    while (head < mine.length && head < theirs.length && mine[head] === theirs[head]) head++;
    while (tail < mine.length - head && tail < theirs.length - head && mine[mine.length - 1 - tail] === theirs[theirs.length - 1 - tail]) tail++;
    out.push(...mine.slice(0, head), MARKS.local, ...mine.slice(head, mine.length - tail), MARKS.split, ...theirs.slice(head, theirs.length - tail), MARKS.store, ...mine.slice(mine.length - tail));
    conflicts++;
  }
  out.push(...o.slice(at));
  const newline = finalNewline(local) === finalNewline(base) ? finalNewline(store) : finalNewline(local);
  return {text: out.join('\n') + (newline && out.length ? '\n' : ''), conflicts};
}
// A text still holding a conflict marked by an update (or by Git) never goes to the store.
const MARKED = /^<{7}(?:[ \t].*)?$[\s\S]*?^={7}[ \t]*$[\s\S]*?^>{7}(?:[ \t].*)?$/m;
export function hasConflictMarks(text: string): boolean {return MARKED.test(text.replace(/\r\n?/g, '\n'));}
