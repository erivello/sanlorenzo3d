import { MathUtils } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { TilesRenderer } from "3d-tiles-renderer";
import {
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin,
  ReorientationPlugin,
  TileCompressionPlugin,
  TilesFadePlugin,
} from "3d-tiles-renderer/plugins";
import { parse } from "yaml";
import siteYaml from "../../../content/site.yaml?raw";
import type { ChurchScene } from "./scene";

interface Site {
  name: string;
  lat: number;
  lon: number;
  elevation_m: number;
}

export const site = parse(siteYaml) as Site;

// Geoid undulation (EGM96) around Vittorio Veneto: ellipsoid height ≈ MSL + ~47 m.
// The tiles live on the WGS84 ellipsoid, so the origin must use ellipsoid height.
const GEOID_OFFSET_M = 47;

const DRACO_DECODER = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

/**
 * Google Photorealistic 3D Tiles, re-centred so the church sits at the
 * three.js origin (Y-up, metres).
 */
export class GoogleTiles {
  readonly tiles: TilesRenderer;

  constructor(
    world: ChurchScene,
    apiKey: string,
    onError: (error: unknown) => void,
  ) {
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    tiles.registerPlugin(
      new GLTFExtensionsPlugin({
        dracoLoader: new DRACOLoader().setDecoderPath(DRACO_DECODER),
      }),
    );
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.registerPlugin(
      new ReorientationPlugin({
        lat: site.lat * MathUtils.DEG2RAD,
        lon: site.lon * MathUtils.DEG2RAD,
        height: site.elevation_m + GEOID_OFFSET_M,
      }),
    );
    tiles.setCamera(world.camera);
    tiles.setResolutionFromRenderer(world.camera, world.renderer);
    tiles.addEventListener("load-error", (e: { tile: unknown; error: unknown }) => {
      // Root tileset failure = auth/billing problem; single tile failures are not fatal.
      if (e.tile === null) onError(e.error);
    });

    this.tiles = tiles;
    world.scene.add(tiles.group);
    world.beforeFrame(() => {
      if (!tiles.group.visible) return;
      world.camera.updateMatrixWorld();
      tiles.setResolutionFromRenderer(world.camera, world.renderer);
      tiles.update();
    });
  }

  set visible(v: boolean) {
    this.tiles.group.visible = v;
  }

  /** Google requires its logo and data attributions to be visible. */
  renderAttributions(el: HTMLElement) {
    const nodes = this.tiles.getAttributions().map((a) => {
      if (a.type === "image") {
        const img = document.createElement("img");
        img.src = String(a.value);
        img.alt = "Google";
        return img;
      }
      return document.createTextNode(String(a.value));
    });
    el.replaceChildren(...nodes);
  }
}
