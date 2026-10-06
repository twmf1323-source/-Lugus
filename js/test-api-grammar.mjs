/**
 * API 文法盤點契約：本地高信心不進必答清單、消歧漏答補查、否決不回流
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function fail(msg) {
  console.error("FAIL", msg);
  process.exit(1);
}

const ctx = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  Storage: {
    loadSettings: () => ({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      model: "test-model",
    }),
    DEFAULT_SETTINGS: { baseUrl: "https://example.invalid/v1", model: "test-model" },
    isEnglishVocabSkip: () => false,
  },
  RulesService: {},
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

const q = "Je n'ai pas déjeuné en France.";
const tokens = ctx.FrParse.tokenize(q);
const candidates = ctx.FrParse.deterministicFunctions(q, tokens);
if (candidates.some((c) => ctx.FrParse.isPronounGrammar(c))) {
  fail(`pronouns must not be grammar candidates ${candidates.map((c) => c.name)}`);
}
const enCand = candidates.find((c) => c.grammarKey === "prep:en");
if (!enCand || !enCand.needsDisambiguation) {
  fail(`en France should be prep disambiguation ${JSON.stringify(candidates.map((c) => c.grammarKey))}`);
}
const highIds = candidates
  .filter((c) => ctx.FrParse.isHighConfidenceCandidate(c) && !c.needsDisambiguation)
  .map((c) => ctx.FrParse.candidateDecisionId(c));
if (!highIds.length) fail("expected local high-confidence candidates");

const checklist = ctx.FrParse.grammarChecklist(tokens, candidates, { apiOnly: true });
if (checklist.some((x) => highIds.includes(x.id))) {
  fail(`api checklist still contains high-confidence IDs ${checklist.map((x) => x.id)}`);
}
if (!checklist.some((x) => x.id === ctx.FrParse.candidateDecisionId(enCand))) {
  fail(`en missing from api checklist ${checklist.map((x) => x.id)}`);
}

function apiResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () =>
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  };
}

vm.runInContext(
  fs.readFileSync(path.join(here, "ai.js"), "utf8") + "\nglobalThis.AiService = AiService;",
  ctx
);

const enId = ctx.FrParse.candidateDecisionId(enCand);
const calls = [];
const responses = [
  {
    u: "第一輪漏答",
    t: "我沒在法國吃過午飯。",
    fn: [],
  },
  { fn: [{ q: enId, x: "rejected", e: "此處不成立" }] },
];
ctx.fetch = async (_url, options) => {
  calls.push(JSON.parse(options.body));
  return apiResponse(responses.shift());
};

const repaired = await ctx.AiService.inventoryByFrParse(q, { skipVocab: true });
if (calls.length !== 2) fail(`expected one repair call, got ${calls.length}`);
if (!repaired.apiRepairUsed) fail(`repair not flagged ${JSON.stringify(repaired)}`);
if (repaired.apiRejectedCount !== 1) fail(`rejected count ${repaired.apiRejectedCount}`);
if (repaired.items.some((it) => it.candidateId === enId)) {
  fail("rejected disamb candidate leaked");
}
const user1 = String(calls[0].messages[1].content);
if (/本地已有規則標題/.test(user1) || /筆記本規則/.test(user1)) {
  fail("first prompt still sends local titles");
}
if (!user1.includes("已本地確認")) fail("first prompt missing local-confirmed section");
for (const id of highIds) {
  const checklistPart = user1.split("必處理清單")[1] || "";
  if (checklistPart.includes(id)) fail(`high-confidence ${id} still in required checklist`);
}
if (!calls[1].messages[1].content.includes(enId)) fail("repair prompt omitted unresolved ID");
if (!calls[1].messages[1].content.includes("不要新增 new")) fail("repair prompt did not limit second pass");

const completeCalls = [];
ctx.fetch = async (_url, options) => {
  completeCalls.push(JSON.parse(options.body));
  return apiResponse({
    u: "完整",
    t: "翻譯",
    fn: [
      {
        q: enId,
        x: "confirmed",
        g: enCand.grammarKey,
        n: enCand.name,
        a: enCand.tokenFrom,
        b: enCand.tokenTo,
        c: enCand.category || "介詞",
        f: "h",
      },
    ],
  });
};
const complete = await ctx.AiService.inventoryByFrParse(q, { skipVocab: true });
if (completeCalls.length !== 1 || complete.apiRepairUsed) {
  fail(`complete should not repair ${completeCalls.length} ${complete.apiRepairUsed}`);
}
if (!complete.items.length) fail(`complete lost items ${JSON.stringify(complete.items)}`);
if (!complete.items.some((it) => /avoir|否定|ne…pas|déjeun/.test(`${it.grammarKey || ""} ${it.name || ""}`))) {
  fail(`local grammar missing ${complete.items.map((it) => it.name)}`);
}
if (complete.items.some((it) => ctx.FrParse.isPronounGrammar(it))) {
  fail(`pronoun grammar leaked ${complete.items.map((it) => it.name)}`);
}

const vetoCalls = [];
ctx.fetch = async (_url, options) => {
  vetoCalls.push(JSON.parse(options.body));
  const avoir = candidates.find((c) => /avoir/.test(c.grammarKey || "") || /avoir/.test(c.name || ""));
  return apiResponse({
    u: "",
    t: "翻譯",
    fn: avoir
      ? [
          {
            q: ctx.FrParse.candidateDecisionId(avoir),
            x: "rejected",
            e: "誤否決",
          },
          {
            q: enId,
            x: "confirmed",
            g: enCand.grammarKey,
            n: enCand.name,
            a: enCand.tokenFrom,
            b: enCand.tokenTo,
            c: "介詞",
            f: "h",
          },
        ]
      : [{ q: enId, x: "confirmed", g: enCand.grammarKey, n: enCand.name, a: enCand.tokenFrom, b: enCand.tokenTo, c: "介詞", f: "h" }],
  });
};
const vetoed = await ctx.AiService.inventoryByFrParse(q, { skipVocab: true });
if (
  candidates.some((c) => /avoir/.test(c.grammarKey || "")) &&
  !vetoed.items.some((it) => /avoir/.test(it.grammarKey || "") || /avoir/.test(it.name || ""))
) {
  fail("cannotVeto avoir was dropped after API reject");
}

const lunch = "Je n'ai pas déjeuné.";
const lunchTokens = ctx.FrParse.tokenize(lunch);
const lunchCands = ctx.FrParse.deterministicFunctions(lunch, lunchTokens);
const lunchCheck = ctx.FrParse.grammarChecklist(lunchTokens, lunchCands, { apiOnly: true });
const lunchHigh = lunchCands.filter((c) => ctx.FrParse.isHighConfidenceCandidate(c) && !c.needsDisambiguation);
if (lunchHigh.length < 3) fail(`lunch sentence should auto-confirm several items, got ${lunchHigh.length}`);
if (lunchCheck.some((x) => lunchHigh.some((c) => ctx.FrParse.candidateDecisionId(c) === x.id))) {
  fail("lunch high-confidence leaked into api checklist");
}

const legacyCalls = [];
ctx.fetch = async (_url, options) => {
  legacyCalls.push(JSON.parse(options.body));
  return apiResponse({
    u: "",
    t: "翻譯",
    i: [{ n: "否定（ne…pas）", c: "否定", s: "n'ai pas", f: "h" }],
    v: [],
  });
};
await ctx.AiService.inventoryGrammar(lunch, ["這不該出現的本地標題（fake）"]);
const legacyUser = String(legacyCalls[0].messages[1].content);
if (legacyUser.includes("這不該出現的本地標題")) fail("legacy inventory still sends local titles");
if (!/不參考任何本地筆記本/.test(legacyUser)) fail("legacy inventory missing independent instruction");

console.log("ok api grammar contract", calls.length, "calls with repair;", completeCalls.length, "without");
void root;
