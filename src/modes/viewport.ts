import { cellToChildPos, getHexagonAreaAvg, getHexagonEdgeLengthAvg, getNumCells, getPentagons, getResolution, isPentagon, UNITS } from 'h3-js';
import { cellsToFeatures, estimateCells, fmtArea, fmtInt, fmtLen, viewportCells, type BBox } from '../h3geo.ts';
import { bindRange, code, COLORS, q, range, rows, scene, SEVEN, type Mode } from '../mode.ts';

const CAP = 25_000;
const AUTO_TARGET = 2_500;

export const viewport: Mode = {
  id: 'viewport',
  title: 'Viewport grid',
  blurb: 'Covers everything you can see with cells at one resolution. Each cell is colored by its position among its 7 siblings, so you can see how every parent splits into 7 children (aperture 7).',
  apis: [
    'polygonToCells(ring, res, true)',
    'cellToChildPos(cell, res - 1)',
    'getNumCells(res)',
    'getHexagonAreaAvg(res, UNITS.km2)',
    'getHexagonEdgeLengthAvg(res, UNITS.km)',
    'getPentagons(res) / isPentagon(cell)',
  ],

  mount(map, panel) {
    const s = scene(map);
    let res = 7;
    let auto = true;
    let frame = 0;

    const setCells = s.source('vp');
    s.layer({
      id: 'vp-fill',
      type: 'fill',
      source: 'vp',
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.16,
      },
    });
    s.layer({ id: 'vp-line', type: 'line', source: 'vp', paint: { 'line-color': COLORS.paper, 'line-opacity': 0.35, 'line-width': 0.8 } });

    panel.innerHTML = `
      <label class="toggle"><input type="checkbox" name="auto" checked /><span>Pick resolution from zoom (about ${fmtInt(AUTO_TARGET)} cells on screen)</span></label>
      ${range('res', 'Resolution', 0, 15, res)}
      <div class="card" data-stats></div>
      <p class="hint">Legend: ${SEVEN.map((c, i) => `<i class="sw" style="background:${c}"></i>${i}`).join(' ')} = ${code('cellToChildPos')}, <i class="sw" style="background:${COLORS.rose}"></i> pentagon</p>`;

    const stats = q(panel, '[data-stats]');
    const resInput = bindRange(panel, 'res', (v) => {
      res = v;
      q<HTMLInputElement>(panel, 'input[name="auto"]').checked = auto = false;
      schedule();
    });
    q<HTMLInputElement>(panel, 'input[name="auto"]').addEventListener('change', (e) => {
      auto = (e.target as HTMLInputElement).checked;
      schedule();
    });

    function bbox(): BBox {
      const b = map.getBounds();
      return [b.getWest(), Math.max(b.getSouth(), -85), b.getEast(), Math.min(b.getNorth(), 85)];
    }

    function render() {
      const box = bbox();
      if (auto) {
        let r = 0;
        while (r < 15 && estimateCells(box, r + 1) <= AUTO_TARGET) r++;
        res = r;
        resInput.value = String(r);
        q(panel, 'output[data-for="res"]').textContent = String(r);
      }
      const t0 = performance.now();
      const result = viewportCells(box, res, CAP);
      const ms = performance.now() - t0;
      const base = [
        ['Global cell count', fmtInt(getNumCells(res))],
        ['Average area', fmtArea(getHexagonAreaAvg(res, UNITS.km2))],
        ['Average edge', fmtLen(getHexagonEdgeLengthAvg(res, UNITS.km))],
        ['Pentagons at this res', `${getPentagons(res).length} (always 12)`],
      ] as [string, string][];

      if (result.capped) {
        setCells(cellsToFeatures([]));
        stats.innerHTML = `<p class="warn">Around ${fmtInt(result.estimate)} cells would be drawn, over the ${fmtInt(CAP)} limit. Zoom in or lower the resolution.</p>${rows(base)}`;
        return;
      }
      setCells(
        cellsToFeatures(result.cells, (c) => ({
          color: isPentagon(c) ? COLORS.rose : SEVEN[getResolution(c) === 0 ? 0 : cellToChildPos(c, res - 1) % 7],
        })),
      );
      stats.innerHTML = rows([['Cells in view', `<b>${fmtInt(result.cells.length)}</b> <small>(${ms.toFixed(1)} ms)</small>`], ...base]);
    }

    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    }

    s.on('moveend', schedule);
    render();

    return () => {
      cancelAnimationFrame(frame);
      s.dispose();
    };
  },
};
