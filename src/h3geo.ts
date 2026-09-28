import { cellToBoundary, cellToLatLng, getHexagonAreaAvg, polygonToCells, UNITS } from 'h3-js';
import type { Feature, FeatureCollection, Polygon } from 'geojson';

const EARTH_R_KM = 6371.0088;
const POLE_LAT = 89.99; // exactly 90 projects to infinity in web mercator

/**
 * Make a [lng, lat] ring continuous: each vertex is kept within 180° of the previous one,
 * so cells crossing the antimeridian don't smear across the whole map (lng may leave [-180, 180],
 * which MapLibre renders fine). A ring that still drifts by 360° encloses a pole, so we close it
 * through the pole instead.
 */
export function unwrapRing(ring: number[][]): number[][] {
  const out = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    const prev = out[i - 1][0];
    let lng = ring[i][0];
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    out.push([lng, ring[i][1]]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (Math.abs(last[0] - first[0]) > 180) {
    const pole = first[1] > 0 ? POLE_LAT : -POLE_LAT;
    out.push([last[0], pole], [first[0], pole], [first[0], first[1]]);
  }
  return out;
}

export function cellFeature<P extends object>(cell: string, props?: P): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: { h3: cell, ...props },
    geometry: { type: 'Polygon', coordinates: [unwrapRing(cellToBoundary(cell, true))] },
  };
}

export function cellsToFeatures<P extends object>(
  cells: string[],
  props?: (cell: string, i: number) => P,
): FeatureCollection<Polygon> {
  return { type: 'FeatureCollection', features: cells.map((c, i) => cellFeature(c, props?.(c, i))) };
}

/**
 * Rotation of a cell relative to north: the bearing from its center to its first vertex, folded by the
 * cell's symmetry (60° for hexagons, 72° for pentagons). 0° = a vertex points due north.
 */
export function cellOrientation(cell: string): number {
  const rad = Math.PI / 180;
  const [lat1, lng1] = cellToLatLng(cell);
  const boundary = cellToBoundary(cell);
  const [lat2, lng2] = boundary[0];
  const dLng = (lng2 - lng1) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
  const fold = 360 / boundary.length;
  return (((Math.atan2(y, x) / rad) % fold) + fold) % fold;
}

export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export type BBox = [west: number, south: number, east: number, north: number];

/** Spherical area of a lat/lng box, km². */
export function bboxAreaKm2([w, s, e, n]: BBox): number {
  const rad = Math.PI / 180;
  return EARTH_R_KM ** 2 * Math.min(e - w, 360) * rad * Math.abs(Math.sin(n * rad) - Math.sin(s * rad));
}

export function estimateCells(bbox: BBox, res: number): number {
  return Math.ceil(bboxAreaKm2(bbox) / getHexagonAreaAvg(res, UNITS.km2));
}

/**
 * Split a (possibly world-wrapped) bbox into chunks ≤ 90° wide, each normalized into [-180, 180].
 * H3 treats polygons wider than 180° as crossing the antimeridian, so a wide box must be split.
 * Chunk edges are aligned to multiples of 90°, so no chunk straddles ±180.
 */
export function chunkBBox([w, s, e, n]: BBox): BBox[] {
  if (e - w >= 360) [w, e] = [-180, 180];
  const chunks: BBox[] = [];
  for (let x = w; x < e; ) {
    const next = Math.min(e, (Math.floor(x / 90) + 1) * 90);
    const offset = Math.floor((x + 180) / 360) * 360;
    chunks.push([x - offset, s, next - offset, n]);
    x = next;
  }
  return chunks;
}

export type ViewportResult = { cells: string[]; capped: false } | { capped: true; estimate: number };

export function viewportCells(bbox: BBox, res: number, cap: number): ViewportResult {
  const estimate = estimateCells(bbox, res);
  if (estimate > cap) return { capped: true, estimate };
  const cells = new Set<string>();
  for (const [w, s, e, n] of chunkBBox(bbox)) {
    const ring = [[w, s], [e, s], [e, n], [w, n], [w, s]];
    for (const c of polygonToCells(ring, res, true)) cells.add(c);
  }
  return { cells: [...cells], capped: false };
}

/** O(n²) check for crossing edges in a closed ring; fine for hand-drawn polygons (tens of vertices). */
export function selfIntersects(ring: number[][]): boolean {
  const n = ring.length - 1; // closed ring: last == first
  const cross = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
      const [a, b, c, d] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  }
  return false;
}

export const fmtArea = (km2: number) =>
  km2 >= 1 ? `${km2.toLocaleString('en', { maximumFractionDigits: 2 })} km²` : `${(km2 * 1e6).toLocaleString('en', { maximumFractionDigits: 2 })} m²`;

export const fmtLen = (km: number) =>
  km >= 1 ? `${km.toLocaleString('en', { maximumFractionDigits: 2 })} km` : `${(km * 1e3).toLocaleString('en', { maximumFractionDigits: 2 })} m`;

export const fmtInt = (n: number) => n.toLocaleString('en');
