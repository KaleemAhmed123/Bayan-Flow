const fs = require("node:fs");
const path = require("node:path");

/**
 * GPU files Electron ships for workloads BayanFlow does not have.
 * The dock and settings windows are plain HTML with no WebGL, WebGPU or canvas
 * rendering, so the DirectX shader compilers and the SwiftShader software
 * Vulkan driver never load. Worth ~32 MB on disk, measured.
 *
 * Deliberately kept:
 * - ffmpeg.dll holds the Opus encoder MediaRecorder needs for audio/webm.
 * - libGLESv2.dll / libEGL.dll are ANGLE, which still backs window compositing.
 * - d3dcompiler_47.dll is ANGLE's runtime shader compiler on the D3D11 path.
 * - LICENSES.chromium.html is required Chromium attribution.
 *
 * This hook used to also shell out to rcedit for the icon and version strings,
 * because `signAndEditExecutable: false` had switched off electron-builder's own
 * resource editing. That meant reaching into
 * `node_modules/electron-winstaller/vendor/rcedit.exe` — a package four levels
 * deep under a Squirrel target this project does not build, present only because
 * npm hoists it, and never declared as a dependency. A future electron-builder
 * minor could drop it and `npm run dist` would fail with ENOENT after packaging
 * 281 MB. The config now uses `signExecutable: false`, which keeps the icon and
 * metadata and skips only the signing, so none of that is needed.
 */
const REMOVABLE_GPU_FILES = [
  "dxcompiler.dll",
  "dxil.dll",
  "vk_swiftshader.dll",
  "vk_swiftshader_icd.json",
  "vulkan-1.dll",
];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  let removedBytes = 0;
  for (const name of REMOVABLE_GPU_FILES) {
    const target = path.join(context.appOutDir, name);
    try {
      removedBytes += fs.statSync(target).size;
      fs.rmSync(target);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  console.log(`afterPack: removed ${(removedBytes / 1024 / 1024).toFixed(1)} MB of unused GPU files`);
};
