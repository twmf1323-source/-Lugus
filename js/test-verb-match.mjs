/**
 * 動詞專屬卡不可因同為「現在時」誤配（dit ≠ prendre）
 */
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

function fail(msg) {
  console.error("FAIL", msg);
  process.exit(1);
}
function ok(msg) {
  console.log("ok", msg);
}

function load() {
  const analyzer = fs.readFileSync(path.join(here, "analyzer.js"), "utf8");
  const rules = fs.readFileSync(path.join(here, "rules.js"), "utf8");
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
  vm.createContext(ctx);
  vm.runInContext(`${analyzer}\n${rules}\nthis.__R = RulesService; this.__A = Analyzer;`, ctx);
  return { Rules: ctx.__R, Analyzer: ctx.__A };
}

const { Rules, Analyzer } = load();

const prendre = {
  id: "user-prendre-present",
  title: "現在時（prendre présent）",
  category: "變位",
  explanation: "prendre 現在時",
  endings: {
    je: "prends",
    tu: "prends",
    il: "prend",
    nous: "prenons",
    vous: "prenez",
    ils: "prennent",
  },
};
const dire = {
  id: "user-dire-present",
  title: "現在時（dire présent）",
  category: "變位",
  explanation: "dire 現在時",
  endings: {
    je: "dis",
    tu: "dis",
    il: "dit",
    nous: "disons",
    vous: "dites",
    ils: "disent",
  },
};
const erPresent = {
  id: "seed-present-er",
  title: "現在時（-er présent）",
  category: "時態",
  explanation: "規則 -er",
  endings: {
    je: "-e",
    tu: "-es",
    il: "-e",
    nous: "-ons",
    vous: "-ez",
    ils: "-ent",
  },
};
const etre = {
  id: "seed-etre-present",
  title: "現在時（être）",
  category: "變位",
  explanation: "être 現在時",
  endings: {
    je: "suis",
    tu: "es",
    il: "est",
    nous: "sommes",
    vous: "êtes",
    ils: "sont",
  },
};

if (!Analyzer.lookupIrregular("dit") || Analyzer.lookupIrregular("dit").infinitive !== "dire") {
  fail("dit should lookup as dire");
}
ok("dit → dire");

if (!Analyzer.lookupIrregular("souvient") || Analyzer.lookupIrregular("souvient").infinitive !== "souvenir") {
  fail("souvient should lookup as souvenir");
}
ok("souvient → souvenir");

Rules.setAll([prendre, erPresent, etre]);

const ditVsPrendre = Rules.findMatchingRule({
  name: "現在時（dire présent）",
  nameZh: "現在時",
  nameFr: "dire présent",
  span: "dit",
});
if (ditVsPrendre.owned) {
  fail(
    `dit owned by ${ditVsPrendre.rule?.title} (score ${ditVsPrendre.score}) — should be 尚未收錄`
  );
}
ok("dit / dire présent is not owned by prendre card");

const genericPresent = Rules.findMatchingRule({
  name: "現在時（présent）",
  span: "dit",
});
if (genericPresent.owned) {
  fail(`generic 現在時 owned by ${genericPresent.rule?.title}`);
}
ok("generic 現在時 + dit is not owned");

const prendHit = Rules.findMatchingRule({
  name: "現在時（prendre présent）",
  span: "prend",
});
if (!prendHit.owned || prendHit.rule?.id !== "user-prendre-present") {
  fail(`prend should own prendre card, got ${prendHit.rule?.title} owned=${prendHit.owned}`);
}
ok("prend owns 現在時（prendre présent）");

Rules.setAll([prendre, dire, erPresent, etre]);
const ditVsDire = Rules.findMatchingRule({
  name: "現在時（dire présent）",
  span: "dit",
});
if (!ditVsDire.owned || ditVsDire.rule?.id !== "user-dire-present") {
  fail(`dit should own dire card, got ${ditVsDire.rule?.title} owned=${ditVsDire.owned}`);
}
ok("dit owns 現在時（dire présent） when that card exists");

{
  const keyed = Rules.findInventoryRule({
    name: "現在時（dire présent）",
    span: "dit",
    grammarKey: "verb:dire:present",
  });
  if (!keyed.owned || keyed.rule?.id !== "user-dire-present") {
    fail(`dire key should own dire card, got ${keyed.rule?.title} owned=${keyed.owned}`);
  }
  ok("grammarKey verb:dire:present owns dire card");
}

