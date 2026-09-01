import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadTheme } from "../scripts/injector.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const macosRoot = path.resolve(here, "..");
const writer = path.join(macosRoot, "scripts", "write-theme.mjs");
const fixtureImage = path.join(macosRoot, "assets", "portal-hero.png");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${command} exited with ${code}`));
    });
  });
}

test("custom theme writer matches the injector text and task-mode contract", async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "dreamskin-write-contract."));
  try {
    await fs.copyFile(fixtureImage, path.join(output, "background.png"));
    const longTagline = "界".repeat(130);
    const longQuote = "光".repeat(130);
    await run(process.execPath, [
      writer,
      "custom",
      "--output-dir", output,
      "--image", "background.png",
      "--name", "Writer contract fixture",
      "--tagline", longTagline,
      "--quote", longQuote,
      "--task-mode", "full",
      "--theme-id", "img-contract-1",
      "--category", "nature",
      "--tags-json", '["森林","收藏"]',
      "--accent", "#12AB34",
    ]);

    const raw = JSON.parse(await fs.readFile(path.join(output, "theme.json"), "utf8"));
    assert.equal(Array.from(raw.tagline).length, 120);
    assert.equal(Array.from(raw.quote).length, 120);
    assert.equal(raw.art.taskMode, "full");
    assert.equal(raw.id, "img-contract-1");
    assert.equal(raw.category, "nature");
    assert.deepEqual(raw.tags, ["森林", "收藏"]);
    assert.equal(raw.colors.accent, "#12ab34");

    const loaded = await loadTheme(output);
    assert.equal(loaded.theme.tagline, "界".repeat(120));
    assert.equal(loaded.theme.quote, "光".repeat(120));
    assert.equal(loaded.theme.art.taskMode, "full");
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});

test("custom theme writer emits the shared framing contract", async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "dreamskin-write-framing."));
  try {
    await fs.copyFile(fixtureImage, path.join(output, "background.png"));
    await run(process.execPath, [
      writer, "custom", "--output-dir", output, "--image", "background.png",
      "--name", "Framing fixture", "--position-x", "0.35", "--position-y", "-0.2",
      "--zoom", "1.6", "--position-mode", "free",
    ]);
    const raw = JSON.parse(await fs.readFile(path.join(output, "theme.json"), "utf8"));
    assert.deepEqual(raw.art, {
      safeArea: "auto", taskMode: "auto", positionX: 0.35, positionY: -0.2,
      zoom: 1.6, positionMode: "free", framingEnabled: true,
    });
    const loaded = await loadTheme(output);
    assert.equal(loaded.theme.art.positionMode, "free");
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});
