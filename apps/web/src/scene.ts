import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import type { Vec3 } from "./content";

const DEFAULT_SPLAT = "https://sparkjs.dev/assets/splats/butterfly.spz";

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export class ChurchScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  splat?: SplatMesh;

  private flight?: {
    from: CameraPose;
    to: CameraPose;
    start: number;
    duration: number;
  };
  private frameListeners: Array<() => void> = [];
  private beforeFrameListeners: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
    this.camera.position.set(0, 0.5, 2);

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.add(new SparkRenderer({ renderer: this.renderer }));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);

    window.addEventListener("resize", () => this.resize());
    this.resize();

    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  /**
   * Screen area covered by UI (CSS px). The projection centre is shifted so the
   * camera target appears in the middle of the free area, not behind the panel.
   */
  setInsets(insets: { left?: number; bottom?: number }) {
    this.insets = { left: insets.left ?? 0, bottom: insets.bottom ?? 0 };
    this.resize();
  }

  private insets = { left: 0, bottom: 0 };

  private resize() {
    const el = this.renderer.domElement.parentElement!;
    const { clientWidth: w, clientHeight: h } = el;
    const { left, bottom } = this.insets;
    this.renderer.setSize(w, h);
    // Virtual view of (w+left)×(h+bottom); render its sub-rect so the centre moves
    // right by left/2 and up by bottom/2.
    const fullW = w + left;
    const fullH = h + bottom;
    this.camera.aspect = fullW / fullH;
    if (left || bottom) this.camera.setViewOffset(fullW, fullH, 0, bottom, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  async loadSplat(url = import.meta.env.VITE_SPLAT_URL || DEFAULT_SPLAT) {
    const splat = new SplatMesh({ url });
    // COLMAP/Brush output is Y-down; flip to three.js Y-up (see AGENTS.md).
    splat.quaternion.set(1, 0, 0, 0);
    this.scene.add(splat);
    await splat.initialized;
    this.splat = splat;
    return splat;
  }

  /** Runs after render (DOM overlays). */
  onFrame(fn: () => void) {
    this.frameListeners.push(fn);
  }

  /** Runs before render (scene updates, e.g. tiles streaming). */
  beforeFrame(fn: () => void) {
    this.beforeFrameListeners.push(fn);
  }

  /** Near/far planes: tiny for the interior splat, kilometres for the village. */
  setClipping(near: number, far: number) {
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  cancelFlight() {
    this.flight = undefined;
  }

  /** Jump without animation. */
  setPose(pose: CameraPose) {
    this.flight = undefined;
    this.camera.position.set(...pose.position);
    this.controls.target.set(...pose.target);
  }

  pose(): CameraPose {
    const r = (v: THREE.Vector3): Vec3 =>
      v.toArray().map((n) => Math.round(n * 1000) / 1000) as Vec3;
    return { position: r(this.camera.position), target: r(this.controls.target) };
  }

  flyTo(to: CameraPose, duration = 1400) {
    this.flight = { from: this.pose(), to, start: performance.now(), duration };
  }

  /** World-space point on the splat under a screen position, if any. */
  pick(clientX: number, clientY: number): THREE.Vector3 | undefined {
    if (!this.splat) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster.intersectObject(this.splat, false)[0]?.point;
  }

  /** Project a world point to CSS pixels; undefined when behind the camera. */
  project(p: Vec3): { x: number; y: number } | undefined {
    const v = new THREE.Vector3(...p).project(this.camera);
    if (v.z > 1) return;
    const el = this.renderer.domElement;
    return {
      x: ((v.x + 1) / 2) * el.clientWidth,
      y: ((1 - v.y) / 2) * el.clientHeight,
    };
  }

  private tick(now: number) {
    if (this.flight) {
      const { from, to, start, duration } = this.flight;
      const t = Math.min(1, (now - start) / duration);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(
        new THREE.Vector3(...from.position),
        new THREE.Vector3(...to.position),
        k,
      );
      this.controls.target.lerpVectors(
        new THREE.Vector3(...from.target),
        new THREE.Vector3(...to.target),
        k,
      );
      if (t === 1) this.flight = undefined;
    }
    this.controls.update();
    for (const fn of this.beforeFrameListeners) fn();
    this.renderer.render(this.scene, this.camera);
    for (const fn of this.frameListeners) fn();
  }
}