const parlerGeneric = Rules.findMatchingRule({
  name: "現在時（-er présent）",
  span: "parle",
  grammarKey: "verb:er:present",
});
if (!parlerGeneric.owned || parlerGeneric.rule?.id !== "seed-present-er") {
  fail(`parle should own -er présent, got ${parlerGeneric.rule?.title} owned=${parlerGeneric.owned}`);
}
ok("regular parle owns 現在時（-er présent）");

const avoir = {
  id: "seed-avoir-present",
  title: "avoir 直陳式現在時（助動詞）",
  category: "變位",
  explanation: "avoir 現在時常用作 passé composé 助動詞。",
  endings: {
    je: "ai|j'ai|n'ai",
    tu: "as|n'as",
    il: "a|n'a",
    nous: "avons",
    vous: "avez",
    ils: "ont",
  },
};
Rules.setAll([avoir, erPresent, etre]);
if (Analyzer.mentionsInfinitive("avoir 直陳式現在時（助動詞）", "voir")) {
  fail("avoir title must not mention voir");
}
ok("avoir title does not mention voir");

const voirInf = Rules.findMatchingRule({
  name: "不定式",
  nameZh: "不定式",
  span: "y voir",
});
if (voirInf.owned) {
  fail(`y voir / 不定式 owned by ${voirInf.rule?.title} (score ${voirInf.score})`);
}
ok("不定式 y voir is not owned by avoir present");

const aiHit = Rules.findMatchingRule({
  name: "現在時（avoir）",
  span: "ai",
});
if (!aiHit.owned || aiHit.rule?.id !== "seed-avoir-present") {
  fail(`ai should own avoir card, got ${aiHit.rule?.title} owned=${aiHit.owned}`);
}
ok("ai still owns avoir present");

const ppEr = {
  id: "seed-pp-er",
  title: "過去分詞（-é）",
  category: "變位",
  explanation: "規則 -er 動詞過去分詞",
  endings: {
    je: "-é",
    tu: "-é",
    il: "-é",
    nous: "-é",
    vous: "-é",
    ils: "-é",
  },
};
Rules.setAll([ppEr, avoir, erPresent]);
const assisHit = Rules.findMatchingRule({
  name: "過去分詞（-é）",
  nameZh: "過去分詞",
  nameFr: "-é",
  span: "assis",
});
if (assisHit.owned) {
  fail(`assis owned by ${assisHit.rule?.title} (score ${assisHit.score}) — irregular PP`);
}
ok("assis is not owned by 過去分詞（-é）");

const dejeuneHit = Rules.findMatchingRule({
  name: "過去分詞（-é）",
  span: "déjeuné",
});
if (!dejeuneHit.owned || dejeuneHit.rule?.id !== "seed-pp-er") {
  fail(`déjeuné should own -é card, got ${dejeuneHit.rule?.title} owned=${dejeuneHit.owned}`);
}
ok("déjeuné still owns 過去分詞（-é）");

const luiCod = {
  id: "user-cod",
  title: "直接賓語代詞（pronoms objets directs）",
  category: "代詞",
  has_persons: false,
  keywords: ["me", "te", "le", "la", "nous", "vous", "les", "lui"],
  endings: { je: "", tu: "", il: "", nous: "", vous: "", ils: "" },
};
Rules.setAll([luiCod]);
const luiHit = Rules.findMatchingRule({
  name: "直接賓語代詞（pronoms objets directs）",
  span: "lui",
});
if (luiHit.owned) {
  fail("lui must not own COD card");
}
ok("lui is not owned by 直接賓語代詞");

const leHit = Rules.findMatchingRule({
  name: "直接賓語代詞（pronoms objets directs）",
  span: "le",
});
if (!leHit.owned) {
  fail("le should still own COD card");
}
ok("le still owns 直接賓語代詞");

const negation = {
  id: "seed-negation-ne-pas",
  title: "否定（ne…pas）",
  category: "否定",
  explanation: "一般否定：ne + 動詞 + pas。動詞以元音或啞音 h 開頭時 ne 省音為 n'（如 n'ai、n'est）。",
  has_persons: false,
  keywords: ["pas", "ne", "n'", "n"],
  endings: { je: "", tu: "", il: "", nous: "", vous: "", ils: "" },
};
const prepEntre = {
  id: "user-prep-entre",
  title: "介詞（entre）",
  category: "介詞",
  has_persons: false,
  keywords: ["entre"],
  endings: { je: "", tu: "", il: "", nous: "", vous: "", ils: "" },
};
Rules.setAll([negation, prepEntre, erPresent, etre, avoir]);

