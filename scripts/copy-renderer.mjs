import { copyFile, cp, mkdir, rm } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await rm("dist/renderer", { recursive: true, force: true });
await rm("dist/assets", { recursive: true, force: true });
await rm("dist/helpers", { recursive: true, force: true });
await cp("src/renderer", "dist/renderer", { recursive: true, force: true });
await cp("src/assets", "dist/assets", { recursive: true, force: true });
await cp("src/helpers", "dist/helpers", { recursive: true, force: true });
await copyFile("src/main.cjs", "dist/main.cjs");
