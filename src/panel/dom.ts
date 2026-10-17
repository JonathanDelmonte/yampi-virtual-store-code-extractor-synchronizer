// Small helpers for the panel's DOM. No framework: the panel is a few static sections whose
// text and visibility change, plus two lists (files, activity log) rebuilt from data.
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// Only the marks that carry information (done, failed, close); everything else is text.
export function glyph(name: 'check' | 'x' | 'close'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  svg.setAttribute('class', 'glyph'); svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', `#i-${name}`); svg.append(use);
  return svg;
}
type Child = Node | string | false | undefined;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: {class?: string; text?: string; attrs?: Record<string, string>} = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [key, value] of Object.entries(props.attrs || {})) node.setAttribute(key, value);
  for (const child of children) if (child) node.append(child);
  return node;
}
export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export const dateTime = (value: string | number) => new Date(value).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
export function since(value: string | number): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `em ${dateTime(value)}`;
}
// "a, b e c": lists read as Portuguese sentences, not as separated metadata.
export function list(items: string[]): string {
  const parts = items.filter(Boolean);
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
}
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// A new screen settles in with a short fade and rise; nothing moves on its own.
export function enter(...nodes: HTMLElement[]): void {
  if (reducedMotion() || document.hidden || document.body.dataset.input === 'keyboard') return;
  for (const [index, node] of nodes.entries()) node.animate?.([{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], {duration: 240, delay: index * 40, easing: 'cubic-bezier(.23, 1, .32, 1)', fill: 'backwards'});
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, ms = 3400): void {
  const node = $('toast');
  node.hidden = true; node.textContent = text;
  void node.offsetWidth;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {node.hidden = true;}, ms);
}
// The click that asks for it lets the page write to the clipboard; older paths use a selection.
export async function copyText(text: string): Promise<boolean> {
  try {await navigator.clipboard.writeText(text); return true;} catch {
    const area = el('textarea', {attrs: {readonly: '', 'aria-hidden': 'true'}});
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.append(area); area.select();
    try {return document.execCommand('copy');} finally {area.remove();}
  }
}
