// Compares the locally compiled Sass with the CSS served by the storefront.
// Both sides go through the same normalization, equivalent to the minifier
// differences observed (colors, zero units, calc spacing, rewritten URLs).
import * as sass from 'sass';
import {compileStyles} from './engine.mjs';
const NAMED = {black: '#000', silver: '#c0c0c0', gray: '#808080', grey: '#808080', white: '#fff', maroon: '#800000', red: '#f00', purple: '#800080', fuchsia: '#f0f', magenta: '#f0f', green: '#008000', lime: '#0f0', olive: '#808000', yellow: '#ff0', navy: '#000080', blue: '#00f', teal: '#008080', aqua: '#0ff', cyan: '#0ff', orange: '#ffa500', gold: '#ffd700', pink: '#ffc0cb', brown: '#a52a2a', coral: '#ff7f50', crimson: '#dc143c', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', dimgray: '#696969', dimgrey: '#696969', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', linen: '#faf0e6', orchid: '#da70d6', plum: '#dda0dd', salmon: '#fa8072', snow: '#fffafa', tan: '#d2b48c', tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', whitesmoke: '#f5f5f5', beige: '#f5f5dc', azure: '#f0ffff', chocolate: '#d2691e', firebrick: '#b22222', darkred: '#8b0000', darkblue: '#00008b', darkgreen: '#006400', lightblue: '#add8e6', lightgreen: '#90ee90', skyblue: '#87ceeb', slategray: '#708090', slategrey: '#708090', steelblue: '#4682b4', royalblue: '#4169e1', seagreen: '#2e8b57', sienna: '#a0522d', peru: '#cd853f', orangered: '#ff4500', hotpink: '#ff69b4', deeppink: '#ff1493', mintcream: '#f5fffa', honeydew: '#f0fff0', aliceblue: '#f0f8ff', antiquewhite: '#faebd7', bisque: '#ffe4c4', blanchedalmond: '#ffebcd', cornsilk: '#fff8dc', floralwhite: '#fffaf0', lemonchiffon: '#fffacd', lightyellow: '#ffffe0', mistyrose: '#ffe4e1', oldlace: '#fdf5e6', papayawhip: '#ffefd5', seashell: '#fff5ee'};
const short = hex => {const h = hex.toLowerCase(); return /^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/.test(h) ? '#' + h[1] + h[3] + h[5] : h;};
const toHex = (r, g, b) => short('#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0')).join(''));
export function normalizeCss(css) {
  let text = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  try {text = sass.compileString(text, {syntax: 'css', style: 'compressed', logger: sass.Logger.silent}).css;} catch {text = text.replace(/\s+/g, ' ');}
  return text
    .replace(/@charset\s+[^;]+;/gi, '').replace(/@import\s+[^;]+;/gi, '')
    .replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/gi, 'url()')
    .replace(/,\s+/g, ',').replace(/:\s+/g, ':').replace(/\s*!\s*important/gi, '!important').replace(/;}/g, '}')
    .replace(/rgba?\(\s*0,0,0,0\s*\)/gi, 'transparent')
    .replace(/rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)/gi, (_m, r, g, b) => toHex(r, g, b))
    .replace(/rgba\((\d{1,3}),(\d{1,3}),(\d{1,3}),(?:1|1\.0+)\)/gi, (_m, r, g, b) => toHex(r, g, b))
    .replace(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi, short)
    .replace(/(^|[:\s,(])([a-z]+)(?=[\s,;)}!]|$)/gi, (whole, before, name) => NAMED[name.toLowerCase()] ? before + NAMED[name.toLowerCase()] : whole)
    .replace(/(^|[^\w.#-])(-?)0(?:\.0+)?(?:px|em|rem|ex|ch|vh|vw|vmin|vmax|cm|mm|in|pt|pc)\b/g, '$10')
    .replace(/(^|[^\w.-])0+\.(\d)/g, '$1.$2')
    .replace(/font-weight:bold\b/gi, 'font-weight:700').replace(/font-weight:normal\b/gi, 'font-weight:400')
    .replace(/calc\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi, (_m, inner) => 'calc(' + inner.replace(/\s+/g, '') + ')');
}
// Flattened "context|selector{declarations}" strings, as a multiset.
export function cssRules(css) {
  const rules = [], stack = [];
  let buffer = '', quote = '';
  for (const char of css) {
    if (quote) {buffer += char; if (char === quote) quote = ''; continue;}
    if (char === '"' || char === "'") {quote = char; buffer += char; continue;}
    if (char === '{') {stack.push({prelude: buffer.trim(), nested: false}); if (stack.length > 1) stack.at(-2).nested = true; buffer = ''; continue;}
    if (char === '}') {
      const block = stack.pop();
      if (block && !block.nested && buffer.trim()) rules.push([...stack.map(s => s.prelude), block.prelude].join('|') + '{' + buffer.trim() + '}');
      buffer = ''; continue;
    }
    if (char === ';' && stack.length === 0) {buffer = ''; continue;}
    buffer += char;
  }
  return rules;
}
function multiset(list) {const map = new Map(); for (const item of list) map.set(item, (map.get(item) || 0) + 1); return map;}
export function compareCss(localCss, servedCss) {
  const local = multiset(cssRules(normalizeCss(localCss))), served = multiset(cssRules(normalizeCss(servedCss)));
  let matched = 0; const onlyLocal = [], onlyServed = [];
  for (const [rule, count] of local) {const other = served.get(rule) || 0; matched += Math.min(count, other); if (count > other) onlyLocal.push(rule);}
  for (const [rule, count] of served) if (count > (local.get(rule) || 0)) onlyServed.push(rule);
  const total = map => [...map.values()].reduce((sum, n) => sum + n, 0);
  return {localRules: total(local), servedRules: total(served), matched, equal: !onlyLocal.length && !onlyServed.length, onlyLocal: onlyLocal.slice(0, 5), onlyServed: onlyServed.slice(0, 5)};
}
function entriesFor(config, sheet) {
  if (sheet.group === 'styles') return config.styles || [];
  if (sheet.group === 'mobileStyles') return config.mobileStyles || [];
  return config[sheet.group]?.[sheet.page] || [];
}
export function cssParity(local) {
  const sheets = local.preview.platform?.themeSheets || [], results = [];
  for (const sheet of sheets) {
    const resource = local.preview.resources.find(r => r.url === sheet.url), served = resource && local.preview.assets[resource.path];
    const entries = entriesFor(local.config, sheet);
    if (!served || !entries.length) {results.push({url: sheet.url, group: sheet.group, page: sheet.page ?? null, status: served ? 'no-local-entry' : 'not-captured'}); continue;}
    try {
      const comparison = compareCss(compileStyles(local.text, entries, {style: 'compressed'}), served.toString('utf8'));
      results.push({url: sheet.url, group: sheet.group, page: sheet.page ?? null, entries, status: comparison.equal ? 'equal' : 'different', ...comparison});
    } catch (error) {results.push({url: sheet.url, group: sheet.group, page: sheet.page ?? null, entries, status: 'compile-error', reason: error.message});}
  }
  const compared = results.filter(r => ['equal', 'different'].includes(r.status));
  const association = !compared.length ? 'not-compared' : compared.every(r => r.status === 'equal') ? 'published-verified-by-css' : 'published-css-divergent';
  return {association, sheets: results, note: 'Equivalência por regras após normalização de minificação; URLs e ordem entre regras iguais não são comparadas.'};
}