if (Rules.fullFormEquals("ne", "n'entre")) {
  fail("ne must not equal synthesized n'entre");
}
ok("ne ≠ n'entre");

const entreVariants = Rules.expandMatchVariants("entre");
if (entreVariants.some((v) => v.form === "n'entre" || v.form === "j'entre")) {
  fail(`entre must not synthesize n'/j'entre: ${entreVariants.map((v) => v.form).join(",")}`);
}
ok("entre does not synthesize n'entre");

if (!Rules.fullFormEquals("n'ai", "ai")) {
  fail("n'ai must still equal ai");
}
ok("n'ai ↔ ai still holds");

const entrePresent = Rules.findMatchingRule({
  name: "現在時（entrer présent）",
  nameZh: "現在時",
  nameFr: "entrer présent",
  span: "entre",
});
if (entrePresent.owned) {
  fail(
    `entre / 現在時（entrer présent） owned by ${entrePresent.rule?.title} (score ${entrePresent.score})`
  );
}
ok("API 現在時（entrer présent）·entre is not owned");

for (const [span, name] of [
  ["aime", "現在時（aimer présent）"],
  ["habite", "現在時（habiter présent）"],
  ["écoute", "現在時（écouter présent）"],
]) {
  const h = Rules.findMatchingRule({ name, span });
  if (h.owned && (h.rule?.id === "seed-negation-ne-pas" || h.rule?.id === "user-prep-entre")) {
    fail(`${span} owned by ${h.rule?.title}`);
  }
}
ok("vowel-initial verbs are not owned by 否定／介詞 entre");

const estHit = Rules.findMatchingRule({
  name: "現在時（être）",
  span: "est",
});
if (!estHit.owned || estHit.rule?.id !== "seed-etre-present") {
  fail(`est should own être, got ${estHit.rule?.title} owned=${estHit.owned}`);
}
if (estHit.rule?.id === "seed-negation-ne-pas") {
  fail("est must not own 否定");
}
ok("est still owns 現在時（être）");

const negPas = Rules.findMatchingRule({
  name: "否定（ne…pas）",
  span: "pas",
});
if (!negPas.owned || negPas.rule?.id !== "seed-negation-ne-pas") {
  fail(`pas should own 否定, got ${negPas.rule?.title}`);
}
ok("pas still owns 否定");

const negNai = Rules.findMatchingRule({
  name: "否定（ne…pas）",
  span: "n'ai",
});
if (!negNai.owned || negNai.rule?.id !== "seed-negation-ne-pas") {
  fail(`n'ai should own 否定, got ${negNai.rule?.title} owned=${negNai.owned}`);
}
ok("n'ai still owns 否定");

const aiStill = Rules.findMatchingRule({
  name: "現在時（avoir）",
  span: "ai",
});
if (!aiStill.owned || aiStill.rule?.id !== "seed-avoir-present") {
  fail(`ai should own avoir, got ${aiStill.rule?.title}`);
}
ok("ai still owns avoir present (not 否定)");

const reality = {
  id: "user-reality-present",
  title: "現實式",
  category: "時態",
  explanation: "直陳式現在時，第一組詞尾。",
  endings: {
    je: "-e",
    tu: "-es",
    il: "-e",
    nous: "-ons",
    vous: "-ez",
    ils: "-ent",
  },
};
Rules.setAll([reality, dire, avoir]);
const realityParle = Rules.findInventoryRule({
  name: "現在時（-er présent）",
  span: "parle",
  grammarKey: "verb:er:present",
});
if (!realityParle.owned || realityParle.rule?.id !== "user-reality-present") {
  fail(`parle should own 現實式, got ${realityParle.rule?.title} owned=${realityParle.owned} ${realityParle.reason || ""}`);
}
ok("parle owns 現實式 when that is the present card");

const realityNamed = Rules.findInventoryRule({
  name: "現在時（-er présent）",
  span: "parle",
});
if (!realityNamed.owned || realityNamed.rule?.id !== "user-reality-present") {
  fail(`parle without grammarKey should own 現實式, got ${realityNamed.rule?.title}`);
}
ok("現在時（-er présent） without key still owns 現實式");

