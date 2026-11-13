import "./style.css";
import { pois } from "./content";
import { ChurchScene, type CameraPose } from "./scene";
import { setupTour } from "./tour";

const world = new ChurchScene(document.getElementById("viewport")!);
const overview: CameraPose = world.pose();
const loading = document.getElementById("loading")!;

world
  .loadSplat()
  .then(() => loading.remove())
  .catch((err) => {
    console.error(err);
    loading.textContent = "Impossibile caricare lo splat (vedi console).";
  });

setupTour(world, pois, overview);

// Authoring helpers (see AGENTS.md → Convenzioni 3D)
window.addEventListener("keydown", (e) => {
  if (e.key === "p" || e.key === "P") {
    const pose = world.pose();
    console.info(
      `camera:\n  position: [${pose.position.join(", ")}]\n  target: [${pose.target.join(", ")}]`,
    );
  }
});
world.renderer.domElement.addEventListener("click", (e) => {
  if (!e.shiftKey) return;
  const hit = world.pick(e.clientX, e.clientY);
  console.info(
    hit
      ? `anchor: [${hit.toArray().map((n) => n.toFixed(3)).join(", ")}]`
      : "Nessun punto dello splat sotto il cursore",
  );
});
