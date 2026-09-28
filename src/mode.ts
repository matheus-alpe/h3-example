import type { AddLayerObject, GeoJSONSource, Map, MapEventType, MapLayerEventType, Subscription } from 'maplibre-gl';
import { EMPTY } from './h3geo.ts';

export interface Mode {
  id: string;
  title: string;
  blurb: string;
  /** h3-js calls this example exercises, shown in the panel as a reference. */
  apis: string[];
  /** Adds its layers/listeners/UI; returns a cleanup that removes all of them. */
  mount(map: Map, panel: HTMLElement): () => void;
}

export const COLORS = {
  amber: '#ffb547',
  teal: '#3ee6c1',
  rose: '#ff5d7a',
  ice: '#8fa8ff',
  paper: '#f3efe6',
  ink: '#0b0f14',
};

/** 7 hues for "position among siblings" (aperture 7) and other small categorical sets. */
export const SEVEN = ['#ffb547', '#3ee6c1', '#ff5d7a', '#8fa8ff', '#c6f45d', '#f58fff', '#5fd3ff'];

export const RAMP = ['#1d1a3a', '#4b2a6b', '#9b3b7a', '#e2556b', '#ff8f4f', '#ffd166', '#fff5c7'];

export const LABEL_FONT = ['Noto Sans Regular'];

/**
 * Owns everything a mode adds to the map so cleanup is one call.
 * fill/line/extrusion layers go under the basemap labels; symbols and circles go on top.
 */
export function scene(map: Map) {
  const layers: string[] = [];
  const sources: string[] = [];
  const subs: Subscription[] = [];
  // Insert under the trailing block of label layers (the style also has some symbol layers early on, under buildings).
  const style = map.getStyle().layers;
  let i = style.length;
  while (i > 0 && style[i - 1].type === 'symbol') i--;
  const firstSymbol = style[i]?.id;

  return {
    /** `promote`: use the `h3` property as feature id (for feature-state); off when features carry their own ids. */
    source(id: string, promote = true) {
      map.addSource(id, { type: 'geojson', data: EMPTY, ...(promote && { promoteId: 'h3' }) });
      sources.push(id);
      return (d: GeoJSON.GeoJSON) => void map.getSource<GeoJSONSource>(id)?.setData(d);
    },
    layer(spec: AddLayerObject) {
      const under = spec.type === 'fill' || spec.type === 'line' || spec.type === 'fill-extrusion';
      map.addLayer(spec, under ? firstSymbol : undefined);
      layers.push(spec.id);
    },
    on<T extends keyof MapEventType>(type: T, fn: (e: MapEventType[T]) => void) {
      subs.push(map.on(type, fn));
    },
    onLayer<T extends keyof MapLayerEventType>(type: T, layer: string, fn: (e: MapLayerEventType[T]) => void) {
      subs.push(map.on(type, layer, fn));
    },
    dispose() {
      subs.forEach((s) => s.unsubscribe());
      for (const id of layers.reverse()) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of sources) if (map.getSource(id)) map.removeSource(id);
    },
  };
}

export type Scene = ReturnType<typeof scene>;

/** Standard cell styling: translucent fill + crisp outline. */
export function cellLayers(s: Scene, id: string, color: unknown, opts: { fill?: number; line?: number; lineColor?: unknown } = {}) {
  s.layer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': color as string, 'fill-opacity': opts.fill ?? 0.25 } });
  s.layer({
    id: `${id}-line`,
    type: 'line',
    source: id,
    paint: { 'line-color': (opts.lineColor ?? color) as string, 'line-width': opts.line ?? 1.2, 'line-opacity': 0.9 },
  });
}

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function q<T extends Element = HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
}

export const range = (name: string, label: string, min: number, max: number, value: number) => `
  <label class="ctl">
    <span class="ctl-label">${label}<output data-for="${name}">${value}</output></span>
    <input type="range" name="${name}" min="${min}" max="${max}" value="${value}" />
  </label>`;

/** Wire a `range()` control; calls fn with the numeric value on input. */
export function bindRange(root: ParentNode, name: string, fn: (v: number) => void) {
  const input = q<HTMLInputElement>(root, `input[name="${name}"]`);
  const out = q(root, `output[data-for="${name}"]`);
  input.addEventListener('input', () => {
    out.textContent = input.value;
    fn(Number(input.value));
  });
  return input;
}

export const segmented = (name: string, options: [value: string, label: string][], value: string) => `
  <div class="seg" role="radiogroup">
    ${options
      .map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}/><span>${l}</span></label>`)
      .join('')}
  </div>`;

export function bindSegmented(root: ParentNode, name: string, fn: (v: string) => void) {
  root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((i) => i.addEventListener('change', () => fn(i.value)));
}

export const rows = (pairs: [string, string][]) =>
  `<dl class="kv">${pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

export const code = (s: string) => `<code>${esc(s)}</code>`;

export function setGlobe(map: Map, on: boolean) {
  map.setProjection({ type: on ? 'globe' : 'mercator' });
  q(document, '#globe').setAttribute('aria-pressed', String(on));
}

let toastTimer = 0;
export function toast(msg: string) {
  const t = q(document, '#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
}
