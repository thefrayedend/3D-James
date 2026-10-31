import { ShapeUtils, Vector2 } from 'three';
import { crc32 } from './zip.js';

// Reading other programs' 3D files: 3MF (a zip of XML), OBJ text, and turning meshes into STL bytes.

export function meshToStl(verts, tris) {
  validateMesh(verts, tris);
  const n = tris.length / 3; const buf = new ArrayBuffer(84 + n * 50); const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let i = 0; i < tris.length; i += 3) {
    o += 12;
    for (let k = 0; k < 3; k++) { const v = tris[i + k] * 3; dv.setFloat32(o, verts[v], true); dv.setFloat32(o + 4, verts[v + 1], true); dv.setFloat32(o + 8, verts[v + 2], true); o += 12; }
    o += 2;
  }
  return new Uint8Array(buf);
}

const MAX_ARCHIVE_BYTES = 400 * 1048576;
export async function readZip(bytes) {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('The archive is too large (maximum 400 MB).');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const check = (start, length) => {
    if (start < 0 || length < 0 || start + length > bytes.length) throw new Error('The ZIP archive is truncated or damaged.');
  };
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50 && i + 22 + dv.getUint16(i + 20, true) === bytes.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a valid ZIP archive.');
  if (dv.getUint16(eocd + 4, true) || dv.getUint16(eocd + 6, true)) throw new Error('Split ZIP archives are not supported.');
  const count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true);
  let p = dv.getUint32(eocd + 16, true), total = 0;
  if (count === 65535 || p === 0xffffffff || cdSize === 0xffffffff) throw new Error('ZIP64 archives are not supported.');
  check(p, cdSize);
  const cdEnd = p + cdSize;
  if (cdEnd > eocd) throw new Error('Invalid ZIP directory.');
  const out = new Map();
  for (let k = 0; k < count; k++) {
    check(p, 46);
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Invalid ZIP directory entry.');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
    check(p, 46 + nlen + xlen + clen);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen)).replace(/^\//, '');
    p += 46 + nlen + xlen + clen;
    if (p > cdEnd) throw new Error('Invalid ZIP directory length.');
    if (flags & 1) throw new Error('Encrypted ZIP archives are not supported.');
    if (method !== 0 && method !== 8) throw new Error('Unsupported ZIP compression method.');
    if (usize > MAX_ARCHIVE_BYTES - total) throw new Error('The expanded archive is too large (maximum 400 MB).');
    check(loff, 30);
    if (dv.getUint32(loff, true) !== 0x04034b50) throw new Error('Invalid ZIP file entry.');
    const dataStart = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    check(dataStart, csize);
    const raw = bytes.subarray(dataStart, dataStart + csize);
    let data;
    if (method === 0) data = raw;
    else {
      const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > usize || size > MAX_ARCHIVE_BYTES - total) throw new Error('The expanded archive exceeds its size limit.');
          chunks.push(value);
        }
      } catch (err) { await reader.cancel().catch(() => {}); throw err; }
      finally { reader.releaseLock(); }
      data = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    }
    if (data.length !== usize || crc32(data) !== crc) throw new Error('A ZIP entry is damaged.');
    total += data.length;
    if (out.has(name)) throw new Error('The ZIP archive contains duplicate file names.');
    out.set(name, data);
  }
  return out;
}

function validateMesh(verts, tris) {
  if (!verts.length || verts.length % 3 || !tris.length || tris.length % 3) throw new Error('The mesh has incomplete vertices or triangles.');
  for (const v of verts) if (!Number.isFinite(v)) throw new Error('The mesh contains invalid coordinates.');
  const count = verts.length / 3;
  for (const i of tris) if (!Number.isInteger(i) || i < 0 || i >= count) throw new Error('A mesh face refers to a missing vertex.');
}

const PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const UNITS = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

