import { renderBody, type Poi } from "./content";
import type { CameraPose, ChurchScene } from "./scene";

const STATUS_LABEL: Record<Poi["status"], string> = {
  bozza: "Bozza",
  "da-verificare": "Da verificare — contenuto provvisorio",
  verificato: "Verificato",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupTour(world: ChurchScene, pois: Poi[], overview: CameraPose) {
  let current = -1;
  const list = $<HTMLOListElement>("poi-list");
  const detail = $<HTMLElement>("poi-detail");
  const hotspotLayer = $<HTMLDivElement>("hotspots");

  const hotspots = pois.map((poi, i) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = poi.title;
    btn.onclick = () => select(i);
    li.append(btn);
    list.append(li);

    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "hotspot";
    dot.textContent = String(i + 1);
    dot.title = poi.title;
    dot.onclick = () => select(i);
    hotspotLayer.append(dot);
    return dot;
  });

  function select(i: number) {
    current = i;
    const poi = pois[i];
    world.flyTo(poi.camera);
    detail.hidden = false;
    $("poi-title").textContent = poi.title;
    $("poi-status").textContent = STATUS_LABEL[poi.status] ?? poi.status;
    $("poi-status").dataset.status = poi.status;
    $("poi-body").innerHTML = renderBody(poi.body);
    const sources = $<HTMLUListElement>("poi-sources");
    sources.replaceChildren(
      ...poi.sources.map((s) => {
        const li = document.createElement("li");
        if (s.url) {
          const a = document.createElement("a");
          a.href = s.url;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = s.title;
          li.append(a);
        } else li.textContent = s.title;
        if (s.note) li.append(` — ${s.note}`);
        return li;
      }),
    );
    $("poi-sources-wrap").hidden = poi.sources.length === 0;
    list.querySelectorAll("button").forEach((b, j) => b.classList.toggle("active", j === i));
    hotspots.forEach((h, j) => h.classList.toggle("active", j === i));
  }

  $("prev").onclick = () => select((current - 1 + pois.length) % pois.length);
  $("next").onclick = () => select((current + 1) % pois.length);
  $("overview").onclick = () => {
    current = -1;
    detail.hidden = true;
    list.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    hotspots.forEach((h) => h.classList.remove("active"));
    world.flyTo(overview);
  };

  world.onFrame(() => {
    pois.forEach((poi, i) => {
      const p = world.project(poi.anchor);
      const el = hotspots[i];
      el.hidden = !p;
      if (p) el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    });
  });
}
