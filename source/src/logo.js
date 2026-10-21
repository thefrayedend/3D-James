import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

/** SVG is parsed as data, never inserted into the live page. Closed filled paths only. */
export function parseLogo(svg, label = 'Logo') {
  if (svg.length > 2 * 1048576) throw new Error('Use an SVG smaller than 2 MB.');
  const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'svg') throw new Error('This is not a valid SVG.');
  if (xml.querySelector('image, foreignObject, script, use')) throw new Error('Use a self-contained SVG made of filled paths. Convert text, linked objects and strokes to paths first.');
  const { paths } = new SVGLoader().parse(svg);
  const shapes = [];
  let points = 0;
  const loop = (curve) => {
    const pts = curve.getPoints(32).map((v) => [v.x, -v.y]);
    if (pts.length > 1 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-9) pts.pop();
    const clean = pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-9);
    if (clean.length < 3 || clean.some((p) => p.some((v) => !Number.isFinite(v)))) throw new Error('The SVG contains an invalid outline.');
    points += clean.length;
    if (points > 20000) throw new Error('This logo has too much detail. Simplify its paths first.');
    return clean;
  };
  for (const path of paths) {
    const style = path.userData?.style;
    if (style?.fill === 'none' || +style?.fillOpacity === 0 || +style?.opacity === 0) continue;
    for (const shape of SVGLoader.createShapes(path)) shapes.push({ outer: loop(shape), holes: shape.holes.map(loop) });
  }
  if (!shapes.length) throw new Error('No filled outlines found. Convert SVG text and strokes to filled paths first.');
  const all = shapes.flatMap((s) => [s.outer, ...s.holes]).flat();
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = maxX - minX;
  if (!(width > 1e-9 && maxY > minY)) throw new Error('The SVG has no usable area.');
  for (const p of all) { p[0] = (p[0] - (minX + maxX) / 2) / width; p[1] = (p[1] - (minY + maxY) / 2) / width; }
  return { label, shapes, aspect: (maxY - minY) / width, svg };
}
