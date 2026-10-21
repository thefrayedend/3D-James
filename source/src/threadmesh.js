// Procedural ISO-style (60°) thread meshes, built directly as closed triangle meshes
// and handed to Manifold for fast, robust booleans.

/**
 * Closed mesh of a right-hand threaded rod from z=0 to z=len.
 * Regular (angle, height) grid; radius follows the thread profile along a helix.
 */
export function threadRodMesh({ D, P, len, clear = 0 }) {
  const H = 0.866025 * P;
  const depth = (H * 5) / 8;
  const rMaj = D / 2 + clear;
  const rMin = rMaj - depth;
  const crest = P / 8, root = P / 4, flank = (P - crest - root) / 2;
  const prof = (s) => {
    s = ((s % P) + P) % P;
    if (s < crest) return rMaj;
    if (s < crest + flank) return rMaj - ((s - crest) / flank) * depth;
    if (s < crest + flank + root) return rMin;
    return rMin + ((s - crest - flank - root) / flank) * depth;
  };
  const N = Math.max(48, Math.min(180, Math.ceil((Math.PI * D) / 0.4)));
  const Nz = Math.max(2, Math.ceil(len / (P / 14)));
  const verts = new Float32Array((N * (Nz + 1) + 2) * 3);
  let v = 0;
  for (let j = 0; j <= Nz; j++) {
    const z = (len * j) / Nz;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * 2 * Math.PI;
      const rr = prof(z - (P * i) / N);
      verts[v++] = rr * Math.cos(th); verts[v++] = rr * Math.sin(th); verts[v++] = z;
    }
  }
  const cBot = N * (Nz + 1), cTop = cBot + 1;
  verts[v++] = 0; verts[v++] = 0; verts[v++] = 0;
  verts[v++] = 0; verts[v++] = 0; verts[v++] = len;
  const tris = new Uint32Array((N * Nz * 2 + 2 * N) * 3);
  let t = 0;
  const id = (i, j) => j * N + (i % N);
  for (let j = 0; j < Nz; j++) {
    for (let i = 0; i < N; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
      tris[t++] = a; tris[t++] = b; tris[t++] = c;
      tris[t++] = a; tris[t++] = c; tris[t++] = d;
    }
  }
  for (let i = 0; i < N; i++) {
    tris[t++] = cBot; tris[t++] = id(i + 1, 0); tris[t++] = id(i, 0);
    tris[t++] = cTop; tris[t++] = id(i, Nz); tris[t++] = id(i + 1, Nz);
  }
  return { verts, tris, rMaj, rMin, depth };
}
