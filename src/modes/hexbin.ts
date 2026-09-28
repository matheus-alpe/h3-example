import { cellArea, getHexagonEdgeLengthAvg, latLngToCell, UNITS } from 'h3-js';
import { cellsToFeatures, EMPTY, fmtArea, fmtInt } from '../h3geo.ts';
import { bindRange, bindSegmented, cellLayers, COLORS, esc, q, RAMP, range, rows, scene, segmented, setGlobe, type Mode } from '../mode.ts';

// Public domain, CORS-enabled, refreshed every minute by USGS.
const FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson';

interface Quake {
  lat: number;
  lng: number;
  mag: number | null;
  place: string;
  time: number;
  url: string;
}
interface Bin {
  quakes: Quake[];
  maxMag: number | null;
}

const VISIBLE = RAMP.slice(1); // the darkest stop disappears on the dark basemap
const rampStops = (prop: string) => ['interpolate', ['linear'], ['get', prop], ...VISIBLE.flatMap((c, i) => [i / (VISIBLE.length - 1), c])];

export const hexbin: Mode = {
  id: 'hexbin',
  title: 'Hexbin: earthquakes',
  blurb: 'Every earthquake USGS recorded in the last 30 days, grouped into cells with <code>latLngToCell</code>. Grouping is a single pass through the points, so changing the resolution is instant. Because every hexagon is about the same size, the counts are fair to compare.',
  apis: ['latLngToCell(lat, lng, res)', 'cellToBoundary(cell, true)', 'cellArea(cell, UNITS.km2)', 'getHexagonEdgeLengthAvg(res, UNITS.m)'],

  mount(map, panel) {
    const s = scene(map);
    const abort = new AbortController();
    let quakes: Quake[] = [];
    let bins = new Map<string, Bin>();
    let res = 3;
    let metric = 'count';
    let extrude = false;

    setGlobe(map, true);
    map.flyTo({ center: [-150, 35], zoom: 1.6, pitch: 0 });

    const setBins = s.source('hb');
    const setSel = s.source('hb-sel');
    s.layer({ id: 'hb-fill', type: 'fill', source: 'hb', paint: { 'fill-color': rampStops('v') as never, 'fill-opacity': 0.78 } });
    s.layer({
      id: 'hb-3d',
      type: 'fill-extrusion',
      source: 'hb',
      layout: { visibility: 'none' },
      paint: { 'fill-extrusion-color': rampStops('v') as never, 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.9 },
    });
    cellLayers(s, 'hb-sel', COLORS.paper, { fill: 0, line: 2.5 });

    panel.innerHTML = `
      <div data-status class="card"><p class="hint">Loading the USGS feed…</p></div>
      ${range('res', 'Resolution', 0, 7, res)}
      <span class="ctl-label">Color by</span>
      ${segmented('metric', [['count', 'Number of quakes (log)'], ['mag', 'Largest magnitude']], metric)}
      <label class="toggle"><input type="checkbox" name="extrude" /><span>Show as 3D columns</span></label>
      <div class="legend"><i style="background:linear-gradient(90deg, ${VISIBLE.join(',')})"></i><span data-lo></span><span data-hi></span></div>
      <div data-detail></div>
      <p class="hint">Data: <a href="https://earthquake.usgs.gov/earthquakes/feed/" target="_blank" rel="noreferrer">USGS Earthquake Hazards Program</a> (public domain).</p>`;

    const status = q(panel, '[data-status]');
    const detail = q(panel, '[data-detail]');

    function bin() {
      bins = new Map();
      for (const qk of quakes) {
        const cell = latLngToCell(qk.lat, qk.lng, res);
        let b = bins.get(cell);
        if (!b) bins.set(cell, (b = { quakes: [], maxMag: null }));
        b.quakes.push(qk);
        if (qk.mag !== null && (b.maxMag === null || qk.mag > b.maxMag)) b.maxMag = qk.mag;
      }
    }

    function render() {
      const cells = [...bins.keys()];
      const maxCount = Math.max(1, ...[...bins.values()].map((b) => b.quakes.length));
      const mags = [...bins.values()].map((b) => b.maxMag).filter((m): m is number => m !== null);
      const [lo, hi] = [Math.min(...mags), Math.max(...mags)];
      const colHeight = getHexagonEdgeLengthAvg(res, UNITS.m) * 14;

      setBins(
        cellsToFeatures(cells, (c) => {
          const b = bins.get(c)!;
          // Quakes with no magnitude still count, but sit at the bottom of the magnitude scale.
          const v = metric === 'count' ? Math.log1p(b.quakes.length) / Math.log1p(maxCount) : b.maxMag === null || hi === lo ? 0 : (b.maxMag - lo) / (hi - lo);
          return { v, h: Math.max(v, 0.02) * colHeight };
        }),
      );
      const noMags = !mags.length;
      q(panel, '[data-lo]').textContent = metric === 'count' ? '1' : noMags ? '—' : `M${lo.toFixed(1)}`;
      q(panel, '[data-hi]').textContent = metric === 'count' ? fmtInt(maxCount) : noMags ? '—' : `M${hi.toFixed(1)}`;
    }

    function update() {
      if (!quakes.length) return;
      const t0 = performance.now();
      bin();
      const ms = performance.now() - t0;
      render();
      setSel(EMPTY);
      detail.innerHTML = '';
      status.innerHTML = rows([
        ['Earthquakes', fmtInt(quakes.length)],
        ['Occupied cells', `${fmtInt(bins.size)} at res ${res}`],
        ['Grouping took', `${ms.toFixed(1)} ms`],
      ]);
    }

    function showCell(cell: string) {
      const b = bins.get(cell);
      if (!b) return;
      setSel(cellsToFeatures([cell]));
      const top = [...b.quakes].sort((a, z) => (z.mag ?? -9) - (a.mag ?? -9)).slice(0, 8);
      detail.innerHTML = `<div class="card">
        <span class="eyebrow"><span class="raw">${esc(cell)}</span> · ${fmtArea(cellArea(cell, UNITS.km2))}</span>
        <p><b>${fmtInt(b.quakes.length)}</b> quakes, largest ${b.maxMag === null ? 'unknown' : `M${b.maxMag.toFixed(1)}`}</p>
        <ul class="quakes">${top
          .map(
            (qk) => `<li><b>${qk.mag === null ? '—' : qk.mag.toFixed(1)}</b>
              ${qk.url ? `<a href="${esc(qk.url)}" target="_blank" rel="noreferrer">${esc(qk.place)}</a>` : esc(qk.place)}
              <small>${new Date(qk.time).toLocaleString()}</small></li>`,
          )
          .join('')}</ul></div>`;
    }

    async function load() {
      status.innerHTML = '<p class="hint">Loading the USGS feed…</p>';
      try {
        const r = await fetch(FEED, { signal: abort.signal });
        if (!r.ok) throw new Error(`USGS responded ${r.status} ${r.statusText}`);
        const fc = (await r.json()) as GeoJSON.FeatureCollection<GeoJSON.Point | null>;
        quakes = fc.features.flatMap((f) => {
          if (!f.geometry) return [];
          const [lng, lat] = f.geometry.coordinates;
          const p = f.properties ?? {};
          const url = typeof p.url === 'string' && p.url.startsWith('https://earthquake.usgs.gov/') ? p.url : '';
          return [{ lat, lng, mag: typeof p.mag === 'number' ? p.mag : null, place: String(p.place ?? 'Unknown location'), time: Number(p.time), url }];
        });
        update();
      } catch (err) {
        if (abort.signal.aborted) return; // mode was closed mid-request
        status.innerHTML = `<p class="error">Couldn’t load earthquakes: ${esc((err as Error).message)}</p><button class="chip" data-retry>Retry</button>`;
        q(status, '[data-retry]').addEventListener('click', load);
      }
    }

    bindRange(panel, 'res', (v) => {
      res = v;
      update();
    });
    bindSegmented(panel, 'metric', (v) => {
      metric = v;
      render();
    });
    q<HTMLInputElement>(panel, 'input[name="extrude"]').addEventListener('change', (e) => {
      extrude = (e.target as HTMLInputElement).checked;
      map.setLayoutProperty('hb-3d', 'visibility', extrude ? 'visible' : 'none');
      map.setLayoutProperty('hb-fill', 'visibility', extrude ? 'none' : 'visible');
      map.easeTo({ pitch: extrude ? 55 : 0 });
    });

    for (const layer of ['hb-fill', 'hb-3d']) {
      s.onLayer('click', layer, (e) => {
        const cell = e.features?.[0]?.properties?.h3;
        if (typeof cell === 'string') showCell(cell);
      });
      s.onLayer('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      s.onLayer('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }

    load();

    return () => {
      abort.abort();
      map.getCanvas().style.cursor = '';
      if (extrude) map.easeTo({ pitch: 0 });
      s.dispose();
    };
  },
};
