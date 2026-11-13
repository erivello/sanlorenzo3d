import "./style.css";
import { pois } from "./content";
import { GoogleTiles } from "./exterior";
import { setupKeyboard } from "./keyboard";
import { Modes } from "./modes";
import { ChurchScene, type CameraPose } from "./scene";
import { setupTour } from "./tour";

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

setupKeyboard(world, () =>
  modes.mode === "exterior"
    ? // ~0.8× height above the church ground: slow near roofs, fast up high.
      Math.max(5, world.camera.position.y * 0.8)
    : 1,
);

document.getElementById("enter")!.onclick = () => modes.enterChurch();
document.getElementById("exit")!.onclick = () => modes.exitToVillage();

splatReady.then(() => {
  loading.remove();
  if (modes.hasExterior) modes.flyIntoVillage();
});

if (import.meta.env.DEV) Object.assign(window, { __sl3d: { world, tiles, modes } });

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
