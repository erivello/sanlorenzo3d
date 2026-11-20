import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * House names live in content/local/case.geojson, which is git-ignored (the repo
 * is public). In dev this plugin serves and saves it at /__sl3d/houses so the
 * viewer can edit names in place (Alt+click). Nothing of it reaches a build.
 */
const HOUSES_FILE = resolve(__dirname, "../../content/local/case.geojson");
const EMPTY = { type: "FeatureCollection", features: [] };

function housesDevApi(): Plugin {
  return {
    name: "sl3d-houses-dev-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__sl3d/houses", async (req, res) => {
        try {
          if (req.method === "GET") {
            const text = await readFile(HOUSES_FILE, "utf8").catch(() => JSON.stringify(EMPTY));
            res.setHeader("Content-Type", "application/geo+json");
            res.end(text);
            return;
          }
          if (req.method === "PUT") {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body);
            if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("not a FeatureCollection");
            await mkdir(dirname(HOUSES_FILE), { recursive: true });
            const tmp = `${HOUSES_FILE}.tmp`;
            await writeFile(tmp, JSON.stringify(data, null, 1) + "\n");
            await rename(tmp, HOUSES_FILE); // atomic: never a half-written file
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
      });
    },
  };
}

export default defineConfig({
  server: {
    port: 5173,
    // Saving a name must not reload the page.
    watch: { ignored: ["**/content/local/**"] },
  },
  plugins: [housesDevApi()],
});
