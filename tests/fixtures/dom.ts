// Minimal DOMParser for Node tests, backed by parse5. It supports only the
// selectors used by the static capture; the capture never executes scripts.
import {parse} from 'parse5';
type Parsed = {tagName?: string; nodeName: string; value?: string; attrs?: {name: string; value: string}[]; childNodes?: Parsed[]; content?: Parsed};
function walk(node: Parsed, output: Parsed[]) {
  for (const child of node.childNodes || []) {if (child.tagName) output.push(child); walk(child, output);}
  if (node.content) walk(node.content, output);
}
function text(node: Parsed): string {return node.nodeName === '#text' ? node.value || '' : (node.childNodes || []).map(text).join('');}
class FixtureElement {
  constructor(readonly node: Parsed) {}
  get tagName() {return (this.node.tagName || '').toUpperCase();}
  get id() {return this.getAttribute('id') || '';}
  get className() {return this.getAttribute('class') || '';}
  get textContent() {return text(this.node);}
  getAttribute(name: string) {return this.node.attrs?.find(a => a.name === name)?.value ?? null;}
}
function matches(element: FixtureElement, selector: string): boolean {
  const m = selector.trim().match(/^([a-z0-9-]*)((?:\[[^\]]+\])*)(?::not\(\[([^\]]+)\]\))?$/i);
  if (!m) throw new Error('Seletor não suportado no DOM de teste: ' + selector);
  if (m[1] && element.tagName !== m[1].toUpperCase()) return false;
  for (const [, name, value] of m[2].matchAll(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)) {const actual = element.getAttribute(name); if (actual === null || value !== undefined && actual !== value) return false;}
  return !(m[3] && element.getAttribute(m[3]) !== null);
}
export class FixtureDocument {
  private readonly elements: FixtureElement[];
  constructor(html: string) {const all: Parsed[] = []; walk(parse(html) as unknown as Parsed, all); this.elements = all.map(node => new FixtureElement(node));}
  querySelectorAll(selector: string) {return this.elements.filter(element => selector.split(',').some(part => matches(element, part)));}
  get body() {return this.elements.find(element => element.tagName === 'BODY');}
}
export function installDomParser(): () => void {
  const previous = (globalThis as {DOMParser?: unknown}).DOMParser;
  (globalThis as {DOMParser?: unknown}).DOMParser = class {parseFromString(html: string) {return new FixtureDocument(html);}};
  return () => {(globalThis as {DOMParser?: unknown}).DOMParser = previous;};
}
