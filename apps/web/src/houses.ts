import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import buildingsJson from "../../../content/buildings.geojson?raw";
import type { Ground } from "./ground";
import type { ChurchScene } from "./scene";

/**
 * Names on the houses people know, written above the roofs.
 *
 * Data: content/local/case.geojson (git-ignored: names + places of real
 * families must not end up in the public repo). In dev it is read and saved
 * through the Vite plugin at /__sl3d/houses; a production build shows names only
 * if built with VITE_HOUSE_NAMES=1 and the file copied to public/local/.
 *
 * Editing (dev only): Alt+click on the map → name + note; the label snaps to the
 * OpenStreetMap building under the click (content/buildings.geojson) or, failing
 * that, to the nearest one within SNAP_M, and that building gets an outline.
 * Alt+click on a label edits or deletes it. A plain click on a label shows its note.
 */

type LngLat = [number, number];
interface HouseProps {
  id: string;
  name: string;
  note?: string;
  osm?: string; // building it is attached to
}
interface HouseFeature {
  type: "Feature";
  properties: HouseProps;
  geometry: { type: "Point"; coordinates: LngLat };
}
interface Building {
  osm: string;
  ring: LngLat[];
  centre: LngLat;
  scene?: THREE.Vector3[]; // ring in scene coordinates (y on the terrain)
}
interface Label {
  house: HouseFeature;
  el: HTMLElement;
  stem: HTMLElement;
  ground: THREE.Vector3;
}

const SNAP_M = 15;
const SHOW_WITHIN_M = 600;
const LABEL_HEIGHT_M = 14;
const LIFT_M = 1.2;
const API = "/__sl3d/houses";

