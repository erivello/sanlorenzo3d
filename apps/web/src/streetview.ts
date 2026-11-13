import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import type { GoogleTiles } from "./exterior";
import type { ChurchScene } from "./scene";

/**
 * Google Street View, integrated as a hand-off from the 3D view:
 * - coverage: panoramas around the village are discovered by walking the
 *   panorama graph (links) from the one nearest to the church, and drawn as
 *   blue ribbons on the terrain, like the coverage layer in Google Maps;
 * - click near a blue street → the official StreetViewPanorama opens there,
 *   facing the direction the 3D camera was looking;
 * - "Vista dall'alto" → back to 3D above the panorama you walked to.
 *
 * Imagery is shown only through Google's own viewer (Terms of Service): we never
 * read panorama pixels into the 3D scene, and nothing is cached beyond the session.
 */

export interface Pano {
  id: string;
  lat: number;
  lng: number;
  links: string[];
  pos: THREE.Vector3; // scene position on the terrain
}

const CRAWL_RADIUS_M = 700;
const CRAWL_MAX = 1200;
const PICK_RADIUS_PX = 24;
const LINE_WIDTH_PX = 4;
const LINE_LIFT = 1.5; // metres above the terrain, avoids z-fighting with the mesh

/** Compass heading (deg) of a scene direction. Scene frame: +x west, +z north. */
export const headingOf = (dir: THREE.Vector3) =>
  (THREE.MathUtils.radToDeg(Math.atan2(-dir.x, dir.z)) + 360) % 360;
/** Scene direction (horizontal, unit) of a compass heading. */
export const dirOf = (heading: number) => {
  const h = THREE.MathUtils.degToRad(heading);
  return new THREE.Vector3(-Math.sin(h), 0, Math.cos(h));
};

