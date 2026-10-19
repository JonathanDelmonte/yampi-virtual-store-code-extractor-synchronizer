import {editScript, splitLines} from './diff';
import {textHash} from './sha256';
// Three-way merge by lines, as Git does. Changes from the project and from the store that touch
// different lines are both kept. Changes to the same lines, or to lines with no unchanged line
// between them, become a conflict: decided per stretch by the user, or marked in the text to be
// resolved in the code editor (VS Code offers "Accept Current/Incoming Change" on these marks).
// The same change on both sides is no conflict.
export const MARKS = {local: '<<<<<<< nossa (pasta do projeto)', split: '=======', store: '>>>>>>> da loja (Yampi agora)'} as const;
// mine: the project's lines; theirs: the store's; both: the project's, then the store's; marks: both
// between conflict marks, to finish in the code editor.
export type HunkChoice = 'mine' | 'theirs' | 'both' | 'marks';
// A stretch both sides changed. Its id comes from its content, so a choice made for it still
// applies after the store is read again, as long as that stretch did not change.
export interface Hunk {id: string; mine: string[]; theirs: string[]}
export type Part = {lines: string[]} | {hunk: Hunk};
// same: no merge was needed (one side unchanged); the text as it is, line breaks included.
export interface MergeParts {parts: Part[]; newline: boolean; same?: string}
interface Change {side: 'local' | 'store'; oStart: number; oEnd: number; start: number; end: number}
// Each run of changed lines as base[oStart, oEnd) replaced by side[start, end).
function changes(base: string[], other: string[], side: Change['side']): Change[] {
  const out: Change[] = [], {steps} = editScript(base, other);
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
export function mergeParts(base: string, local: string, store: string): MergeParts {
  if (local === store || store === base) return {parts: [], newline: finalNewline(local), same: local};
  if (local === base) return {parts: [], newline: finalNewline(store), same: store};
  const o = splitLines(base), sides = {local: splitLines(local), store: splitLines(store)};
  const all = [...changes(o, sides.local, 'local'), ...changes(o, sides.store, 'store')].sort((x, y) => x.oStart - y.oStart || x.oEnd - y.oEnd);
  const parts: Part[] = [], push = (lines: string[]) => {if (lines.length) parts.push({lines});};
  let at = 0;
  for (let index = 0; index < all.length;) {
    const group = [all[index++]];
    const start = group[0].oStart;
    let end = group[0].oEnd;
    while (index < all.length && all[index].oStart <= end) {end = Math.max(end, all[index].oEnd); group.push(all[index++]);}
    push(o.slice(at, start)); at = end;
    // What each side has in place of base[start, end). Outside its own changes a side follows the
    // base line for line, so the edges of the region map by offset.
    const version = (side: Change['side']) => {
      const own = group.filter(h => h.side === side);
      if (!own.length) return o.slice(start, end);
      const first = own[0], last = own.at(-1)!;
      return sides[side].slice(first.start - (first.oStart - start), last.end + (end - last.oEnd));
    };
    const mine = version('local'), theirs = version('store');
    if (!group.some(h => h.side === 'store')) {push(mine); continue;}
    if (!group.some(h => h.side === 'local')) {push(theirs); continue;}
    if (mine.length === theirs.length && mine.every((line, i) => line === theirs[i])) {push(mine); continue;}
    // Lines both sides agree on at the edges stay outside the conflict.
    let head = 0, tail = 0;
    while (head < mine.length && head < theirs.length && mine[head] === theirs[head]) head++;
    while (tail < mine.length - head && tail < theirs.length - head && mine[mine.length - 1 - tail] === theirs[theirs.length - 1 - tail]) tail++;
    const ours = mine.slice(head, mine.length - tail), store_ = theirs.slice(head, theirs.length - tail);
    push(mine.slice(0, head));
    parts.push({hunk: {id: textHash(['<', ...ours, '=', ...store_].join('\n')).slice(0, 16), mine: ours, theirs: store_}});
    push(mine.slice(mine.length - tail));
  }
  push(o.slice(at));
  return {parts, newline: finalNewline(local) === finalNewline(base) ? finalNewline(store) : finalNewline(local)};
}
export const hunksOf = (merge: MergeParts) => merge.parts.flatMap(part => 'hunk' in part ? [part.hunk] : []);
export interface Merge {text: string; conflicts: number}
// A stretch without a choice keeps its marks; conflicts counts those still marked.
export function renderMerge(merge: MergeParts, choices: Record<string, HunkChoice> = {}): Merge {
  if (merge.same !== undefined) return {text: merge.same, conflicts: 0};
  const out: string[] = [];
  let conflicts = 0;
  for (const part of merge.parts) {
    if ('lines' in part) {out.push(...part.lines); continue;}
    const {hunk} = part, choice = choices[hunk.id] ?? 'marks';
    if (choice === 'mine') out.push(...hunk.mine);
    else if (choice === 'theirs') out.push(...hunk.theirs);
    else if (choice === 'both') out.push(...hunk.mine, ...hunk.theirs);
    else {out.push(MARKS.local, ...hunk.mine, MARKS.split, ...hunk.theirs, MARKS.store); conflicts++;}
  }
  return {text: out.join('\n') + (merge.newline && out.length ? '\n' : ''), conflicts};
}
export function mergeTexts(base: string, local: string, store: string): Merge {return renderMerge(mergeParts(base, local, store));}
// A text still holding a conflict marked by an update (or by Git) never goes to the store.
const MARKED = /^<{7}(?:[ \t].*)?$[\s\S]*?^={7}[ \t]*$[\s\S]*?^>{7}(?:[ \t].*)?$/m;
export function hasConflictMarks(text: string): boolean {return MARKED.test(text.replace(/\r\n?/g, '\n'));}