const realityDit = Rules.findInventoryRule({
  name: "dire 現在時（présent）",
  span: "dit",
  grammarKey: "verb:dire:present",
});
if (!realityDit.owned || realityDit.rule?.id !== "user-dire-present") {
  fail(`dit should still own dire, got ${realityDit.rule?.title} owned=${realityDit.owned}`);
}
ok("dit still owns dire beside 現實式");

Rules.setAll([reality]);
const realityDitAlone = Rules.findInventoryRule({
  name: "dire 現在時（présent）",
  span: "dit",
  grammarKey: "verb:dire:present",
});
if (realityDitAlone.owned) {
  fail(`dit must not own 現實式, got ${realityDitAlone.rule?.title}`);
}
ok("dit does not own 現實式");

Rules.setAll([reality, avoir]);
const realityAi = Rules.findInventoryRule({
  name: "avoir 現在時（présent）",
  span: "ai",
  grammarKey: "verb:avoir:present",
});
if (!realityAi.owned || realityAi.rule?.id !== "seed-avoir-present") {
  fail(`ai should still own avoir, got ${realityAi.rule?.title} owned=${realityAi.owned}`);
}
ok("ai still owns avoir beside 現實式");

const realityEntre = Rules.findInventoryRule({
  name: "現在時（-er présent）",
  span: "entre",
  grammarKey: "verb:er:present",
});
if (realityEntre.owned) {
  fail(`entre must not own 現實式, got ${realityEntre.rule?.title}`);
}
ok("entre does not own 現實式");

Rules.setAll([reality, erPresent]);
const realityKeepsSeed = Rules.findInventoryRule({
  name: "現在時（-er présent）",
  span: "parle",
  grammarKey: "verb:er:present",
});
if (!realityKeepsSeed.owned || realityKeepsSeed.rule?.id !== "seed-present-er") {
  fail(`seed -er should win over 現實式, got ${realityKeepsSeed.rule?.title}`);
}
ok("標準現在時（-er présent）仍優先於現實式");

const realityEmpty = {
  id: "user-reality-empty",
  title: "現實式",
  category: "時態",
  has_persons: true,
  endings: { je: "", tu: "", il: "", nous: "", vous: "", ils: "" },
};
Rules.setAll([realityEmpty]);
const emptyHit = Rules.findInventoryRule({
  name: "現在時（-er présent）",
  span: "habite",
  grammarKey: "verb:er:present",
});
if (!emptyHit.owned || emptyHit.rule?.id !== "user-reality-empty") {
  fail(`empty 現實式 should own habite, got ${emptyHit.rule?.title} owned=${emptyHit.owned}`);
}
ok("尚未填六格的現實式仍套上現在時");

const parlerKey = Rules.findInventoryRule({
  name: "parler 現在時（présent）",
  span: "parle",
  grammarKey: "verb:parler:present",
});
if (!parlerKey.owned || parlerKey.rule?.id !== "user-reality-empty") {
  fail(`verb:parler:present should own empty 現實式, got ${parlerKey.rule?.title} owned=${parlerKey.owned}`);
}
ok("verb:parler:present owns 現實式");

const avoirForms = {
  id: "user-reality-avoir",
  title: "現實式",
  category: "變位",
  endings: { je: "ai", tu: "as", il: "a", nous: "avons", vous: "avez", ils: "ont" },
};
Rules.setAll([avoirForms]);
const steal = Rules.findInventoryRule({
  name: "現在時（-er présent）",
  span: "parle",
  grammarKey: "verb:er:present",
});
if (steal.owned) fail(`avoir-shaped 現實式 must not own parle, got ${steal.rule?.title}`);
ok("完整形 avoir 的現實式不搶 parle");
const aiOnly = Rules.findInventoryRule({
  name: "avoir 現在時（présent）",
  span: "ai",
  grammarKey: "verb:avoir:present",
});
if (!aiOnly.owned || aiOnly.rule?.id !== "user-reality-avoir") {
  fail(`ai should own avoir-shaped 現實式, got ${aiOnly.rule?.title} owned=${aiOnly.owned}`);
}
ok("沒有 avoir 種子時，六格是 ai 的現實式套上 ai");

console.log("all ok");
