// Builds SkyTrace's offline star catalogue + constellation dataset.
//
// Source: d3-celestial (BSD-3-Clause, Olaf Frohn) — Hipparcos-derived stars (mag ≤ 6),
// IAU star names, constellation stick figures and IAU constellation boundaries.
// Curated distances / spectral types for ~60 bright named stars are added below.
//
//   npm pack d3-celestial && tar xzf d3-celestial-*.tgz      (creates ./package)
//   D3C_DIR=./package/data node scripts/build-star-data.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.env.D3C_DIR ?? './package/data';
const OUT = new URL('../public/data/', import.meta.url);
const VERSION = 'stars-2026.10-1';
const read = (f) => JSON.parse(readFileSync(join(SRC, f), 'utf8'));

const stars6 = read('stars.6.json').features;
const names = read('starnames.json');
const cons = read('constellations.json').features;
const lines = read('constellations.lines.json').features;
const bounds = read('constellations.bounds.json').features;

const lonToRa = (lon) => (lon < 0 ? lon + 360 : lon);
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// Curated physical data (approximate; distances in light years).
const CURATED = {
  Sirius: [8.6, 'A1V'], Canopus: [310, 'A9II'], 'Rigil Kentaurus': [4.4, 'G2V'], Arcturus: [37, 'K1.5III'],
  Vega: [25, 'A0V'], Capella: [43, 'G3III'], Rigel: [860, 'B8Ia'], Procyon: [11.5, 'F5IV-V'], Achernar: [139, 'B6Vep'],
  Betelgeuse: [548, 'M1-2Ia'], Hadar: [390, 'B1III'], Altair: [16.7, 'A7V'], Acrux: [320, 'B0.5IV'], Aldebaran: [65, 'K5III'],
  Antares: [550, 'M1.5Iab'], Spica: [250, 'B1V'], Pollux: [34, 'K0III'], Fomalhaut: [25, 'A3V'], Deneb: [2600, 'A2Ia'],
  Mimosa: [280, 'B0.5III'], Regulus: [79, 'B8IV'], Adhara: [430, 'B2II'], Castor: [51, 'A1V'], Gacrux: [88, 'M3.5III'],
  Shaula: [570, 'B2IV'], Bellatrix: [250, 'B2III'], Elnath: [130, 'B7III'], Miaplacidus: [113, 'A1III'], Alnilam: [1200, 'B0Ia'],
  Alnair: [101, 'B6V'], Alnitak: [1260, 'O9.5Iab'], Alioth: [83, 'A1III'], Dubhe: [123, 'K0III'], Mirfak: [510, 'F5Ib'],
  Wezen: [1600, 'F8Ia'], 'Kaus Australis': [143, 'B9.5III'], Avior: [630, 'K3III'], Alkaid: [104, 'B3V'], Menkalinan: [81, 'A1IV'],
  Atria: [391, 'K2Ib'], Alhena: [109, 'A1.5IV'], Peacock: [180, 'B3V'], Polaris: [433, 'F7Ib'], Mirzam: [490, 'B1II'],
  Alphard: [177, 'K3II'], Hamal: [66, 'K2III'], Diphda: [96, 'K0III'], Nunki: [228, 'B2.5V'], Saiph: [650, 'B0.5Ia'],
  Mintaka: [1200, 'O9.5II'], Denebola: [36, 'A3V'], Algol: [90, 'B8V'], Schedar: [228, 'K0III'], Rasalhague: [49, 'A5III'],
  Kochab: [131, 'K4III'], Enif: [690, 'K2Ib'], Markab: [133, 'B9III'], Mizar: [83, 'A2V'], Eltanin: [154, 'K5III'],
  Mirach: [197, 'M0III'], Alpheratz: [97, 'B8IV'], Menkent: [59, 'K0III'], Sargas: [300, 'F1II'], Alderamin: [49, 'A8V'],
};

