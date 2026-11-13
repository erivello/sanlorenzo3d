import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import borghiJson from "../../../content/borghi.geojson?raw";
import boundaryJson from "../../../content/boundary.geojson?raw";
import type { GoogleTiles } from "./exterior";
import type { ChurchScene } from "./scene";

/**
 * Village boundary (content/boundary.geojson: ISTAT localities + streets added
 * by hand, one Feature per area):
 * - a golden outline draped on the terrain around each area;
 * - everything outside dimmed and desaturated, so the village "lights up"
 *   (a mask texture sampled in the Google tiles' fragment shader);
 * - a floating name label per area, hidden when you get close;
 * - the names of the borghi (content/borghi.geojson, OpenStreetMap) written
 *   high above them, with a thin stem down to the ground.
 */

type Ring = [number, number][];
interface Feature {
  properties: {
    name: string;
    main?: boolean;
    /** Label position [lng, lat]; defaults to the centre of the area. */
    point?: [number, number];
    /** Other named places inside the area, labelled too. */
    places?: { name: string; point: [number, number] }[];
  };
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
}
const features = (JSON.parse(boundaryJson) as { features: Feature[] }).features;
const borghi = (
  JSON.parse(borghiJson) as { features: { properties: { name: string }; geometry: { coordinates: [number, number] } }[] }
).features;
/** Outer rings only: the areas have no holes worth drawing. */
const outerRings = (f: Feature): Ring[] =>
  f.geometry.type === "Polygon" ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]);

interface Label {
  el: HTMLElement;
  ground: THREE.Vector3; // y snapped to the terrain
  height: number; // metres above the ground
  hideWithin: number; // horizontal metres
  stem?: HTMLElement;
}

const STEP_M = 4; // densify edges so the outline follows the terrain
const LIFT_M = 1.5; // above the terrain, avoids z-fighting
const MASK_MARGIN_M = 60;
const MASK_MAX_PX = 2048;
const MASK_BLUR_PX = 6; // soft edge between lit and dimmed area
const LABEL_HEIGHT_M = 45;
const LABEL_HIDE_WITHIN_M = 220;
const BORGO_HEIGHT_M = 30;
const BORGO_HIDE_WITHIN_M = 40;
const REBUILD_MIN_MS = 400;
const FADE_PER_S = 3;

