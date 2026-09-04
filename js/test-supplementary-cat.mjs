/**
 * 補充用法不可被盤點／AI 正規化洗成「其他」
 */
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, "ai.js"), "utf8");

function fail(msg) {
  console.error("FAIL", msg);
  process.exit(1);
}
function ok(msg) {
  console.log("ok", msg);
}

const ctx = {
  Storage: {
    loadSettings() {
      return {};
    },
    DEFAULT_SETTINGS: { baseUrl: "https://api.x.ai/v1" },
  },
  console,
};
vm.createContext(ctx);
vm.runInContext(`${code}\nthis.__Ai = AiService;`, ctx);
const Ai = ctx.__Ai;

const inv = Ai.normalizeInventory({
  i: [
    {
      n: "慣用語（comme ci）",
      c: "補充用法",
      s: "",
      f: "h",
      source: "manual",
      manualRuleId: "r_supp",
    },
  ],
  v: [],
});
const it = inv.items[0];
if (!it) fail("inventory item dropped");
if (it.category !== "補充用法") fail(`category rewritten to ${it.category}`);
if (it.manualRuleId !== "r_supp") fail("manualRuleId lost");
ok("normalizeInventory keeps 補充用法");

const draft = Ai.normalizeDraft(
  { n: "慣用語（comme ci）", c: "句型", e: "說明", p: true, d: { je: "-e" } },
  "慣用語（comme ci）",
  { keepCategory: "補充用法" }
);
if (draft.category !== "補充用法") fail(`draft category ${draft.category}`);
if (draft.has_persons) fail("supplementary draft still has persons");
ok("normalizeDraft keepCategory locks 補充用法");

const passthrough = Ai.normalizeDraft(
  { n: "慣用語（comme ci）", c: "補充用法", e: "說明", p: false },
  "慣用語（comme ci）"
);
if (passthrough.category !== "補充用法") fail(`passthrough ${passthrough.category}`);
ok("AI outputting 補充用法 is not remapped");

console.log("all ok");
