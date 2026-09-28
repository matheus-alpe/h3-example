import {
  cellToCenterChild,
  cellToChildPos,
  cellToChildren,
  cellToChildrenSize,
  cellToLatLng,
  cellToParent,
  childPosToCell,
  getHexagonAreaAvg,
  getHexagonEdgeLengthAvg,
  getNumCells,
  getResolution,
  latLngToCell,
  UNITS,
} from 'h3-js';
import { cellFeature, cellsToFeatures, EMPTY, fmtArea, fmtInt, fmtLen } from '../h3geo.ts';
import { bindRange, cellLayers, code, COLORS, esc, q, range, rows, scene, type Mode } from '../mode.ts';

export const hierarchy: Mode = {
  id: 'hierarchy',
  title: 'Parents & children',
  blurb: 'Each cell has exactly one parent and about 7 children. Children don’t fit perfectly inside their parent, which is why H3 shapes are only approximately nested. Click the map to pick a cell.',
  apis: [
    'cellToParent(cell, res)',
    'cellToChildren(cell, res)',
    'cellToChildrenSize(cell, res)',
    'cellToCenterChild(cell, res)',
    'cellToChildPos(child, parentRes)',
    'childPosToCell(pos, parent, childRes)',
    'getHexagonAreaAvg / getHexagonEdgeLengthAvg / getNumCells',
  ],

  mount(map, panel) {
    const s = scene(map);
    let res = 8;
    let cell = '';
    let pos = 0;

    const setParents = s.source('hi-parents');
    const setCell = s.source('hi-cell');
    const setKids = s.source('hi-kids');
    const setGrandkids = s.source('hi-grand');
    const setPick = s.source('hi-pick');

    s.layer({
      id: 'hi-parents-line',
      type: 'line',
      source: 'hi-parents',
      paint: {
        'line-color': ['interpolate', ['linear'], ['get', 'r'], 0, COLORS.ice, 15, COLORS.teal],
        'line-width': ['interpolate', ['linear'], ['get', 'r'], 0, 3, 15, 1],
        'line-opacity': 0.85,
      },
    });
    cellLayers(s, 'hi-grand', COLORS.paper, { fill: 0, line: 0.4 });
    cellLayers(s, 'hi-kids', ['case', ['get', 'center'], COLORS.teal, COLORS.amber], { fill: 0.14, line: 1 });
    cellLayers(s, 'hi-cell', COLORS.amber, { fill: 0.08, line: 2.5 });
    cellLayers(s, 'hi-pick', COLORS.rose, { fill: 0.5, line: 2 });

    panel.innerHTML = `
      ${range('res', 'Cell resolution', 0, 14, res)}
      <div data-info></div>
      <details class="card" open>
        <summary>Resolution table</summary>
        <table class="tbl" data-table>
          <thead><tr><th>Res</th><th>Avg area</th><th>Avg edge</th><th>Cells worldwide</th></tr></thead>
          <tbody>${Array.from(
            { length: 16 },
            (_, r) =>
              `<tr data-r="${r}"><td>${r}</td><td>${fmtArea(getHexagonAreaAvg(r, UNITS.km2))}</td><td>${fmtLen(
                getHexagonEdgeLengthAvg(r, UNITS.km),
              )}</td><td>${fmtInt(getNumCells(r))}</td></tr>`,
          ).join('')}</tbody>
        </table>
      </details>`;

    const info = q(panel, '[data-info]');
    const resInput = bindRange(panel, 'res', (v) => {
      res = v;
      select(cellToLatLng(cell), false);
    });

    function renderPick(childRes: number) {
      const pick = childPosToCell(pos, cell, childRes);
      setPick({ type: 'FeatureCollection', features: [cellFeature(pick)] });
      q(info, '[data-pick]').innerHTML = `${code(`childPosToCell(${pos}, cell, ${childRes})`)} → <span class="mono">${esc(pick)}</span><br/>
        ${code('cellToChildPos(child, parentRes)')} gives back <b>${cellToChildPos(pick, res)}</b>`;
    }

    function select([lat, lng]: number[], fly: boolean) {
      cell = latLngToCell(lat, lng, res);
      const parents = Array.from({ length: res }, (_, r) => cellToParent(cell, r));
      setParents(cellsToFeatures(parents, (c) => ({ r: getResolution(c) })));
      setCell(cellsToFeatures([cell]));
      const center = cellToCenterChild(cell, res + 1);
      setKids(cellsToFeatures(cellToChildren(cell, res + 1), (c) => ({ center: c === center })));
      setGrandkids(res + 2 <= 15 ? cellsToFeatures(cellToChildren(cell, res + 2)) : EMPTY);

      const childRes = Math.min(res + 2, 15);
      const size = cellToChildrenSize(cell, childRes);
      pos = Math.min(pos, size - 1);

      info.innerHTML = `
        <div class="card">
          <span class="eyebrow">Selected · res ${res}</span>
          <div class="index">${esc(cell)}</div>
          ${rows([
            ['Children at res ' + (res + 1), String(cellToChildrenSize(cell, res + 1))],
            [`Descendants at res ${childRes}`, fmtInt(size)],
            ['Center child', `<span class="mono" style="color:${COLORS.teal}">${esc(center)}</span>`],
          ])}
          <span class="eyebrow">Parents (click one to select it)</span>
          <ol class="parents">${parents
            .map((p, r) => `<li><button class="link mono" data-r="${r}">${r} · ${esc(p)}</button></li>`)
            .join('')}</ol>
        </div>
        <div class="card">
          <span class="eyebrow">Walk the children by position</span>
          ${range('pos', `Position (0–${size - 1})`, 0, size - 1, pos)}
          <p class="hint" data-pick></p>
        </div>`;

      info.querySelectorAll<HTMLButtonElement>('button[data-r]').forEach((b) =>
        b.addEventListener('click', () => {
          res = Number(b.dataset.r);
          resInput.value = String(res);
          q(panel, 'output[data-for="res"]').textContent = String(res);
          select(cellToLatLng(parents[res]), true);
        }),
      );
      bindRange(info, 'pos', (v) => {
        pos = v;
        renderPick(childRes);
      });
      renderPick(childRes);
      panel.querySelectorAll('tr[data-r]').forEach((tr) => tr.classList.toggle('on', Number((tr as HTMLElement).dataset.r) === res));
      if (fly) map.flyTo({ center: [lng, lat], zoom: Math.max(1, res * 1.12 + 1) });
    }

    panel.querySelectorAll<HTMLTableRowElement>('tr[data-r]').forEach((tr) =>
      tr.addEventListener('click', () => {
        const r = Number(tr.dataset.r);
        if (r > 14) return;
        res = r;
        resInput.value = String(r);
        q(panel, 'output[data-for="res"]').textContent = String(r);
        select(cellToLatLng(cell), true);
      }),
    );

    s.on('click', (e) => select([e.lngLat.lat, e.lngLat.lng], false));
    const c = map.getCenter();
    select([c.lat, c.lng], false);

    return () => s.dispose();
  },
};
