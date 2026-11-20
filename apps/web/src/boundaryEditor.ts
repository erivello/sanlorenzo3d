import * as THREE from "three";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { BoundaryFeature, Ring, VillageBoundary } from "./boundary";
import type { Ground } from "./ground";
import { pickGround, segmentDistance, toScreen } from "./pick";
import type { ChurchScene } from "./scene";

/**
 * Dev-only editor for content/boundary.geojson, directly on the 3D terrain:
 *   drag a point          → move it
 *   click on a side       → add a point there (and keep dragging it)
 *   Alt+click on a point  → remove it
 *   Cmd/Ctrl+Z            → undo
 * "Salva" writes the file through the Vite dev API (/__sl3d/boundary), records
 * the manual edit in the feature's sources, and rebuilds the boundary in place.
 * Re-running pipeline/istat_boundary.py regenerates the file and drops these edits.
 */

type LngLat = [number, number];
/** One editable outer ring and where it lives in the FeatureCollection. */
interface EditRing {
  feature: number;
  polygon: number | null; // index inside a MultiPolygon, null for a Polygon
  points: LngLat[]; // open ring (no closing duplicate)
}

const VERTEX_PX = 10;
const EDGE_PX = 8;
const MIN_POINTS = 4;
const LIFT_M = 2;
const API = "/__sl3d/boundary";
const EDIT_NOTE = "confine ritoccato a mano nel viewer da un residente";