// --- stars (sorted bright → faint so magnitude filters can stop early)
const list = stars6
  .map((f) => ({ hip: Number(f.id), ra: lonToRa(f.geometry.coordinates[0]), dec: f.geometry.coordinates[1], mag: Number(f.properties.mag), bv: Number(f.properties.bv) }))
  .filter((s) => Number.isFinite(s.ra) && Number.isFinite(s.dec) && Number.isFinite(s.mag))
  .sort((a, b) => a.mag - b.mag);
const index = new Map(list.map((s, i) => [s.hip, i]));

// --- names & designations for notable stars
const info = {};
let curatedHits = 0;
for (const [hip, n] of Object.entries(names)) {
  if (!index.has(Number(hip))) continue;
  const name = n.name || '';
  const desig = (n.bayer || n.flam || n.desig || '').replace(/ /g, ' ');
  if (!name && !desig) continue;
  const entry = { n: name || undefined, d: desig || undefined, c: n.c || undefined };
  const cur = CURATED[name];
  if (cur) {
    entry.ly = cur[0];
    entry.sp = cur[1];
    curatedHits++;
  }
  info[hip] = entry;
}

// --- constellation lines → star index pairs (nearest catalogue star within 0.15°)
const nearest = (ra, dec) => {
  let best = -1;
  let bd = 0.15;
  const cd = Math.cos((dec * Math.PI) / 180);
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let dra = Math.abs(s.ra - ra);
    if (dra > 180) dra = 360 - dra;
    const d = Math.hypot(dra * cd, s.dec - dec);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
};
let unmatched = 0;
const linesBy = {};
for (const f of lines) {
  const pairs = [];
  for (const strip of f.geometry.coordinates) {
    let prev = -1;
    for (const [lon, lat] of strip) {
      const i = nearest(lonToRa(lon), lat);
      if (i < 0) unmatched++;
      if (prev >= 0 && i >= 0 && prev !== i) pairs.push([prev, i]);
      prev = i;
    }
  }
  linesBy[f.id] = pairs;
}

// --- boundaries, densified along edges (≤1°) so great-circle tests follow the RA/Dec edges
const densify = (ring) => {
  const out = [];
  for (let k = 0; k < ring.length - 1; k++) {
    const [a0, d0] = ring[k];
    let [a1, d1] = ring[k + 1];
    let da = a1 - a0;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(da), Math.abs(d1 - d0))));
    for (let j = 0; j < n; j++) out.push([r4(lonToRa(((a0 + (da * j) / n + 540) % 360) - 180)), r4(d0 + ((d1 - d0) * j) / n)]);
  }
  return out;
};
const boundsBy = {};
for (const f of bounds) {
  const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  boundsBy[f.id] = densify(rings[0]);
}

const constellations = cons.map((c) => ({
  id: c.id,
  name: c.properties.name,
  gen: c.properties.gen,
  rank: Number(c.properties.rank),
  label: [r4(lonToRa(c.geometry.coordinates[0])), r4(c.geometry.coordinates[1])],
  lines: linesBy[c.id] ?? [],
  boundary: boundsBy[c.id] ?? [],
}));

mkdirSync(OUT, { recursive: true });
writeFileSync(
  new URL('stars.v1.json', OUT),
  JSON.stringify({
    version: VERSION,
    epoch: 'J2000',
    source: 'Hipparcos via d3-celestial (BSD-3-Clause)',
    fields: ['hip', 'raDeg', 'decDeg', 'mag', 'bv'],
    stars: list.map((s) => [s.hip, r4(s.ra), r4(s.dec), s.mag, Number.isFinite(s.bv) ? s.bv : null]),
    info,
  }),
);
writeFileSync(
  new URL('constellations.v1.json', OUT),
  JSON.stringify({ version: VERSION, epoch: 'J2000', source: 'IAU boundaries & d3-celestial figures (BSD-3-Clause)', constellations }),
);
console.log(`stars ${list.length}, named/designated ${Object.keys(info).length}, curated ${curatedHits}/${Object.keys(CURATED).length}`);
console.log(`constellations ${constellations.length}, line segments ${Object.values(linesBy).reduce((a, b) => a + b.length, 0)}, unmatched line points ${unmatched}`);
