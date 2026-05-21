// Compiles Electron main and preload to ESM using esbuild.
// Electron 42+ requires ESM imports for the electron module — CJS require("electron")
// no longer returns the Electron API in Electron 42 with Node.js 24.
const esbuild = require("esbuild");

const shared = {
  platform: "node",
  target: "node22",
  bundle: true,
  format: "esm",
  packages: "external",
  external: ["electron"],
  tsconfig: "tsconfig.node.json",
  sourcemap: true,
};

async function main() {
  await Promise.all([
    esbuild.build({
      ...shared,
      entryPoints: ["electron/main.ts"],
      outfile: "dist-electron/main.mjs",
    }),
    esbuild.build({
      ...shared,
      entryPoints: ["electron/preload.ts"],
      outfile: "dist-electron/preload.mjs",
    }),
    esbuild.build({
      ...shared,
      entryPoints: ["electron/glow-preload.ts"],
      outfile: "dist-electron/glow-preload.mjs",
    }),
  ]);
  console.log("Electron files built.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
