import {diffLines} from '../core/diff';
import {el} from './dom';
// Unified diff for one file: the changed lines with a little context, numbered on both sides.
const MAX_RENDERED = 3000;
export function renderDiff(container: HTMLElement, stats: HTMLElement, before: string | undefined, after: string | undefined, labels: {before: string; after: string}): void {
  container.replaceChildren();
  if (before === undefined || after === undefined) {
    const missing = before === undefined ? labels.before : labels.after;
    stats.textContent = `${missing}: arquivo ausente.`;
    container.append(el('p', {class: 'diff-empty', text: before === undefined && after !== undefined ? `O arquivo não existe em “${labels.before}”. Todo o conteúdo abaixo é novo.` : `O arquivo não existe em “${labels.after}”.`}));
    if (after !== undefined) renderLines(container, after.split('\n').map((text, index) => ({kind: 'add' as const, text, b: index + 1})));
    return;
  }
  const diff = diffLines(before, after);
  if (diff.identical) {
    stats.textContent = before === after ? 'Sem diferenças.' : 'Diferença só em quebras de linha.';
    container.append(el('p', {class: 'diff-empty', text: before === after ? `“${labels.before}” e “${labels.after}” são iguais.` : 'O conteúdo é o mesmo; muda só o tipo de quebra de linha.'}));
    return;
  }
  stats.textContent = `+${diff.added} −${diff.removed} linhas · ${labels.before} → ${labels.after}${diff.approximate ? ' · arquivos muito diferentes: comparação simplificada' : ''}`;
  let rendered = 0;
  for (const hunk of diff.hunks) {
    if (rendered > MAX_RENDERED) {container.append(el('p', {class: 'diff-empty', text: 'Diferença longa demais para mostrar inteira aqui.'})); break;}
    const block = el('div', {class: 'diff-hunk'}, el('div', {class: 'diff-hunk-head', text: `Linhas ${hunk.aStart}–${hunk.aStart + Math.max(hunk.aCount - 1, 0)} → ${hunk.bStart}–${hunk.bStart + Math.max(hunk.bCount - 1, 0)}`}));
    renderLines(block, hunk.lines);
    container.append(block);
    rendered += hunk.lines.length;
  }
}
function renderLines(container: HTMLElement, lines: {kind: 'same' | 'add' | 'del'; text: string; a?: number; b?: number}[]): void {
  const fragment = document.createDocumentFragment();
  for (const line of lines.slice(0, MAX_RENDERED)) {
    fragment.append(el('div', {class: `diff-line ${line.kind}`},
      el('span', {class: 'n', text: line.a ? String(line.a) : ''}),
      el('span', {class: 'n', text: line.b ? String(line.b) : ''}),
      el('span', {class: 's', text: line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}),
      el('span', {class: 't', text: line.text || ' '})));
  }
  container.append(fragment);
}
