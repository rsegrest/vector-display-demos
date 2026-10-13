#!/usr/bin/env node
// Serves a demo, opens it in headless Chrome with software WebGL2, and saves screenshots.
//
//   node tools/screenshot.mjs <vite-root> <out-prefix> [--path lenia/] [--query "seed=1"] [--at 3,8,15] [--eval "js"] [--size 1280x800]
//       [--chrome-flags "--autoplay-policy=no-user-gesture-required"]
//
// Prints page errors and any value returned by --eval, and exits non-zero on a page error.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const [demoDir, outPrefix] = args;
if (!demoDir || !outPrefix) {
  console.error("usage: screenshot.mjs <demo-dir> <out-prefix> [--query q] [--at s1,s2] [--eval js] [--size WxH]");
  process.exit(2);
}
const query = option("query", "");
const routePath = option("path", "");
const shotTimes = option("at", "4").split(",").map(Number);
const evalBeforeShots = option("eval", "");
const [width, height] = option("size", "1280x800").split("x").map(Number);
// Extra Chrome switches, space separated: e.g. letting a page start audio without a key press.
const chromeFlags = option("chrome-flags", "").split(" ").filter(Boolean);
const port = 5300 + Math.floor(Math.random() * 400);
const debugPort = 9400 + Math.floor(Math.random() * 400);

// Software WebGL2 on this host needs an X display and these flags (see vector-games/asteroids/tools/smoke.mjs).
const display = process.env.SMOKE_DISPLAY ?? (existsSync("/tmp/.X11-unix/X99") ? ":99" : process.env.DISPLAY);
const chrome = [process.env.CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn("npx", ["vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
  cwd: resolve(demoDir),
  stdio: "ignore",
});
let browser;
let profile;
let exitCode = 0;
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
    } catch {}
    if (i > 80) throw new Error("dev server did not start");
    await sleep(250);
  }
  profile = mkdtempSync(join(tmpdir(), "demo-shot-"));
  browser = spawn(
    chrome,
    [
      "--headless=new", "--no-sandbox", "--mute-audio",
      "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=gl-egl",
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
      ...chromeFlags,
      "about:blank",
    ],
    { stdio: "ignore", env: { ...process.env, DISPLAY: display } },
  );
  let target;
  for (let i = 0; !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === "page");
    } catch {}
    if (i > 100) throw new Error("no page target");
    await sleep(100);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let sequence = 0;
  const errors = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(message.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  });
  const cdp = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++sequence;
      const onMessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        ws.removeEventListener("message", onMessage);
        message.error ? rej(new Error(`${method}: ${message.error.message}`)) : res(message.result);
      };
      ws.addEventListener("message", onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Page.navigate", { url: `http://127.0.0.1:${port}/${routePath}${query ? `?${query}` : ""}` });

  const started = Date.now();
  let evaluated = false;
  for (const seconds of shotTimes) {
    if (!evaluated && evalBeforeShots) {
      await sleep(1500);
      console.log("eval:", JSON.stringify(await evaluate(evalBeforeShots)));
      evaluated = true;
    }
    await sleep(Math.max(0, seconds * 1000 - (Date.now() - started)));
    const shot = await cdp("Page.captureScreenshot", { format: "png" });
    const file = `${outPrefix}-${seconds}s.png`;
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log("saved", file);
  }
  console.log("webgl2:", await evaluate("!!document.createElement('canvas').getContext('webgl2')"));
  if (errors.length) {
    console.log("PAGE ERRORS:\n" + errors.join("\n"));
    exitCode = 1;
  }
  ws.close();
} catch (error) {
  console.error("screenshot failed:", error.message);
  exitCode = 1;
} finally {
  browser?.kill("SIGKILL");
  server.kill("SIGTERM");
  // Chrome may still be writing its profile for a moment after being killed.
  await sleep(300);
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(exitCode);