export class BoundaryEditor {
  active = false;
  private rings: EditRing[] = [];
  private history: string[] = [];
  private group = new THREE.Group();
  private lineMaterial = new LineMaterial({ color: 0xd9a35b, linewidth: 3, depthTest: false, transparent: true });
  private pointMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 9,
    sizeAttenuation: false,
    depthTest: false,
    transparent: true,
  });
  private hoverMaterial = new THREE.PointsMaterial({ color: 0xd9a35b, size: 14, sizeAttenuation: false, depthTest: false });
  private hover = new THREE.Points(new THREE.BufferGeometry(), this.hoverMaterial);
  private drag?: { ring: EditRing; index: number };
  private dirty = false;

  constructor(
    private world: ChurchScene,
    private ground: Ground,
    private boundary: VillageBoundary,
    private ui: { start: HTMLButtonElement; bar: HTMLElement; save: HTMLButtonElement; cancel: HTMLButtonElement; status: HTMLElement },
  ) {
    this.group.name = "boundary-editor";
    this.group.renderOrder = 10;
    this.hover.renderOrder = 11;
    this.group.add(this.hover);
    world.beforeFrame(() => {
      const c = world.renderer.domElement;
      this.lineMaterial.resolution.set(c.clientWidth, c.clientHeight);
    });
    ui.start.onclick = () => this.start();
    ui.cancel.onclick = () => this.stop();
    ui.save.onclick = () => this.save();

    // Capture phase on window: runs before OrbitControls sees the pointer.
    window.addEventListener("pointerdown", (e) => this.onDown(e), { capture: true });
    window.addEventListener("pointermove", (e) => this.onMove(e), { capture: true });
    window.addEventListener("pointerup", () => this.endDrag(), { capture: true });
    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        this.undo();
      } else if (e.key === "Escape") {
        this.stop();
      }
    });
  }

  // --- Session ---------------------------------------------------------------

  start() {
    if (this.active) return;
    this.rings = [];
    this.boundary.data.forEach((f, feature) => {
      const g = f.geometry;
      if (g.type === "Polygon") this.rings.push({ feature, polygon: null, points: open(g.coordinates[0]) });
      else g.coordinates.forEach((p, polygon) => this.rings.push({ feature, polygon, points: open(p[0]) }));
    });
    this.history = [];
    this.dirty = false;
    this.active = true;
    this.world.scene.add(this.group);
    this.boundary.outlineVisible = false;
    document.body.dataset.editing = "boundary";
    this.ui.bar.hidden = false;
    this.ui.start.hidden = true;
    this.setStatus("");
    this.redraw();
  }

  stop() {
    if (!this.active) return;
    if (this.dirty && !confirm("Uscire senza salvare le modifiche al confine?")) return;
    this.active = false;
    this.endDrag();
    this.world.scene.remove(this.group);
    this.boundary.outlineVisible = true;
    delete document.body.dataset.editing;
    this.ui.bar.hidden = true;
    this.ui.start.hidden = false;
    this.world.renderer.domElement.style.cursor = "";
  }

  private async save() {
    const features: BoundaryFeature[] = structuredClone(this.boundary.data as BoundaryFeature[]);
    for (const r of this.rings) {
      const closed: Ring = [...r.points.map(round), round(r.points[0])];
      const g = features[r.feature].geometry;
      if (g.type === "Polygon") g.coordinates[0] = closed;
      else g.coordinates[r.polygon!][0] = closed;
    }
    const today = new Date().toISOString().slice(0, 10);
    for (const f of features) {
      const p = f.properties;
      const note = `${EDIT_NOTE} (${today})`;
      p.sources = [...(p.sources ?? []).filter((s) => !s.startsWith(EDIT_NOTE)), note];
      if (!p.changes?.includes("ritocchi manuali")) p.changes = `${p.changes ?? ""}; ritocchi manuali nel viewer`;
    }
    this.setStatus("Salvataggio…");
    try {
      const r = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/geo+json" },
        body: JSON.stringify({ type: "FeatureCollection", features }),
      });
      if (!r.ok) throw new Error(await r.text());
      this.dirty = false;
      this.boundary.setFeatures(features);
      this.stop();
    } catch (err) {
      this.setStatus(`Salvataggio non riuscito: ${err}`);
    }
  }

  // --- Pointer ---------------------------------------------------------------

  private onDown(e: PointerEvent) {
    if (!this.active || e.button !== 0 || e.target !== this.world.renderer.domElement) return;
    const v = this.nearestVertex(e.clientX, e.clientY);
    if (v) {
      e.stopPropagation(); // keep the camera still
      if (e.altKey) {
        if (v.ring.points.length <= MIN_POINTS) return this.setStatus(`Servono almeno ${MIN_POINTS} punti.`);
        this.remember();
        v.ring.points.splice(v.index, 1);
        this.redraw();
      } else {
        this.remember();
        this.beginDrag(v.ring, v.index);
      }
      return;
    }
    if (e.altKey) return;
    const edge = this.nearestEdge(e.clientX, e.clientY);
    if (!edge) return; // empty map: let the camera orbit
    const hit = pickGround(this.world, this.ground, e.clientX, e.clientY);
    if (!hit) return;
    e.stopPropagation();
    this.remember();
    const { lat, lng } = this.ground.toLatLng(hit);
    edge.ring.points.splice(edge.index + 1, 0, [lng, lat]);
    this.beginDrag(edge.ring, edge.index + 1);
    this.redraw();
  }

  private onMove(e: PointerEvent) {
    if (!this.active) return;
    const canvas = this.world.renderer.domElement;
    if (this.drag) {
      const hit = pickGround(this.world, this.ground, e.clientX, e.clientY);
      if (!hit) return;
      const { lat, lng } = this.ground.toLatLng(hit);
      this.drag.ring.points[this.drag.index] = [lng, lat];
      this.dirty = true;
      this.redraw();
      return;
    }
    if (e.target !== canvas) return;
    const v = this.nearestVertex(e.clientX, e.clientY);
    const edge = v ? undefined : this.nearestEdge(e.clientX, e.clientY);
    canvas.style.cursor = v ? (e.altKey ? "not-allowed" : "grab") : edge ? "copy" : "";
    this.showHover(v ? this.scenePoint(v.ring.points[v.index]) : undefined);
  }

  private beginDrag(ring: EditRing, index: number) {
    this.drag = { ring, index };
    this.dirty = true;
    this.world.controls.enabled = false;
    this.world.renderer.domElement.style.cursor = "grabbing";
  }

  private endDrag() {
    if (!this.drag) return;
    this.drag = undefined;
    this.world.controls.enabled = true;
    this.world.renderer.domElement.style.cursor = "";
  }

  private nearestVertex(x: number, y: number) {
    const p = new THREE.Vector2(x, y);
    let best: { ring: EditRing; index: number } | undefined;
    let bestD = VERTEX_PX;
    const s = new THREE.Vector2();
    for (const ring of this.rings) {
      ring.points.forEach((ll, index) => {
        if (!toScreen(this.world, this.scenePoint(ll), s)) return;
        const d = s.distanceTo(p);
        if (d < bestD) {
          bestD = d;
          best = { ring, index };
        }
      });
    }
    return best;
  }

  /** Side under the pointer: inserting after `index`. */
  private nearestEdge(x: number, y: number) {
    const p = new THREE.Vector2(x, y);
    let best: { ring: EditRing; index: number } | undefined;
    let bestD = EDGE_PX;
    for (const ring of this.rings) {
      const screen = ring.points.map((ll) => toScreen(this.world, this.scenePoint(ll)));
      for (let i = 0; i < screen.length; i++) {
        const a = screen[i];
        const b = screen[(i + 1) % screen.length];
        if (!a || !b) continue;
        const { d } = segmentDistance(p, a, b);
        if (d < bestD) {
          bestD = d;
          best = { ring, index: i };
        }
      }
    }
    return best;
  }

  // --- Drawing ---------------------------------------------------------------

  private scenePoint([lng, lat]: LngLat) {
    const v = this.ground.toScene(lat, lng);
    v.y = (this.ground.groundAt(v.x, v.z) ?? 0) + LIFT_M;
    return v;
  }

  private redraw() {
    for (const o of [...this.group.children]) {
      if (o === this.hover) continue;
      this.group.remove(o);
      (o as THREE.Mesh).geometry.dispose();
    }
    for (const ring of this.rings) {
      const pts = ring.points.map((ll) => this.scenePoint(ll));
      const loop = [...pts, pts[0]];
      const line = new Line2(new LineGeometry().setPositions(loop.flatMap((v) => [v.x, v.y, v.z])), this.lineMaterial);
      line.renderOrder = 10;
      const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), this.pointMaterial);
      dots.renderOrder = 11;
      this.group.add(line, dots);
    }
    const n = this.rings.reduce((s, r) => s + r.points.length, 0);
    this.setStatus(this.dirty ? `${n} punti · modifiche non salvate` : `${n} punti`);
  }

  private showHover(p: THREE.Vector3 | undefined) {
    this.hover.geometry.dispose();
    this.hover.geometry = new THREE.BufferGeometry().setFromPoints(p ? [p] : []);
  }

  private remember() {
    this.history.push(JSON.stringify(this.rings.map((r) => r.points)));
    if (this.history.length > 100) this.history.shift();
  }

  private undo() {
    const last = this.history.pop();
    if (!last) return;
    const points = JSON.parse(last) as LngLat[][];
    this.rings.forEach((r, i) => (r.points = points[i]));
    this.dirty = this.history.length > 0;
    this.redraw();
  }

  private setStatus(text: string) {
    this.ui.status.textContent = text;
  }
}

const open = (ring: Ring): LngLat[] => {
  const pts = ring.map(([lng, lat]) => [lng, lat] as LngLat);
  const [a, b] = [pts[0], pts[pts.length - 1]];
  if (pts.length > 1 && a[0] === b[0] && a[1] === b[1]) pts.pop();
  return pts;
};
const round = ([lng, lat]: LngLat): LngLat => [Number(lng.toFixed(7)), Number(lat.toFixed(7))];
