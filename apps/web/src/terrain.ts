import * as THREE from "three";
import { LocalFrame, lat2tile, lon2tile, tile2lat, tile2lon } from "./geo";
import type { Ground } from "./ground";
import type { Imagery } from "./imagery";
import type { ChurchScene } from "./scene";

/**
 * Open terrain for the exterior view: TINITALY heights (public/terrain/dem.*,
 * built by pipeline/terrain_dem.py) draped with XYZ imagery tiles (imagery.ts).
 *
 * Level of detail: a quadtree of Web Mercator tiles over the DEM area. A tile
 * splits when the camera is close relative to its size; the parent stays on
 * screen until all four children have their imagery, then hands over.
 * Each tile is a small height-mapped grid with a skirt hanging below its
 * edges, hiding cracks between neighbours at different levels.
 */

interface DemMeta {
  south: number;
  north: number;
  west: number;
  east: number;
  rows: number;
  cols: number;
  base: number;
  scale: number;
  source: string;
  license: string;
}

interface Node {
  z: number;
  x: number;
  y: number;
  centre: THREE.Vector3;
  radius: number;
  mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  state: "idle" | "queued" | "loading" | "ready";
  children?: Node[];
  lastUsed: number;
  priority: number;
  failures: number;
}

const ROOT_ZOOM = 12;
const SEGMENTS = 24;
const SPLIT_FACTOR = 1.6; // split when distance < size × factor
const MAX_LOADING = 6;
const PRUNE_AFTER_MS = 8000;
const SKIRT_RATIO = 0.04; // skirt depth relative to tile size
const MAX_FAILURES = 3; // then show the tile without imagery
const RETRY_MS = 2000;

export class OpenTerrain implements Ground {
  readonly object = new THREE.Group();
  private frame: LocalFrame;
  private dem?: { meta: DemMeta; h: Uint16Array };
  private roots: Node[] = [];
  private loading = 0;
  private queue = new Set<Node>();
  private changeCbs: (() => void)[] = [];
  private materialCbs: ((m: THREE.Material) => void)[] = [];
  private materials = new Set<THREE.Material>();
  private textureLoader = new THREE.TextureLoader().setCrossOrigin("anonymous");
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private sphere = new THREE.Sphere();

  constructor(
    private world: ChurchScene,
    lat0: number,
    lon0: number,
    /** Sea-level height of the scene origin (y = 0). */
    private originHeight: number,
    private imagery: Imagery,
    onError: (error: unknown) => void,
  ) {
    this.frame = new LocalFrame(lat0, lon0);
    this.object.name = "open-terrain";
    world.scene.add(this.object);
    this.loadDem().catch(onError);
    world.beforeFrame(() => {
      if (this.object.visible && this.dem) this.update();
    });
  }

  get ready() {
    return !!this.dem;
  }
  get visible() {
    return this.object.visible;
  }
  set visible(v: boolean) {
    this.object.visible = v;
  }

  /** Swap the imagery source; tiles reload progressively. */
  setImagery(imagery: Imagery) {
    if (imagery.id === this.imagery.id) return;
    this.imagery = imagery;
    for (const r of this.roots) this.dispose(r, true);
    this.roots = this.makeRoots();
  }

  toScene(lat: number, lng: number, target = new THREE.Vector3()) {
    return this.frame.toScene(lat, lng, target);
  }
  toLatLng(p: THREE.Vector3) {
    return this.frame.toLatLng(p);
  }
  groundAt(x: number, z: number) {
    const { lat, lng } = this.frame.toLatLng(new THREE.Vector3(x, 0, z));
    const h = this.heightAt(lat, lng);
    return h === undefined ? undefined : h - this.originHeight;
  }
  onChange(cb: () => void) {
    this.changeCbs.push(cb);
    if (this.dem) cb();
  }
  onMaterial(cb: (m: THREE.Material) => void) {
    this.materialCbs.push(cb);
    for (const m of this.materials) cb(m);
  }
  renderAttributions(el: HTMLElement) {
    const text = `${this.imagery.attribution} · Terreno: TINITALY 1.1, INGV (CC BY 4.0)`;
    if (el.textContent !== text) el.textContent = text;
  }

  // --- DEM -----------------------------------------------------------------

