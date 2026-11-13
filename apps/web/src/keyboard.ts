import { Vector3 } from "three";
import type { ChurchScene } from "./scene";

/**
 * Walk/fly with the keyboard on top of OrbitControls.
 *   ↑/W ↓/S  forward/back at constant height     A/D  strafe
 *   ←/→      turn the view left/right            Q/E  up/down
 *   Shift    faster
 * Camera and orbit target move together, so mouse orbiting keeps working.
 */
const BINDINGS: Record<string, keyof Input> = {
  ArrowUp: "forward",
  KeyW: "forward",
  ArrowDown: "back",
  KeyS: "back",
  ArrowLeft: "turnLeft",
  ArrowRight: "turnRight",
  KeyA: "left",
  KeyD: "right",
  KeyQ: "up",
  KeyE: "down",
};

interface Input {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  up: boolean;
  down: boolean;
}

const TURN_SPEED = Math.PI / 3; // rad/s
const FAST = 3;

export function setupKeyboard(
  world: ChurchScene,
  /** Movement speed in scene units per second for the current mode/position. */
  speed: () => number,
) {
  const input: Input = {
    forward: false, back: false, left: false, right: false,
    turnLeft: false, turnRight: false, up: false, down: false,
  };
  let fast = false;

  const isTyping = (e: KeyboardEvent) =>
    e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
    fast = e.shiftKey;
    const action = BINDINGS[e.code];
    if (!action) return;
    input[action] = true;
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    fast = e.shiftKey;
    const action = BINDINGS[e.code];
    if (action) input[action] = false;
  });
  // Avoid "stuck" keys when the window loses focus mid-press.
  window.addEventListener("blur", () => {
    for (const k of Object.keys(input) as Array<keyof Input>) input[k] = false;
  });

  const forward = new Vector3();
  const side = new Vector3();
  const move = new Vector3();
  const offset = new Vector3();
  const UP = new Vector3(0, 1, 0);
  let last = performance.now();

  world.beforeFrame(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const turn = Number(input.turnLeft) - Number(input.turnRight);
    const fwd = Number(input.forward) - Number(input.back);
    const str = Number(input.right) - Number(input.left);
    const vert = Number(input.up) - Number(input.down);
    if (!turn && !fwd && !str && !vert) return;

    world.cancelFlight();
    const { camera, controls } = world;

    if (turn) {
      // Rotate the target around the camera: the view turns, the camera stays.
      offset.subVectors(controls.target, camera.position);
      offset.applyAxisAngle(UP, turn * TURN_SPEED * dt);
      controls.target.addVectors(camera.position, offset);
    }

    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1); // looking straight down
    forward.normalize();
    side.crossVectors(forward, UP).normalize();

    const step = speed() * (fast ? FAST : 1) * dt;
    move
      .set(0, 0, 0)
      .addScaledVector(forward, fwd)
      .addScaledVector(side, str)
      .addScaledVector(UP, vert);
    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(step);
    camera.position.add(move);
    controls.target.add(move);
  });
}
