const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

/**
 * GPU files Electron ships for workloads BayanFlow does not have.
 * The dock and settings windows are plain HTML with no WebGL, WebGPU or canvas
 * rendering, so the DirectX shader compilers and the SwiftShader software
 * Vulkan driver never load. Worth ~34 MB on disk.
 *
 * Deliberately kept:
 * - ffmpeg.dll holds the Opus encoder MediaRecorder needs for audio/webm.
 * - libGLESv2.dll / libEGL.dll are ANGLE, which still backs window compositing.
 * - d3dcompiler_47.dll is ANGLE's runtime shader compiler on the D3D11 path.
 * - LICENSES.chromium.html is required Chromium attribution.
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

  const exeName = context.packager.appInfo.productFilename + ".exe";
  const executablePath = path.join(context.appOutDir, exeName);
  const rceditPath = path.join(context.packager.projectDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");
  const iconPath = path.join(context.packager.projectDir, "src", "assets", "tray-icon.ico");

  execFileSync(
    rceditPath,
    [
      executablePath,
      "--set-icon",
      iconPath,
      "--set-version-string",
      "ProductName",
      "BayanFlow",
      "--set-version-string",
      "FileDescription",
      "BayanFlow",
      "--set-version-string",
      "InternalName",
      "BayanFlow",
      "--set-version-string",
      "OriginalFilename",
      exeName,
      "--set-version-string",
      "CompanyName",
      "BayanFlow",
    ],
    { stdio: "inherit" },
  );

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
