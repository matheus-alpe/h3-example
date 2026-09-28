import { cellToLatLng, getBaseCellNumber, getIcosahedronFaces, getNumCells, getPentagons, getRes0Cells, isResClassIII, radsToDegs, uncompactCells } from 'h3-js';
import { cellsToFeatures, fmtInt } from '../h3geo.ts';
import { bindRange, bindSegmented, code, COLORS, LABEL_FONT, q, range, rows, scene, segmented, SEVEN, setGlobe, type Mode } from '../mode.ts';

export const globe: Mode = {
  id: 'globe',
  title: 'The whole planet',
  blurb: 'H3 starts from an icosahedron (20 triangular faces) and cuts it into 122 base cells: 110 hexagons and 12 pentagons, one at each icosahedron corner. Every other cell comes from splitting these.',
  apis: [
    'getRes0Cells()',
    'uncompactCells(cells, res)',
    'getPentagons(res)',
    'getBaseCellNumber(cell)',
    'getIcosahedronFaces(cell)',
    'isResClassIII(cell)',
    'getNumCells(res)',
    'radsToDegs(rad)',
  ],

  mount(map, panel) {
    const s = scene(map);
    let res = 0;
    let colorBy = 'base';

    setGlobe(map, true);
    map.flyTo({ center: [10, 25], zoom: 1.4, pitch: 0, bearing: 0 });

    const setCells = s.source('gl-cells');
    const setPents = s.source('gl-pents');
    s.layer({
      id: 'gl-fill',
      type: 'fill',
      source: 'gl-cells',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.32 },
    });
    s.layer({ id: 'gl-line', type: 'line', source: 'gl-cells', paint: { 'line-color': COLORS.paper, 'line-width': 0.7, 'line-opacity': 0.55 } });
    s.layer({
      id: 'gl-pent-dot',
      type: 'circle',
      source: 'gl-pents',
      paint: { 'circle-radius': 7, 'circle-color': COLORS.rose, 'circle-stroke-color': COLORS.ink, 'circle-stroke-width': 2 },
    });
    s.layer({
      id: 'gl-pent-label',
      type: 'symbol',
      source: 'gl-pents',
      layout: { 'text-field': ['get', 'base'], 'text-font': LABEL_FONT, 'text-size': 11, 'text-offset': [0, 1.4] },
      paint: { 'text-color': COLORS.rose, 'text-halo-color': COLORS.ink, 'text-halo-width': 1.5 },
    });

    panel.innerHTML = `
      ${range('res', 'Resolution (0–2 draws the full planet)', 0, 2, res)}
      <span class="ctl-label">Color by</span>
      ${segmented('by', [['base', 'Base cell'], ['face', 'Icosahedron face'], ['class', 'Class II / III']], colorBy)}
      <div class="card" data-stats></div>
      <p class="hint">The icosahedron is oriented so all 12 pentagons fall in the ocean, away from where most data is. Neighboring
        pentagons sit ${code('radsToDegs(Math.atan(2))')} ≈ ${radsToDegs(Math.atan(2)).toFixed(1)}° apart.</p>`;

    const stats = q(panel, '[data-stats]');

    function render() {
      const cells = res === 0 ? getRes0Cells() : uncompactCells(getRes0Cells(), res);
      setCells(
        cellsToFeatures(cells, (c) => ({
          color:
            colorBy === 'base'
              ? SEVEN[getBaseCellNumber(c) % 7]
              : colorBy === 'face'
                ? `hsl(${getIcosahedronFaces(c)[0] * 18}, 75%, 62%)` // 20 faces → 20 distinct hues
                : isResClassIII(c) ? COLORS.teal : COLORS.ice,
        })),
      );
      const pents = getPentagons(res);
      setPents({
        type: 'FeatureCollection',
        features: pents.map((p) => {
          const [lat, lng] = cellToLatLng(p);
          return { type: 'Feature', properties: { base: String(getBaseCellNumber(p)) }, geometry: { type: 'Point', coordinates: [lng, lat] } };
        }),
      });
      stats.innerHTML = rows([
        ['Cells drawn', `${fmtInt(cells.length)} (= getNumCells(${res}): ${fmtInt(getNumCells(res))})`],
        ['Base cells', String(getRes0Cells().length)],
        ['Pentagons', `${pents.length}, labeled with their base cell`],
      ]);
    }

    bindRange(panel, 'res', (v) => {
      res = v;
      render();
    });
    bindSegmented(panel, 'by', (v) => {
      colorBy = v;
      render();
    });
    render();

    return () => s.dispose();
  },
};
