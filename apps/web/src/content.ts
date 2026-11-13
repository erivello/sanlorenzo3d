import { parse } from "yaml";

export type Vec3 = [number, number, number];

export interface Source {
  title: string;
  url?: string;
  note?: string;
}

export interface Poi {
  id: string;
  title: string;
  order: number;
  status: "bozza" | "da-verificare" | "verificato";
  anchor: Vec3;
  camera: { position: Vec3; target: Vec3 };
  sources: Source[];
  body: string;
}

const files = import.meta.glob("../../../content/pois/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parsePoi(path: string, raw: string): Poi {
  const match = FRONTMATTER.exec(raw.replace(/\r\n/g, "\n"));
  if (!match) throw new Error(`POI senza frontmatter: ${path}`);
  const data = parse(match[1]) as Omit<Poi, "body">;
  for (const key of ["id", "title", "anchor", "camera"] as const) {
    if (data[key] == null) throw new Error(`POI ${path}: campo "${key}" mancante`);
  }
  return { ...data, sources: data.sources ?? [], body: match[2].trim() };
}

export const pois: Poi[] = Object.entries(files)
  .map(([path, raw]) => parsePoi(path, raw))
  .sort((a, b) => a.order - b.order);

/** Minimal markdown → HTML: paragraphs, **bold**, *italic*. Content is first-party. */
export function renderBody(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return md
    .split(/\n{2,}/)
    .map((p) =>
      `<p>${esc(p)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")}</p>`,
    )
    .join("");
}
