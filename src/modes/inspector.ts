import {
  cellArea,
  cellToLatLng,
  cellToVertex,
  cellToVertexes,
  cellsToDirectedEdge,
  h3IndexToSplitLong,
  splitLongToH3Index,
  constructCell,
  degsToRads,
  directedEdgeToBoundary,
  directedEdgeToCells,
  edgeLength,
  getBaseCellNumber,
  getDirectedEdgeDestination,
  getDirectedEdgeOrigin,
  getHexagonAreaAvg,
  getIcosahedronFaces,
  getIndexDigit,
  getResolution,
  isPentagon,
  isResClassIII,
  isValidCell,
  isValidDirectedEdge,
  isValidIndex,
  isValidVertex,
  latLngToCell,
  originToDirectedEdges,
  reverseDirectedEdge,
  UNITS,
  vertexToLatLng,
} from 'h3-js';
import type { FeatureCollection } from 'geojson';
import { cellFeature, cellOrientation, cellsToFeatures, EMPTY, fmtArea, fmtLen, unwrapRing } from '../h3geo.ts';
import { bindRange, cellLayers, code, COLORS, esc, LABEL_FONT, q, range, rows, scene, toast, type Mode } from '../mode.ts';

export const inspector: Mode = {
  id: 'inspector',
  title: 'Cell inspector',
  blurb: 'Move the cursor to see the cell under it, then click to pin one. You get everything H3 can tell you about a single index: how it is encoded, what shape it is, its edges and its vertexes.',
  apis: [
    'latLngToCell(lat, lng, res)',
    'cellToLatLng(cell)',
    'cellToBoundary(cell, true)',
    'getResolution / getBaseCellNumber',
    'getIndexDigit(cell, r)',
    'isResClassIII / isPentagon',
    'getIcosahedronFaces(cell)',
    'cellArea(cell, UNITS.km2)',
    'originToDirectedEdges(cell)',
    'directedEdgeToBoundary(edge, true)',
    'getDirectedEdgeOrigin / getDirectedEdgeDestination',
    'directedEdgeToCells / reverseDirectedEdge',
    'cellsToDirectedEdge(origin, destination)',
    'h3IndexToSplitLong / splitLongToH3Index',
    'edgeLength(edge, UNITS.m)',
    'cellToVertexes / cellToVertex / vertexToLatLng',
    'isValidCell / isValidDirectedEdge / isValidVertex / isValidIndex',
    'constructCell(baseCell, digits, res)',
    'degsToRads(deg)',
  ],

  mount(map, panel) {
    const s = scene(map);
    let res = 8;
    let hovered = '';

    const setHover = s.source('insp-hover');
    const setNeighbors = s.source('insp-neigh');
    const setPin = s.source('insp-pin');
    const setEdges = s.source('insp-edges', false);
    const setVerts = s.source('insp-verts');

    cellLayers(s, 'insp-neigh', COLORS.ice, { fill: 0.06, line: 0.8 });
    cellLayers(s, 'insp-hover', COLORS.paper, { fill: 0.08, line: 1.5 });
    cellLayers(s, 'insp-pin', COLORS.amber, { fill: 0.22, line: 0 });
    s.layer({
      id: 'insp-edges-line',
      type: 'line',
      source: 'insp-edges',
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hi'], false], COLORS.paper, COLORS.amber],
        'line-width': ['case', ['boolean', ['feature-state', 'hi'], false], 5, 3],
      },
      layout: { 'line-cap': 'round' },
    });
    s.layer({
      id: 'insp-edges-label',
      type: 'symbol',
      source: 'insp-edges',
      layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'n'], 'text-font': LABEL_FONT, 'text-size': 12 },
      paint: { 'text-color': COLORS.ink, 'text-halo-color': COLORS.amber, 'text-halo-width': 2 },
    });
    s.layer({
      id: 'insp-verts-dot',
      type: 'circle',
      source: 'insp-verts',
      paint: { 'circle-radius': 4, 'circle-color': COLORS.teal, 'circle-stroke-color': COLORS.ink, 'circle-stroke-width': 1.5 },
    });

    panel.innerHTML = `
      ${range('res', 'Resolution', 0, 15, res)}
      <form class="lookup">
        <input name="idx" placeholder="Paste an H3 index (cell, edge or vertex)" spellcheck="false" autocomplete="off" />
        <button class="chip">Go</button>
      </form>
      <p class="hint" data-hint>Click the map to pin a cell.</p>
      <div data-info></div>
      <details class="card">
        <summary>Build a cell from its parts</summary>
        <p class="hint">Under the hood a cell is a base cell (0–121) plus one digit (0–6) per resolution.</p>
        <div class="row">
          <input name="base" type="number" min="0" max="121" value="20" aria-label="Base cell" />
          <input name="digits" value="2,4,6,1,0" aria-label="Digits" spellcheck="false" />
          <button class="chip" data-build>Build</button>
        </div>
      </details>`;

    const info = q(panel, '[data-info]');
    const hint = q(panel, '[data-hint]');

    bindRange(panel, 'res', (v) => {
      res = v;
      hovered = '';
      setHover(EMPTY);
    });

    function pin(cell: string, fly = false, highlightEdge?: string) {
      hint.hidden = true;
      setPin(cellsToFeatures([cell]));

      const edges = originToDirectedEdges(cell);
      const edgeFc: FeatureCollection = {
        type: 'FeatureCollection',
        features: edges.map((e, i) => ({
          type: 'Feature',
          id: i,
          properties: { n: String(i + 1) },
          geometry: { type: 'LineString', coordinates: unwrapRing(directedEdgeToBoundary(e, true)) },
        })),
      };
      setEdges(edgeFc);
      setNeighbors(cellsToFeatures(edges.map(getDirectedEdgeDestination)));

      const verts = cellToVertexes(cell);
      setVerts({
        type: 'FeatureCollection',
        features: verts.map((v) => {
          const [lat, lng] = vertexToLatLng(v);
          return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } };
        }),
      });

      const r = getResolution(cell);
      const [lat, lng] = cellToLatLng(cell);
      const digits = Array.from({ length: r }, (_, i) => getIndexDigit(cell, i + 1)).join('·') || '—';
      const area = cellArea(cell, UNITS.km2);
      const [lo, hi] = h3IndexToSplitLong(cell); // JS has no native 64-bit int, so h3-js can split an index into two 32-bit halves
      const splitOk = splitLongToH3Index(lo, hi) === cell;
      const avg = getHexagonAreaAvg(r, UNITS.km2);

      info.innerHTML = `
        <div class="card hero">
          <span class="eyebrow">Pinned cell</span>
          <button class="index" data-copy title="Copy">${esc(cell)}</button>
          ${rows([
            ['Resolution', String(r)],
            ['As [low, high] 32-bit', `<span class="mono">[${lo >>> 0}, ${hi >>> 0}]</span> ${splitOk ? '' : '<b class="warn">round trip failed</b>'}`],
            ['Base cell', String(getBaseCellNumber(cell))],
            ['Digits', `<span class="mono">${digits}</span>`],
            ['Shape', isPentagon(cell) ? '<b class="warn">Pentagon</b> (5 edges)' : 'Hexagon (6 edges)'],
            ['Class', isResClassIII(cell) ? 'III (grid rotated ~19.1°)' : 'II'],
            ['Orientation vs north', `${cellOrientation(cell).toFixed(1)}° <small>(0° = a vertex points north, ${isPentagon(cell) ? 36 : 30}° = a flat edge on top)</small>`],
            ['Icosahedron faces', getIcosahedronFaces(cell).join(', ')],
            ['Center', `<span class="mono">${lat.toFixed(6)}, ${lng.toFixed(6)}</span>`],
            ['Center (radians)', `<span class="mono">${degsToRads(lat).toFixed(5)}, ${degsToRads(lng).toFixed(5)}</span>`],
            ['Area', `${fmtArea(area)} <small>(${((area / avg) * 100).toFixed(1)}% of res-${r} average)</small>`],
          ])}
        </div>
        <div class="card">
          <span class="eyebrow">Directed edges → neighbors</span>
          <table class="tbl" data-edges>
            <thead><tr><th>#</th><th>Length</th><th>Destination</th></tr></thead>
            <tbody>${edges
              .map((e, i) => {
                const ok = cellsToDirectedEdge(cell, getDirectedEdgeDestination(e)) === e && getDirectedEdgeOrigin(e) === cell && directedEdgeToCells(e)[0] === cell && isValidDirectedEdge(reverseDirectedEdge(e));
                return `<tr data-i="${i}" data-edge="${e}"><td>${i + 1}</td><td>${fmtLen(edgeLength(e, UNITS.km))}</td>
                  <td class="mono" title="${ok ? 'origin/reverse checks pass' : 'check failed'}">${esc(getDirectedEdgeDestination(e))}</td></tr>`;
              })
              .join('')}</tbody>
          </table>
        </div>
        <div class="card">
          <span class="eyebrow">Vertexes (${verts.length})</span>
          <ul class="mono small">${verts.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>
          <p class="hint">${code('cellToVertex(cell, 0)')} = ${esc(cellToVertex(cell, 0))}</p>
        </div>`;

      const edgeRows = info.querySelectorAll<HTMLTableRowElement>('tr[data-i]');
      edgeRows.forEach((tr) => {
        const id = Number(tr.dataset.i);
        tr.addEventListener('mouseenter', () => map.setFeatureState({ source: 'insp-edges', id }, { hi: true }));
        tr.addEventListener('mouseleave', () => map.setFeatureState({ source: 'insp-edges', id }, { hi: false }));
        tr.addEventListener('click', () => pin(getDirectedEdgeDestination(tr.dataset.edge!)));
      });
      if (highlightEdge) {
        const i = edges.indexOf(highlightEdge);
        if (i >= 0) map.setFeatureState({ source: 'insp-edges', id: i }, { hi: true });
      }
      q(info, '[data-copy]').addEventListener('click', () => navigator.clipboard.writeText(cell).then(() => toast('Index copied')));
      if (fly) map.flyTo({ center: [lng, lat], zoom: Math.max(1, r * 1.12 + 1.5) });
    }

    s.on('mousemove', (e) => {
      const cell = latLngToCell(e.lngLat.lat, e.lngLat.lng, res);
      if (cell === hovered) return; // only rebuild GeoJSON when the cell actually changes
      hovered = cell;
      setHover({ type: 'FeatureCollection', features: [cellFeature(cell)] });
    });
    s.on('click', (e) => pin(latLngToCell(e.lngLat.lat, e.lngLat.lng, res)));

    q(panel, 'form.lookup').addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = q<HTMLInputElement>(panel, 'input[name="idx"]').value.trim().toLowerCase();
      if (isValidCell(raw)) pin(raw, true);
      else if (isValidDirectedEdge(raw)) pin(getDirectedEdgeOrigin(raw), true, raw);
      else if (isValidVertex(raw)) {
        const [lat, lng] = vertexToLatLng(raw);
        map.flyTo({ center: [lng, lat], zoom: 14 });
        toast('Vertex — flying to its location');
      } else toast(isValidIndex(raw) ? 'Valid index, but not a cell, edge or vertex' : 'Not a valid H3 index');
    });

    q(panel, '[data-build]').addEventListener('click', () => {
      const base = Number(q<HTMLInputElement>(panel, 'input[name="base"]').value);
      const digitsRaw = q<HTMLInputElement>(panel, 'input[name="digits"]').value.trim();
      const digits = digitsRaw ? digitsRaw.split(/[\s,·]+/).map(Number) : [];
      try {
        pin(constructCell(base, digits, digits.length), true);
      } catch (err) {
        toast(`constructCell failed: ${(err as Error).message}`);
      }
    });

    // Start with the cell at the map center pinned so the panel isn't empty.
    const c = map.getCenter();
    pin(latLngToCell(c.lat, c.lng, res));

    return () => s.dispose();
  },
};
