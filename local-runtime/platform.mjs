// Generic local implementations. These are not proprietary Yampi services.
import {themeSheet} from './contract.mjs';
const WEIGHTS = {thin: 100, hairline: 100, extralight: 200, 'extra-light': 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, medio: 500, semibold: 600, 'semi-bold': 600, demibold: 600, bold: 700, negrito: 700, extrabold: 800, 'extra-bold': 800, ultrabold: 800, black: 900, heavy: 900};
const unquote = value => String(value || '').replace(/["']/g, '').split(',')[0].trim().toLowerCase();
export function twigHelpers(localAsset, previewAsset = value => String(value || '').startsWith('/preview/assets/') ? value : '/__local/placeholder.svg', {platform = {}, map = {}, pages, trace = {}} = {}) {
  const rgb = value => {
    let hex = String(value || '#ffffff').replace(/^#/, '');
    if (hex.length === 3) hex = [...hex].map(c => c + c).join('');
    if (!/^[a-f0-9]{6}([a-f0-9]{2})?$/i.test(hex)) return [255, 255, 255];
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  };
  const luminance = color => rgb(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  const radius = value => ({square: '0px', rounded: '8px', round: '50%', pill: '999px'}[value] || '8px');
  const clean = value => String(value || '').replace(/\{\{|\}\}/g, '');
  // Captured font sheets keep only latin/latin-ext faces, served from preview/.
  const fontLink = family => {
    const name = unquote(family);
    const sheet = (platform.fontSheets || []).find(s => (s.families || []).some(f => unquote(f) === name));
    if (sheet && map[sheet.url]) return map[sheet.url];
    if (name) (trace.fonts ||= []).push(name);
    return '/__local/empty.css';
  };
  // Published theme sheets keep their own link, media and order locally.
  const componentsUrl = value => {
    const source = String(value || '');
    if (!/\.css(?:$|\?)/.test(source)) return '/__local/empty.js';
    return themeSheet(source, pages) ? '/__local' + new URL(source, 'https://local.invalid').pathname : '/__local/style.css';
  };
  return {
    filters: {
      bool_text: v => v === true || v === 'true' || v === 1 ? 'true' : 'false',
      boolean: v => v === true || v === 'true' || v === 1,
      json_decode: v => JSON.parse(v || '{}'),
      only_numbers: v => String(v || '').replace(/\D/g, ''),
      strip_mustache: clean,
      font_link: fontLink,
      components_url: componentsUrl,
      mask: (v, mask) => {let i = 0; const digits = String(v || '').replace(/\D/g, ''); return String(mask || '').replace(/#/g, () => digits[i++] || '');},
      youtube_url: () => '',
    },
    functions: {
      strip_mustache: clean,
      hex_to_rgb: v => rgb(v).join(', '),
      hex_to_rgba: (v, a) => `rgba(${rgb(v).join(', ')}, ${a ?? 1})`,
      relative_luminance: luminance,
      is_gray: v => {const [r, g, b] = rgb(v); return r === g && g === b;},
      color_is_light: v => luminance(v) > .5,
      is_color_contrasting: (a, b) => contrast(a, b) >= 3,
      get_contrasting_color: (v, foreground, alternative) => foreground ? contrast(v, foreground) >= 3 ? foreground : alternative || '#000000' : contrast(v, '#000000') > contrast(v, '#ffffff') ? '#000000' : '#ffffff',
      button_bg_color: (style, color) => /^(outline|outlined|contour|contorno)$/i.test(String(style)) ? 'transparent' : color || (/^(#|rgb|hsl|var\()/i.test(String(style)) ? style : '#222222'),
      font_weight: (family, weight) => {const value = String(weight ?? family).trim().toLowerCase(); return WEIGHTS[value] || WEIGHTS[value.replace(/[\s_]/g, '')] || Number(value) || 400;},
      type_border_radius: radius, type_border_radius_slide: radius, resolve_border_radius_by_type: radius,
      product_discount_tag_radius: radius,
      product_image_margin: () => '0px',
      social_media_fa: v => 'fa-' + String(v || '').replace(/[^a-z-]/gi, ''),
      thumborize: v => String(v || '').startsWith('/tema/assets/') ? v : previewAsset(v),
      vuetify: (value, name, key, interpolate) => {
        if (value) return String(String(key || '').split('.').reduce((item, property) => item?.[property], value) ?? '');
        const expression = 'data.' + String(name || 'product') + (key ? '.' + key : '');
        return interpolate === false ? expression : '{{ ' + expression + ' }}';
      },
      asset: localAsset,
    }
  };
}
