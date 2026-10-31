// 3D viewport: endless floor, 3D Builder–style camera controls, selection, dragging, handles and picking.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toCreasedNormals, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mods, palm } from './touch.js';
import { meshAreas } from './meshfaces.js';
import { paintMesh, applyOp, meshContext, eachPiece } from './paint.js';

const tmpV = new THREE.Vector3();
const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

export class Viewport {
  constructor(container, hooks) {
    this.el = container;
    this.hooks = hooks;
    this.bodies = new Map();
    this.selection = [];
    this.mode = 'select';
    this.pick = null;
    this.grid = 1;
    this.rotSnap = 15;
    this.showEdges = true;
    this.showReflection = true;
    this.activeAxis = null; // like 3D Builder: the axis last used (or being typed) shows green, the rest blue
    this.display = 'solid'; // solid, wire, see (see-through) or xray (hidden edges show through)
    this.lockScale = true;
    this.colors = { accent: '#2f8cf0', outline: '#4fb3ff', pick: '#f08a24', edge: '#1d2733', floorA: '#e4e6e9', floorB: '#d6d9dd', bg: '#dcdfe3', ruler: '#5b6470' };

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    r.domElement.className = 'gl';

    const scene = (this.scene = new THREE.Scene());
    const cam = (this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200000));
    cam.up.set(0, 0, 1);
    cam.position.set(-120, -260, 160);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.3);
    this.hemi.position.set(0, 0, 1);
    scene.add(this.hemi);
    this.head = new THREE.DirectionalLight(0xffffff, 1.3);
    scene.add(this.head); scene.add(this.head.target);
    this.top = new THREE.DirectionalLight(0xffffff, 0.5);
    this.top.castShadow = true;
    this.top.shadow.mapSize.set(2048, 2048);
    this.top.shadow.bias = -0.0005;
    scene.add(this.top); scene.add(this.top.target);

    this.buildFloor();

    const oc = (this.orbit = new OrbitControls(cam, r.domElement));
    oc.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    oc.enableDamping = true; oc.dampingFactor = 0.18;
    oc.zoomToCursor = true;
    oc.screenSpacePanning = true;
    oc.rotateSpeed = 0.9; oc.zoomSpeed = 1.1;
    oc.minDistance = 1; oc.maxDistance = 60000;
    oc.addEventListener('change', () => this.requestRender());
    r.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    // 3D Builder-style handles, drawn flat on top of the view (arrows, size frame, turning rings)
    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    container.appendChild(this.hud);
    this.hudItems = [];
    this.gizmoMode = 'translate';
    // Ruler (like TinkerCAD): gaps from the selected object to its neighbours and the floor; click a number to type it
    this.measurePoints = [];
    this.measureEl = document.createElement('div'); this.measureEl.className = 'measure-overlay'; container.appendChild(this.measureEl);
    this.ruler = false;
    this.rulerEl = document.createElement('div');
    this.rulerEl.className = 'ruler';
    container.appendChild(this.rulerEl);
    // Align (like TinkerCAD): rows of dots around the picked objects
    this.alignOpts = null; this.alignDots = null;
    this.alignEl = document.createElement('div');
    this.alignEl.className = 'ruler align-ov';
    container.appendChild(this.alignEl);

    this.overlay = new THREE.Group();
    scene.add(this.overlay);
    this.lineMat = new LineMaterial({ color: new THREE.Color(this.colors.pick), linewidth: 4, worldUnits: false, depthTest: false, transparent: true });
    this.lineMatHover = new LineMaterial({ color: new THREE.Color(this.colors.pick), linewidth: 3, worldUnits: false, depthTest: false, transparent: true, opacity: 0.7 });
    this.faceMat = new THREE.MeshBasicMaterial({ color: this.colors.pick, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    this.faceMatHover = new THREE.MeshBasicMaterial({ color: this.colors.pick, transparent: true, opacity: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    this.ghostMat = new THREE.MeshBasicMaterial({ color: this.colors.pick, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    this.ghosts = new THREE.Group();
    scene.add(this.ghosts);

    // selection outline
    const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(scene, cam));
    const op = (this.outline = new OutlinePass(new THREE.Vector2(1, 1), scene, cam));
    op.edgeStrength = 4; op.edgeGlow = 0; op.edgeThickness = 1; op.pulsePeriod = 0;
    op.visibleEdgeColor.set(this.colors.outline); op.hiddenEdgeColor.set(this.colors.outline);
    this.composer.addPass(op);
    this.composer.addPass(new OutputPass());

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bindPointer();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.needsRender = true;
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.anim) this.stepAnim();
      const moved = oc.update();
      if (moved || this.needsRender) this.render();
    };
    loop();
  }

  requestRender() { this.needsRender = true; }

  setTheme(c) {
    Object.assign(this.colors, c);
    for (const m of [this.lineMat, this.lineMatHover]) m.color.set(this.colors.pick);
    for (const m of [this.faceMat, this.faceMatHover, this.ghostMat]) m.color.set(this.colors.pick);
    this.outline.visibleEdgeColor.set(this.colors.outline); this.outline.hiddenEdgeColor.set(this.colors.outline);
    const u = this.floor.material.uniforms;
    u.cA.value.set(this.colors.floorA); u.cB.value.set(this.colors.floorB); u.cBg.value.set(this.colors.bg);
    this.scene.background = new THREE.Color(this.colors.bg);
    this.rulerStep = 0;
    this.updateStyles();
    this.updateGizmo();
  }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lineMat.resolution.set(w, h); this.lineMatHover.resolution.set(w, h);
    this.requestRender();
  }

  render() {
    this.needsRender = false;
    const cam = this.camera, tgt = this.orbit.target;
    const d = cam.position.distanceTo(tgt);
    tmpV.set(-0.35, 0.5, 0).applyQuaternion(cam.quaternion);
    this.head.position.copy(cam.position).add(tmpV.multiplyScalar(d * 0.4));
    this.head.target.position.copy(tgt);
    cam.near = Math.max(0.02, d / (cam.fov < 5 ? 40 : 800)); cam.far = d * (cam.fov < 5 ? 20 : 400) + 5000; cam.updateProjectionMatrix();
    this.updateFloor(cam.fov < 5 ? d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(16)) : d); // flat view: act like the normal lens at the same zoom
    this.composer.render();
    this.updateHud();
    this.updateRuler();
    this.updateAlign();
    this.updateMeasurements();
  }

  // ---------------- endless floor with rulers ----------------
  buildFloor() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
      uniforms: { cell: { value: 10 }, cA: { value: new THREE.Color(this.colors.floorA) }, cB: { value: new THREE.Color(this.colors.floorB) }, cBg: { value: new THREE.Color(this.colors.bg) }, center: { value: new THREE.Vector2() }, fade: { value: 1000 } },
      vertexShader: 'varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xy; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `
        uniform float cell; uniform vec3 cA; uniform vec3 cB; uniform vec3 cBg; uniform vec2 center; uniform float fade; varying vec2 vW;
        float checker(vec2 p, float s){ vec2 q = p / s; vec2 fw = fwidth(q); vec2 a = floor(q); float c = mod(a.x + a.y, 2.0);
          float blur = clamp(max(fw.x, fw.y) * 1.5 - 0.3, 0.0, 1.0); return mix(c, 0.5, blur); }
        void main(){
          float c1 = checker(vW, cell); float c2 = checker(vW, cell * 10.0);
          vec3 col = mix(cA, cB, c1 * 0.75 + c2 * 0.25);
          float dist = length(vW - center);
          float f = smoothstep(fade * 0.35, fade, dist);
          col = mix(col, cBg, f);
          float a = gl_FrontFacing ? 0.8 : 0.35;
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.floor.renderOrder = -2;
    this.floor.raycast = () => {};
    this.scene.add(this.floor);
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.14, depthWrite: false }));
    this.shadowPlane.position.z = 0.005; this.shadowPlane.receiveShadow = true; this.shadowPlane.renderOrder = -1;
    this.shadowPlane.raycast = () => {};
    this.scene.add(this.shadowPlane);
    this.rulers = new THREE.Group();
    this.scene.add(this.rulers);
    this.rulerStep = 0;
    this.printerOutline = null;
    this.scene.background = new THREE.Color(this.colors.bg);
  }

  updateFloor(d) {
    const t = this.orbit.target;
    const size = d * 60 + 2000;
    this.floor.scale.set(size, size, 1);
    this.floor.position.set(t.x, t.y, 0);
    const u = this.floor.material.uniforms;
    const f = this.camera.fov < 5 ? 0 : 0.5;
    u.center.value.set(this.camera.position.x * f + t.x * (1 - f), this.camera.position.y * f + t.y * (1 - f));
    u.fade.value = d * 6 + 300;
    // checker cell: 10 mm up close, bigger as you zoom out
    const cell = Math.pow(10, Math.max(1, Math.floor(Math.log10(Math.max(d, 1) / 25))));
    u.cell.value = cell;
    // shadow follows the view
    const s = Math.max(150, d * 0.9);
    this.shadowPlane.scale.set(s * 4, s * 4, 1); this.shadowPlane.position.set(t.x, t.y, 0.005);
    const sc = this.top.shadow.camera;
    if (Math.abs(sc.right - s) > s * 0.2 || !this.shadowCenter || this.shadowCenter.distanceTo(t) > s * 0.3) {
      sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = 1; sc.far = s * 8; sc.updateProjectionMatrix();
      this.shadowCenter = t.clone();
    }
    this.top.position.set(this.shadowCenter.x + s * 0.15, this.shadowCenter.y + s * 0.25, s * 3);
    this.top.target.position.set(this.shadowCenter.x, this.shadowCenter.y, 0);
    // rulers
    const want = d / 6;
    let step = NICE[NICE.length - 1];
    for (const n of NICE) if (n >= want) { step = n; break; }
    if (step !== this.rulerStep) this.buildRulers(step);
  }

  buildRulers(step) {
    this.rulerStep = step;
    const g = this.rulers;
    while (g.children.length) { const o = g.children.pop(); o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); }
    const label = (txt, x, y, rot) => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.font = '500 34px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = this.colors.ruler; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, 128, 34);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const h = step * 0.1;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(h * 4, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.position.set(x, y, 0.02); m.rotation.z = rot; m.renderOrder = -1;
      m.raycast = () => {};
      g.add(m);
    };
    const fmtLen = (v) => (v >= 1000 ? `${v / 1000} m` : `${v} mm`);
    for (let i = 1; i <= 5; i++) {
      label(fmtLen(i * step), i * step, -step * 0.1, 0);
      label(fmtLen(i * step), 0, i * step, 0);
    }
    this.requestRender();
  }

  setPrinterOutline(size) {
    if (this.printerOutline) { this.scene.remove(this.printerOutline); this.printerOutline.geometry.dispose(); this.printerOutline = null; }
    if (size) {
      const [w, d] = size;
      const geo = new THREE.BufferGeometry().setFromPoints([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]].map(([x, y]) => new THREE.Vector3(x, y, 0.03)));
      this.printerOutline = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: this.colors.accent, transparent: true, opacity: 0.8 }));
      this.printerOutline.raycast = () => {};
      this.scene.add(this.printerOutline);
    }
    this.requestRender();
  }

  // ---------------- bodies ----------------
  setBodies(list, props) {
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let entry = this.bodies.get(b.id);
      if (!entry || entry.key !== b.key) {
        if (entry) this.disposeEntry(entry);
        entry = this.buildEntry(b);
        this.bodies.set(b.id, entry);
      }
      entry.group.matrix.identity(); entry.group.matrixWorldNeedsUpdate = true;
      entry.mirror.matrix.makeScale(1, 1, -1); entry.mirror.matrixWorldNeedsUpdate = true;
      entry.data = b;
    }
    for (const [id, e] of this.bodies) if (!seen.has(id)) { this.disposeEntry(e); this.bodies.delete(id); }
    this.props = props;
    this.selection = this.selection.filter((id) => this.bodies.has(id));
    this.updateStyles();
    this.updateGizmo();
    this.refreshPickOverlay();
  }

  buildEntry(b) {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(b.vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(b.triangles, 1));
    if (b.solid && b.normals?.length === b.vertices.length) geo.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3));
    else geo = toCreasedNormals(geo, (35 * Math.PI) / 180);
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: '#C3C3C3', roughness: 0.55, metalness: 0.03, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.bodyId = b.id;
    group.add(mesh);
    let edges;
    if (b.solid && b.lines?.length) {
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.BufferAttribute(b.lines, 3));
      edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: this.colors.edge, transparent: true, opacity: 0.35 }));
    } else {
      const src = mergeVertices(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(b.vertices, 3)).setIndex(new THREE.BufferAttribute(b.triangles, 1)), 1e-4);
      edges = new THREE.LineSegments(new THREE.EdgesGeometry(src, 28), new THREE.LineBasicMaterial({ color: this.colors.edge, transparent: true, opacity: 0.28 }));
    }
    edges.raycast = () => {};
    group.add(edges);
    this.scene.add(group);
    const mirror = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#C3C3C3', roughness: 0.6, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
    mirror.matrixAutoUpdate = false;
    mirror.matrix.makeScale(1, 1, -1);
    mirror.renderOrder = -3;
    mirror.raycast = () => {};
    this.scene.add(mirror);
    return { id: b.id, key: b.key, group, mesh, edges, mirror, data: b };
  }

  disposeEntry(e) {
    this.dropPaint(e);
    this.scene.remove(e.group);
    this.scene.remove(e.mirror); e.mirror.material.dispose();
    e.mesh.geometry.dispose(); e.mesh.material.dispose();
    e.edges.geometry.dispose(); e.edges.material.dispose();
    if (e.pickLines) e.pickLines.geometry.dispose();
  }

  updateStyles() {
    const sel = new Set(this.selection);
    const outlined = [];
    for (const [id, e] of this.bodies) {
      const p = this.props?.[id] || {};
      const m = e.mesh.material;
      const dm = this.display, solid = dm === 'solid';
      m.color.set(p.hole ? '#8b96a3' : p.color || '#C3C3C3');
      const see = !!p.hole || dm !== 'solid';
      m.transparent = see; m.opacity = p.hole ? 0.38 : dm === 'xray' ? 0.16 : dm === 'see' ? 0.42 : dm === 'wire' ? 0.6 : 1; m.depthWrite = !see;
      m.wireframe = dm === 'wire';
      m.needsUpdate = true;
      e.mesh.castShadow = solid && !p.hole;
      e.edges.visible = dm === 'wire' ? false : this.showEdges || !!p.hole || !solid;
      const em = e.edges.material;
      em.userData.base ??= em.opacity;
      em.depthTest = dm !== 'xray'; em.opacity = dm === 'xray' || dm === 'see' ? 0.8 : em.userData.base; em.needsUpdate = true;
      e.edges.renderOrder = dm === 'xray' ? 2 : 0;
      e.group.visible = !p.hidden;
      e.mirror.visible = this.showReflection && !p.hidden && !p.hole && solid; e.mirror.material.color.set(p.color || '#C3C3C3');
      e.mesh.renderOrder = p.hole ? 1 : 0;
      this.updatePaint(e);
      if (e.paintMesh) { const pm = e.paintMesh.material; pm.transparent = m.transparent; pm.opacity = m.opacity; pm.depthWrite = m.depthWrite; pm.wireframe = m.wireframe; pm.needsUpdate = true; }
      if (sel.has(id) && !p.hidden && this.mode === 'select') outlined.push(e.mesh);
    }
    this.outline.selectedObjects = this.mode === 'select' ? outlined : [];
    this.requestRender();
  }

  /** See-through copies of objects a step used up (shown while that step is being edited), and the piece pointed out
   * by hovering an Edit sketch button (hover: orange, drawn over everything so it shows inside the object too). */
  setGhosts(list) {
    while (this.ghosts.children.length) { const o = this.ghosts.children.pop(); o.geometry.dispose(); o.children.forEach((c) => c.geometry.dispose()); }
    this.pieceMat ||= new THREE.MeshBasicMaterial({ color: 0xff8a00, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    for (const b of list || []) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.vertices, 3));
      g.setIndex(new THREE.BufferAttribute(b.triangles, 1));
      const m = new THREE.Mesh(g, b.hover ? this.pieceMat : this.ghostMat);
      m.renderOrder = b.hover ? 8 : 6; m.raycast = () => {};
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: b.hover ? 0xff6a00 : this.colors.pick, transparent: true, opacity: 0.9, depthTest: false }));
      edges.renderOrder = b.hover ? 9 : 7; edges.raycast = () => {};
      m.add(edges);
      this.ghosts.add(m);
    }
    this.requestRender();
  }

  setSelection(ids) {
    this.selection = ids.filter((id) => this.bodies.has(id));
    this.updateStyles();
    this.updateGizmo();
  }
  setEdgesVisible(v) { this.showEdges = v; this.updateStyles(); }
  setReflection(v) { this.showReflection = v; this.updateStyles(); }
  /** Show (or with null, remove) the workplane: a see-through grid square on the picked face. */
  setWorkplane(wp) {
    if (this.wpMesh) { this.scene.remove(this.wpMesh); this.wpMesh.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); this.wpMesh = null; }
    if (wp) {
      const size = wp.size || 80, g = new THREE.Group();
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: this.colors.accent, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
      const grid = new THREE.GridHelper(size, Math.round(size / 10), this.colors.accent, this.colors.accent);
      grid.rotation.x = Math.PI / 2; grid.material.transparent = true; grid.material.opacity = 0.55;
      const direction = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), Math.min(size * 0.18, 20), this.colors.accent);
      g.add(plane, grid, direction);
      g.traverse((o) => { o.raycast = () => {}; o.renderOrder = 4; });
      const n = new THREE.Vector3(...wp.n).normalize();
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      g.position.set(...wp.P).addScaledVector(n, 0.05);
      this.wpMesh = g; this.scene.add(g);
    }
    this.requestRender();
  }
  setRuler(on) { this.ruler = on; this.updateRuler(); this.requestRender(); }

  /** The gaps around the one selected object: to the nearest object on each side (left, right, front, back),
   *  and down to whatever is below it (or the floor). Uses where things are drawn right now, so it follows drags. */
  rulerGaps() {
    if (!this.ruler || this.selection.length < 1 || this.mode !== 'select') return [];
    const box = (ids) => { const b = new THREE.Box3(); for (const id of ids) { const e = this.bodies.get(id); if (e?.group.visible) b.union(new THREE.Box3().setFromObject(e.mesh)); } return b; };
    const S = box(this.selection); if (S.isEmpty()) return [];
    const others = [...this.bodies.keys()].filter((id) => !this.selection.includes(id) && !this.props?.[id]?.hidden && !this.props?.[id]?.hole).map((id) => box([id])).filter((b) => !b.isEmpty());
    const lo = (b, k) => b.min.getComponent(k), hi = (b, k) => b.max.getComponent(k);
    const overlap = (a, b, k) => Math.min(hi(a, k), hi(b, k)) - Math.max(lo(a, k), lo(b, k));
    const gaps = [];
    for (const ax of [0, 1]) {
      const o1 = 1 - ax;
      for (const dir of [-1, 1]) {
        let best = null;
        for (const O of others) {
          if (overlap(S, O, o1) <= 0 || overlap(S, O, 2) <= 0) continue;
          const gap = dir > 0 ? lo(O, ax) - hi(S, ax) : lo(S, ax) - hi(O, ax);
          if (gap >= -1e-6 && (!best || gap < best.gap)) best = { gap, O };
        }
        if (!best) continue;
        const O = best.O;
        const mid = (k) => (Math.max(lo(S, k), lo(O, k)) + Math.min(hi(S, k), hi(O, k))) / 2;
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        a.setComponent(ax, dir > 0 ? hi(S, ax) : lo(S, ax)); b.setComponent(ax, dir > 0 ? lo(O, ax) : hi(O, ax));
        for (const k of [o1, 2]) { a.setComponent(k, mid(k)); b.setComponent(k, mid(k)); }
        gaps.push({ ax, dir, gap: Math.max(0, best.gap), a, b });
      }
    }
    // straight down: to the object below or to the floor
    let floor = 0;
    for (const O of others) if (overlap(S, O, 0) > 0 && overlap(S, O, 1) > 0 && hi(O, 2) <= lo(S, 2) + 1e-6) floor = Math.max(floor, hi(O, 2));
    const c = S.getCenter(new THREE.Vector3());
    if (lo(S, 2) - floor > 1e-3) gaps.push({ ax: 2, dir: -1, gap: lo(S, 2) - floor, a: new THREE.Vector3(c.x, c.y, lo(S, 2)), b: new THREE.Vector3(c.x, c.y, floor) });
    return gaps;
  }

  updateRuler() {
    const el = this.rulerEl;
    if (this.rulerEditing) return; // don't redraw under a number being typed
    const gaps = this.rulerGaps();
    if (!gaps.length) { if (el.childElementCount) el.replaceChildren(); return; }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const scr = (p) => { const s = this.toScreen(p); return { x: s.x - rect.left, y: s.y - rect.top }; };
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'ruler-lines');
    el.replaceChildren(svg);
    for (const g of gaps) {
      const A = scr(g.a), B = scr(g.b);
      const line = document.createElementNS(NS, 'line');
      for (const [k, v] of Object.entries({ x1: A.x, y1: A.y, x2: B.x, y2: B.y })) line.setAttribute(k, v);
      svg.appendChild(line);
      for (const P of [A, B]) { const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('cx', P.x); dot.setAttribute('cy', P.y); dot.setAttribute('r', 2.5); svg.appendChild(dot); }
      const lab = document.createElement('button');
      lab.className = 'ruler-num'; lab.textContent = String(Math.round(g.gap * 100) / 100);
      lab.title = 'Click to type an exact gap';
      lab.style.transform = `translate(${(A.x + B.x) / 2}px, ${(A.y + B.y) / 2}px) translate(-50%, -50%)`;
      lab.onclick = () => {
        const inp = document.createElement('input');
        inp.className = 'ruler-in'; inp.value = lab.textContent; inp.style.transform = lab.style.transform;
        this.rulerEditing = true; lab.replaceWith(inp); inp.focus(); inp.select();
        const done = (ok) => {
          if (!this.rulerEditing) return;
          this.rulerEditing = false;
          const v = parseFloat(inp.value);
          if (ok && Number.isFinite(v) && v >= 0) {
            // move the selection along that axis so the gap becomes v
            const d = [0, 0, 0]; d[g.ax] = (g.gap - v) * g.dir;
            this.hooks.onRulerMove?.(d);
          }
          this.updateRuler();
        };
        inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
        inp.onblur = () => done(true);
      };
      el.appendChild(lab);
    }
  }

  setAlign(opts) {
    this.alignPreview(null);
    this.alignOpts = opts; this.alignDots = null; this.alignEl.replaceChildren();
    this.updateGizmo(); // the move/size handles step aside while the dots are up
    this.requestRender();
  }
  /** Show (visually only) where everything would go for one dot; null puts things back. */
  alignPreview(plan) {
    const I = new THREE.Matrix4();
    for (const id of this.alignMoved || []) this.applyPreview([id], I);
    this.alignMoved = [];
    if (!plan) return;
    for (const [id, d] of Object.entries(plan)) { this.applyPreview([id], new THREE.Matrix4().makeTranslation(...d)); this.alignMoved.push(id); }
  }
  updateAlign() {
    const el = this.alignEl, o = this.alignOpts;
    if (!o || this.selection.length < 2) { if (el.childElementCount) el.replaceChildren(); this.alignDots = null; return; }
    // the picked objects' box, from their built shapes (not the preview)
    const box = (ids) => { const b = new THREE.Box3(); for (const id of ids) { const bb = this.bodies.get(id)?.data.bbox; if (bb) b.union(new THREE.Box3(new THREE.Vector3(...bb[0]), new THREE.Vector3(...bb[1]))); } return b; };
    const S = box(this.selection); if (S.isEmpty()) return;
    const c = S.getCenter(new THREE.Vector3()), cam = this.camera.position;
    const off = this.worldPerPixel(c) * 26;
    // the rows sit on the sides facing you, on the floor of the box; the up/down row stands at the near corner
    const ny = cam.y < c.y ? S.min.y - off : S.max.y + off, nx = cam.x < c.x ? S.min.x - off : S.max.x + off, z0 = S.min.z;
    const at = (k, w) => (w < 0 ? S.min.getComponent(k) : w > 0 ? S.max.getComponent(k) : c.getComponent(k));
    const spots = [];
    for (const w of [-1, 0, 1]) spots.push({ axis: 0, w, p: new THREE.Vector3(at(0, w), ny, z0) });
    for (const w of [-1, 0, 1]) spots.push({ axis: 1, w, p: new THREE.Vector3(nx, at(1, w), z0) });
    for (const w of [-1, 0, 1]) spots.push({ axis: 2, w, p: new THREE.Vector3(nx, ny, at(2, w)) });
    if (!this.alignDots) {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'ruler-lines');
      const lines = [0, 1, 2].map(() => { const l = document.createElementNS(NS, 'line'); svg.appendChild(l); return l; });
      const tag = document.createElement('div'); tag.className = 'al-anchor'; tag.textContent = 'stays put';
      el.replaceChildren(svg, tag);
      const names = [['left sides', 'centers', 'right sides'], ['fronts', 'centers', 'backs'], ['bottoms', 'middles', 'tops']];
      const dots = spots.map((s) => {
        const b = document.createElement('button');
        b.className = 'al-dot' + (s.w === 0 ? ' mid' : '');
        b.title = `Line up the ${names[s.axis][s.w + 1]}`;
        b.onmouseenter = () => this.alignPreview(this.hooks.alignPreview?.(s.axis, s.w));
        b.onmouseleave = () => this.alignPreview(null);
        b.onclick = () => { this.alignPreview(null); this.hooks.onAlign?.(s.axis, s.w); };
        el.appendChild(b);
        return b;
      });
      this.alignDots = { dots, lines, tag };
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const scr = (p) => { const s = this.toScreen(p); return { x: s.x - rect.left, y: s.y - rect.top }; };
    const P = spots.map((s) => scr(s.p));
    P.forEach((q, i) => { this.alignDots.dots[i].style.transform = `translate(${q.x}px, ${q.y}px) translate(-50%, -50%)`; });
    this.alignDots.lines.forEach((l, k) => { const a = P[k * 3], b = P[k * 3 + 2]; l.setAttribute('x1', a.x); l.setAttribute('y1', a.y); l.setAttribute('x2', b.x); l.setAttribute('y2', b.y); });
    const A = box(o.anchor || []);
    if (!A.isEmpty()) { const t = scr(new THREE.Vector3(A.getCenter(new THREE.Vector3()).x, A.getCenter(new THREE.Vector3()).y, A.max.z)); this.alignDots.tag.style.transform = `translate(${t.x}px, ${t.y - 14}px) translate(-50%, -100%)`; }
  }

  /** A small PNG picture of the current view (for the preview inside .3dj files). */
  async snapshot(width = 512) {
    try {
      this.render();
      const src = this.renderer.domElement, k = width / src.width;
      const c = document.createElement('canvas'); c.width = width; c.height = Math.round(src.height * k);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    } catch { return null; }
  }
  setDisplay(mode) { this.display = mode; this.updateStyles(); }

  /** Flat view: a very narrow lens, so sizes don't shrink with distance (looks like an engineering drawing). */
  setFlat(on) {
    const nf = on ? 1.5 : 32;
    if (this.camera.fov === nf) return;
    const k = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(nf) / 2);
    const tgt = this.orbit.target, off = this.camera.position.clone().sub(tgt).multiplyScalar(k);
    this.camera.fov = nf; this.camera.position.copy(tgt).add(off);
    this.orbit.minDistance = on ? 20 : 1; this.orbit.maxDistance = on ? 60000 * 22 : 60000;
    this.camera.updateProjectionMatrix(); this.orbit.update(); this.requestRender();
  }

  selectionBox(ids = this.selection) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const e = this.bodies.get(id); if (!e) continue;
      box.expandByPoint(tmpV.set(...e.data.bbox[0])); box.expandByPoint(tmpV.set(...e.data.bbox[1]));
    }
    return box;
  }

  /** How far the picked objects reach from c, in any direction. It stays the same while they turn (a box around them
   * grows and shrinks as they turn), so the turning rings keep one size. */
  selectionReach(c, ids = this.selection) {
    let r = 0;
    for (const id of ids) {
      const s = this.bodies.get(id)?.mesh.geometry.boundingSphere; if (!s) continue;
      r = Math.max(r, s.center.distanceTo(c) + s.radius);
    }
    return r;
  }

  // ---------------- handles ----------------
  setGizmoMode(m) { this.gizmoMode = m; this.updateGizmo(); }

  updateGizmo() {
    const show = (this.mode === 'select' && this.selection.length > 0 && !this.alignOpts || this.planeEdit) && !this.dragging && !this.handleDrag;
    if (!show) { this.clearHandles(); this.requestRender(); return; }
    this.buildHandles();
    this.requestRender();
  }

  /** Which axis (0 X, 1 Y, 2 Z) a handle works on right now, or null (corners), or undefined (not an arrow). */
  handleAxis(d, L) {
    if (d.type === 'lift' || d.type === 'planemove') return 2;
    if (d.type === 'slide') return d.ax ?? (d.at === 'depth' ? L.depth.ax : L.lrAx);
    if (d.type === 'edge') return d.side === 'top' || d.side === 'bottom' ? 2 : L.lrAx;
    if (d.type === 'depth') return L.depth.ax;
    if (d.type === 'face') return d.ax;
    if (d.type === 'rot') return L.rot?.[d.ring]?.ai;
    return undefined;
  }
  setActiveAxis(ax) {
    if (this.activeAxis === ax) return;
    this.activeAxis = ax;
    this.hooks.onActiveAxis?.(ax);
    this.updateHud();
  }

  clearHandles() { this.hud.replaceChildren(); this.hudItems = []; }

  buildHandles() {
    // flat on-screen handles in the 3D Builder style
    this.clearHandles();
    const pe = this.planeEdit;
    const NS = 'http://www.w3.org/2000/svg';
    const mkSvg = (cls, w, h, inner) => {
      const el = document.createElementNS(NS, 'svg');
      el.setAttribute('class', 'hh ' + cls); el.setAttribute('width', w); el.setAttribute('height', h); el.setAttribute('viewBox', `0 0 ${w} ${h}`);
      el.innerHTML = inner;
      return el;
    };
    const add = (el, data) => {
      el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); try { e.target.setPointerCapture(e.pointerId); } catch { /* */ } this.startHandleDrag(data, e); });
      el.addEventListener('pointermove', (e) => { if (this.handleDrag) this.moveHandleDrag(e); });
      el.addEventListener('pointerup', () => { if (this.handleDrag) this.endHandleDrag(); });
      el.addEventListener('pointercancel', () => { if (this.handleDrag) this.endHandleDrag(); });
      this.hud.appendChild(el);
      this.hudItems.push({ el, data });
    };
    const passive = (el, data) => { this.hud.appendChild(el); this.hudItems.push({ el, data }); };
    const dbl = (color) => `<g fill="${color}" stroke="rgba(0,0,0,.25)" stroke-width=".6"><rect x="10.5" y="9" width="3" height="18" rx="1"/><path d="M12 1 L19 10 L5 10 Z"/><path d="M12 35 L19 26 L5 26 Z"/></g>`;
    const tri2 = (color) => `<g fill="${color}" stroke="rgba(0,0,0,.25)" stroke-width=".6"><path d="M9 1 L16 8 L2 8 Z"/><path d="M9 7 L16 14 L2 14 Z"/></g>`;
    const rings = () => {
      const r = document.createElementNS(NS, 'svg');
      r.setAttribute('class', 'hrings');
      r.innerHTML = '<circle class="ball"/><polyline class="ring rz"/><polyline class="ring ra"/><polyline class="ring rb"/>';
      passive(r, { type: 'rings' });
    };
    const rotArrow = (ring, color, width) => {
      const el = document.createElementNS(NS, 'svg');
      el.setAttribute('class', 'hrot');
      el.innerHTML = `<path class="grab" d=""/><path class="shaft" d="" stroke="${color}" stroke-width="${width}"/><path class="head1" fill="${color}"/><path class="head2" fill="${color}"/>`;
      add(el, { type: 'rot', ring });
    };
    const mode = pe ? pe.mode : this.gizmoMode;
    if (mode === 'rotate') {
      rings();
      rotArrow('z', 'currentColor', 4); rotArrow('a', 'currentColor', 4); rotArrow('b', 'currentColor', 3.2);
    } else if (pe) {
      add(mkSvg('lift', 24, 36, dbl('#1ea0ff')), { type: 'planemove' });
    } else if (mode === 'translate') {
      // an arrow on every side, drawn in 3D lying along its direction, just outside the middle of that side at the
      // object's middle height (above the top and under the bottom for up-down). Arrows behind the object are hidden.
      const moveArrow = (cls, data) => {
        const el = document.createElementNS(NS, 'svg');
        el.setAttribute('class', 'hrot hmove ' + cls);
        el.dataset.ax = data.ax; el.dataset.sign = data.sign;
        el.innerHTML = '<path class="grab" d=""/><path class="shaft" d="" stroke="currentColor" stroke-width="3.2"/><path class="head1" fill="currentColor"/><path class="head2" fill="currentColor"/>';
        add(el, data);
      };
      moveArrow('lift', { type: 'lift', at: 'top', ax: 2, sign: 1 });
      moveArrow('lift', { type: 'lift', at: 'bottom', ax: 2, sign: -1 });
      for (const ax of [0, 1]) for (const sign of [1, -1]) moveArrow('slide', { type: 'slide', ax, sign });
    } else {
      const frame = document.createElement('div'); frame.className = 'hframe'; passive(frame, { type: 'frame' });
      for (const c of ['tl', 'tr', 'bl', 'br']) add(Object.assign(document.createElement('div'), { className: 'hdot' }), { type: 'corner', at: c });
      // like 3D Builder: a size arrow just outside the middle of each side of the object, pointing straight out of
      // that side (so it lines up with the object), hidden when the object is in front of it
      for (const ax of [0, 1, 2]) for (const sign of [1, -1]) add(mkSvg('tri', 18, 15, tri2('currentColor')), { type: 'face', ax, sign });
    }
    this.updateHud();
  }

  // ring set used for turning: a ball outline and three circles around a center
  ringLayout(c, R, rect) {
    const cam = this.camera.position;
    const dv = c.clone().sub(cam).normalize();
    const axA = Math.abs(dv.x) >= Math.abs(dv.y) ? 0 : 1;
    const axB = 1 - axA;
    const AX = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const basis = { 0: [AX[1], AX[2]], 1: [AX[2], AX[0]], 2: [AX[0], AX[1]] };
    const scr = (p) => { const s = this.toScreen(p); return { x: s.x - rect.left, y: s.y - rect.top }; };
    const ringOf = (ai, pick) => {
      const [u, v] = basis[ai];
      const at = (t) => c.clone().add(u.clone().multiplyScalar(R * Math.cos(t))).add(v.clone().multiplyScalar(R * Math.sin(t)));
      const pts = []; let best = null;
      for (let i = 0; i <= 72; i++) {
        const t = (i / 72) * Math.PI * 2; const q = { t, ...scr(at(t)) };
        pts.push(q);
        if (pick && (!best || pick(q, best))) best = q;
      }
      return { ai, axis: AX[ai], at, pts, best };
    };
    const toward = new THREE.Vector2(-dv.x, -dv.y).normalize();
    const rz = ringOf(2, null);
    { const t = Math.atan2(toward.y, toward.x); rz.best = { t, ...scr(rz.at(t)) }; }
    const ra = ringOf(axA, (q, b) => q.x < b.x);
    const rb = ringOf(axB, (q, b) => q.y < b.y);
    for (const ring of [rz, ra, rb]) {
      const t = ring.best.t, eps = 0.01;
      const p1 = scr(ring.at(t)), p2 = scr(ring.at(t + eps));
      ring.tan = { x: (p2.x - p1.x) / eps, y: (p2.y - p1.y) / eps };
      ring.pxPerRad = Math.hypot(ring.tan.x, ring.tan.y);
      // the arrow is drawn along the ring itself, so it bends the way the ring bends
      const half = Math.min(0.5, 26 / Math.max(ring.pxPerRad, 1));
      ring.arc = [];
      for (let i = 0; i <= 10; i++) ring.arc.push(scr(ring.at(t - half + (2 * half * i) / 10)));
    }
    this.camera.updateMatrixWorld();
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const sc = scr(c), se = scr(c.clone().add(camRight.multiplyScalar(R)));
    return { z: rz, a: ra, b: rb, ball: { x: sc.x, y: sc.y, r: Math.hypot(se.x - sc.x, se.y - sc.y) }, c };
  }

  hudLayout() {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pe = this.planeEdit;
    if (pe) {
      const p = this.planePoint();
      const n = this.planeNormal();
      const sp = this.toScreen(p), sq = this.toScreen(p.clone().add(n.clone().multiplyScalar(pe.size * 0.2)));
      return { rect, plane: { x: sp.x - rect.left, y: sp.y - rect.top, ang: Math.atan2(sq.y - sp.y, sq.x - sp.x), p, n }, rot: pe.mode === 'rotate' ? this.ringLayout(p, pe.size * 0.45, rect) : null };
    }
    const box = this.selectionBox(); if (box.isEmpty()) return null;
    const pts = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(this.toScreen(new THREE.Vector3(x, y, z)));
    const xs = pts.map((q) => q.x - rect.left), ys = pts.map((q) => q.y - rect.top);
    const r = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const c = box.getCenter(new THREE.Vector3());
    const cam = this.camera.position;
    const diag = box.getSize(new THREE.Vector3()).length();
    // the floor axis closest to left-right on screen, and the other one (depth)
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    // (sticky: it only switches when the other axis is clearly closer, so arrows don't flip back and forth near 45°)
    let lrAx = Math.abs(right.x) >= Math.abs(right.y) ? 0 : 1;
    if (this.lastLrAx != null && lrAx !== this.lastLrAx && Math.abs(Math.abs(right.getComponent(lrAx)) - Math.abs(right.getComponent(this.lastLrAx))) < 0.25) lrAx = this.lastLrAx;
    this.lastLrAx = lrAx;
    const lrSign = Math.sign(right.getComponent(lrAx)) || 1;
    const dAx = 1 - lrAx;
    const dSign = cam.getComponent(dAx) - c.getComponent(dAx) >= 0 ? 1 : -1;
    const dp = c.clone(); dp.setComponent(dAx, dSign > 0 ? box.max.getComponent(dAx) : box.min.getComponent(dAx));
    const dq = dp.clone(); dq.setComponent(dAx, dp.getComponent(dAx) + dSign * Math.max(1, diag * 0.2));
    const s1 = this.toScreen(dp), s2 = this.toScreen(dq);
    const depth = { ax: dAx, sign: dSign, p: dp, x: s1.x - rect.left, y: s1.y - rect.top, ang: Math.atan2(s2.y - s1.y, s2.x - s1.x) };
    // move arrows: one per side, centered on that side (the side ones at the object's middle height, the bottom one
    // right under it), lying along its direction. Up close they sit at a set spot and size on the object; zoomed out
    // they keep a readable size and move out just enough to stay clear of it, like 3D Builder. Turning the view never
    // moves them. One you could not see from here (behind the object, under the floor, tip-on) is hidden.
    const move = {};
    if (this.gizmoMode === 'translate' && !this.planeEdit) {
      const half = Math.min(25, Math.max(4, diag * 0.12)), gap = half * 0.5 + 2; // mm
      const block = box.clone().expandByScalar(1e-3), ray = new THREE.Ray();
      const seen = (P) => {
        // under the floor, seen from above: the floor hides it (from below you look through the floor, as at the objects)
        if (cam.z > 0 && P.z < -1e-6) return false;
        // the object, taken as a solid block, in the way (so a hollow box doesn't show arrows through its openings)
        const dir = P.clone().sub(cam), dist = dir.length(); ray.set(cam, dir.normalize());
        const hit = ray.intersectBox(block, new THREE.Vector3());
        return !hit || hit.distanceTo(cam) > dist - 1e-6;
      };
      const scr = (q) => { const s = this.toScreen(q); return { x: s.x - rect.left, y: s.y - rect.top }; };
      for (const ax of [0, 1, 2]) for (const sign of [1, -1]) {
        // up close: a set spot and length on the object (a tenth of its size, at least 6 mm). Zoomed out, like 3D
        // Builder, it doesn't shrink below about 32 px on screen and moves out along the middle of its side just enough
        // to stay about 12 px clear of the object (always centered on that side)
        const F = c.clone(); F.setComponent(ax, sign > 0 ? box.max.getComponent(ax) : box.min.getComponent(ax));
        const wpp = this.worldPerPixel(F), objHalf = Math.max(3, diag * 0.05);
        const hl = Math.max(objHalf, 16 * wpp), inner = Math.max(gap + half - objHalf, 12 * wpp);
        const M = F.clone(); M.setComponent(ax, F.getComponent(ax) + sign * (inner + hl));
        const A = M.clone(), B = M.clone();
        A.setComponent(ax, A.getComponent(ax) - hl); B.setComponent(ax, B.getComponent(ax) + hl);
        const a = scr(A), b = scr(B), len = Math.hypot(b.x - a.x, b.y - a.y);
        // pointing (nearly) straight at you or away, you would only see its tip: hidden
        const along = Math.abs(M.clone().sub(cam).normalize().getComponent(ax));
        move[`${ax}${sign}`] = { a, b, hidden: !seen(M) || along > 0.87 || len < 12 };
      }
    }
    // size arrows: one per side of the object, ~30 px straight out from the middle of that side
    const faces = {};
    if (this.gizmoMode === 'scale' && !this.planeEdit) {
      const meshes = this.selection.map((id) => this.bodies.get(id)?.mesh).filter(Boolean);
      for (const ax of [0, 1, 2]) for (const sign of [1, -1]) {
        const F = c.clone(); F.setComponent(ax, sign > 0 ? box.max.getComponent(ax) : box.min.getComponent(ax));
        // side arrows: at the bottom edge of sides that face you, the top edge of sides that face away (so they sit just
        // outside the object's outline instead of on top of it)
        const k = ((cam.getComponent(ax) - F.getComponent(ax)) * sign) / (cam.distanceTo(F) || 1); // how much the side faces you
        if (ax !== 2 && Math.abs(k) > 0.3) F.z = k > 0 ? box.min.z : box.max.z; // seen side-on: stays at mid height
        const P = F.clone(); P.setComponent(ax, P.getComponent(ax) + sign * 30 * this.worldPerPixel(F));
        const sf = this.toScreen(F), sp = this.toScreen(P);
        let dx = sp.x - sf.x, dy = sp.y - sf.y; const len = Math.hypot(dx, dy);
        // looking straight along this direction: the arrow would point at you, so it is left out
        let hidden = len < 4;
        if (!hidden) {
          // an arrow behind the object is hidden (3D Builder draws them in 3D, so the object covers them)
          const dir = P.clone().sub(cam); const dist = dir.length(); dir.normalize();
          this.raycaster.set(cam, dir);
          const hit = this.raycaster.intersectObjects(meshes, false)[0];
          hidden = !!hit && hit.distance < dist - 1e-3;
        }
        if (hidden && ax === 2 && sign > 0 && len < 4) { hidden = false; dx = 0; dy = -1; } // seen from straight above: the up arrow sits in the middle
        if (len < 4 && ax !== 2 && k > 0) { hidden = false; dx = 0; dy = 1; } // a side facing you head-on keeps its (small) arrow
        // a fixed distance on screen from the middle of the side (so sides facing away still get their arrow outside the object)
        const ul = Math.hypot(dx, dy) || 1, ratio = Math.min(1, len / 30), push = len < 4 ? 0 : 26 * Math.max(ratio, 0.3);
        // pointing almost straight at you or away: drawn small, or left out
        if (ratio < 0.15 && ax === 2 && sign < 0) hidden = true;
        // a side pointing almost straight away from you: its arrow is behind the object
        if (ax !== 2 && ratio < 0.35 && k < 0) hidden = true;
        if (ax !== 2 && ratio < 0.35 && !hidden) {
          // pointing nearly at you: sits on the side itself, just above its bottom edge (out of the bottom arrow's way)
          const G = F.clone(); G.z = box.min.z + (box.max.z - box.min.z) * 0.18; const sg = this.toScreen(G);
          faces[`${ax}${sign}`] = { x: sg.x - rect.left, y: sg.y - rect.top, ang: Math.atan2(dy, dx), hidden, onFace: true };
          continue;
        }
        faces[`${ax}${sign}`] = { x: sf.x - rect.left + (dx / ul) * push, y: sf.y - rect.top + (dy / ul) * push, ang: Math.atan2(dy, dx), hidden };
      }
      // seen from low down (like 3D Builder): left-right arrows lie flat at the middle of the frame's sides, up-down
      // arrows sit centered above and below the frame, and front-back only shows when that side faces you
      const elev = Math.asin(Math.max(-1, Math.min(1, (cam.z - c.z) / (cam.distanceTo(c) || 1))));
      if (elev < 0.5) {
        const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
        faces[`${lrAx}${lrSign}`] = { x: r.x1 + 16, y: cy, ang: 0, hidden: false };
        faces[`${lrAx}${-lrSign}`] = { x: r.x0 - 16, y: cy, ang: Math.PI, hidden: false };
        faces['21'] = { x: cx, y: r.y0 - 16, ang: -Math.PI / 2, hidden: false };
        faces['2-1'] = { x: cx, y: r.y1 + 16, ang: Math.PI / 2, hidden: false };
        for (const sign of [1, -1]) {
          const f = faces[`${dAx}${sign}`];
          // keep it only when it sits on the side facing you (pointing almost straight at you)
          if (!f.onFace) f.hidden = true;
        }
      }
    }
    return { box, r, c, rect, lrAx, lrSign, depth, move, faces, rot: this.gizmoMode === 'rotate' ? this.ringLayout(c, Math.max((this.selectionReach(c) || diag * 0.5) * 1.12, 2), rect) : null };
  }

  updateHud() {
    if (!this.hudItems.length) return;
    const L = this.hudLayout();
    this.hud.style.display = L && !this.handleDrag && !this.dragging ? '' : 'none';
    if (!L) return;
    const place = (el, x, y, rot = 0) => { el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rot}rad)`; };
    const pts = (arr) => arr.map((q) => `${q.x},${q.y}`).join(' ');
    for (const { el, data } of this.hudItems) {
      // the direction being worked on (its box in the bar is picked, or its arrow was used) is green, like that box's
      // underline; the other directions are blue
      const ax = this.handleAxis(data, L);
      if (ax !== undefined) el.style.color = ax === this.activeAxis ? '#7ed321' : '#1ea0ff';
      if (data.type === 'rings') {
        const { ball, z, a, b } = L.rot;
        const ci = el.querySelector('.ball'); ci.setAttribute('cx', ball.x); ci.setAttribute('cy', ball.y); ci.setAttribute('r', ball.r);
        el.querySelector('.rz').setAttribute('points', pts(z.pts));
        el.querySelector('.ra').setAttribute('points', pts(a.pts));
        el.querySelector('.rb').setAttribute('points', pts(b.pts));
        continue;
      }
      if (data.type === 'rot') {
        const ring = L.rot[data.ring]; const arc = ring.arc;
        const d = 'M' + arc.map((q) => `${q.x} ${q.y}`).join(' L');
        el.querySelector('.grab').setAttribute('d', d);
        // shorten the shaft so the heads sit on the ends
        el.querySelector('.shaft').setAttribute('d', 'M' + arc.slice(1, -1).map((q) => `${q.x} ${q.y}`).join(' L'));
        const head = (tip, from) => {
          const dx = tip.x - from.x, dy = tip.y - from.y, l = Math.hypot(dx, dy) || 1;
          const ux = dx / l, uy = dy / l, s = 8;
          const bx = tip.x - ux * s * 1.2, by = tip.y - uy * s * 1.2;
          return `M${tip.x + ux * 2} ${tip.y + uy * 2} L${bx - uy * s * 0.75} ${by + ux * s * 0.75} L${bx + uy * s * 0.75} ${by - ux * s * 0.75} Z`;
        };
        el.querySelector('.head1').setAttribute('d', head(arc[0], arc[2]));
        el.querySelector('.head2').setAttribute('d', head(arc[arc.length - 1], arc[arc.length - 3]));
        continue;
      }
      if (el.classList.contains('hmove')) {
        const m = L.move[`${data.ax}${data.sign}`];
        const { a, b } = m;
        // drawn exactly where it is in the scene (the layout hides ones you could not see)
        el.style.display = m.hidden ? 'none' : '';
        if (m.hidden) continue;
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
        const ux = dx / len, uy = dy / len, s = Math.min(6.5, len / 4); // (heads shrink on a short arrow)
        const head = (tip, sgn) => {
          const bx = tip.x - sgn * ux * s * 1.3, by = tip.y - sgn * uy * s * 1.3;
          return `M${tip.x} ${tip.y} L${bx - uy * s} ${by + ux * s} L${bx + uy * s} ${by - ux * s} Z`;
        };
        el.querySelector('.grab').setAttribute('d', `M${a.x} ${a.y} L${b.x} ${b.y}`);
        el.querySelector('.shaft').setAttribute('d', `M${a.x + ux * s} ${a.y + uy * s} L${b.x - ux * s} ${b.y - uy * s}`);
        el.querySelector('.head1').setAttribute('d', head(b, 1));
        el.querySelector('.head2').setAttribute('d', head(a, -1));
        continue;
      }
      if (data.type === 'planemove') { place(el, L.plane.x, L.plane.y, L.plane.ang + Math.PI / 2); continue; }
      const { r } = L;
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      if (data.type === 'frame') { el.style.transform = `translate(${r.x0}px, ${r.y0}px)`; el.style.width = `${r.x1 - r.x0}px`; el.style.height = `${r.y1 - r.y0}px`; continue; }
      if (data.type === 'lift') place(el, cx, data.at === 'top' ? r.y0 - 24 : r.y1 + 24);
      else if (data.type === 'corner') place(el, data.at[1] === 'l' ? r.x0 : r.x1, data.at[0] === 't' ? r.y0 : r.y1);
      else if (data.type === 'edge') {
        if (data.side === 'top') place(el, cx, r.y0 - 9, 0);
        else if (data.side === 'bottom') place(el, cx, r.y1 + 9, Math.PI);
        else if (data.side === 'left') place(el, r.x0 - 9, cy, -Math.PI / 2);
        else place(el, r.x1 + 9, cy, Math.PI / 2);
      } else if (data.type === 'face') {
        const f = L.faces[`${data.ax}${data.sign}`];
        el.style.display = f.hidden ? 'none' : '';
        if (!f.hidden) place(el, f.x, f.y, f.ang + Math.PI / 2);
      } else if (data.type === 'depth') { const f = L.depth; place(el, f.x + Math.cos(f.ang) * 12, f.y + Math.sin(f.ang) * 12, f.ang + Math.PI / 2); }
    }
  }

  // ---------------- cutting plane (Split) ----------------
  startPlane(opts) {
    this.planeEdit = { mode: 'move', ...opts };
    if (!this.planeMesh) {
      this.planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#5fd35f', transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }));
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: '#2fae2f' }));
      this.planeMesh.add(edge);
      this.planeMesh.renderOrder = 5;
      this.planeMesh.raycast = () => {};
    }
    this.scene.add(this.planeMesh);
    this.mode = 'plane';
    this.updateStyles();
    this.updatePlane();
    this.updateGizmo();
  }
  setPlane(patch) { Object.assign(this.planeEdit, patch); this.updatePlane(); this.updateGizmo(); }
  endPlane() { this.planeEdit = null; if (this.planeMesh) this.scene.remove(this.planeMesh); this.mode = 'select'; this.updateStyles(); this.updateGizmo(); }
  planeQuat() { const e = this.planeEdit; return new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(e.roll || 0), THREE.MathUtils.degToRad(e.pitch || 0), THREE.MathUtils.degToRad(e.yaw || 0), 'ZYX')); }
  planeNormal() { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.planeQuat()); }
  planePoint() { const e = this.planeEdit; return new THREE.Vector3(...e.center).add(this.planeNormal().multiplyScalar(e.off || 0)); }
  updatePlane() {
    const e = this.planeEdit; if (!e || !this.planeMesh) return;
    this.planeMesh.position.copy(this.planePoint());
    this.planeMesh.quaternion.copy(this.planeQuat());
    this.planeMesh.scale.set(e.size, e.size, 1);
    this.requestRender();
  }

  applyPreview(ids, m) {
    const flip = new THREE.Matrix4().makeScale(1, 1, -1);
    for (const id of ids) {
      const e = this.bodies.get(id); if (!e) continue;
      e.group.matrix.copy(m); e.group.matrixWorldNeedsUpdate = true;
      e.mirror.matrix.multiplyMatrices(flip, m); e.mirror.matrixWorldNeedsUpdate = true;
    }
    this.requestRender();
  }

  // ---------------- camera ----------------
  sceneBox() {
    const box = new THREE.Box3();
    for (const [id, e] of this.bodies) {
      if (this.props?.[id]?.hidden) continue;
      box.expandByPoint(tmpV.set(...e.data.bbox[0])); box.expandByPoint(tmpV.set(...e.data.bbox[1]));
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 20));
    return box;
  }

  view(name, animate = true) {
    const dirs = { home: [-0.45, -1, 0.62], top: [0, -0.0001, 1], bottom: [0, 0.0001, -1], front: [0, -1, 0.0001], back: [0, 1, 0.0001], left: [-1, 0, 0.0001], right: [1, 0, 0.0001] };
    const box = name === 'selection' && this.selection.length ? this.selectionBox() : this.sceneBox();
    const dir = name === 'fit' || name === 'selection' ? this.camera.position.clone().sub(this.orbit.target).normalize() : new THREE.Vector3(...(dirs[name] || dirs.home)).normalize();
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    let radius = Math.max(size.length() / 2, 8);
    if (name === 'home') radius = Math.max(radius * 1.35, 40);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (radius / Math.sin(fov / 2)) * (this.camera.aspect < 1 ? 1 / this.camera.aspect : 1) * 0.92;
    const pos = center.clone().add(dir.multiplyScalar(dist));
    if (!animate) { this.camera.position.copy(pos); this.orbit.target.copy(center); this.orbit.update(); this.requestRender(); return; }
    this.anim = { t0: performance.now(), dur: 320, p0: this.camera.position.clone(), p1: pos, c0: this.orbit.target.clone(), c1: center };
  }
  /** Turn the view to look straight at a face (center P, normal n), far enough back to see something `size` across. */
  lookAt(P, n, size = 40) {
    const dir = new THREE.Vector3(...n).normalize();
    if (Math.abs(dir.z) > 0.9999) dir.set(0, dir.z > 0 ? -0.0001 : 0.0001, Math.sign(dir.z)).normalize(); // straight up or down
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = ((Math.max(size, 10) * 0.75) / Math.sin(fov / 2)) * (this.camera.aspect < 1 ? 1 / this.camera.aspect : 1);
    const c = new THREE.Vector3(...P);
    this.anim = { t0: performance.now(), dur: 420, p0: this.camera.position.clone(), p1: c.clone().add(dir.multiplyScalar(dist)), c0: this.orbit.target.clone(), c1: c };
    this.requestRender();
  }
  stepAnim() {
    const a = this.anim; let t = (performance.now() - a.t0) / a.dur;
    if (t >= 1) { t = 1; this.anim = null; }
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const off0 = a.p0.clone().sub(a.c0), off1 = a.p1.clone().sub(a.c1);
    const r = THREE.MathUtils.lerp(off0.length(), off1.length(), e);
    const dir = off0.normalize().lerp(off1.normalize(), e).normalize();
    const c = a.c0.clone().lerp(a.c1, e);
    this.camera.position.copy(c).add(dir.multiplyScalar(r));
    this.orbit.target.copy(c);
    this.requestRender();
  }

  setMeasurements(points) { this.measurePoints = points.map((p) => p.slice()); this.updateMeasurements(); this.requestRender(); }
  updateMeasurements() {
    if (!this.measureEl) return;
    this.measureEl.replaceChildren();
    if (!this.measurePoints.length) return;
    const rect = this.el.getBoundingClientRect();
    const pts = this.measurePoints.map((p) => { const s = this.toScreen(new THREE.Vector3(...p)); return [s.x - rect.left, s.y - rect.top]; });
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', this.el.clientWidth); svg.setAttribute('height', this.el.clientHeight);
    if (pts.length === 2) {
      const line = document.createElementNS(ns, 'line');
      for (const [key, val] of Object.entries({ x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1], stroke: '#f08a24', 'stroke-width': 2 })) line.setAttribute(key, val);
      svg.append(line);
    }
    pts.forEach(([x, y], i) => {
      const circle = document.createElementNS(ns, 'circle');
      for (const [key, val] of Object.entries({ cx: x, cy: y, r: 6, fill: '#f08a24', stroke: 'white', 'stroke-width': 2 })) circle.setAttribute(key, val);
      const label = document.createElementNS(ns, 'text'); label.setAttribute('x', x + 9); label.setAttribute('y', y - 9); label.setAttribute('fill', this.colors.ruler); label.textContent = String(i + 1);
      svg.append(circle, label);
    });
    this.measureEl.append(svg);
  }

  // ---------------- pointer ----------------
  setPointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }
  worldPerPixel(at) {
    const d = this.camera.position.distanceTo(at || this.orbit.target);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / (this.renderer.domElement.clientHeight || 1);
  }
  toScreen(p) {
    const v = p.clone().project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height);
  }

  /**
   * Where a shape dragged in from the toolbar lands under the pointer: on top of an object when the pointer is over
   * a face that points up, otherwise on the floor. Returns the spot for the shape's bottom middle, or null (sky).
   */
  dropPoint(e) {
    const hit = this.hitBody(e);
    if (hit?.face) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (n.z > 0.7) return hit.point.clone();
    }
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)) return null;
    // close to the horizon the floor goes on for ever: too far away to mean it
    return p.distanceTo(this.camera.position) > 8 * this.camera.position.distanceTo(this.orbit.target) ? null : p;
  }
  /**
   * The see-through shape shown where a dragged shape will land: p its bottom middle, size [w, d, h] mm, kind the
   * shape (a cylinder looks like a cylinder...; anything else a box). null hides it.
   */
  showDrop(p, size = [20, 20, 20], kind = 'box', sides = 0) {
    const key = `${kind}:${sides}`;
    if (this.dropGhost && this.dropGhost.userData.key !== key) { this.scene.remove(this.dropGhost); this.dropGhost.traverse((o) => o.geometry?.dispose()); this.dropGhost = null; }
    if (!this.dropGhost) {
      // a shape 1 mm across and 1 mm high, standing on 0: scaled to size below
      const up = (geo) => { geo.rotateX(Math.PI / 2); geo.translate(0, 0, 0.5); return geo; };
      const n = sides || 4;
      const geo = kind === 'cyl' || kind === 'tube' ? up(new THREE.CylinderGeometry(0.5, 0.5, 1, 40))
        : kind === 'prism' ? up(new THREE.CylinderGeometry(0.5, 0.5, 1, 6).rotateY(Math.PI / 6))
          : kind === 'cone' ? up(new THREE.CylinderGeometry(0.15, 0.5, 1, 40))
            : kind === 'pyramid' ? up(new THREE.ConeGeometry(0.5, 1, n).rotateY(Math.PI / n))
              : kind === 'sphere' ? new THREE.SphereGeometry(0.5, 32, 16).translate(0, 0, 0.5)
                : kind === 'torus' ? new THREE.TorusGeometry(0.4, 0.1, 12, 40).scale(1, 1, 5).translate(0, 0, 0.5)
                  : new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: this.colors.accent, transparent: true, opacity: 0.22, depthWrite: false })));
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: this.colors.accent })));
      g.traverse((o) => { o.raycast = () => {}; });
      g.userData.key = key;
      this.dropGhost = g;
    }
    if (!p) { this.scene.remove(this.dropGhost); this.requestRender(); return; }
    this.dropGhost.position.copy(p).setZ(p.z + 0.01);
    this.dropGhost.scale.set(...size);
    if (!this.dropGhost.parent) this.scene.add(this.dropGhost);
    this.requestRender();
  }

  // ---------------- paint (see paint.js): drawn over the object, in the colours of its strokes ----------------
  /** Lay the object's strokes (hooks.paintOf) on it again when they or the object changed. */
  updatePaint(e) {
    const ops = (!this.props?.[e.id]?.hole && this.hooks.paintOf?.(e.id)) || null;
    if (e.paintOps === ops && e.paintKey === e.key) return;
    e.paintOps = ops; e.paintKey = e.key;
    e.paint = ops ? paintMesh(e.data, ops) : null;
    this.drawPaint(e);
  }
  dropPaint(e) { if (e.paintMesh) { e.group.remove(e.paintMesh); e.paintMesh.geometry.dispose(); e.paintMesh.material.dispose(); e.paintMesh = null; } }
  drawPaint(e) {
    const P = e.paint;
    if (!P || !P.trees.some((x) => x)) { this.dropPaint(e); this.requestRender(); return; }
    const V = e.data.vertices, T = e.data.triangles, g = e.mesh.geometry, nA = g.getAttribute('normal'), gi = g.index;
    const cols = P.colors.map((c) => new THREE.Color(c));
    const pos = [], nor = [], col = [];
    eachPiece(P.trees, (t, s, ...w) => {
      const c = cols[s - 1];
      for (const b of w) {
        for (let i = 0; i < 3; i++) pos.push(b[0] * V[3 * T[3 * t] + i] + b[1] * V[3 * T[3 * t + 1] + i] + b[2] * V[3 * T[3 * t + 2] + i]);
        const n = [0, 0, 0];
        for (let k = 0; k < 3; k++) { const j = gi ? gi.getX(3 * t + k) : 3 * t + k; n[0] += b[k] * nA.getX(j); n[1] += b[k] * nA.getY(j); n[2] += b[k] * nA.getZ(j); }
        nor.push(...n); col.push(c.r, c.g, c.b);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (e.paintMesh) { e.paintMesh.geometry.dispose(); e.paintMesh.geometry = geo; }
    else {
      // drawn right on the surface: the object itself is pushed back a little (its polygonOffset), so this wins
      e.paintMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.03 }));
      e.paintMesh.raycast = () => {};
      e.group.add(e.paintMesh);
    }
    this.requestRender();
  }
  /** Add a stroke to an object's paint at once (while a brush is being dragged). */
  paintLive(id, op) {
    const e = this.bodies.get(id); if (!e) return;
    e.paint ||= { colors: [], trees: new Array(e.data.triangles.length / 3).fill(0) };
    applyOp(meshContext(e.data), e.paint, op);
    this.drawPaint(e);
  }
  /** Paint mode: dragging on an object paints (hooks.onPaint), dragging beside it turns the view. */
  setPaintMode(on) {
    this.mode = on ? 'paint' : 'select';
    if (!on) { this.paintPainting = false; this.showPaintCursor(null); this.showPaintPreview(null); this.renderer.domElement.style.cursor = 'default'; }
    this.clearHandles();
    this.updateStyles();
    this.updateGizmo();
  }
  /** The brush outline where the pointer is: a ring of radius r, flat across n (null hides it). */
  showPaintCursor(at, n, r, color) {
    if (!at) { if (this.paintCursor) this.paintCursor.visible = false; this.requestRender(); return; }
    if (!this.paintCursor) {
      this.paintCursor = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
      this.paintCursor.renderOrder = 20;
      this.paintCursor.raycast = () => {};
      this.scene.add(this.paintCursor);
    }
    const c = this.paintCursor;
    c.visible = true; c.material.color.set(color || '#ffffff');
    c.position.set(...at); c.scale.setScalar(r);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...n).normalize());
    this.requestRender();
  }
  /** See-through colour over triangles of an object (what a click would fill); null clears it. */
  showPaintPreview(id, tris, color) {
    if (this.paintPreview) { this.scene.remove(this.paintPreview); this.paintPreview.geometry.dispose(); this.paintPreview.material.dispose(); this.paintPreview = null; }
    const e = id && this.bodies.get(id);
    if (e && tris?.length) {
      const T = e.data.triangles, idx = new Uint32Array(tris.length * 3);
      tris.forEach((t, i) => idx.set(T.subarray(3 * t, 3 * t + 3), 3 * i));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(e.data.vertices, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      this.paintPreview = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: color || '#ffffff', transparent: true, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      this.paintPreview.raycast = () => {};
      this.scene.add(this.paintPreview);
    }
    this.requestRender();
  }
  /** What a paint stroke needs from a pointer hit: the object, the point, the face's direction and the view's. */
  paintHit(hit) {
    if (!hit) return null;
    const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 0, 1);
    return { body: hit.object.userData.bodyId, point: hit.point.toArray(), normal: n.toArray(), dir: this.raycaster.ray.direction.toArray(), tri: hit.faceIndex, wpp: this.worldPerPixel(hit.point) };
  }

  hitBody(e) {
    this.setPointer(e);
    const meshes = [];
    for (const [id, en] of this.bodies) if (!this.props?.[id]?.hidden) meshes.push(en.mesh);
    return this.raycaster.intersectObjects(meshes, false)[0] || null;
  }

  bindPointer() {
    const dom = this.renderer.domElement;
    let down = null;
    // Fingers: a tap picks, touch-and-hold then drag moves an object, any other swipe or pinch moves the camera
    // (the camera controls see every finger). Mouse and pen work as before: press on an object and drag it.
    const touches = new Set();
    let hold = null, lastTap = null, lastTouch = 0;
    const startDrag = (id, e, hitPoint, additive) => {
      this.orbit.enabled = false;
      this.drag = { id, x: e.clientX, y: e.clientY, started: false, z0: hitPoint.z, p0: hitPoint.clone(), shift: e.shiftKey, additive };
      try { dom.setPointerCapture(e.pointerId); } catch { /* */ }
    };
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        if (palm(e)) { e.stopImmediatePropagation(); return; } // a palm while the pen is in use
        touches.add(e.pointerId);
        if (touches.size > 1) { clearTimeout(hold?.timer); hold = null; this.cancelDrag(); down = null; return; } // two fingers: the camera
        down = { x: e.clientX, y: e.clientY, button: 0, moved: false, touch: true };
        if (this.mode !== 'select') return;
        const hit = this.hitBody(e);
        if (hit) {
          const at = { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, shiftKey: false };
          hold = { id: hit.object.userData.bodyId, point: hit.point.clone(), timer: setTimeout(() => {
            if (!hold || touches.size !== 1) return;
            startDrag(hold.id, at, hold.point, mods.multi);
            navigator.vibrate?.(12);
          }, 380) };
        }
        return;
      }
      down = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
      if (e.button !== 0) return;
      if (this.mode === 'paint') {
        // on an object: paint (the view stays still); beside it: turn the view as usual
        const hit = this.paintHit(this.hitBody(e));
        if (hit && this.hooks.onPaint?.('down', hit, e)) {
          this.paintPainting = true; this.orbit.enabled = false;
          try { dom.setPointerCapture(e.pointerId); } catch { /* */ }
          e.stopImmediatePropagation();
        }
        return;
      }
      if (this.mode !== 'select') return;
      const hit = this.hitBody(e);
      if (hit) {
        const id = hit.object.userData.bodyId;
        this.orbit.enabled = false;
        startDrag(id, e, hit.point, e.ctrlKey || e.metaKey || e.shiftKey || mods.multi);
      }
    }, { capture: true });

    dom.addEventListener('pointermove', (e) => {
      if (this.mode === 'paint' && e.pointerType !== 'touch') {
        if (this.paintPainting || !e.buttons) this.hooks.onPaint?.(this.paintPainting ? 'drag' : 'hover', this.paintHit(this.hitBody(e)), e);
        if (this.paintPainting) return;
      }
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > (down.touch ? 10 : 4)) { down.moved = true; if (hold && !this.drag) { clearTimeout(hold.timer); hold = null; } }
      const d = this.drag;
      if (d) {
        if (!d.started) {
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
          d.started = true;
          if (!this.selection.includes(d.id)) this.hooks.onSelect?.(d.id, d.additive);
          this.dragging = true; this.clearHandles();
          d.ids = this.selection.slice();
          this.hooks.onDragState?.(true);
        }
        this.setPointer(e);
        let delta;
        if (d.shift) {
          delta = new THREE.Vector3(0, 0, (d.y - e.clientY) * this.worldPerPixel(d.p0));
          if (this.grid > 0) delta.z = Math.round(delta.z / this.grid) * this.grid;
        } else {
          const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -d.z0);
          const p = new THREE.Vector3();
          if (!this.raycaster.ray.intersectPlane(plane, p)) return;
          delta = p.sub(d.p0); delta.z = 0;
          if (this.grid > 0) { delta.x = Math.round(delta.x / this.grid) * this.grid; delta.y = Math.round(delta.y / this.grid) * this.grid; }
        }
        delta = this.snapToObjects(d.ids, delta, d.shift ? [2] : [0, 1], e.altKey);
        d.delta = delta;
        this.applyPreview(d.ids, new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z));
        this.hooks.onDragLive?.('move', delta);
        return;
      }
      if (e.buttons) return;
      this.hover(e);
    });

    const finish = (e) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId); lastTouch = Date.now();
        if (hold) clearTimeout(hold.timer);
        const tapped = hold?.id ?? null; hold = null;
        if (!this.drag) {
          if (down?.touch && !down.moved && touches.size === 0 && e.type === 'pointerup') {
            if (this.mode !== 'select') this.doPick(e);
            // (times from the events themselves: a slow redraw after the first tap must not stretch the gap)
            else if (tapped && lastTap && lastTap.id === tapped && e.timeStamp - lastTap.t < 450) { lastTap = null; this.hooks.onDoubleClick?.(tapped); }
            else { lastTap = { id: tapped, t: e.timeStamp }; this.hooks.onSelect?.(tapped, mods.multi); }
          }
          if (!touches.size) down = null;
          return;
        }
      }
      if (this.paintPainting) {
        this.paintPainting = false; this.orbit.enabled = true; down = null;
        try { dom.releasePointerCapture(e.pointerId); } catch { /* */ }
        this.hooks.onPaint?.('up', null, e);
        return;
      }
      const d = this.drag;
      if (d) {
        this.drag = null;
        this.setSnapGuides(null);
        this.orbit.enabled = true;
        try { dom.releasePointerCapture(e.pointerId); } catch { /* */ }
        if (d.started) {
          this.dragging = false;
          this.hooks.onDragState?.(false);
          if (d.delta && d.delta.lengthSq() > 0) this.hooks.onTransformCommit?.(d.ids, new THREE.Matrix4().makeTranslation(d.delta.x, d.delta.y, d.delta.z), { mode: 'translate' });
          else this.updateGizmo();
        } else this.hooks.onSelect?.(d.id, d.additive);
        down = null;
        return;
      }
      if (down && !down.moved && down.button === 0 && e.type === 'pointerup') {
        if (this.mode === 'select') this.hooks.onSelect?.(null, e.ctrlKey || e.metaKey || e.shiftKey || mods.multi);
        else this.doPick(e);
      }
      down = null;
    };
    dom.addEventListener('pointerup', finish);
    dom.addEventListener('pointercancel', finish);
    dom.addEventListener('dblclick', (e) => {
      if (this.mode !== 'select' || Date.now() - lastTouch < 700) return; // a finger's double tap was handled above
      const hit = this.hitBody(e);
      if (hit) this.hooks.onDoubleClick?.(hit.object.userData.bodyId);
    });
    dom.addEventListener('pointerleave', (e) => { if (this.mode === 'paint' && !this.paintPainting) this.hooks.onPaint?.('hover', null, e); if (this.pick?.hover) { this.pick.hover = null; this.refreshPickOverlay(); } });
  }

  /** A second finger came down while an object was being dragged: put it back, the fingers move the camera. */
  cancelDrag() {
    const d = this.drag; if (!d) return;
    this.drag = null; this.setSnapGuides(null); this.orbit.enabled = true;
    if (d.started) { if (d.ids) this.applyPreview(d.ids, new THREE.Matrix4()); this.dragging = false; this.hooks.onDragState?.(false); this.updateGizmo(); }
  }

  startHandleDrag(h, e) {
    const L = this.hudLayout(); if (!L) return;
    this.orbit.enabled = false;
    const base = { x: e.clientX, y: e.clientY, ids: this.selection.slice() };
    if (h.type === 'rot') {
      const ring = L.rot[h.ring];
      this.handleDrag = { ...base, h: { ...h, axis: ring.axis.clone(), ai: ring.ai, tan: ring.tan, pxPerRad: ring.pxPerRad }, anchor: L.rot.c.clone(), startQuat: this.planeEdit ? this.planeQuat() : null };
      this.setActiveAxis(ring.ai);
    } else if (h.type === 'planemove') {
      this.handleDrag = { ...base, h, anchor: L.plane.p.clone(), n: L.plane.n.clone(), off0: this.planeEdit.off || 0 };
    } else {
      const box = L.box, c = L.c;
      let anchor = c.clone(), info = {};
      if (h.type === 'lift') anchor = new THREE.Vector3(c.x, c.y, h.at === 'top' ? box.max.z : box.min.z);
      if (h.type === 'edge') {
        let ax, sign;
        if (h.side === 'top' || h.side === 'bottom') { ax = 2; sign = h.side === 'top' ? 1 : -1; }
        else { ax = L.lrAx; sign = (h.side === 'right' ? 1 : -1) * L.lrSign; }
        anchor = c.clone(); anchor.setComponent(ax, sign > 0 ? box.max.getComponent(ax) : box.min.getComponent(ax));
        info = { ax, sign };
      }
      if (h.type === 'depth') { anchor = L.depth.p.clone(); info = { ax: L.depth.ax, sign: L.depth.sign }; }
      if (h.type === 'face') { anchor = c.clone(); anchor.setComponent(h.ax, h.sign > 0 ? box.max.getComponent(h.ax) : box.min.getComponent(h.ax)); info = { ax: h.ax, sign: h.sign }; }
      let slideAxis = 0;
      if (h.type === 'slide') {
        slideAxis = h.ax ?? (h.at === 'depth' ? L.depth.ax : L.lrAx);
        if (h.ax != null) { anchor = c.clone(); anchor.setComponent(h.ax, h.sign > 0 ? box.max.getComponent(h.ax) : box.min.getComponent(h.ax)); }
      }
      const corner = h.type === 'corner' ? { x: (h.at[1] === 'l' ? L.r.x0 : L.r.x1) + L.rect.left, y: (h.at[0] === 't' ? L.r.y0 : L.r.y1) + L.rect.top } : null;
      const center = { x: (L.r.x0 + L.r.x1) / 2 + L.rect.left, y: (L.r.y0 + L.r.y1) / 2 + L.rect.top };
      this.handleDrag = { ...base, h: { ...h, ...info, slideAxis }, box, anchor, corner, center };
      { const ax = this.handleAxis(h, L); if (ax != null) this.setActiveAxis(ax); }
    }
    this.hud.style.display = 'none';
    this.hooks.onDragState?.(true);
  }

  /**
   * Objects being moved snap flush against other objects (face to face, zero gap), line up with their edges,
   * and sit on the floor or on top of other objects, whenever they come within a few pixels.
   * Snapping to objects wins over the grid.
   */
  snapToObjects(ids, delta, axes, free) {
    this.setSnapGuides(null);
    if (free) return delta; // Alt held: no snapping at all
    const box = this.selectionBox(ids); if (box.isEmpty()) return delta;
    const moved = box.clone().translate(delta);
    const reach = this.worldPerPixel(moved.getCenter(new THREE.Vector3())) * 10;
    const others = [];
    for (const [id, e] of this.bodies) {
      if (ids.includes(id) || this.props?.[id]?.hidden) continue;
      others.push({ box: new THREE.Box3(new THREE.Vector3(...e.data.bbox[0]), new THREE.Vector3(...e.data.bbox[1])), circles: this.circleCenters(e) });
    }
    const out = delta.clone(), guides = [];
    const c = moved.getCenter(new THREE.Vector3());
    // 1) on the floor: the middle of what you drag lands on the middle of a hole or round edge (a screw over a hole)
    if (axes.includes(0) && axes.includes(1)) {
      let best = null, bd = reach * 1.2;
      for (const o of others) for (const q of [...o.circles, o.box.getCenter(new THREE.Vector3())]) {
        const d = Math.hypot(q.x - c.x, q.y - c.y); if (d < bd) { bd = d; best = q; }
      }
      if (best) {
        out.x += best.x - c.x; out.y += best.y - c.y;
        guides.push({ kind: 'point', p: new THREE.Vector3(best.x, best.y, Math.max(best.z, moved.min.z)) });
        this.setSnapGuides(guides); return out;
      }
    }
    for (const ax of axes) {
      const lo = moved.min.getComponent(ax), hi = moved.max.getComponent(ax), mid = (lo + hi) / 2;
      let best = null, guide = null;
      const consider = (shift, at) => { if (Math.abs(shift) <= reach && (best === null || Math.abs(shift) < Math.abs(best) - 1e-9)) { best = shift; guide = at; } };
      if (ax === 2) consider(-lo, null); // the floor
      for (const o of others) {
        const ob = o.box, olo = ob.min.getComponent(ax), ohi = ob.max.getComponent(ax), omid = (olo + ohi) / 2;
        // objects next to it along the other directions: flush face to face, or edges lined up
        const near = [0, 1, 2].every((k) => k === ax || (moved.min.getComponent(k) <= ob.max.getComponent(k) + reach && moved.max.getComponent(k) >= ob.min.getComponent(k) - reach));
        if (near) { consider(ohi - lo, null); consider(olo - hi, null); consider(olo - lo, null); consider(ohi - hi, null); }
        // any object anywhere: line up edges and middles (a dotted guide line shows it)
        if (ax !== 2) {
          for (const [mine, theirs] of [[lo, olo], [hi, ohi], [lo, ohi], [hi, olo], [mid, omid]]) consider(theirs - mine, { ax, v: theirs, o: ob });
          for (const q of o.circles) consider(q.getComponent(ax) - mid, { ax, v: q.getComponent(ax), o: ob });
        }
      }
      if (best !== null) { out.setComponent(ax, out.getComponent(ax) + best); if (guide) guides.push({ kind: 'line', ...guide }); }
    }
    if (guides.length) {
      const fin = box.clone().translate(out);
      this.setSnapGuides(guides.map((g) => ({ ...g, me: fin })));
    }
    return out;
  }

  /** Centers of the round edges of an object (holes, cylinders), worked out once from its edge lines. */
  circleCenters(e) {
    const d = e.data; if (d._circles) return d._circles;
    const out = [];
    if (d.lines && d.edgeRanges) {
      const L = d.lines, R = d.edgeRanges;
      for (let k = 0; k < R.length / 2; k++) {
        const start = R[2 * k], count = R[2 * k + 1]; if (count < 12) continue;
        const a = start * 3, b = (start + count - 1) * 3;
        if (Math.hypot(L[a] - L[b], L[a + 1] - L[b + 1], L[a + 2] - L[b + 2]) > 1e-3) continue; // not a closed loop
        const cen = new THREE.Vector3(); for (let i = 0; i < count; i++) cen.add(new THREE.Vector3(L[(start + i) * 3], L[(start + i) * 3 + 1], L[(start + i) * 3 + 2]));
        cen.divideScalar(count);
        let rmin = Infinity, rmax = 0;
        for (let i = 0; i < count; i++) { const r = Math.hypot(L[(start + i) * 3] - cen.x, L[(start + i) * 3 + 1] - cen.y, L[(start + i) * 3 + 2] - cen.z); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
        if (rmax > 0.2 && rmax - rmin < rmax * 0.03) out.push(cen); // round
      }
    }
    d._circles = out;
    return out;
  }

  /** Dotted purple guides showing what a dragged object lined up with (gone when the drag ends). */
  setSnapGuides(list) {
    if (this.snapGuides) { this.scene.remove(this.snapGuides); this.snapGuides.traverse((o) => o.geometry?.dispose()); this.snapGuides = null; }
    if (!list?.length) { this.requestRender(); return; }
    const g = new THREE.Group(), pts = [];
    for (const it of list) {
      if (it.kind === 'point') {
        const r = this.worldPerPixel(it.p) * 12, z = it.p.z + 0.05;
        pts.push(it.p.x - r, it.p.y, z, it.p.x + r, it.p.y, z, it.p.x, it.p.y - r, z, it.p.x, it.p.y + r, z);
        continue;
      }
      // a line across both objects at the lined-up spot, just above the floor
      const other = it.ax === 0 ? 1 : 0, z = 0.05;
      const a = Math.min(it.me.min.getComponent(other), it.o.min.getComponent(other)) - 5, b = Math.max(it.me.max.getComponent(other), it.o.max.getComponent(other)) + 5;
      const p1 = [0, 0, z], p2 = [0, 0, z]; p1[it.ax] = it.v; p2[it.ax] = it.v; p1[other] = a; p2[other] = b;
      pts.push(...p1, ...p2);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({ color: 0x7a4fd0, dashSize: 2, gapSize: 1.5, depthTest: false, transparent: true }));
    line.computeLineDistances(); line.renderOrder = 10;
    g.add(line); this.scene.add(g); this.snapGuides = g; this.requestRender();
  }

  axisDelta(anchor, dir, dx, dy) {
    // mouse movement converted to distance along a world direction
    const a = this.toScreen(anchor), b = this.toScreen(anchor.clone().add(dir));
    const sv = b.sub(a); const len = sv.length();
    if (len < 1e-6) return 0;
    return (dx * sv.x + dy * sv.y) / len / len;
  }

  moveHandleDrag(e) {
    const hd = this.handleDrag; if (!hd) return;
    const h = hd.h;
    const dx = e.clientX - hd.x, dy = e.clientY - hd.y;
    const snap = (v) => (this.grid > 0 ? Math.round(v / this.grid) * this.grid : v);
    if (h.type === 'rot') {
      const len = Math.hypot(h.tan.x, h.tan.y) || 1;
      let deg = THREE.MathUtils.radToDeg(((dx * h.tan.x + dy * h.tan.y) / len) / (h.pxPerRad || 1));
      if (this.rotSnap > 0) deg = Math.round(deg / this.rotSnap) * this.rotSnap;
      const ang = THREE.MathUtils.degToRad(deg);
      if (this.planeEdit) {
        const q = new THREE.Quaternion().setFromAxisAngle(h.axis, ang).multiply(hd.startQuat);
        const eu = new THREE.Euler().setFromQuaternion(q, 'ZYX');
        const r = (a) => Math.round(THREE.MathUtils.radToDeg(a) * 100) / 100;
        Object.assign(this.planeEdit, { roll: r(eu.x), pitch: r(eu.y), yaw: r(eu.z) });
        this.updatePlane();
        hd.planeChanged = true;
        this.hooks.onPlaneLive?.(this.planeEdit);
        return;
      }
      const c = hd.anchor;
      const M = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationAxis(h.axis, ang)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      hd.M = M; hd.info = { mode: 'rotate' };
      this.applyPreview(hd.ids, M);
      const v = [0, 0, 0]; v[h.ai] = deg;
      this.hooks.onDragLive?.('rotate', v);
      return;
    }
    if (h.type === 'planemove') {
      const d = snap(this.axisDelta(hd.anchor, hd.n, dx, dy));
      this.planeEdit.off = Math.round((hd.off0 + d) * 1000) / 1000;
      this.updatePlane();
      hd.planeChanged = true;
      this.hooks.onPlaneLive?.(this.planeEdit);
      return;
    }
    const box = hd.box;
    let M, info;
    if (h.type === 'lift') {
      const v = this.snapToObjects(hd.ids, new THREE.Vector3(0, 0, snap(-dy * this.worldPerPixel(hd.anchor))), [2], e.altKey);
      M = new THREE.Matrix4().makeTranslation(0, 0, v.z);
      info = { mode: 'translate', delta: v };
    } else if (h.type === 'slide') {
      const dir = new THREE.Vector3(); dir.setComponent(h.slideAxis, 1);
      const d = snap(this.axisDelta(hd.anchor, dir, dx, dy));
      let v = new THREE.Vector3(); v.setComponent(h.slideAxis, d);
      v = this.snapToObjects(hd.ids, v, [h.slideAxis], e.altKey);
      M = new THREE.Matrix4().makeTranslation(v.x, v.y, 0);
      info = { mode: 'translate', delta: v };
    } else {
      const size = box.getSize(new THREE.Vector3());
      const s = new THREE.Vector3(1, 1, 1);
      const pivot = box.getCenter(new THREE.Vector3()); pivot.z = box.min.z;
      if (h.type === 'edge' || h.type === 'depth' || h.type === 'face') {
        // X and Y size from the middle (the arrow follows the pointer, the opposite side moves the same the other way,
        // so the object doesn't wander); Z keeps the opposite side still, so an object on the floor stays on it
        const ax = h.ax, sg = h.sign, both = ax < 2;
        if (!both) pivot.setComponent(ax, sg > 0 ? box.min.getComponent(ax) : box.max.getComponent(ax));
        const dir = new THREE.Vector3(); dir.setComponent(ax, sg);
        const ext0 = size.getComponent(ax) || 1;
        const ext = Math.max(0.1, snap(ext0 + (both ? 2 : 1) * this.axisDelta(hd.anchor, dir, dx, dy)));
        const f = ext / ext0;
        if (this.lockScale) s.setScalar(f); else s.setComponent(ax, f);
      } else {
        const vx = hd.corner.x - hd.center.x, vy = hd.corner.y - hd.center.y;
        const L0 = Math.hypot(vx, vy) || 1;
        let f = Math.max(0.01, (L0 + (dx * vx + dy * vy) / L0) / L0);
        const ref = Math.max(size.x, size.y, size.z);
        if (this.grid > 0) f = Math.max(this.grid, Math.round((ref * f) / this.grid) * this.grid) / ref;
        s.setScalar(f);
      }
      M = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      info = { mode: 'scale', scale: s, pivot: pivot.toArray(), size: new THREE.Vector3(size.x * s.x, size.y * s.y, size.z * s.z) };
    }
    hd.M = M; hd.info = info;
    this.applyPreview(hd.ids, M);
    this.hooks.onDragLive?.(info.mode === 'scale' ? 'scale' : 'move', info.mode === 'scale' ? info.size : info.delta);
  }

  endHandleDrag() {
    const hd = this.handleDrag; this.handleDrag = null; this.setSnapGuides(null);
    this.orbit.enabled = true;
    this.hud.style.display = '';
    this.hooks.onDragState?.(false);
    if (hd?.planeChanged) { this.hooks.onPlaneLive?.(this.planeEdit, true); this.updateGizmo(); return; }
    if (hd?.M && !hd.M.equals(new THREE.Matrix4())) this.hooks.onTransformCommit?.(hd.ids, hd.M, hd.info);
    else this.updateGizmo();
  }

  // like 3D Builder's double-click: same viewing angle, but fly in (or out) so the objects sit centered and fill the view.
  // cycle: double-clicking the same objects again (view not moved since) goes in to half that distance, then back out.
  centerOn(ids, cycle = false) {
    const box = this.selectionBox(ids); if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 2);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (radius / Math.sin(fov / 2)) * (this.camera.aspect < 1 ? 1 / this.camera.aspect : 1) * 1.25;
    const key = [...ids].sort().join(','), last = this.flyCycle;
    // still exactly where the last double-click put the view (or flying there)? then take the next step
    const end = this.anim?.p1 || this.camera.position, endT = this.anim?.c1 || this.orbit.target;
    const same = cycle && last && last.key === key && end.distanceTo(last.p) < 1e-3 * Math.max(1, dist) && endT.distanceTo(last.c) < 1e-3 * Math.max(1, dist);
    const level = same ? (last.level + 1) % 2 : 0;
    const p1 = c.clone().add(dir.multiplyScalar(level ? dist / 2 : dist));
    this.flyCycle = cycle ? { key, level, p: p1.clone(), c: c.clone() } : null;
    this.anim = { t0: performance.now(), dur: 450, p0: this.camera.position.clone(), p1, c0: this.orbit.target.clone(), c1: c };
  }

  hover(e) {
    const dom = this.renderer.domElement;
    if (this.mode === 'paint') return;
    if (this.mode === 'select') {
      dom.style.cursor = this.hitBody(e) ? 'pointer' : 'default';
      return;
    }
    if (!this.pick) { dom.style.cursor = 'default'; return; }
    const h = this.pickAt(e);
    const prev = this.pick.hover;
    const same = (a, b) => (!a && !b) || (a && b && a.body === b.body && a.index === b.index);
    if (!same(prev, h)) { this.pick.hover = h; this.refreshPickOverlay(); }
    dom.style.cursor = h ? 'pointer' : 'default';
  }

  // ---------------- picking edges / faces ----------------
  /** meshes: faces can also be flat areas of meshes (hits then carry `area`, one of meshAreas' areas) */
  startPick(kind, bodyFilter, items = [], { meshes = false } = {}) {
    this.mode = 'pick';
    this.pick = { kind, bodyFilter, items, hover: null, meshes };
    this.clearHandles();
    this.updateStyles();
    this.refreshPickOverlay();
  }
  setPickItems(items) { if (this.pick) { this.pick.items = items; this.refreshPickOverlay(); } }
  endPick() {
    this.mode = 'select'; this.pick = null;
    this.clearOverlay();
    this.renderer.domElement.style.cursor = 'default';
    this.updateStyles();
    this.updateGizmo();
  }

  ensurePickLines(e) {
    if (e.pickLines || !e.data.solid) return e.pickLines;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(e.data.lines, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ visible: false }));
    l.userData.bodyId = e.id;
    e.pickLines = l;
    e.group.add(l);
    return l;
  }

  pickAt(e) {
    this.setPointer(e);
    const p = this.pick; if (!p) return null;
    const entries = [...this.bodies.values()].filter((en) => !this.props?.[en.id]?.hidden && (!p.bodyFilter || p.bodyFilter(en.id)) && (p.kind === 'point' || en.data.solid || (p.meshes && p.kind === 'face')));
    const meshHit = this.raycaster.intersectObjects(entries.map((en) => en.mesh), false)[0];
    if (p.kind === 'point') {
      if (!meshHit) return null;
      const entry = this.bodies.get(meshHit.object.userData.bodyId);
      const point = meshHit.point.clone(); const threshold = this.worldPerPixel(point) * 9;
      const indices = entry.data.triangles.subarray(meshHit.faceIndex * 3, meshHit.faceIndex * 3 + 3);
      let nearest = threshold;
      for (const index of indices) {
        const vertex = new THREE.Vector3(...entry.data.vertices.subarray(index * 3, index * 3 + 3)).applyMatrix4(entry.mesh.matrixWorld);
        const distance = vertex.distanceTo(meshHit.point);
        if (distance < nearest) { point.copy(vertex); nearest = distance; }
      }
      return { body: entry.id, index: meshHit.faceIndex, point: point.toArray() };
    }
    if (p.kind === 'face') {
      if (!meshHit) return null;
      const en = this.bodies.get(meshHit.object.userData.bodyId);
      if (!en.data.solid) {
        // a mesh: the flat area around the triangle (numbered after any solid face, so items stay comparable)
        const M = meshAreas(en.data), ai = M.areaOf[meshHit.faceIndex];
        return { body: en.id, index: 1e9 + ai, point: meshHit.point.toArray(), area: M.areas[ai], normal: M.normal(meshHit.faceIndex) };
      }
      const fi = rangeIndex(en.data.faceRanges, meshHit.faceIndex * 3);
      return fi < 0 ? null : { body: en.id, index: fi, point: meshHit.point.toArray() };
    }
    const wpp = this.worldPerPixel(meshHit ? meshHit.point : undefined);
    this.raycaster.params.Line = { threshold: wpp * 7 };
    const lines = entries.map((en) => this.ensurePickLines(en)).filter(Boolean);
    const hits = this.raycaster.intersectObjects(lines, false);
    let best = null;
    for (const h of hits) {
      if (meshHit && h.distance > meshHit.distance + wpp * 12) continue;
      const en = this.bodies.get(h.object.userData.bodyId);
      const ei = rangeIndex(en.data.edgeRanges, h.index);
      if (ei < 0) continue;
      const dpx = h.distanceToRay ?? 0;
      if (!best || dpx < best.dpx - 1e-9) best = { body: en.id, index: ei, dpx, point: h.point.toArray() };
    }
    return best ? { body: best.body, index: best.index, point: best.point } : null;
  }

  doPick(e) { const h = this.pickAt(e); if (h) this.hooks.onPick?.(this.pick.kind, h, e); }

  clearOverlay() {
    while (this.overlay.children.length) { const o = this.overlay.children.pop(); o.geometry?.dispose(); }
    this.requestRender();
  }

  refreshPickOverlay() {
    this.clearOverlay();
    const p = this.pick; if (!p || p.kind === 'point') return;
    const draw = (it, hover) => {
      const en = this.bodies.get(it.body); if (!en) return;
      if (it.area && !en.data.solid) {
        const T = en.data.triangles, idx = new Uint32Array(it.area.tris.length * 3);
        it.area.tris.forEach((t, i) => idx.set(T.subarray(3 * t, 3 * t + 3), 3 * i));
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(en.data.vertices, 3));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        this.overlay.add(new THREE.Mesh(g, hover ? this.faceMatHover : this.faceMat));
        return;
      }
      if (!en.data.solid) return;
      if (p.kind === 'edge') {
        const r = en.data.edgeRanges; const start = r[2 * it.index], count = r[2 * it.index + 1];
        const seg = en.data.lines.subarray(start * 3, (start + count) * 3); if (!seg.length) return;
        const g = new LineSegmentsGeometry(); g.setPositions(seg);
        const l = new LineSegments2(g, hover ? this.lineMatHover : this.lineMat);
        l.renderOrder = 10;
        this.overlay.add(l);
      } else {
        const r = en.data.faceRanges; const start = r[2 * it.index], count = r[2 * it.index + 1];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(en.data.vertices, 3));
        g.setIndex(new THREE.BufferAttribute(en.data.triangles.slice(start, start + count), 1));
        this.overlay.add(new THREE.Mesh(g, hover ? this.faceMatHover : this.faceMat));
      }
    };
    for (const it of p.items) draw(it, false);
    if (p.hover && !p.items.some((i) => i.body === p.hover.body && i.index === p.hover.index)) draw(p.hover, true);
    this.requestRender();
  }
}

function rangeIndex(ranges, v) {
  for (let i = 0; i < ranges.length / 2; i++) { const s = ranges[2 * i], c = ranges[2 * i + 1]; if (v >= s && v < s + c) return i; }
  return -1;
}
