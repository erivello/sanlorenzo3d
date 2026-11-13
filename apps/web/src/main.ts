import "./style.css";
import { pois } from "./content";
import { VillageBoundary } from "./boundary";
import { GoogleTiles } from "./exterior";
import { setupKeyboard } from "./keyboard";
import { CHURCH, Modes } from "./modes";
import { ChurchScene, type CameraPose } from "./scene";
import { StreetView, headingOf } from "./streetview";
import { setupTour } from "./tour";
import { Vector3 } from "three";

const world = new ChurchScene(document.getElementById("viewport")!);

// Keep the camera target in the part of the screen not covered by the panel.
const panel = document.getElementById("panel")!;
const updateInsets = () => {
  const r = panel.getBoundingClientRect();
  const side = window.innerWidth > 640;
  world.setInsets(side ? { left: r.right } : { bottom: window.innerHeight - r.top });
};
new ResizeObserver(updateInsets).observe(panel);
window.addEventListener("resize", updateInsets);
const interiorOverview: CameraPose = world.pose();
const loading = document.getElementById("loading")!;
const notice = document.getElementById("notice")!;

const splatReady = world.loadSplat().catch((err) => {
  console.error(err);
  loading.textContent = "Impossibile caricare lo splat (vedi console).";
  throw err;
});

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
let modes: Modes;
const tiles = apiKey
  ? new GoogleTiles(world, apiKey, (err) => {
      console.error("Google 3D Tiles non disponibili:", err);
      notice.textContent =
        "Vista del paese non disponibile: controlla la chiave Google e che la fatturazione sia attiva.";
      notice.hidden = false;
      modes.disableExterior();
    })
  : undefined;
modes = new Modes(world, interiorOverview, tiles);
if (!tiles) document.body.dataset.exterior = "off";

setupTour(world, pois, interiorOverview);

// --- Village boundary (ISTAT) ------------------------------------------------
const boundary = tiles
  ? new VillageBoundary(world, tiles, document.getElementById("village-labels")!)
  : undefined;
if (boundary) {
  modes.attachBoundary(boundary);
  const toggle = document.getElementById("boundary-toggle") as HTMLInputElement;
  toggle.onchange = () => (boundary.on = toggle.checked);
}

// --- Street View -----------------------------------------------------------
const street = tiles && apiKey ? new StreetView(world, tiles, apiKey) : undefined;
const streetStatus = document.getElementById("street-status")!;
const doorstepBtn = document.getElementById("street-church") as HTMLButtonElement;
if (street) {
  modes.attachStreetView(street);
  street
    .init()
    .then(async () => {
      // Wait for the tiles frame, then discover coverage around the church.
      while (!tiles!.ready) await new Promise((r) => setTimeout(r, 200));
      const church = tiles!.toLatLng(new Vector3(...CHURCH));
      const start = await street.nearest(church.lat, church.lng, 150);
      if (!start) {
        streetStatus.textContent = "Nessuna Street View vicino alla chiesa.";
        return;
      }
      doorstepBtn.disabled = false;
      doorstepBtn.onclick = () => {
        const toChurch = new Vector3(...CHURCH).sub(start.pos);
        modes.openStreet(start, headingOf(toChurch));
      };
      await street.crawl(start, (n) => (streetStatus.textContent = `Cerco le vie… ${n} panorami`));
      streetStatus.textContent = "Clicca su una via blu per scendere in strada.";
    })
    .catch((err) => {
      console.error("Street View non disponibile:", err);
      streetStatus.textContent =
        "Street View non disponibile: abilita la Maps JavaScript API per la chiave.";
    });

  // Click (not drag) on the terrain near a blue street → open the panorama there.
  let down: { x: number; y: number } | undefined;
  const canvas = world.renderer.domElement;
  canvas.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener("click", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    if (modes.mode !== "exterior" || modes.streetOpen || e.shiftKey) return;
    const pano = street.pick(world.camera, canvas, e.clientX, e.clientY);
    if (!pano) return;
    const dir = world.camera.getWorldDirection(new Vector3());
    modes.openStreet(pano, headingOf(dir));
  });
  document.getElementById("street-close")!.onclick = () => modes.closeStreet();
  document.getElementById("street-enter")!.onclick = () => modes.enterChurch();
} else {
  streetStatus.textContent = "";
}

setupKeyboard(
  world,
  () =>
    modes.mode === "exterior"
      ? // ~0.8× height above the church ground: slow near roofs, fast up high.
        Math.max(5, world.camera.position.y * 0.8)
      : 1,
  () => !modes.streetOpen, // Street View has its own keyboard controls
);

document.getElementById("enter")!.onclick = () => modes.enterChurch();
document.getElementById("exit")!.onclick = () => modes.exitToVillage();

splatReady.then(() => {
  loading.remove();
  if (modes.hasExterior) modes.flyIntoVillage();
});

if (import.meta.env.DEV) Object.assign(window, { __sl3d: { world, tiles, modes, street, boundary } });

// Authoring helpers (see AGENTS.md → Convenzioni 3D)
window.addEventListener("keydown", (e) => {
  if (e.key === "p" || e.key === "P") {
    const pose = world.pose();
    console.info(
      `[${modes.mode}] camera:\n  position: [${pose.position.join(", ")}]\n  target: [${pose.target.join(", ")}]`,
    );
  }
});
world.renderer.domElement.addEventListener("click", (e) => {
  if (!e.shiftKey || modes.mode !== "interior") return;
  const hit = world.pick(e.clientX, e.clientY);
  console.info(
    hit
      ? `anchor: [${hit.toArray().map((n) => n.toFixed(3)).join(", ")}]`
      : "Nessun punto dello splat sotto il cursore",
  );
});
