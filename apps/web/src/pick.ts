import * as THREE from "three";
import type { Ground } from "./ground";
import type { ChurchScene } from "./scene";

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/** Point of the village surface under a screen position (CSS px), if any. */
export function pickGround(world: ChurchScene, ground: Ground, clientX: number, clientY: number) {
  const rect = world.renderer.domElement.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, world.camera);
  // Hidden tiles (parents of loaded children) are still raycastable: skip them.
  return raycaster.intersectObject(ground.object, true).find((h) => h.object.visible)?.point;
}

/** Scene point → CSS px relative to the viewport, or undefined behind the camera. */
export function toScreen(world: ChurchScene, p: THREE.Vector3, out = new THREE.Vector2()) {
  const v = p.clone().project(world.camera);
  if (v.z > 1) return;
  const rect = world.renderer.domElement.getBoundingClientRect();
  return out.set(rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height);
}

/** Distance (px) from p to segment ab, and the position t ∈ [0,1] of the closest point. */
export function segmentDistance(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const ab = b.clone().sub(a);
  const len2 = ab.lengthSq();
  const t = len2 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / len2, 0, 1) : 0;
  return { d: a.clone().addScaledVector(ab, t).distanceTo(p), t };
}
