// Refraction for the two floating bars. Each bar gets an SVG displacement map made for its own
// size: near the rounded rim, the content behind is sampled from further inside, so text that
// scrolls under the edge bends the way it does under thick glass. Chromium applies SVG filters
// in backdrop-filter; where it cannot, the bars keep their plain blur.
const SVG = 'http://www.w3.org/2000/svg';
interface LensOptions {radius: number; bezel: number; shift: number}
export function lens(element: HTMLElement, id: string, options: LensOptions): void {
  if (!CSS.supports('backdrop-filter', `url(#${id}) blur(1px)`) || matchMedia('(prefers-reduced-transparency: reduce)').matches) return;
  const defs = document.querySelector('svg.defs');
  if (!defs) return;
  const filter = document.createElementNS(SVG, 'filter'), image = document.createElementNS(SVG, 'feImage'), displace = document.createElementNS(SVG, 'feDisplacementMap');
  filter.id = id;
  for (const [key, value] of Object.entries({x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB'})) filter.setAttribute(key, value);
  for (const [key, value] of Object.entries({x: '0', y: '0', result: 'map', preserveAspectRatio: 'none'})) image.setAttribute(key, value);
  for (const [key, value] of Object.entries({in: 'SourceGraphic', in2: 'map', scale: String(options.shift * 2), xChannelSelector: 'R', yChannelSelector: 'G'})) displace.setAttribute(key, value);
  filter.append(image, displace); defs.append(filter);
  let size = '';
  const draw = () => {
    const box = element.getBoundingClientRect(), width = Math.round(box.width), height = Math.round(box.height);
    if (!width || !height || `${width}x${height}` === size) return;
    size = `${width}x${height}`;
    image.setAttribute('width', String(width)); image.setAttribute('height', String(height));
    image.setAttribute('href', displacementMap(width, height, options));
  };
  new ResizeObserver(draw).observe(element);
  draw();
  element.style.setProperty('--lens', `url(#${id})`);
  element.classList.add('lensed');
}
// Red and green hold the x and y offsets (128 = none). The offset grows toward the rim with a
// rounded profile, pointing inward along the shape's normal, corners included.
function displacementMap(width: number, height: number, {radius, bezel}: LensOptions): string {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!, image = context.createImageData(width, height), data = image.data;
  const cx = width / 2, cy = height / 2, r = Math.min(radius, cx, cy), hx = cx - r, hy = cy - r;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x + .5 - cx, py = y + .5 - cy, qx = Math.abs(px) - hx, qy = Math.abs(py) - hy;
    let nx = 0, ny = 0, inside: number;
    if (qx > 0 && qy > 0) {const length = Math.hypot(qx, qy); inside = r - length; nx = qx / length * Math.sign(px); ny = qy / length * Math.sign(py);}
    else if (qx > qy) {inside = r - qx; nx = Math.sign(px);}
    else {inside = r - qy; ny = Math.sign(py);}
    const depth = Math.max(0, Math.min(1, inside / bezel)), strength = inside < 0 ? 0 : 1 - Math.sqrt(1 - (1 - depth) ** 2);
    const offset = (y * width + x) * 4;
    data[offset] = Math.round(128 - 127 * nx * strength);
    data[offset + 1] = Math.round(128 - 127 * ny * strength);
    data[offset + 2] = 128; data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
// Apple's glass grows its shadow while content passes beneath it.
export function adaptiveShadows(top: HTMLElement, bottom: HTMLElement): void {
  let frame = 0;
  const update = () => {
    frame = 0;
    const scroller = document.scrollingElement || document.documentElement;
    top.dataset.covering = String(scroller.scrollTop > 2);
    bottom.dataset.covering = String(scroller.scrollTop + window.innerHeight < scroller.scrollHeight - 2);
  };
  const schedule = () => {if (!frame) frame = requestAnimationFrame(update);};
  addEventListener('scroll', schedule, {passive: true});
  addEventListener('resize', schedule);
  new ResizeObserver(schedule).observe(document.body);
  update();
}