  private async loadDem() {
    const base = `${import.meta.env.BASE_URL}terrain/`;
    const [meta, buf] = await Promise.all([
      fetch(`${base}dem.json`).then((r) => {
        if (!r.ok) throw new Error(`dem.json: HTTP ${r.status}`);
        return r.json() as Promise<DemMeta>;
      }),
      fetch(`${base}dem.bin`).then((r) => {
        if (!r.ok) throw new Error(`dem.bin: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    this.dem = { meta, h: new Uint16Array(buf) };
    this.roots = this.makeRoots();
    for (const cb of this.changeCbs) cb();
  }

  /** Bilinear height (m a.s.l.) at lat/lon, undefined outside the DEM. */
  private heightAt(lat: number, lon: number): number | undefined {
    if (!this.dem) return;
    const { meta, h } = this.dem;
    const fc = ((lon - meta.west) / (meta.east - meta.west)) * (meta.cols - 1);
    const fr = ((lat - meta.south) / (meta.north - meta.south)) * (meta.rows - 1);
    if (fc < 0 || fr < 0 || fc > meta.cols - 1 || fr > meta.rows - 1) return;
    const c0 = Math.min(Math.floor(fc), meta.cols - 2);
    const r0 = Math.min(Math.floor(fr), meta.rows - 2);
    const tc = fc - c0;
    const tr = fr - r0;
    const i = r0 * meta.cols + c0;
    const v =
      h[i] * (1 - tc) * (1 - tr) + h[i + 1] * tc * (1 - tr) + h[i + meta.cols] * (1 - tc) * tr + h[i + meta.cols + 1] * tc * tr;
    return meta.base + v * meta.scale;
  }

  // --- Quadtree ------------------------------------------------------------

  private makeRoots(): Node[] {
    const m = this.dem!.meta;
    const x0 = Math.floor(lon2tile(m.west, ROOT_ZOOM));
    const x1 = Math.floor(lon2tile(m.east, ROOT_ZOOM));
    const y0 = Math.floor(lat2tile(m.north, ROOT_ZOOM));
    const y1 = Math.floor(lat2tile(m.south, ROOT_ZOOM));
    const roots: Node[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) roots.push(this.makeNode(ROOT_ZOOM, x, y));
    return roots;
  }

  private makeNode(z: number, x: number, y: number): Node {
    const m = this.dem!.meta;
    const clampLat = (v: number) => THREE.MathUtils.clamp(v, m.south, m.north);
    const clampLon = (v: number) => THREE.MathUtils.clamp(v, m.west, m.east);
    const a = this.frame.toScene(clampLat(tile2lat(y, z)), clampLon(tile2lon(x, z)));
    const b = this.frame.toScene(clampLat(tile2lat(y + 1, z)), clampLon(tile2lon(x + 1, z)));
    const centre = a.clone().add(b).multiplyScalar(0.5);
    const latC = clampLat(tile2lat(y + 0.5, z));
    const lonC = clampLon(tile2lon(x + 0.5, z));
    centre.y = (this.heightAt(latC, lonC) ?? this.originHeight) - this.originHeight;
    return { z, x, y, centre, radius: a.distanceTo(b) / 2, state: "idle", lastUsed: 0, priority: 0, failures: 0 };
  }

  private update() {
    const now = performance.now();
    const cam = this.world.camera;
    cam.updateMatrixWorld();
    this.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const r of this.roots) this.visit(r, now, cam.position);
    this.pump();
  }

  private visit(node: Node, now: number, eye: THREE.Vector3) {
    node.lastUsed = now;
    const dist = Math.max(0, eye.distanceTo(node.centre) - node.radius);
    // Coarse levels first (something on screen quickly), then nearest first.
    node.priority = node.z * 10 + Math.min(9, dist / (node.radius + 1));
    this.request(node);

    this.sphere.set(node.centre, node.radius * 1.2);
    const wantSplit =
      node.z < this.imagery.maxZoom &&
      dist < node.radius * 2 * SPLIT_FACTOR &&
      this.frustum.intersectsSphere(this.sphere);

    if (wantSplit) {
      node.children ??= [0, 1, 2, 3].map((i) =>
        this.makeNode(node.z + 1, node.x * 2 + (i & 1), node.y * 2 + (i >> 1)),
      );
      for (const c of node.children) {
        c.lastUsed = now;
        this.request(c);
      }
      if (node.children.every((c) => c.state === "ready")) {
        if (node.mesh) node.mesh.visible = false;
        for (const c of node.children) this.visit(c, now, eye);
        return;
      }
    }
    if (node.mesh) node.mesh.visible = node.state === "ready";
    if (node.children) for (const c of node.children) this.hide(c, now);
  }

  /** Hide a subtree; free the parts that have been unused for a while. */
  private hide(node: Node, now: number) {
    if (node.mesh) node.mesh.visible = false;
    if (!node.children) return;
    for (const c of node.children) this.hide(c, now);
    if (node.children.every((c) => now - c.lastUsed > PRUNE_AFTER_MS && !c.children)) {
      for (const c of node.children) this.dispose(c, false);
      node.children = undefined;
    }
  }

  private dispose(node: Node, recursive: boolean) {
    if (recursive && node.children) for (const c of node.children) this.dispose(c, true);
    this.queue.delete(node);
    if (node.mesh) {
      this.object.remove(node.mesh);
      node.mesh.geometry.dispose();
      node.mesh.material.map?.dispose();
      node.mesh.material.dispose();
      this.materials.delete(node.mesh.material);
    }
    node.mesh = undefined;
    node.state = "idle";
  }

  private request(node: Node) {
    if (node.state === "idle") {
      node.state = "queued";
      this.queue.add(node);
    }
  }

  private pump() {
    if (this.loading >= MAX_LOADING || !this.queue.size) return;
    const next = [...this.queue].sort((a, b) => a.priority - b.priority).slice(0, MAX_LOADING - this.loading);
    for (const node of next) {
      this.queue.delete(node);
      this.load(node);
    }
  }

  private load(node: Node) {
    node.state = "loading";
    this.loading++;
    const imagery = this.imagery;
    const done = (texture: THREE.Texture | null) => {
      this.loading--;
      if (imagery !== this.imagery || node.state !== "loading") {
        texture?.dispose();
        return;
      }
      if (!texture && ++node.failures < MAX_FAILURES) {
        // Busy server (e.g. 503): back to the queue a bit later.
        setTimeout(() => {
          if (node.state === "loading") node.state = "idle";
        }, RETRY_MS * node.failures);
        return;
      }
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = this.world.renderer.capabilities.getMaxAnisotropy();
      }
      const material = new THREE.MeshBasicMaterial({ map: texture, color: texture ? 0xffffff : 0x6b6f5a });
      node.mesh = new THREE.Mesh(this.buildGeometry(node), material);
      node.mesh.visible = false;
      node.mesh.name = `terrain-${node.z}/${node.x}/${node.y}`;
      this.object.add(node.mesh);
      this.materials.add(material);
      for (const cb of this.materialCbs) cb(material);
      node.state = "ready";
    };
    this.textureLoader.load(
      imagery.url(node.z, node.x, node.y),
      (t) => done(t),
      undefined,
      () => done(null), // retried; after MAX_FAILURES: plain colour, keep the terrain
    );
  }

  /** Height grid for a tile (clamped to the DEM area) + skirt along its border. */
  private buildGeometry(node: Node) {
    const m = this.dem!.meta;
    const n = SEGMENTS;
    const verts = (n + 1) * (n + 1);
    const positions = new Float32Array((verts + 4 * n) * 3);
    const uvs = new Float32Array((verts + 4 * n) * 2);
    const v = new THREE.Vector3();
    const tileY0 = node.y;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const lon = THREE.MathUtils.clamp(tile2lon(node.x + i / n, node.z), m.west, m.east);
        const lat = THREE.MathUtils.clamp(tile2lat(tileY0 + j / n, node.z), m.south, m.north);
        this.frame.toScene(lat, lon, v);
        v.y = (this.heightAt(lat, lon) ?? this.originHeight) - this.originHeight;
        const k = j * (n + 1) + i;
        positions.set([v.x, v.y, v.z], k * 3);
        // UV from the (clamped) position inside the Mercator tile; image top = v 1.
        uvs[k * 2] = lon2tile(lon, node.z) - node.x;
        uvs[k * 2 + 1] = 1 - (lat2tile(lat, node.z) - tileY0);
      }
    }
    const index: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        index.push(a, c, b, b, c, d); // counter-clockwise seen from above
      }
    }
    // Skirt: walk the border clockwise, duplicate each vertex lower down.
    const border: number[] = [];
    for (let i = 0; i < n; i++) border.push(i); // top edge
    for (let j = 0; j < n; j++) border.push(j * (n + 1) + n); // right edge
    for (let i = n; i > 0; i--) border.push(n * (n + 1) + i); // bottom edge
    for (let j = n; j > 0; j--) border.push(j * (n + 1)); // left edge
    const depth = node.radius * 2 * SKIRT_RATIO + 2;
    border.forEach((src, s) => {
      const k = verts + s;
      positions.set([positions[src * 3], positions[src * 3 + 1] - depth, positions[src * 3 + 2]], k * 3);
      uvs.set([uvs[src * 2], uvs[src * 2 + 1]], k * 2);
    });
    for (let s = 0; s < border.length; s++) {
      const a = border[s];
      const b = border[(s + 1) % border.length];
      const a2 = verts + s;
      const b2 = verts + ((s + 1) % border.length);
      index.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2); // both faces: no culling surprises
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
  }
}
