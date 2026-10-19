// Line diff for the review screen: which lines a send removes and adds. Myers' algorithm on the
// part between the common start and end, which is where theme edits usually are. Very different
// files fall back to "replace the middle", flagged as approximate, instead of using a lot of memory.
export type DiffKind = 'same' | 'add' | 'del';
export interface DiffLine {kind: DiffKind; text: string; a?: number; b?: number}
export interface DiffHunk {aStart: number; aCount: number; bStart: number; bCount: number; lines: DiffLine[]}
export interface LineDiff {hunks: DiffHunk[]; added: number; removed: number; identical: boolean; approximate: boolean}
const MAX_EDITS = 2500, MAX_LINES = 60000;
export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
// Shortest edit script between a and b, as one kind per step; undefined when too costly.
function myers(a: string[], b: string[]): DiffKind[] | undefined {
  const n = a.length, m = b.length, max = n + m;
  if (!max) return [];
  const limit = Math.min(max, MAX_EDITS), offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  // Each step keeps only the diagonals it can reach, so memory grows with the edits, not the file.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {x++; y++;}
      v[offset + k] = x;
      if (x >= n && y >= m) {found = d; break;}
    }
  }
  if (found < 0) return undefined;
  const steps: DiffKind[] = [];
  let x = n, y = m;
  for (let d = found; d >= 0; d--) {
    const row = trace[d], at = (k: number) => row[k + d + 1];
    const k = x - y;
    const previous = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = at(previous), py = px - previous;
    while (x > px && y > py) {steps.push('same'); x--; y--;}
    if (d > 0) steps.push(x === px ? 'add' : 'del');
    x = px; y = py;
  }
  return steps.reverse();
}
// The steps from a to b. Too different for the limits, the middle is replaced as a whole: the
// review says so, and a merge only gets more cautious (a wider conflict, never a wrong merge).
export function editScript(a: string[], b: string[]): {steps: DiffKind[]; approximate: boolean} {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {endA--; endB--;}
  const middleA = a.slice(start, endA), middleB = b.slice(start, endB);
  const middle = middleA.length + middleB.length > MAX_LINES ? undefined : myers(middleA, middleB);
  const steps = middle || [...middleA.map(() => 'del' as const), ...middleB.map(() => 'add' as const)];
  return {steps: [...Array<DiffKind>(start).fill('same'), ...steps, ...Array<DiffKind>(a.length - endA).fill('same')], approximate: !middle};
}
export function diffLines(before: string, after: string, context = 3): LineDiff {
  const a = splitLines(before), b = splitLines(after);
  const {steps: kinds, approximate} = editScript(a, b);
  // Number every line on its side; "same" lines advance both.
  const lines: DiffLine[] = [];
  let ia = 0, ib = 0, added = 0, removed = 0;
  for (const kind of kinds) {
    if (kind === 'same') {lines.push({kind, text: a[ia], a: ++ia, b: ++ib});}
    else if (kind === 'del') {lines.push({kind, text: a[ia], a: ++ia}); removed++;}
    else {lines.push({kind, text: b[ib], b: ++ib}); added++;}
  }
  const hunks: DiffHunk[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].kind === 'same') {index++; continue;}
    const from = Math.max(0, index - context);
    let to = index;
    // Extend through changes separated by at most twice the context; hunks never overlap.
    for (;;) {
      while (to < lines.length && lines[to].kind !== 'same') to++;
      let gap = to;
      while (gap < lines.length && lines[gap].kind === 'same' && gap - to < context * 2 + 1) gap++;
      if (gap < lines.length && lines[gap].kind !== 'same' && gap - to <= context * 2) {to = gap; continue;}
      break;
    }
    const end = Math.min(lines.length, to + context);
    const slice = lines.slice(from, end);
    const first = slice.find(line => line.a !== undefined), firstB = slice.find(line => line.b !== undefined);
    hunks.push({
      aStart: first?.a ?? (lines.slice(0, from).filter(line => line.a !== undefined).at(-1)?.a ?? 0),
      aCount: slice.filter(line => line.kind !== 'add').length,
      bStart: firstB?.b ?? (lines.slice(0, from).filter(line => line.b !== undefined).at(-1)?.b ?? 0),
      bCount: slice.filter(line => line.kind !== 'del').length,
      lines: slice
    });
    index = end;
  }
  return {hunks, added, removed, identical: !added && !removed, approximate};
}