export class StreetView {
  readonly panos = new Map<string, Pano>();
  readonly coverage = new THREE.Group();
  private service?: google.maps.StreetViewService;
  private viewer?: google.maps.StreetViewPanorama;
  private lib?: google.maps.StreetViewLibrary;
  private groundDirty = true;
  private material = new LineMaterial({
    color: 0x3d8bfd,
    linewidth: LINE_WIDTH_PX, // screen pixels, like the coverage layer in Google Maps
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  constructor(
    world: ChurchScene,
    private tiles: GoogleTiles,
    apiKey: string,
  ) {
    setOptions({ key: apiKey, v: "weekly", language: "it", region: "IT" });
    this.coverage.name = "streetview-coverage";
    world.scene.add(this.coverage);
    tiles.tiles.addEventListener("tiles-load-end", () => (this.groundDirty = true));
    world.beforeFrame(() => {
      const canvas = world.renderer.domElement;
      this.material.resolution.set(canvas.clientWidth, canvas.clientHeight);
      if (this.groundDirty && this.coverage.visible && this.panos.size) this.rebuildLines();
    });
  }

  set visible(v: boolean) {
    this.coverage.visible = v;
  }
  get visible() {
    return this.coverage.visible;
  }

  /** Loads the Street View library. Rejects if the Maps JavaScript API is not enabled. */
  async init() {
    this.lib = (await importLibrary("streetView")) as google.maps.StreetViewLibrary;
    this.service = new this.lib.StreetViewService();
  }

  /**
   * Nearest official Google Street View panorama (car/trekker imagery, linked
   * along the streets). User-uploaded photo spheres are excluded: they are not
   * connected to each other, so the street graph cannot be walked from them.
   */
  async nearest(lat: number, lng: number, radius = 50): Promise<Pano | undefined> {
    try {
      const { data } = await this.service!.getPanorama({
        location: { lat, lng },
        radius,
        sources: [this.lib!.StreetViewSource.GOOGLE],
        preference: this.lib!.StreetViewPreference.NEAREST,
      });
      return this.remember(data);
    } catch {
      return undefined; // ZERO_RESULTS
    }
  }

  /** Breadth-first walk of the panorama graph around a starting panorama. */
  async crawl(start: Pano, onProgress?: (n: number) => void) {
    const queue = [start.id];
    const seen = new Set(queue);
    const centre = start.pos.clone();
    while (queue.length && this.panos.size < CRAWL_MAX) {
      const batch = queue.splice(0, 6);
      const results = await Promise.all(
        batch.map((pano) =>
          this.panos.has(pano) && this.panos.get(pano)!.links.length
            ? this.panos.get(pano)
            : this.service!.getPanorama({ pano }).then((r) => this.remember(r.data), () => undefined),
        ),
      );
      for (const p of results) {
        if (!p) continue;
        // Horizontal distance only: heights get snapped to the terrain while we crawl.
        if (Math.hypot(p.pos.x - centre.x, p.pos.z - centre.z) > CRAWL_RADIUS_M) continue;
        for (const next of p.links) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      onProgress?.(this.panos.size);
    }
    this.groundDirty = true;
  }

  /**
   * Panorama drawn closest to a screen point (CSS px), within PICK_RADIUS_PX —
   * i.e. the blue line under the cursor, whatever the camera height.
   */
  pick(camera: THREE.Camera, canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    let best: Pano | undefined;
    let bestD = PICK_RADIUS_PX;
    for (const p of this.panos.values()) {
      v.copy(p.pos).setY(p.pos.y + LINE_LIFT).project(camera);
      if (v.z > 1) continue; // behind the camera
      const x = rect.left + ((v.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(x - clientX, y - clientY);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Show the official panorama viewer in `container`. */
  open(container: HTMLElement, pano: Pano, heading: number) {
    if (!this.viewer) {
      this.viewer = new this.lib!.StreetViewPanorama(container, {
        pano: pano.id,
        pov: { heading, pitch: 0 },
        zoom: 0,
        addressControl: true,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
        showRoadLabels: true,
      });
    } else {
      this.viewer.setPano(pano.id);
      this.viewer.setPov({ heading, pitch: 0 });
    }
    this.viewer.setVisible(true);
    google.maps.event.trigger(this.viewer, "resize");
  }

  /** Where the viewer is now (after the user walked around). */
  current(): { pos: THREE.Vector3; heading: number } | undefined {
    const ll = this.viewer?.getPosition();
    if (!ll) return;
    const pos = this.tiles.toScene(ll.lat(), ll.lng());
    pos.y = this.tiles.groundAt(pos.x, pos.z) ?? 0;
    return { pos, heading: this.viewer!.getPov().heading };
  }

  close() {
    this.viewer?.setVisible(false);
  }

  private remember(data: google.maps.StreetViewPanoramaData): Pano | undefined {
    const id = data.location?.pano;
    const ll = data.location?.latLng;
    if (!id || !ll) return;
    const known = this.panos.get(id);
    if (known && known.links.length) return known; // keep its terrain-snapped height
    const pos = this.tiles.toScene(ll.lat(), ll.lng());
    // Until the terrain under it is loaded, assume the church ground level (y≈0)
    // rather than the ellipsoid height (hundreds of metres underground).
    pos.y = this.tiles.groundAt(pos.x, pos.z) ?? 0;
    const pano: Pano = {
      id,
      lat: ll.lat(),
      lng: ll.lng(),
      links: (data.links ?? []).map((l) => l.pano).filter((p): p is string => !!p),
      pos,
    };
    this.panos.set(id, pano);
    return pano;
  }

  /** Blue lines between linked panoramas, draped on the current terrain. */
  private rebuildLines() {
    this.groundDirty = false;
    for (const p of this.panos.values()) p.pos.y = this.tiles.groundAt(p.pos.x, p.pos.z) ?? p.pos.y;

    const positions: number[] = [];
    const done = new Set<string>();
    for (const a of this.panos.values()) {
      for (const id of a.links) {
        const b = this.panos.get(id);
        const key = a.id < id ? `${a.id}|${id}` : `${id}|${a.id}`;
        if (!b || done.has(key)) continue;
        done.add(key);
        positions.push(a.pos.x, a.pos.y + LINE_LIFT, a.pos.z, b.pos.x, b.pos.y + LINE_LIFT, b.pos.z);
      }
    }
    const geometry = new LineSegmentsGeometry().setPositions(positions);
    const old = this.coverage.children[0] as LineSegments2 | undefined;
    if (old) {
      old.geometry.dispose();
      old.geometry = geometry;
    } else {
      const lines = new LineSegments2(geometry, this.material);
      lines.renderOrder = 1;
      this.coverage.add(lines);
    }
  }
}
