import { cp, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await cp("index.html", "dist/index.html");
await cp("index.html", "dist/korwinki.html");
await cp("public", "dist", { recursive: true });
