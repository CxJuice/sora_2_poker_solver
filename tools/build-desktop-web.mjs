import { cp, mkdir, rm } from "node:fs/promises";

const destination = new URL("../dist/", import.meta.url);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const path of ["index.html", "app.js", "game2.js", "draw-worker.js", "game2-worker.js", "desktop-api.js", "styles.css", "tailwind.css", "assets"]) {
  await cp(new URL(`../${path}`, import.meta.url), new URL(path, destination), { recursive: path === "assets" });
}
