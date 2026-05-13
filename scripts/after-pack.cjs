const path = require("node:path");
const { execFileSync } = require("node:child_process");

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
};