export class VillageBoundary {
  private group = new THREE.Group();
  private rings: THREE.Vector3[][] = []; // densified, scene coordinates
  private lines: Line2[] = [];
  private labels: Label[] = [];
  private material = new LineMaterial({ color: 0xffd54a, linewidth: 4, transparent: true, depthWrite: false });
  private haloMaterial = new LineMaterial({
    color: 0x000000,
    linewidth: 9,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  private groundDirty = true;
  private lastRebuild = 0;
  private enabled = true;
  private shown = false;
  private wanted = false;
  // Shared by every tile material: one update toggles the whole village.
  private uniforms = {
    uSlMask: { value: null as THREE.Texture | null },
    uSlMaskMin: { value: new THREE.Vector2() },
    uSlMaskSize: { value: new THREE.Vector2(1, 1) },
    uSlDim: { value: 0 },
  };

  constructor(
    private world: ChurchScene,
    private tiles: GoogleTiles,
    private labelLayer: HTMLElement,
  ) {
    this.group.name = "village-boundary";
    this.group.visible = false;
    world.scene.add(this.group);

    tiles.tiles.addEventListener("load-model", (e: { scene: THREE.Object3D }) => this.patch(e.scene));
    tiles.tiles.addEventListener("tiles-load-end", () => (this.groundDirty = true));

    let last = performance.now();
    world.beforeFrame(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (!this.rings.length && tiles.ready) this.build();
      if (!this.rings.length) return;
      const canvas = world.renderer.domElement;
      this.material.resolution.set(canvas.clientWidth, canvas.clientHeight);
      this.haloMaterial.resolution.set(canvas.clientWidth, canvas.clientHeight);
      if (this.shown && this.groundDirty && now - this.lastRebuild > REBUILD_MIN_MS) this.drape(now);

      // Fade the outside dimming in/out.
      const target = this.shown ? 1 : 0;
      const u = this.uniforms.uSlDim;
      u.value += THREE.MathUtils.clamp(target - u.value, -FADE_PER_S * dt, FADE_PER_S * dt);
    });
    world.onFrame(() => this.placeLabel());
  }

  /** Whether the current view (exterior, not in Street View) can show it. */
  set active(v: boolean) {
    this.wanted = v;
    this.update();
  }

  /** User toggle. */
  set on(v: boolean) {
    this.enabled = v;
    this.update();
  }

  private update() {
    this.shown = this.wanted && this.enabled;
    this.group.visible = this.shown;
    this.labelLayer.hidden = !this.shown;
  }

  /** Lat/lng polygons → densified rings in scene coordinates, labels, dimming mask. */
  private build() {
    const box = new THREE.Box2();
    for (const f of features) {
      const area = new THREE.Box2();
      for (const coords of outerRings(f)) {
        const pts = coords.map(([lng, lat]) => this.tiles.toScene(lat, lng));
        const ring: THREE.Vector3[] = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const n = Math.max(1, Math.ceil(a.distanceTo(b) / STEP_M));
          for (let k = 0; k < n; k++) ring.push(a.clone().lerp(b, k / n).setY(0));
        }
        ring.push(ring[0].clone());
        for (const p of ring) area.expandByPoint(new THREE.Vector2(p.x, p.z));
        this.rings.push(ring);
      }
      box.union(area);
      const c = area.getCenter(new THREE.Vector2());
      const { name, main, point, places = [] } = f.properties;
      this.addLabel(name, main, point ? this.tiles.toScene(point[1], point[0]) : new THREE.Vector3(c.x, 0, c.y));
      // A borgo with the same name (e.g. "Borgo Castagnè") replaces the locality label.
      for (const p of places) {
        if (!borghi.some((b) => b.properties.name.includes(p.name)))
          this.addLabel(p.name, false, this.tiles.toScene(p.point[1], p.point[0]));
      }
    }
    for (const b of borghi) {
      const [lng, lat] = b.geometry.coordinates;
      this.addBorgo(b.properties.name, this.tiles.toScene(lat, lng));
    }
    box.expandByScalar(MASK_MARGIN_M);
    this.buildMask(box);

    // Patch tiles that loaded before the ring existed.
    this.patch(this.tiles.tiles.group);
  }

  private addLabel(name: string, main: boolean | undefined, anchor: THREE.Vector3) {
    const el = document.createElement("div");
    el.className = main ? "village-label main" : "village-label";
    el.textContent = name;
    this.labelLayer.append(el);
    this.labels.push({
      el,
      ground: anchor.setY(0),
      height: LABEL_HEIGHT_M,
      hideWithin: LABEL_HIDE_WITHIN_M,
    });
  }

  private addBorgo(name: string, ground: THREE.Vector3) {
    const el = document.createElement("div");
    el.className = "borgo-label";
    const text = document.createElement("span");
    text.textContent = name;
    const stem = document.createElement("i");
    el.append(text, stem);
    this.labelLayer.append(el);
    this.labels.push({ el, ground: ground.setY(0), height: BORGO_HEIGHT_M, hideWithin: BORGO_HIDE_WITHIN_M, stem });
  }

