import { MathUtils, Matrix4, Raycaster, Vector3 } from "three";
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
  church_offset_m: [number, number, number];
}

export const site = parse(siteYaml) as Site;

// Geoid undulation (EGM96) around Vittorio Veneto: ellipsoid height ≈ MSL + ~47 m.
// The tiles live on the WGS84 ellipsoid, so the origin must use ellipsoid height.
const GEOID_OFFSET_M = 47;

const DOWN = new Vector3(0, -1, 0);
const DRACO_DECODER = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
// Google logo for dark backgrounds, served by Google for Maps attribution.
const GOOGLE_LOGO = "https://maps.gstatic.com/mapfiles/api-3/images/google_white5_hdpi.png";

/**
 * Google Photorealistic 3D Tiles, re-centred so the site (lat/lon) sits at the
 * three.js origin. Resulting frame (measured): +x west, +z north, +y up, metres.
 * To place geo data, use tiles.ellipsoid + tiles.group.matrixWorld rather than
 * hand-written axis conversions.
 */
export class GoogleTiles {
  readonly tiles: TilesRenderer;

  constructor(
    world: ChurchScene,
    apiKey: string,
    onError: (error: unknown) => void,
  ) {
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true, logoUrl: GOOGLE_LOGO }));
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

  /** True once the root tileset is loaded and the frame is oriented. */
  get ready() {
    return !!this.tiles.root;
  }

  /** WGS84 degrees → scene position (y = ellipsoid height 0, use groundAt for terrain). */
  toScene(lat: number, lng: number, target = new Vector3()) {
    const t = this.tiles;
    t.group.updateMatrixWorld(true);
    t.ellipsoid.getCartographicToPosition(lat * MathUtils.DEG2RAD, lng * MathUtils.DEG2RAD, 0, target);
    return target.applyMatrix4(t.group.matrixWorld);
  }

  /** Scene position → WGS84 degrees. */
  toLatLng(p: Vector3) {
    const t = this.tiles;
    t.group.updateMatrixWorld(true);
    const local = p.clone().applyMatrix4(new Matrix4().copy(t.group.matrixWorld).invert());
    const c = t.ellipsoid.getPositionToCartographic(local, {} as { lat: number; lon: number });
    return { lat: c.lat * MathUtils.RAD2DEG, lng: c.lon * MathUtils.RAD2DEG };
  }

  /** Terrain height under (x, z), if the tiles there are loaded. */
  groundAt(x: number, z: number): number | undefined {
    this.raycaster.set(new Vector3(x, 5000, z), DOWN);
    return this.raycaster.intersectObject(this.tiles.group, true)[0]?.point.y;
  }

  private raycaster = new Raycaster();

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