const buildings: Building[] = (
  JSON.parse(buildingsJson) as { features: { properties: { osm: string }; geometry: { coordinates: LngLat[][] } }[] }
).features.map((f) => {
  const ring = f.geometry.coordinates[0];
  const pts = ring.slice(0, -1);
  const centre: LngLat = [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
  return { osm: f.properties.osm, ring, centre };
});

export class HouseNames {
  readonly editable = import.meta.env.DEV;
  private houses: HouseFeature[] = [];
  private labels: Label[] = [];
  private outlines = new THREE.Group();
  private selection?: Line2;
  private outlineMaterial = new LineMaterial({ color: 0xfff6dc, linewidth: 2, transparent: true, opacity: 0.9, depthWrite: false });
  private selectionMaterial = new LineMaterial({ color: 0xd9a35b, linewidth: 4, depthWrite: false });
  private wanted = false;
  private enabled = true;
  private groundDirty = true;
  private editing?: { house?: HouseFeature; lngLat: LngLat; osm?: string };

  constructor(
    private world: ChurchScene,
    private ground: Ground,
    private layer: HTMLElement,
    private editor: HTMLFormElement,
  ) {
    this.outlines.name = "house-outlines";
    this.outlines.visible = false;
    world.scene.add(this.outlines);
    ground.onChange(() => (this.groundDirty = true));
    world.beforeFrame(() => {
      const c = world.renderer.domElement;
      for (const m of [this.outlineMaterial, this.selectionMaterial]) m.resolution.set(c.clientWidth, c.clientHeight);
      if (this.groundDirty && this.ground.ready && this.shown) this.drape();
    });
    world.onFrame(() => this.place());
    this.setupEditor();
    this.load().catch((err) => console.warn("Nomi delle case non disponibili:", err));
  }

  /** Exterior view and not in Street View (set by Modes). */
  set active(v: boolean) {
    this.wanted = v;
    this.update();
  }
  /** User toggle. */
  set on(v: boolean) {
    this.enabled = v;
    this.update();
  }
  private get shown() {
    return this.wanted && this.enabled;
  }
  private update() {
    this.outlines.visible = this.shown;
    this.layer.hidden = !this.shown;
    if (!this.shown) this.closeEditor();
  }

  // --- Data ------------------------------------------------------------------

  private async load() {
    let url: string | undefined;
    if (import.meta.env.DEV) url = API;
    else if (import.meta.env.VITE_HOUSE_NAMES === "1") url = `${import.meta.env.BASE_URL}local/case.geojson`;
    if (!url) return;
    const r = await fetch(url);
    if (!r.ok) return;
    const data = (await r.json()) as { features?: HouseFeature[] };
    this.houses = data.features ?? [];
    this.rebuild();
  }

  private async save() {
    const body = JSON.stringify({ type: "FeatureCollection", features: this.houses });
    const r = await fetch(API, { method: "PUT", headers: { "Content-Type": "application/geo+json" }, body });
    if (!r.ok) throw new Error(await r.text());
  }

  // --- Scene -----------------------------------------------------------------

  private rebuild() {
    for (const l of this.labels) l.el.remove();
    this.labels = this.houses.map((house) => this.makeLabel(house));
    this.groundDirty = true;
  }

  private makeLabel(house: HouseFeature): Label {
    const el = document.createElement("div");
    el.className = "house-label";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = house.properties.name;
    el.append(name);
    if (house.properties.note) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = house.properties.note;
      el.append(note);
      el.classList.add("has-note");
    }
    const stem = document.createElement("i");
    el.append(stem);
    name.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.altKey && this.editable) {
        const [lng, lat] = house.geometry.coordinates;
        this.openEditor({ house, lngLat: [lng, lat], osm: house.properties.osm }, e.clientX, e.clientY);
      } else {
        el.classList.toggle("open");
      }
    });
    this.layer.append(el);
    const [lng, lat] = house.geometry.coordinates;
    return { house, el, stem, ground: this.ground.toScene(lat, lng) };
  }

  /** Snap labels and outlines to the current terrain. */
  private drape() {
    this.groundDirty = false;
    for (const l of this.labels) l.ground.y = this.ground.groundAt(l.ground.x, l.ground.z) ?? l.ground.y;

    for (const o of this.outlines.children) (o as Line2).geometry.dispose();
    this.outlines.clear();
    const used = new Set(this.houses.map((h) => h.properties.osm).filter(Boolean));
    for (const b of buildings) {
      if (!used.has(b.osm)) continue;
      this.outlines.add(new Line2(this.lineGeometry(b), this.outlineMaterial));
    }
  }

  private lineGeometry(b: Building) {
    b.scene = b.ring.map(([lng, lat]) => {
      const p = this.ground.toScene(lat, lng);
      p.y = (this.ground.groundAt(p.x, p.z) ?? 0) + LIFT_M;
      return p;
    });
    return new LineGeometry().setPositions(b.scene.flatMap((p) => [p.x, p.y, p.z]));
  }

  private place() {
    if (!this.shown) return;
    const cam = this.world.camera.position;
    for (const { el, stem, ground } of this.labels) {
      const far = cam.distanceTo(ground) > SHOW_WITHIN_M;
      const top = far ? undefined : this.world.project([ground.x, ground.y + LABEL_HEIGHT_M, ground.z]);
      el.hidden = !top;
      if (!top) continue;
      el.style.transform = `translate(${top.x}px, ${top.y}px) translate(-50%, -100%)`;
      const foot = this.world.project(ground.toArray());
      stem.style.height = `${foot ? Math.max(0, foot.y - top.y) : 0}px`;
    }
  }

  // --- Editing (dev) ---------------------------------------------------------

  /** Alt+click on the map: called by main.ts with the click position. */
  pickAt(clientX: number, clientY: number) {
    if (!this.editable || !this.shown) return;
    const hit = this.raycast(clientX, clientY);
    if (!hit) return;
    const { lat, lng } = this.ground.toLatLng(hit);
    const b = this.buildingAt(hit);
    const lngLat: LngLat = b ? b.centre : [lng, lat];
    const existing = b && this.houses.find((h) => h.properties.osm === b.osm);
    this.openEditor({ house: existing, lngLat, osm: b?.osm }, clientX, clientY);
  }

  private raycast(clientX: number, clientY: number) {
    const rect = this.world.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.world.camera);
    // Hidden tiles (parents of loaded children) are still raycastable: skip them.
    return raycaster.intersectObject(this.ground.object, true).find((h) => h.object.visible)?.point;
  }

  /** Building containing the point, else the nearest one within SNAP_M. */
  private buildingAt(p: THREE.Vector3): Building | undefined {
    let best: Building | undefined;
    let bestD = SNAP_M;
    for (const b of buildings) {
      const ring = (b.scene ??= b.ring.map(([lng, lat]) => this.ground.toScene(lat, lng)));
      if (insidePolygon(p, ring)) return b;
      const c = this.ground.toScene(b.centre[1], b.centre[0]);
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private setupEditor() {
    const f = this.editor;
    const name = f.elements.namedItem("name") as HTMLInputElement;
    const note = f.elements.namedItem("note") as HTMLTextAreaElement;
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ed = this.editing;
      if (!ed || !name.value.trim()) return;
      const props: HouseProps = {
        id: ed.house?.properties.id ?? crypto.randomUUID(),
        name: name.value.trim(),
        ...(note.value.trim() ? { note: note.value.trim() } : {}),
        ...(ed.osm ? { osm: ed.osm } : {}),
      };
      const feature: HouseFeature = { type: "Feature", properties: props, geometry: { type: "Point", coordinates: ed.lngLat } };
      const others = this.houses.filter((h) => h.properties.id !== props.id);
      await this.commit([...others, feature]);
    });
    f.querySelector<HTMLButtonElement>("[data-action=delete]")!.onclick = async () => {
      const id = this.editing?.house?.properties.id;
      if (id) await this.commit(this.houses.filter((h) => h.properties.id !== id));
    };
    f.querySelector<HTMLButtonElement>("[data-action=cancel]")!.onclick = () => this.closeEditor();
    f.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeEditor();
      e.stopPropagation(); // typing must not move the camera
    });
  }

  private async commit(next: HouseFeature[]) {
    const previous = this.houses;
    this.houses = next;
    try {
      await this.save();
      this.closeEditor();
      this.rebuild();
    } catch (err) {
      this.houses = previous;
      this.editor.querySelector<HTMLElement>(".status")!.textContent = `Salvataggio non riuscito: ${err}`;
    }
  }

  private openEditor(editing: NonNullable<HouseNames["editing"]>, x: number, y: number) {
    this.editing = editing;
    const f = this.editor;
    (f.elements.namedItem("name") as HTMLInputElement).value = editing.house?.properties.name ?? "";
    (f.elements.namedItem("note") as HTMLTextAreaElement).value = editing.house?.properties.note ?? "";
    f.querySelector<HTMLElement>("[data-action=delete]")!.hidden = !editing.house;
    f.querySelector<HTMLElement>(".status")!.textContent = editing.osm
      ? "Agganciata a un edificio OpenStreetMap."
      : "Nessun edificio qui: resta nel punto cliccato.";
    f.hidden = false;
    const w = f.offsetWidth;
    const h = f.offsetHeight;
    f.style.left = `${Math.min(x + 12, window.innerWidth - w - 8)}px`;
    f.style.top = `${Math.min(y + 12, window.innerHeight - h - 8)}px`;
    (f.elements.namedItem("name") as HTMLInputElement).focus();
    this.showSelection(editing.osm);
  }

  private closeEditor() {
    this.editing = undefined;
    this.editor.hidden = true;
    this.showSelection(undefined);
  }

  private showSelection(osm: string | undefined) {
    if (this.selection) {
      this.world.scene.remove(this.selection);
      this.selection.geometry.dispose();
      this.selection = undefined;
    }
    const b = osm && buildings.find((x) => x.osm === osm);
    if (!b) return;
    this.selection = new Line2(this.lineGeometry(b), this.selectionMaterial);
    this.selection.renderOrder = 3;
    this.world.scene.add(this.selection);
  }
}

/** Point-in-polygon on the horizontal plane (x, z). */
function insidePolygon(p: THREE.Vector3, ring: THREE.Vector3[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
