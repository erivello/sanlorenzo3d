import { site, type GoogleTiles } from "./exterior";
import type { CameraPose, ChurchScene } from "./scene";
import type { Vec3 } from "./content";

export type Mode = "exterior" | "interior";

// Exterior poses in metres, relative to the church (viewer frame: +x west, +z north,
// ground ≈ y 0 — see content/site.yaml).
const [cx, cy, cz] = site.church_offset_m;
const at = (x: number, y: number, z: number): Vec3 => [cx + x, cy + y, cz + z];
const VILLAGE_HIGH: CameraPose = { position: at(-1100, 900, -1300), target: at(0, 0, 0) };
const VILLAGE: CameraPose = { position: at(-160, 95, -160), target: at(0, 0, 0) };
const DOORSTEP: CameraPose = { position: at(-35, 18, -35), target: at(0, 3, 0) };

const FADE_MS = 500;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Modes {
  mode: Mode = "interior";
  private busy = false;

  constructor(
    private world: ChurchScene,
    private interiorOverview: CameraPose,
    private tiles?: GoogleTiles,
  ) {
    document.body.dataset.mode = this.mode;
    if (tiles) {
      const attribution = document.getElementById("attribution")!;
      world.onFrame(() => {
        if (this.mode === "exterior") tiles.renderAttributions(attribution);
      });
    }
  }

  get hasExterior() {
    return !!this.tiles;
  }

  /** Arrive over the village from high above. */
  flyIntoVillage() {
    this.apply("exterior");
    this.world.setPose(VILLAGE_HIGH);
    this.world.flyTo(VILLAGE, 4500);
  }

  /** Approach the door, fade, and continue inside. */
  async enterChurch() {
    if (this.busy) return;
    this.busy = true;
    if (this.mode === "exterior") {
      this.world.flyTo(DOORSTEP, 1600);
      await wait(1300);
    }
    await this.fade(async () => {
      this.apply("interior");
      this.world.setPose(this.interiorOverview);
    });
    this.busy = false;
  }

  async exitToVillage() {
    if (this.busy || !this.tiles) return;
    this.busy = true;
    await this.fade(async () => {
      this.apply("exterior");
      this.world.setPose(DOORSTEP);
    });
    this.world.flyTo(VILLAGE, 2000);
    this.busy = false;
  }

  /** Called when the tiles cannot load (bad key, billing off…). */
  disableExterior() {
    this.tiles = undefined;
    document.body.dataset.exterior = "off";
    if (this.mode === "exterior") {
      this.apply("interior");
      this.world.setPose(this.interiorOverview);
    }
  }

  private apply(mode: Mode) {
    this.mode = mode;
    document.body.dataset.mode = mode;
    const outside = mode === "exterior";
    if (this.world.splat) this.world.splat.visible = !outside;
    if (this.tiles) this.tiles.visible = outside;
    this.world.setClipping(outside ? 1 : 0.01, outside ? 40000 : 1000);
  }

  private async fade(during: () => Promise<void>) {
    const veil = document.getElementById("veil")!;
    veil.classList.add("on");
    await wait(FADE_MS);
    await during();
    veil.classList.remove("on");
    await wait(FADE_MS);
  }
}
