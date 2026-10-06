/**
 * 身分制對卡：grammarKey → 種子卡；錯誤動詞名不可靠「現在時」撞卡
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function fail(msg) {
  console.error("FAIL", msg);
  process.exit(1);
}
function ok(msg) {
  console.log("ok", msg);
}

function load() {
  const ctx = {
    console,
    Storage: {
      saveRules() {},
      loadRules() {
        return [];
      },
    },
    crypto: { randomUUID: () => "r_test" },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(path.join(here, "analyzer.js"), "utf8") + "\nglobalThis.Analyzer = Analyzer;",
    ctx
  );
  vm.runInContext(
    fs.readFileSync(path.join(here, "fr-parse.js"), "utf8") + "\nglobalThis.FrParse = FrParse;",
    ctx
  );
  vm.runInContext(
    fs.readFileSync(path.join(here, "rules.js"), "utf8") + "\nglobalThis.RulesService = RulesService;",
    ctx
  );
  return { Rules: ctx.RulesService, FrParse: ctx.FrParse, Analyzer: ctx.Analyzer };
}

const { Rules, FrParse } = load();

const avoir = {
  id: "seed-avoir-present",
  title: "現在時（avoir）",
  category: "變位",
  endings: { je: "ai|j'ai|n'ai", tu: "as", il: "a", nous: "avons", vous: "avez", ils: "ont" },
};
const negation = {
  id: "seed-negation-ne-pas",
  title: "否定（ne…pas）",
  category: "否定",
  has_persons: false,
  keywords: ["pas", "ne", "n'", "n"],
  endings: { je: "", tu: "", il: "", nous: "", vous: "", ils: "" },
};
const ppEr = {
  id: "seed-pp-er",
  title: "過去分詞（-é）",
  category: "時態",
  endings: { je: "-é", tu: "-é", il: "-é", nous: "-é", vous: "-é", ils: "-é" },
};
const pouvoirImp = {
  id: "seed-pouvoir-imparfait",
  title: "未完成過去（pouvoir imparfait）",
  category: "變位",
  endings: {
    je: "pouvais",
    tu: "pouvais",
    il: "pouvait",
    nous: "pouvions",
    vous: "pouviez",
    ils: "pouvaient",
  },
};
const prendre = {
  id: "user-prendre-present",
  title: "現在時（prendre présent）",
  category: "變位",
  endings: {
    je: "prends",
    tu: "prends",
    il: "prend",
    nous: "prenons",
    vous: "prenez",
    ils: "prennent",
  },
};

Rules.setAll([avoir, negation, ppEr, pouvoirImp]);

{
  const q = "Je n'ai pas déjeuné.";
  const tokens = FrParse.tokenize(q);
  const cands = FrParse.deterministicFunctions(q, tokens);
  const local = FrParse.localConfirmedFromCandidates(cands);
  const items = FrParse.functionsToItems(tokens, local.functions, cands, {
    src: q,
    candidateDecisions: local.decisions,
  });
  const attached = Rules.attachLocalRulesToInventory(q, { items });
  const ids = attached.items.filter((it) => it.localAttached).map((it) => it.localRuleId);
  if (!ids.includes("seed-negation-ne-pas")) fail(`negation not attached ${ids} ${attached.items.map((i) => i.name + ":" + i.grammarKey)}`);
  if (!ids.includes("seed-avoir-present")) fail(`avoir not attached ${ids}`);
  if (!ids.includes("seed-pp-er")) fail(`-é not attached ${ids}`);
  ok("Je n'ai pas déjeuné. keys attach to seed cards");
}

{
  const hit = Rules.findInventoryRule({
    name: "未完成過去（pouvoir imparfait）",
    span: "pouvais",
    grammarKey: "verb:pouvoir:imparfait",
  });
  if (!hit.owned || hit.rule?.id !== "seed-pouvoir-imparfait") {
    fail(`pouvais key should own pouvoir card, got ${hit.rule?.title}`);
  }
  ok("grammarKey verb:pouvoir:imparfait owns seed card");
}

Rules.setAll([prendre, ppEr]);
{
  const miss = Rules.findInventoryRule({
    name: "現在時（dire présent）",
    span: "dit",
    grammarKey: "verb:dire:present",
  });
  if (miss.owned) {
    fail(`dire key must not own prendre, got ${miss.rule?.title}`);
  }
  ok("verb:dire:present does not attach prendre");
}

{
  const miss = Rules.findInventoryRule({
    name: "過去分詞（-é）",
    span: "assis",
    grammarKey: "pp:e",
  });
  if (miss.owned) fail(`assis + pp:e must not own -é, got ${miss.rule?.title}`);
  ok("pp:e + assis is not owned");
}

{
  const hit = Rules.findInventoryRule({
    name: "過去分詞（-é）",
    span: "déjeuné",
    grammarKey: "pp:e",
  });
  if (!hit.owned || hit.rule?.id !== "seed-pp-er") fail(`déjeuné + pp:e should own -é`);
  ok("pp:e + déjeuné owns -é");
}

{
  const quon = {
    id: "user-quon",
    title: "que 接 on 省音（qu'on）",
    category: "句型",
    has_persons: false,
    keywords: ["qu'on", "on"],
    endings: { je: "", tu: "", il: "", nous: "", vous: "", ils: "" },
  };
  Rules.setAll([quon]);
  const miss = Rules.findInventoryRule({
    name: "主語代詞（on）",
    span: "on",
    grammarKey: "pron:subj",
  });
  if (miss.owned) fail(`on must not own qu'on, got ${miss.rule?.title}`);
  ok("主語代詞（on） does not attach 省音（qu'on）");
}

{
  const cleaned = FrParse.cleanGrammarName("現在時（se_souvenir présent）");
  if (cleaned !== "souvenir 現在時（présent）") fail(`cleanGrammarName ${cleaned}`);
  const regular = FrParse.cleanGrammarName("durer 現在時（présent）");
  if (regular !== "現在時（-er présent）") fail(`regular verb should share -er card, got ${regular}`);
  ok("se_souvenir name is cleaned; regular durer shares -er présent");
}

{
  const fromOld = FrParse.cleanGrammarName("現在時（se souvenir）");
  if (fromOld !== "souvenir 現在時（présent）") fail(`現在時（se souvenir） → ${fromOld}`);
  ok("現在時（se souvenir） rewrites to souvenir 現在時（présent）");
}

{
  const pronCard = {
    id: "user-on",
    title: "主語代詞（on）",
    category: "代詞",
    has_persons: false,
    keywords: ["on"],
    endings: { je: "", tu: "", il: "", nous: "", vous: "", ils: "" },
  };
  if (!Rules.isPronounGrammar(pronCard)) fail("主語代詞 card should be identified as pronoun grammar");
  if (Rules.isPronounGrammar(avoir)) fail("avoir is not a pronoun card");
  ok("pronoun cards are identified for deletion");
}

console.log("ok attach local");
