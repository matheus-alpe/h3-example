import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { Map, NavigationControl, ScaleControl } from 'maplibre-gl';
import { esc, q, setGlobe, type Mode } from './mode.ts';
import { inspector } from './modes/inspector.ts';
import { viewport } from './modes/viewport.ts';
import { hierarchy } from './modes/hierarchy.ts';
import { globe } from './modes/globe.ts';
import { traversal } from './modes/traversal.ts';
import { polygon } from './modes/polygon.ts';
import { hexbin } from './modes/hexbin.ts';

const MODES: Mode[] = [inspector, viewport, hierarchy, traversal, polygon, globe, hexbin];

const map = new Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/dark',
  center: [-46.6333, -23.5505],
  zoom: 13,
  attributionControl: { compact: true },
});
map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new ScaleControl(), 'bottom-right');

const rail = q(document, '#rail');
const head = q(document, '#mode-head');
const body = q(document, '#mode-body');
const apis = q(document, '#mode-apis');
const globeBtn = q<HTMLButtonElement>(document, '#globe');

globeBtn.addEventListener('click', () => setGlobe(map, globeBtn.getAttribute('aria-pressed') !== 'true'));

rail.innerHTML = MODES.map(
  (m, i) => `<a href="#${m.id}" data-id="${m.id}" title="${esc(m.title)}"><span>${String(i + 1).padStart(2, '0')}</span><em>${esc(m.title)}</em></a>`,
).join('');

let cleanup: (() => void) | undefined;

function activate() {
  const mode = MODES.find((m) => `#${m.id}` === location.hash) ?? MODES[0];
  cleanup?.();
  cleanup = undefined;
  rail.querySelectorAll('a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.id === mode.id));
  const n = MODES.indexOf(mode) + 1;
  head.innerHTML = `<span class="eyebrow">Example ${String(n).padStart(2, '0')} / ${String(MODES.length).padStart(2, '0')}</span>
    <h2>${esc(mode.title)}</h2><p>${mode.blurb}</p>`;
  apis.innerHTML = `<h3>h3-js calls in this example</h3><ul>${mode.apis.map((a) => `<li><code>${esc(a)}</code></li>`).join('')}</ul>`;
  body.replaceChildren();
  body.classList.remove('enter');
  void body.offsetWidth; // restart the enter animation
  body.classList.add('enter');
  try {
    cleanup = mode.mount(map, body);
  } catch (err) {
    body.innerHTML = `<p class="error">This example failed to start: ${esc((err as Error).message)}</p>`;
    throw err;
  }
}

// Keep the camera's center in the part of the map the panel doesn't cover.
function padForPanel() {
  const r = q(document, '#panel').getBoundingClientRect();
  const wide = innerWidth > 760;
  map.setPadding({ left: wide ? r.right : 0, bottom: wide ? 0 : innerHeight - r.top, top: wide ? 0 : 56, right: 0 });
}
addEventListener('resize', padForPanel);
padForPanel();

map.once('load', () => {
  activate();
  window.addEventListener('hashchange', activate);
});
map.on('error', (e) => console.error(e.error));
