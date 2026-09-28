import { cellsToMultiPolygon, compactCells, getResolution, POLYGON_TO_CELLS_FLAGS, polygonToCells, polygonToCellsExperimental, uncompactCells } from 'h3-js';
import type { FeatureCollection } from 'geojson';
import { cellsToFeatures, EMPTY, estimateCells, fmtInt, selfIntersects, type BBox } from '../h3geo.ts';
import { bindRange, code, COLORS, q, RAMP, range, rows, scene, toast, type Mode } from '../mode.ts';

const CAP = 60_000;

// Around central São Paulo, with a hole (Ibirapuera park) to show that holes are supported.
const PRESET: number[][][] = [
  [[-46.705, -23.535], [-46.625, -23.518], [-46.575, -23.56], [-46.6, -23.615], [-46.668, -23.63], [-46.715, -23.595], [-46.705, -23.535]],
  [[-46.668, -23.582], [-46.648, -23.578], [-46.645, -23.595], [-46.662, -23.6], [-46.668, -23.582]],
];

const MODES: [string, string][] = [
  ['classic', 'polygonToCells (cell center inside)'],
  ['containmentCenter', 'Experimental: center inside'],
  ['containmentFull', 'Experimental: whole cell inside'],
  ['containmentOverlapping', 'Experimental: any overlap'],
  ['containmentOverlappingBbox', 'Experimental: bounding box overlaps'],
];

