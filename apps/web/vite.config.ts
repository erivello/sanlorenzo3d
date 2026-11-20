import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev-only editing API: the viewer reads and saves GeoJSON files in place.
 * - /__sl3d/houses   → content/local/case.geojson (git-ignored: the repo is public)
 * - /__sl3d/boundary → content/boundary.geojson   (village boundary editor)
 * Both paths are excluded from the watcher, so saving does not reload the page.
 * Nothing of this reaches a build.
 */
const CONTENT = resolve(__dirname, "../../content");
const FILES: Record<string, string> = {
  houses: resolve(CONTENT, "local/case.geojson"),
  boundary: resolve(CONTENT, "boundary.geojson"),
};
const EMPTY = { type: "FeatureCollection", features: [] };

function geojsonDevApi(): Plugin {
  return {
    name: "sl3d-geojson-dev-api",
    apply: "serve",
    configureServer(server) {
      for (const [name, file] of Object.entries(FILES)) server.middlewares.use(`/__sl3d/${name}`, fileHandler(file));
    },
  };
}

function fileHandler(file: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "GET") {
        const text = await readFile(file, "utf8").catch(() => JSON.stringify(EMPTY));
        res.setHeader("Content-Type", "application/geo+json");
        res.end(text);
        return;
      }
      if (req.method === "PUT") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("not a FeatureCollection");
        await mkdir(dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(data, null, 1) + "\n");
        await rename(tmp, file); // atomic: never a half-written file
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 405;
      res.end();
    } catch (err) {
      res.statusCode = 400;
      res.end(String(err));
    }
  };
}

export default defineConfig({
  server: {
    port: 5173,
    // Saving from the viewer must not reload the page.
    watch: { ignored: ["**/content/local/**", "**/content/boundary.geojson"] },
  },
  plugins: [geojsonDevApi()],
});