/** The part of a 3MF that holds its main model: the one the package's _rels/.rels points to (not just the first in the ZIP). */
function rootModel(zip) {
  const keys = [...zip.keys()];
  const find = (name) => keys.find((k) => k === name) || keys.find((k) => k.toLowerCase() === name.toLowerCase());
  const rels = zip.get(find('_rels/.rels') || '');
  if (rels) {
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(rels), 'application/xml');
    const rel = [...xml.getElementsByTagNameNS('*', 'Relationship')].find((r) => /\/3dmodel$/i.test(r.getAttribute('Type') || ''));
    if (rel) {
      const name = find((rel.getAttribute('Target') || '').replace(/^\/+/, ''));
      if (!name) throw new Error(`The 3MF says its model is in ${rel.getAttribute('Target')}, but that part is missing.`);
      return name;
    }
  }
  const name = find('3D/3dmodel.model') || keys.find((k) => /^3D\/.*\.model$/i.test(k));
  if (!name) throw new Error('No 3D model found in this 3MF file');
  return name;
}

export function parse3mf(zip) {
  // model parts, read when first needed: the main one, and others its components point to (Bambu Studio and
  // PrusaSlicer keep each object in a model file of its own, under 3D/Objects)
  const models = new Map();
  const modelAt = (path) => {
    const name = [...zip.keys()].find((k) => k === path) || [...zip.keys()].find((k) => k.toLowerCase() === path.toLowerCase());
    if (!name) throw new Error(`A 3MF component refers to ${path}, which is missing.`);
    if (models.has(name)) return models.get(name);
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(zip.get(name)), 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('The 3MF model XML is damaged.');
    const objects = new Map();
    for (const o of xml.documentElement.getElementsByTagNameNS('*', 'object')) {
      if (objects.has(o.getAttribute('id'))) throw new Error(`The 3MF has two objects numbered ${o.getAttribute('id')}.`);
      objects.set(o.getAttribute('id'), o);
    }
    const m = { name, model: xml.documentElement, objects };
    models.set(name, m);
    return m;
  };
  const root = modelAt(rootModel(zip));
  const model = root.model;
  const unitName = model.getAttribute('unit') || 'millimeter';
  const unit = UNITS[unitName];
  if (!unit) throw new Error(`The 3MF uses a unit 3DJames does not know (${unitName}).`);
  const pathOf = (el) => (el.getAttributeNS(PROD, 'path') || el.getAttribute('p:path') || '').replace(/^\/+/, '');
  const coord = (v, key) => {
    const s = v.getAttribute(key), x = s == null || !s.trim() ? NaN : +s;
    if (!Number.isFinite(x)) throw new Error(`A 3MF vertex has a missing or invalid ${key} coordinate.`);
    return x;
  };
  const parseT = (t) => { if (!t) return null; const m = t.trim().split(/\s+/).map(Number); if (m.length !== 12 || !m.every(Number.isFinite)) throw new Error('Invalid 3MF transform.'); return m; };
  const mul = (a, b) => { // apply a then b (row-vector 3MF matrices)
    if (!a) return b; if (!b) return a;
    const A = [[a[0], a[1], a[2], 0], [a[3], a[4], a[5], 0], [a[6], a[7], a[8], 0], [a[9], a[10], a[11], 1]];
    const B = [[b[0], b[1], b[2], 0], [b[3], b[4], b[5], 0], [b[6], b[7], b[8], 0], [b[9], b[10], b[11], 1]];
    const C = A.map((r) => [0, 1, 2, 3].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j] + r[3] * B[3][j]));
    return [C[0][0], C[0][1], C[0][2], C[1][0], C[1][1], C[1][2], C[2][0], C[2][1], C[2][2], C[3][0], C[3][1], C[3][2]];
  };
  const path = new Set(); let instances = 0;
  const collect = (m, id, T, acc) => {
    const key = `${m.name}#${id}`;
    if (path.has(key)) throw new Error('The 3MF contains a cyclic component reference.');
    if (path.size >= 128 || ++instances > 100000) throw new Error('The 3MF component tree is too large.');
    const o = m.objects.get(id); if (!o) throw new Error('A 3MF component refers to a missing object.');
    path.add(key);
    const mesh = o.getElementsByTagNameNS('*', 'mesh')[0];
    if (mesh) {
      const base = acc.verts.length / 3;
      for (const v of mesh.getElementsByTagNameNS('*', 'vertex')) {
        let x = coord(v, 'x'), y = coord(v, 'y'), z = coord(v, 'z');
        if (T) { const nx = x * T[0] + y * T[3] + z * T[6] + T[9], ny = x * T[1] + y * T[4] + z * T[7] + T[10], nz = x * T[2] + y * T[5] + z * T[8] + T[11]; x = nx; y = ny; z = nz; }
        acc.verts.push(x * unit, y * unit, z * unit);
      }
      const count = acc.verts.length / 3 - base;
      for (const t of mesh.getElementsByTagNameNS('*', 'triangle')) {
        const indices = ['v1', 'v2', 'v3'].map((key) => t.hasAttribute(key) ? +t.getAttribute(key) : NaN);
        if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= count)) throw new Error('A 3MF face refers to a missing vertex.');
        acc.tris.push(...indices.map((i) => base + i));
      }
    }
    for (const c of o.getElementsByTagNameNS('*', 'component')) collect(pathOf(c) ? modelAt(pathOf(c)) : m, c.getAttribute('objectid'), mul(parseT(c.getAttribute('transform')), T), acc);
    path.delete(key);
  };
  const out = [];
  const build = model.getElementsByTagNameNS('*', 'build')[0];
  const items = build ? [...build.getElementsByTagNameNS('*', 'item')] : [];
  for (const it of items) {
    const acc = { verts: [], tris: [] };
    const id = it.getAttribute('objectid'), m = pathOf(it) ? modelAt(pathOf(it)) : root;
    collect(m, id, parseT(it.getAttribute('transform')), acc);
    if (acc.tris.length) validateMesh(acc.verts, acc.tris);
    if (acc.tris.length) out.push({ name: m.objects.get(id)?.getAttribute('name') || '', verts: new Float32Array(acc.verts), tris: new Uint32Array(acc.tris) });
  }
  if (!out.length) throw new Error('No printable objects found in this 3MF file');
  return out;
}

