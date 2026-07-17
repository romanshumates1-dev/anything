/**
 * One-off author-time converter (NOT shipped, NOT a runtime dep): decodes the
 * Natural Earth 50m TopoJSON into a compact runtime asset the globe fetches —
 * an array of lng/lat rings for land + a separate array for country borders.
 * Runtime then just projects these points; no topojson-client at runtime, no
 * external CDN (the asset is committed to /public/geo/).
 *
 *   node scripts/build-geo.mjs
 * Input : public/geo/countries-50m.topo.json  (world-atlas@2, Natural Earth 50m)
 * Output: public/geo/land-50m.json            { land: ring[], borders: ring[] }
 *         where ring = [[lng,lat], ...] quantized to 2 decimals.
 */
import { readFileSync, writeFileSync } from 'fs';

const topo = JSON.parse(readFileSync(new URL('../public/geo/countries-50m.topo.json', import.meta.url), 'utf8'));
const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;

// Decode every arc from quantized deltas → absolute [lng,lat]. Quantize to 1
// decimal (~11km) — at a 380px globe (~0.35°/px) that is still ~0.3px, plenty,
// and roughly halves the asset vs 2 decimals. Collapse consecutive duplicate
// points that quantization creates.
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  const pts = [];
  for (const [dx, dy] of arc) {
    x += dx; y += dy;
    const p = [Math.round((x * sx + tx) * 10) / 10, Math.round((y * sy + ty) * 10) / 10];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  return pts;
});

// TopoJSON arc index: i>=0 forward, i<0 reversed (~i). Stitch a ring from its arc list.
function ringFromArcIndexes(idxs) {
  const pts = [];
  for (const idx of idxs) {
    const arc = idx < 0 ? arcs[~idx].slice().reverse() : arcs[idx];
    // Drop the shared endpoint between consecutive arcs.
    for (let k = 0; k < arc.length; k++) {
      if (k === 0 && pts.length) continue;
      pts.push(arc[k]);
    }
  }
  return pts;
}

function ringsFromGeometry(geom) {
  const out = [];
  if (geom.type === 'Polygon') {
    for (const ring of geom.arcs) out.push(ringFromArcIndexes(ring));
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.arcs) for (const ring of poly) out.push(ringFromArcIndexes(ring));
  }
  return out;
}

// Per-country rings serve BOTH fill and stroke (internal borders then show as
// thin lines — desired). One set instead of land+borders ≈ halves the asset.
// Keep short rings: the 50m set's small island chains (Caribbean, Indonesia)
// are the whole point of 50m over 110m.
const rings = [];
for (const g of topo.objects.countries.geometries) rings.push(...ringsFromGeometry(g));
const clean = rings.filter((r) => r.length >= 3);

const out = { source: 'Natural Earth 50m (world-atlas@2)', rings: clean };
const json = JSON.stringify(out);
writeFileSync(new URL('../public/geo/land-50m.json', import.meta.url), json);

const kb = (json.length / 1024).toFixed(0);
console.log(`[build-geo] rings: ${out.rings.length}, points: ${out.rings.reduce((n, r) => n + r.length, 0)}, size: ${kb}KB`);
const islands = out.rings.filter((r) => r.length < 40).length;
console.log(`[build-geo] small rings (<40 pts, i.e. islands): ${islands} — islands preserved`);
