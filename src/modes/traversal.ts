import {
  areNeighborCells,
  cellToLatLng,
  cellToLocalIj,
  getHexagonEdgeLengthAvg,
  getPentagons,
  greatCircleDistance,
  gridDisk,
  gridDiskDistances,
  gridDistance,
  gridPathCells,
  gridRing,
  gridRingUnsafe,
  latLngToCell,
  localIjToCell,
  UNITS,
} from 'h3-js';
import type { FeatureCollection } from 'geojson';
import { cellsToFeatures, EMPTY, fmtInt, fmtLen, unwrapRing } from '../h3geo.ts';
import { bindRange, bindSegmented, cellLayers, code, COLORS, esc, LABEL_FONT, q, range, RAMP, rows, scene, segmented, type Mode } from '../mode.ts';

const MAX_PATH = 5_000;
const MAX_LABELS = 80;

export const traversal: Mode = {
  id: 'traversal',
  title: 'Neighbors & paths',
  blurb: 'Every hexagon has 6 neighbors, all the same distance away. That makes k-rings, grid distance and grid paths cheap to compute. Clicks alternate between setting the origin and the destination.',
  apis: [
    'gridDisk(cell, k)',
    'gridDiskDistances(cell, k)',
    'gridRing(cell, k)',
    'gridRingUnsafe(cell, k)',
    'gridDistance(a, b)',
    'gridPathCells(a, b)',
    'areNeighborCells(a, b)',
    'cellToLocalIj(origin, cell)',
    'localIjToCell(origin, {i, j})',
    'greatCircleDistance(a, b, UNITS.km)',
  ],

  mount(map, panel) {
    const s = scene(map);
    let res = 8;
    let k = 3;
    let kind = 'disk';
    let origin = '';
    let dest = '';
    let next: 'origin' | 'dest' = 'dest';

    const setDisk = s.source('tr-disk');
    const setPath = s.source('tr-path');
    const setEnds = s.source('tr-ends');
    const setLine = s.source('tr-line', false);
    const setLabels = s.source('tr-labels', false);

    s.layer({
      id: 'tr-disk-fill',
      type: 'fill',
      source: 'tr-disk',
      paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 't'], 0, RAMP[5], 0.5, RAMP[4], 1, RAMP[2]],
        'fill-opacity': 0.4,
      },
    });
    s.layer({ id: 'tr-disk-line', type: 'line', source: 'tr-disk', paint: { 'line-color': COLORS.ink, 'line-width': 0.8 } });
    cellLayers(s, 'tr-path', COLORS.teal, { fill: 0.3, line: 1 });
    cellLayers(s, 'tr-ends', COLORS.paper, { fill: 0.1, line: 2.5 });
    s.layer({
      id: 'tr-line',
      type: 'line',
      source: 'tr-line',
      paint: { 'line-color': COLORS.teal, 'line-width': 2, 'line-dasharray': [2, 2] },
    });
    s.layer({
      id: 'tr-labels',
      type: 'symbol',
      source: 'tr-labels',
      layout: { 'text-field': ['get', 't'], 'text-font': LABEL_FONT, 'text-size': 10, 'text-allow-overlap': false },
      paint: { 'text-color': COLORS.paper, 'text-halo-color': COLORS.ink, 'text-halo-width': 1.5 },
    });

    panel.innerHTML = `
      ${range('res', 'Resolution', 0, 15, res)}
      ${range('k', 'k (ring size)', 0, 12, k)}
      ${segmented('kind', [['disk', 'gridDisk'], ['ring', 'gridRing'], ['unsafe', 'gridRingUnsafe']], kind)}
      <div class="row"><span class="ctl-label">Next click sets</span>
        ${segmented('next', [['origin', 'Origin'], ['dest', 'Destination']], next)}</div>
      <button class="chip" data-pent>Jump to a pentagon</button>
      <div data-out></div>`;

    const out = q(panel, '[data-out]');

    function setNext(v: 'origin' | 'dest') {
      next = v;
      q<HTMLInputElement>(panel, `input[name="next"][value="${v}"]`).checked = true;
    }

    function render() {
      const html: string[] = [];
      setDisk(EMPTY);
      if (origin) {
        try {
          if (kind === 'disk') {
            // gridDiskDistances returns one array of cells per distance 0..k
            const rings = gridDiskDistances(origin, k);
            const dists = rings.flatMap((r, d) => r.map(() => d));
            setDisk(cellsToFeatures(rings.flat(), (_, i) => ({ t: dists[i] / Math.max(k, 1) })));
            html.push(rows([['Cells in disk', `${fmtInt(gridDisk(origin, k).length)} <small>(3k² + 3k + 1 = ${3 * k * k + 3 * k + 1} unless a pentagon is nearby)</small>`]]));
          } else {
            const ring = kind === 'ring' ? gridRing(origin, k) : gridRingUnsafe(origin, k);
            setDisk(cellsToFeatures(ring, () => ({ t: 1 })));
            html.push(rows([['Cells in ring', `${ring.length} <small>(6k = ${Math.max(1, 6 * k)} unless a pentagon is nearby)</small>`]]));
          }
        } catch (err) {
          // gridRingUnsafe throws when it runs into pentagon distortion; show the error, don't hide it.
          html.push(`<p class="error">${code(kind === 'unsafe' ? 'gridRingUnsafe' : kind)} threw: ${esc((err as Error).message)}. Use ${code('gridRing')}, which handles pentagons.</p>`);
        }
      }

      const ends = [origin, dest].filter(Boolean);
      setEnds(cellsToFeatures(ends));
      setPath(EMPTY);
      setLine(EMPTY);
      setLabels(EMPTY);

      if (origin && dest) {
        const a = cellToLatLng(origin);
        const b = cellToLatLng(dest);
        const gc = greatCircleDistance(a, b, UNITS.km);
        try {
          const dist = gridDistance(origin, dest);
          if (dist > MAX_PATH) throw new Error(`the path would have ${fmtInt(dist + 1)} cells; the demo stops at ${fmtInt(MAX_PATH)}`);
          const path = gridPathCells(origin, dest);
          setPath(cellsToFeatures(path));
          const line: FeatureCollection = {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: unwrapRing(path.map((c) => cellToLatLng(c).reverse())) } }],
          };
          setLine(line);

          // Local IJ: integer coordinates anchored at the origin. It only works near the origin (same base cell or adjacent).
          let ijOk = 0;
          let ijFail = '';
          const labels = path.flatMap((c) => {
            try {
              const ij = cellToLocalIj(origin, c);
              if (localIjToCell(origin, ij) === c) ijOk++;
              const [lat, lng] = cellToLatLng(c);
              return [{ type: 'Feature' as const, properties: { t: `${ij.i},${ij.j}` }, geometry: { type: 'Point' as const, coordinates: [lng, lat] } }];
            } catch (err) {
              ijFail = (err as Error).message;
              return [];
            }
          });
          if (path.length <= MAX_LABELS) setLabels({ type: 'FeatureCollection', features: labels });

          const hexKm = getHexagonEdgeLengthAvg(res, UNITS.km) * Math.sqrt(3); // center-to-center of adjacent hexagons
          html.push(`<div class="card">
            <span class="eyebrow">Origin → destination</span>
            ${rows([
              ['Grid distance', `<b>${fmtInt(dist)}</b> steps`],
              ['Path cells', fmtInt(path.length)],
              ['Neighbors?', areNeighborCells(origin, dest) ? 'yes' : 'no'],
              ['Great-circle distance', fmtLen(gc)],
              ['Steps × average spacing', `${fmtLen(dist * hexKm)} <small>(grid paths zig-zag, so this is usually longer)</small>`],
              ['Local IJ round trips', `${ijOk}/${path.length}${ijFail ? ` <small class="warn">${esc(ijFail)}</small>` : ''}`],
            ])}
            ${path.length > MAX_LABELS ? `<p class="hint">IJ labels are hidden when the path has more than ${MAX_LABELS} cells.</p>` : ''}
          </div>`);
        } catch (err) {
          html.push(`<p class="error">No grid path: ${esc((err as Error).message)}. Great-circle distance is still ${fmtLen(gc)}.</p>`);
        }
      } else {
        html.push(`<p class="hint">${origin ? 'Click again to set a destination.' : 'Click the map to set an origin.'}</p>`);
      }
      out.innerHTML = html.join('');
    }

    function reindex() {
      if (origin) origin = latLngToCell(...(cellToLatLng(origin) as [number, number]), res);
      if (dest) dest = latLngToCell(...(cellToLatLng(dest) as [number, number]), res);
    }

    bindRange(panel, 'res', (v) => {
      res = v;
      reindex();
      render();
    });
    bindRange(panel, 'k', (v) => {
      k = v;
      render();
    });
    bindSegmented(panel, 'kind', (v) => {
      kind = v;
      render();
    });
    bindSegmented(panel, 'next', (v) => (next = v as typeof next));

    q(panel, '[data-pent]').addEventListener('click', () => {
      origin = getPentagons(res)[0];
      dest = '';
      setNext('dest');
      q<HTMLInputElement>(panel, 'input[name="kind"][value="unsafe"]').checked = true;
      kind = 'unsafe';
      const [lat, lng] = cellToLatLng(origin);
      map.flyTo({ center: [lng, lat], zoom: Math.max(1, res * 1.12 - 0.5) });
      render();
    });

    s.on('click', (e) => {
      const cell = latLngToCell(e.lngLat.lat, e.lngLat.lng, res);
      if (next === 'origin' || !origin) {
        origin = cell;
        setNext('dest');
      } else {
        dest = cell;
        setNext('origin');
      }
      render();
    });

    const c = map.getCenter();
    origin = latLngToCell(c.lat, c.lng, res);
    render();

    return () => s.dispose();
  },
};
