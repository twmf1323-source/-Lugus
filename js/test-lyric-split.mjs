/**
 * 法語歌詞本地切行：行長上限、不改寫、不切開省音
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;

function fail(msg) {
  failed += 1;
  console.error("FAIL", msg);
}

function ok(msg) {
  console.log("ok", msg);
}

function load() {
  const ctx = {
    console,
    Storage: {
      loadSettings: () => ({
        apiKey: "",
        baseUrl: "https://example.invalid/v1",
        model: "test-model",
      }),
      DEFAULT_SETTINGS: { baseUrl: "https://example.invalid/v1", model: "test-model" },
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(here, "ai.js"), "utf8"), ctx);
  return ctx.AiService;
}

const AiService = load();
if (!AiService?.enforcePhoneLineLength) {
  fail("AiService.enforcePhoneLineLength missing");
  process.exit(1);
}

function compact(s) {
  return String(s || "").replace(/\s+/g, "");
}

function charLen(s) {
  return Array.from(String(s || "")).length;
}

const HARD = 36;
const short = "Ne me quitte pas";
const shortLines = AiService.enforcePhoneLineLength([short]);
if (shortLines.length !== 1 || shortLines[0] !== short) fail(`short line changed: ${JSON.stringify(shortLines)}`);
else ok("short line kept");

const wall =
  "Sous le ciel de Paris s'envole une chanson elle est née d'aujourd'hui dans le cœur d'un garçon";
const lines = AiService.enforcePhoneLineLength([wall]);
if (!lines.length) fail("wall produced no lines");
if (lines.some((l) => charLen(l) > HARD)) fail(`line longer than ${HARD}: ${JSON.stringify(lines)}`);
else ok(`wall split into ${lines.length} lines ≤${HARD}`);
if (compact(lines.join("")) !== compact(wall)) fail("rewrote source characters");
else ok("source characters preserved");
if (lines.some((l) => /(?:^| )[ldjncsmqt]'?$/i.test(l.trim()))) fail(`split after clitic: ${JSON.stringify(lines)}`);
else ok("did not leave a dangling clitic");
const want = [
  "Sous le ciel de Paris",
  "s'envole une chanson",
  "elle est née d'aujourd'hui",
  "dans le cœur d'un garçon",
];
if (JSON.stringify(lines) !== JSON.stringify(want)) fail(`unexpected split: ${JSON.stringify(lines)}`);
else ok("phrase/image split matches example");

const already = ["Sous le ciel de Paris", "s'envole une chanson"];
const same = AiService.enforcePhoneLineLength(already);
if (same.length !== 2 || same[0] !== already[0] || same[1] !== already[1]) {
  fail(`already-short lines changed: ${JSON.stringify(same)}`);
} else ok("already-short lines kept");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all ok");