    private buildMask(box: THREE.Box2) {
    const size = box.getSize(new THREE.Vector2());
    const canvas = document.createElement("canvas");
    const pxPerM = Math.min(1, MASK_MAX_PX / Math.max(size.x, size.y));
    canvas.width = Math.ceil(size.x * pxPerM);
    canvas.height = Math.ceil(size.y * pxPerM);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.filter = `blur(${MASK_BLUR_PX}px)`;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    // Pixel (u·W, v·H) ↔ scene (min.x + u·size.x, min.z + v·size.z); flipY off to match.
    for (const ring of this.rings) {
      ring.forEach((p, i) => {
        const x = ((p.x - box.min.x) / size.x) * canvas.width;
        const y = ((p.z - box.min.y) / size.y) * canvas.height;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    this.uniforms.uSlMask.value = tex;
    this.uniforms.uSlMaskMin.value.copy(box.min);
    this.uniforms.uSlMaskSize.value.copy(size);
  }

  /** Inject the outside-dimming into tile materials (chains any existing hook). */
  private patch(root: THREE.Object3D) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.patchMaterial(m);
    });
  }

  private patchMaterial(material: THREE.Material & { __slMask?: true }) {
    if (material.__slMask) return;
    material.__slMask = true;
    const previous = material.onBeforeCompile;
    const uniforms = this.uniforms;
    material.onBeforeCompile = function (shader, renderer) {
      previous.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader =
        "varying vec3 vSlWorld;\n" +
        shader.vertexShader.replace(
          "#include <project_vertex>",
          "#include <project_vertex>\n\tvSlWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader =
        `varying vec3 vSlWorld;
uniform sampler2D uSlMask;
uniform vec2 uSlMaskMin;
uniform vec2 uSlMaskSize;
uniform float uSlDim;
` +
        shader.fragmentShader.replace(
          "#include <opaque_fragment>",
          `#include <opaque_fragment>
	if (uSlDim > 0.0) {
		vec2 slUv = (vSlWorld.xz - uSlMaskMin) / uSlMaskSize;
		float slInside = all(greaterThanEqual(slUv, vec2(0.0))) && all(lessThanEqual(slUv, vec2(1.0)))
			? texture2D(uSlMask, slUv).r : 0.0;
		float slLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
		vec3 slOut = mix(gl_FragColor.rgb, vec3(slLum), 0.7) * 0.5;
		gl_FragColor.rgb = mix(gl_FragColor.rgb, slOut, uSlDim * (1.0 - slInside));
	}`,
        );
    };
    const previousKey = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `sl-mask|${previousKey()}`;
    material.needsUpdate = true;
  }

  /** Snap the outline onto the currently loaded terrain. */
  private drape(now: number) {
    this.groundDirty = false;
    this.lastRebuild = now;
    for (const l of this.labels) l.ground.y = this.tiles.groundAt(l.ground.x, l.ground.z) ?? l.ground.y;

    this.rings.forEach((ring, i) => {
      for (const p of ring) p.y = this.tiles.groundAt(p.x, p.z) ?? p.y;
      const positions: number[] = [];
      for (const p of ring) positions.push(p.x, p.y + LIFT_M, p.z);
      const geometry = new LineGeometry().setPositions(positions);
      const halo = this.lines[2 * i];
      const line = this.lines[2 * i + 1];
      if (halo && line) {
        line.geometry.dispose();
        line.geometry = geometry;
        halo.geometry = geometry;
      } else {
        const h = new Line2(geometry, this.haloMaterial);
        const l = new Line2(geometry, this.material);
        h.renderOrder = 1;
        l.renderOrder = 2;
        this.lines.push(h, l);
        this.group.add(h, l);
      }
    });
  }

  private placeLabel() {
    if (!this.shown) return;
    const cam = this.world.camera.position;
    for (const { el, ground, height, hideWithin, stem } of this.labels) {
      const near = Math.hypot(cam.x - ground.x, cam.z - ground.z) < hideWithin;
      const top = near ? undefined : this.world.project([ground.x, ground.y + height, ground.z]);
      el.hidden = !top;
      if (!top) continue;
      el.style.transform = `translate(${top.x}px, ${top.y}px) translate(-50%, -100%)`;
      if (stem) {
        const foot = this.world.project(ground.toArray());
        stem.style.height = `${foot ? Math.max(0, foot.y - top.y) : 0}px`;
      }
    }
  }
}
