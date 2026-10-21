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

export function parse3mf(zip) {
  let modelName = [...zip.keys()].find((k) => /^3D\/.*\.model$/i.test(k));
  if (!modelName) throw new Error('No 3D model found in this 3MF file');
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(zip.get(modelName)), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('The 3MF model XML is damaged.');
  const model = xml.documentElement;
  const unit = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[model.getAttribute('unit') || 'millimeter'] || 1;
  const objects = new Map();
  for (const o of model.getElementsByTagNameNS('*', 'object')) objects.set(o.getAttribute('id'), o);
  const parseT = (t) => { if (!t) return null; const m = t.trim().split(/\s+/).map(Number); if (m.length !== 12 || !m.every(Number.isFinite)) throw new Error('Invalid 3MF transform.'); return m; };
  const mul = (a, b) => { // apply a then b (row-vector 3MF matrices)
    if (!a) return b; if (!b) return a;
    const A = [[a[0], a[1], a[2], 0], [a[3], a[4], a[5], 0], [a[6], a[7], a[8], 0], [a[9], a[10], a[11], 1]];
    const B = [[b[0], b[1], b[2], 0], [b[3], b[4], b[5], 0], [b[6], b[7], b[8], 0], [b[9], b[10], b[11], 1]];
    const C = A.map((r) => [0, 1, 2, 3].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j] + r[3] * B[3][j]));
    return [C[0][0], C[0][1], C[0][2], C[1][0], C[1][1], C[1][2], C[2][0], C[2][1], C[2][2], C[3][0], C[3][1], C[3][2]];
  };
  const path = new Set(); let instances = 0;
  const collect = (id, T, acc) => {
    if (path.has(id)) throw new Error('The 3MF contains a cyclic component reference.');
    if (path.size >= 128 || ++instances > 100000) throw new Error('The 3MF component tree is too large.');
    const o = objects.get(id); if (!o) throw new Error('A 3MF component refers to a missing object.');
    path.add(id);
    const mesh = o.getElementsByTagNameNS('*', 'mesh')[0];
    if (mesh) {
      const base = acc.verts.length / 3;
      for (const v of mesh.getElementsByTagNameNS('*', 'vertex')) {
        let x = +v.getAttribute('x'), y = +v.getAttribute('y'), z = +v.getAttribute('z');
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
    for (const c of o.getElementsByTagNameNS('*', 'component')) collect(c.getAttribute('objectid'), mul(parseT(c.getAttribute('transform')), T), acc);
    path.delete(id);
  };
  const out = [];
  const build = model.getElementsByTagNameNS('*', 'build')[0];
  const items = build ? [...build.getElementsByTagNameNS('*', 'item')] : [];
  for (const it of items) {
    const acc = { verts: [], tris: [] };
    const id = it.getAttribute('objectid');
    collect(id, parseT(it.getAttribute('transform')), acc);
    if (acc.tris.length) validateMesh(acc.verts, acc.tris);
    if (acc.tris.length) out.push({ name: objects.get(id)?.getAttribute('name') || '', verts: new Float32Array(acc.verts), tris: new Uint32Array(acc.tris) });
  }
  if (!out.length) throw new Error('No printable objects found in this 3MF file');
  return out;
}

export function parseObj(text) {
  const v = []; const tris = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.split('#')[0].trim().split(/\s+/);
    if (t[0] === 'v') v.push(+t[1], +t[2], +t[3]);
    else if (t[0] === 'f') {
      const idx = t.slice(1).map((s) => { const i = parseInt(s.split('/')[0], 10); return i < 0 ? v.length / 3 + i : i - 1; });
      for (let k = 1; k + 1 < idx.length; k++) tris.push(idx[0], idx[k], idx[k + 1]);
    }
  }
  if (!tris.length) throw new Error('No faces found in this OBJ file');
  validateMesh(v, tris);
  return { verts: new Float32Array(v), tris: new Uint32Array(tris) };
}