export function parseObj(text) {
  const v = []; const tris = []; const faces = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.split('#')[0].trim().split(/\s+/);
    if (t[0] === 'v') v.push(+t[1], +t[2], +t[3]);
    else if (t[0] === 'f') {
      const idx = t.slice(1).map((s) => {
        const w = s.split('/')[0];
        if (!/^-?\d+$/.test(w)) throw new Error(`An OBJ face has an invalid corner (${s}).`);
        const i = +w; return i < 0 ? v.length / 3 + i : i - 1;
      });
      faces.push(idx);
    }
  }
  for (const idx of faces) { // after all the corners are read (a face may come before its corners)
    if (idx.some((i) => i < 0 || i >= v.length / 3)) throw new Error('An OBJ face refers to a missing vertex.');
    tris.push(...faceTriangles(v, idx));
  }
  if (!tris.length) throw new Error('No faces found in this OBJ file');
  validateMesh(v, tris);
  return { verts: new Float32Array(v), tris: new Uint32Array(tris) };
}

/** Triangles filling one OBJ face (corner indices), dents and all; each one turned the same way as the face. */
function faceTriangles(v, idx) {
  if (idx.length === 3) return idx;
  const P = idx.map((i) => [v[3 * i], v[3 * i + 1], v[3 * i + 2]]);
  // the face's normal (Newell's method), then the corners laid flat on the axis plane it faces most
  const n = [0, 0, 0];
  P.forEach((a, k) => { const b = P[(k + 1) % P.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); });
  const ax = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
  const [i, j] = [[1, 2], [2, 0], [0, 1]][ax];
  const flat = P.map((p) => new Vector2(p[i], p[j]));
  const turn = Math.sign(n[ax]) || 1;
  const out = [];
  for (const [a, b, c] of ShapeUtils.triangulateShape(flat, [])) {
    const area = (flat[b].x - flat[a].x) * (flat[c].y - flat[a].y) - (flat[c].x - flat[a].x) * (flat[b].y - flat[a].y);
    out.push(...(area * turn < 0 ? [idx[a], idx[c], idx[b]] : [idx[a], idx[b], idx[c]]));
  }
  if (!out.length) for (let k = 1; k + 1 < idx.length; k++) out.push(idx[0], idx[k], idx[k + 1]); // a face with no area: as before
  return out;
}
