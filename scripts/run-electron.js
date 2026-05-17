// Spawns the Electron binary with ELECTRON_RUN_AS_NODE removed from the env.
// VSCode sets ELECTRON_RUN_AS_NODE=1 in its terminal, which makes Electron act
// as plain Node.js and breaks require("electron") / import ... from "electron".
const { spawn } = require("child_process");
const electronPath = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env,
  cwd: process.cwd(),
});

child.on("exit", (code) => process.exit(code ?? 1));
