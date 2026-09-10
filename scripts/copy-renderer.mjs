import { copyFile, cp, mkdir, rm } from "node:fs/promises";

// Full wipe: tsc leaves behind output for source files that were since deleted,
// and those stale modules used to get packed into the shipped asar.
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("src/renderer", "dist/renderer", { recursive: true, force: true });
await cp("src/assets", "dist/assets", { recursive: true, force: true });
await copyFile("src/main.cjs", "dist/main.cjs");
