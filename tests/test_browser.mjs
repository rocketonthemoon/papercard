// Clicks through Grammar Duel in headless Chrome (DevTools protocol, no dependencies) and saves screenshots.
// Needs a server with ALLOW_DEV_LOGIN=1.  Usage: node tests/test_browser.mjs [url] [outDir] [--mobile] [--light]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const flags = new Set(process.argv.filter((a) => a.startsWith("--")));
const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const url = pos[0] ?? "http://localhost:8080/";
const outDir = pos[1] ?? os.tmpdir();
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "duel-chrome-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${profile}`, "--window-size=1300,1000", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch("http://127.0.0.1:9334/json")).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {
    await sleep(200);
  }
}
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === "Runtime.exceptionThrown") logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const waitFor = async (expr, what) => {
  for (let i = 0; i < 60; i++) {
    if (await js(expr)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
};
const shot = async (name) => {
  const png = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const file = path.join(outDir, `duel-${name}${flags.has("--mobile") ? "-mobile" : ""}${flags.has("--light") ? "-light" : ""}.png`);
  fs.writeFileSync(file, Buffer.from(png.result.data, "base64"));
  console.log("screenshot:", file);
};

await send("Runtime.enable");
await send("Page.enable");
if (flags.has("--mobile")) await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
if (flags.has("--light")) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

try {
  await send("Page.navigate", { url });
  await waitFor(`!!document.getElementById("signin")`, "landing page");
  await shot("1-landing");

  await js(`document.getElementById("dev-name").value = "Tester ${Date.now() % 1000}"; document.getElementById("dev-login").requestSubmit()`);
  await waitFor(`!!document.querySelector(".unit-banner")`, "learn path after sign-in");
  await shot("2-learn-path");
  await js(`location.hash = "#/play"`);
  await waitFor(`!!document.getElementById("create") && document.getElementById("r-text").textContent !== "Loading…"`, "play hub");
  await shot("2-play");

  await js(`document.getElementById("create").click()`);
  await waitFor(`!!document.getElementById("answer")`, "duel page");
  await waitFor(`document.querySelectorAll("#marks mark").length > 0`, "underlined mistakes");
  console.log("duel opened, underlined mistakes:", await js(`document.querySelectorAll("#marks mark").length`));
  // Fix one obvious mistake per kind we know is in every random text: just tidy "alot" and "could of" if present.
  await js(`(() => { const a = document.getElementById("answer"); a.value = a.value.replace(/\\balot\\b/g, "a lot").replace(/could of/g, "could have").replace(/\\bwas\\b/, "were"); a.dispatchEvent(new Event("input")); })()`);
  await shot("3-play");

  await js(`window.confirm = () => true; document.getElementById("submit").click()`);
  await waitFor(`!!document.querySelector(".score b")`, "results");
  const result = await js(`({ score: document.querySelector(".score b").textContent, max: document.querySelector(".score .muted").textContent, board: document.querySelectorAll(".people li").length, answers: document.querySelectorAll(".rows .answer").length })`);
  console.log("results:", JSON.stringify(result));
  await shot("4-results");

  // Free practice: load a text, fix one mistake, check, open a hint.
  await js(`location.hash = "#/learn/free"`);
  await waitFor(`document.querySelectorAll("#l-list .answer").length > 0 && document.querySelectorAll("#l-marks mark").length > 0`, "learn text");
  const before = await js(`document.querySelectorAll("#l-marks mark").length`);
  await js(`(() => { const t = document.getElementById("l-answer"); const w = document.querySelector("#l-marks mark").textContent; const at = t.value.indexOf(w); t.value = t.value.slice(0, at) + "XX" + t.value.slice(at + w.length); t.dispatchEvent(new Event("input")); document.getElementById("l-check").click(); })()`);
  await waitFor(`/fixed|new/.test(document.getElementById("l-status").textContent)`, "learn check");
  await js(`document.querySelector("#l-list [data-show=hint]")?.click()`);
  const learn = await js(`({ underlinedBefore: ${before}, status: document.getElementById("l-status").textContent.trim(), hintShown: !!document.querySelector("#l-list [data-hint]:not([hidden])") })`);
  console.log("learn:", JSON.stringify(learn));
  await shot("5-free-practice");

  // A Learn lesson: answer the first challenge (any option, or Harper's answer for a fix).
  await js(`location.hash = "#/learn"`);
  await waitFor(`!!document.querySelector(".node.current")`, "path");
  await js(`document.querySelector(".node.current").click()`);
  await waitFor(`!!(document.querySelector(".option") || document.getElementById("ltext"))`, "lesson");
  await js(`(document.querySelector(".option") ?? null)?.click(); const t = document.getElementById("ltext"); if (t) { t.value = "Xx " + t.value; t.dispatchEvent(new Event("input")); } document.getElementById("action").click();`);
  await waitFor(`/right|wrong/.test(document.getElementById("foot").className)`, "lesson feedback");
  console.log("lesson feedback:", await js(`document.getElementById("feedback").textContent.trim().slice(0, 80)`));
  await shot("6-lesson");
} catch (e) {
  console.error("FAILED:", e.message);
  await shot("failure");
  process.exitCode = 1;
}
if (logs.length) console.log("page errors:\n" + logs.join("\n"));
ws.close();
proc.kill();
