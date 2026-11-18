import fs from "node:fs";

const port = 9397;
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});

const send = (method, params = {}) => new Promise((r) => {
  const i = ++id;
  pending.set(i, r);
  ws.send(JSON.stringify({ id: i, method, params }));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const targets = [
  { hash: "#/learn/course/1", name: "course_path" },
  { hash: "#/learn/words", name: "words_list" },
  { hash: "#/u/Tester", name: "profile_view" }
];

for (const t of targets) {
  await send("Runtime.evaluate", { expression: `location.hash = '${t.hash}'; window.__app?.route?.();` });
  await sleep(1500);
  const res = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`tests/${t.name}.png`, Buffer.from(res.result.data, "base64"));
  console.log(`Saved tests/${t.name}.png`);
}

process.exit(0);