export const polygon: Mode = {
  id: 'polygon',
  title: 'Polygon to cells',
  blurb: 'Fill any polygon (holes included) with cells, choose which cells count as inside, then <em>compact</em> the result into the smallest set of mixed-resolution cells that covers the same area. Draw your own polygon to try it.',
  apis: [
    'polygonToCells(coords, res, true)',
    'polygonToCellsExperimental(coords, res, flag, true)',
    'POLYGON_TO_CELLS_FLAGS.containment*',
    'compactCells(cells)',
    'uncompactCells(cells, res)',
    'cellsToMultiPolygon(cells, true)',
  ],

  mount(map, panel) {
    const s = scene(map);
    let res = 9;
    let flag = 'classic';
    let compact = false;
    let shape = PRESET;
    let drawing: number[][] | null = null;
    let cursor: number[] | null = null;

    const setCells = s.source('pg-cells');
    const setOutline = s.source('pg-outline', false);
    const setShape = s.source('pg-shape', false);
    const setDraw = s.source('pg-draw', false);

    s.layer({
      id: 'pg-cells-fill',
      type: 'fill',
      source: 'pg-cells',
      paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 'r'], 5, RAMP[2], 8, RAMP[4], 11, RAMP[5], 15, RAMP[6]],
        'fill-opacity': 0.42,
      },
    });
    s.layer({ id: 'pg-cells-line', type: 'line', source: 'pg-cells', paint: { 'line-color': COLORS.ink, 'line-width': 0.6, 'line-opacity': 0.8 } });
    s.layer({ id: 'pg-outline', type: 'line', source: 'pg-outline', paint: { 'line-color': COLORS.amber, 'line-width': 2.5 } });
    s.layer({ id: 'pg-shape', type: 'line', source: 'pg-shape', paint: { 'line-color': COLORS.teal, 'line-width': 2, 'line-dasharray': [2, 1.5] } });
    s.layer({ id: 'pg-draw-line', type: 'line', source: 'pg-draw', paint: { 'line-color': COLORS.teal, 'line-width': 2 } });
    s.layer({
      id: 'pg-draw-pts',
      type: 'circle',
      source: 'pg-draw',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 4, 'circle-color': COLORS.teal, 'circle-stroke-color': COLORS.ink, 'circle-stroke-width': 1.5 },
    });

    panel.innerHTML = `
      ${range('res', 'Resolution', 0, 13, res)}
      <label class="ctl"><span class="ctl-label">Which cells count as inside</span>
        <select name="flag">${MODES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="toggle"><input type="checkbox" name="compact" /><span>Compact (merge full sets of children into their parent)</span></label>
      <div class="row">
        <button class="chip primary" data-draw>Draw a polygon</button>
        <button class="chip" data-preset>Reset to the example</button>
      </div>
      <p class="hint" data-drawhint hidden>Click to add points. <kbd>Enter</kbd> or double-click to finish, <kbd>Backspace</kbd> undoes the last point, <kbd>Esc</kbd> cancels.</p>
      <div class="card" data-stats></div>
      <p class="hint"><span class="sw-line" style="background:${COLORS.teal}"></span> your polygon ·
        <span class="sw-line" style="background:${COLORS.amber}"></span> outline from ${code('cellsToMultiPolygon')}</p>`;

    const stats = q(panel, '[data-stats]');
    const drawHint = q(panel, '[data-drawhint]');

    function renderShape() {
      setShape({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: shape } });
    }

    function render() {
      const lngs = shape[0].map((p) => p[0]);
      const lats = shape[0].map((p) => p[1]);
      const box: BBox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
      const estimate = estimateCells(box, res);
      if (estimate > CAP) {
        setCells(EMPTY);
        setOutline(EMPTY);
        stats.innerHTML = `<p class="warn">Roughly ${fmtInt(estimate)} cells, over the ${fmtInt(CAP)} limit for this demo. Lower the resolution.</p>`;
        return;
      }

      const t0 = performance.now();
      const cells =
        flag === 'classic'
          ? polygonToCells(shape, res, true)
          : polygonToCellsExperimental(shape, res, POLYGON_TO_CELLS_FLAGS[flag as keyof typeof POLYGON_TO_CELLS_FLAGS], true);
      const t1 = performance.now();
      const compacted = compactCells(cells);
      const shown = compact ? compacted : cells;
      setCells(cellsToFeatures(shown, (c) => ({ r: getResolution(c) })));

      const outline = cellsToMultiPolygon(cells, true);
      const outlineFc: FeatureCollection = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: outline.flat() } }],
      };
      setOutline(outlineFc);

      const roundTrip = uncompactCells(compacted, res).length;
      const resCounts = new Map<number, number>();
      for (const c of compacted) resCounts.set(getResolution(c), (resCounts.get(getResolution(c)) ?? 0) + 1);

      stats.innerHTML = rows([
        [`Cells at res ${res}`, `<b>${fmtInt(cells.length)}</b> <small>(${(t1 - t0).toFixed(1)} ms)</small>`],
        [
          'After compactCells',
          `<b>${fmtInt(compacted.length)}</b> <small>(${cells.length ? ((1 - compacted.length / cells.length) * 100).toFixed(0) : 0}% fewer)</small>`,
        ],
        ['Mix of resolutions', [...resCounts].sort((a, b) => a[0] - b[0]).map(([r, n]) => `r${r}×${fmtInt(n)}`).join(' · ') || '—'],
        ['uncompactCells round trip', roundTrip === cells.length ? `✓ ${fmtInt(roundTrip)} cells` : `<b class="warn">${roundTrip} ≠ ${cells.length}</b>`],
        ['Outline parts', `${outline.length} polygon(s), ${outline.reduce((n, p) => n + p.length - 1, 0)} hole(s)`],
      ]) + (selfIntersects(shape[0]) ? `<p class="warn">The polygon crosses itself, so H3’s result is not well defined.</p>` : '');
    }

    // --- drawing (no plugin: clicks, keys and a preview line) ---
    function renderDraw() {
      if (!drawing) return setDraw(EMPTY);
      const line = cursor ? [...drawing, cursor] : drawing;
      setDraw({
        type: 'FeatureCollection',
        features: [
          ...(line.length > 1 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: line } }] : []),
          ...drawing.map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: p } })),
        ],
      });
    }

    function startDraw() {
      drawing = [];
      cursor = null;
      drawHint.hidden = false;
      map.getCanvas().style.cursor = 'crosshair';
      renderDraw();
    }

    function stopDraw() {
      drawing = null;
      cursor = null;
      drawHint.hidden = true;
      map.getCanvas().style.cursor = '';
      renderDraw();
    }

    function finishDraw() {
      if (!drawing) return;
      // a double-click also fires two clicks; drop the duplicated points it adds
      const pts = drawing.filter((p, i) => i === 0 || Math.hypot(p[0] - drawing![i - 1][0], p[1] - drawing![i - 1][1]) > 1e-9);
      if (pts.length < 3) {
        toast('A polygon needs at least 3 points');
        return;
      }
      shape = [[...pts, pts[0]]];
      stopDraw();
      renderShape();
      render();
    }

    s.on('click', (e) => {
      if (!drawing) return;
      drawing.push([e.lngLat.lng, e.lngLat.lat]);
      renderDraw();
    });
    s.on('dblclick', (e) => {
      if (!drawing) return;
      e.preventDefault();
      finishDraw();
    });
    s.on('mousemove', (e) => {
      if (!drawing) return;
      cursor = [e.lngLat.lng, e.lngLat.lat];
      renderDraw();
    });
    const onKey = (e: KeyboardEvent) => {
      if (!drawing || (e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.key === 'Enter') finishDraw();
      else if (e.key === 'Escape') stopDraw();
      else if (e.key === 'Backspace') {
        drawing.pop();
        renderDraw();
      }
    };
    window.addEventListener('keydown', onKey);
    const hadDblZoom = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable();

    bindRange(panel, 'res', (v) => {
      res = v;
      render();
    });
    q<HTMLSelectElement>(panel, 'select[name="flag"]').addEventListener('change', (e) => {
      flag = (e.target as HTMLSelectElement).value;
      render();
    });
    q<HTMLInputElement>(panel, 'input[name="compact"]').addEventListener('change', (e) => {
      compact = (e.target as HTMLInputElement).checked;
      render();
    });
    q(panel, '[data-draw]').addEventListener('click', startDraw);
    q(panel, '[data-preset]').addEventListener('click', () => {
      shape = PRESET;
      stopDraw();
      renderShape();
      render();
      map.fitBounds([[-46.72, -23.64], [-46.57, -23.51]], { padding: 40 });
    });

    renderShape();
    render();
    map.fitBounds([[-46.72, -23.64], [-46.57, -23.51]], { padding: 40, duration: 800 });

    return () => {
      window.removeEventListener('keydown', onKey);
      if (hadDblZoom) map.doubleClickZoom.enable();
      map.getCanvas().style.cursor = '';
      s.dispose();
    };
  },
};

