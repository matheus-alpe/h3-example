import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellToBoundary, latLngToCell, polygonToCells } from 'h3-js';
import { cellOrientation, chunkBBox, selfIntersects, unwrapRing, viewportCells } from './h3geo.ts';

const lngSpan = (ring: number[][]) => Math.max(...ring.map((p) => p[0])) - Math.min(...ring.map((p) => p[0]));

test('antimeridian cell (Fiji) stays compact after unwrap', () => {
  const cell = latLngToCell(-17.0, 179.99, 3);
  const raw = cellToBoundary(cell, true);
  assert.ok(lngSpan(raw) > 180, 'fixture should actually cross the antimeridian');
  assert.ok(lngSpan(unwrapRing(raw)) < 5);
});

test('polar cell is closed through the pole', () => {
  const ring = unwrapRing(cellToBoundary(latLngToCell(89.9, 0, 0), true));
  assert.ok(ring.some((p) => p[1] === 89.99));
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test('normal cell is untouched', () => {
  const raw = cellToBoundary(latLngToCell(-23.55, -46.63, 9), true);
  assert.deepEqual(unwrapRing(raw), raw);
});

test('bbox chunks are ≤90° wide and inside [-180, 180]', () => {
  const chunks = chunkBBox([150, -10, 250, 10]); // map panned past the antimeridian
  assert.deepEqual(chunks, [[150, -10, 180, 10], [-180, -10, -110, 10]]);
  for (const [w, , e] of chunkBBox([-500, -80, 500, 80])) {
    assert.ok(e - w <= 90 && w >= -180 && e <= 180);
  }
});

test('viewportCells matches polygonToCells and honors the cap', () => {
  const bbox: [number, number, number, number] = [-46.7, -23.6, -46.6, -23.5];
  const r = viewportCells(bbox, 7, 1e4);
  assert.equal(r.capped, false);
  const direct = polygonToCells([[-46.7, -23.6], [-46.6, -23.6], [-46.6, -23.5], [-46.7, -23.5], [-46.7, -23.6]], 7, true);
  if (!r.capped) assert.equal(r.cells.length, direct.length);
  assert.equal(viewportCells([-180, -80, 180, 80], 9, 1e4).capped, true);
});

test('cellOrientation: class III (odd res) is rotated ~19.1° from class II', () => {
  const [a, b] = [8, 9].map((r) => cellOrientation(latLngToCell(-23.55, -46.63, r)));
  for (const o of [a, b]) assert.ok(o >= 0 && o < 60);
  const diff = Math.abs(a - b) % 60;
  assert.ok(Math.abs(Math.min(diff, 60 - diff) - 19.1) < 1.5, `got ${diff}`);
});

test('selfIntersects detects a bow-tie', () => {
  assert.equal(selfIntersects([[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]), true);
  assert.equal(selfIntersects([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), false);
});
