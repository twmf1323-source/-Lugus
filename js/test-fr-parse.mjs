/**
 * 法語切詞／候選／標準管線契約
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
      loadSettings: () => ({
        apiKey: "test-key",
        baseUrl: "https://example.invalid/v1",
        model: "test-model",
      }),
      DEFAULT_SETTINGS: { baseUrl: "https://example.invalid/v1", model: "test-model" },
      isEnglishVocabSkip: () => false,
    },
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
  return ctx;
}

const ctx = load();
const FrParse = ctx.FrParse;
const Analyzer = ctx.Analyzer;

function tokensOf(q) {
  const tokens = FrParse.tokenize(q);
  const joined = tokens.map((t) => t.word).join("");
  if (joined !== q) fail(`reconstruct ${JSON.stringify(q)} => ${JSON.stringify(joined)}`);
  return tokens;
}

{
  const q = "Je n'ai pas déjeuné.";
  const tokens = tokensOf(q);
  const forms = tokens.filter((t) => t.pos !== "空白" && t.pos !== "標點").map((t) => t.form);
  if (!forms.includes("n'") && !forms.includes("n")) fail(`elision missing in ${forms.join("|")}`);
  if (!forms.includes("ai")) fail(`host ai missing in ${forms.join("|")}`);
  const cands = FrParse.deterministicFunctions(q, tokens);
  const keys = cands.map((c) => c.grammarKey);
  if (!keys.includes("neg:ne-pas")) fail(`ne…pas candidate missing ${keys.join(",")}`);
  if (!keys.some((k) => k.includes("avoir") || k === "verb:avoir:present")) {
    fail(`avoir candidate missing ${keys.join(",")}`);
  }
  if (!keys.includes("pp:e") && !keys.includes("tense:passe-compose")) {
    fail(`participle / passé composé missing ${keys.join(",")}`);
  }
  ok("Je n'ai pas déjeuné. tokenize + candidates");
}

{
  const q = "pouvais";
  const tokens = tokensOf(q);
  const cands = FrParse.deterministicFunctions(q, tokens);
  if (!cands.some((c) => /pouvoir/.test(c.name) && /imparfait/.test(c.name))) {
    fail(`pouvais not tagged as pouvoir imparfait ${JSON.stringify(cands)}`);
  }
  const hit = Analyzer.lookupIrregular("pouvais");
  if (!hit || hit.infinitive !== "pouvoir") fail("analyzer pouvais");
  ok("pouvais → pouvoir imparfait");
}

{
  const q = "Il lui dit assis.";
  const tokens = tokensOf(q);
  const cands = FrParse.deterministicFunctions(q, tokens);
  if (cands.some((c) => c.grammarKey === "pron:coi")) fail(`lui must not be a grammar card`);
  if (!cands.some((c) => /dire/.test(c.name))) fail(`dire missing ${cands.map((c) => c.name)}`);
  if (cands.some((c) => /prendre/.test(c.name))) fail("dit must not map to prendre");
  if (cands.some((c) => c.grammarKey === "pp:e" && /assis/.test(c.name))) {
    fail("assis must not be -é");
  }
  ok("dit ≠ prendre; lui COI; assis not -é");
}

{
  const q = "l'histoire d'y voir";
  const tokens = tokensOf(q);
  const forms = tokens.map((t) => t.form);
  if (!forms.includes("l'") && !forms.includes("l")) fail(`l' missing ${forms}`);
  if (!forms.includes("d'") && !forms.includes("d")) fail(`d' missing ${forms}`);
  const lTok = tokens.find((t) => t.form === "l'" || t.form === "l");
  const dTok = tokens.find((t) => t.form === "d'" || t.form === "d");
  if (lTok?.pos !== "冠詞") fail(`l' pos ${lTok?.pos}`);
  if (dTok?.pos !== "介詞") fail(`d' pos ${dTok?.pos}`);
  const hist = tokens.find((t) => t.form === "histoire");
  if (hist && hist.pos === "動詞") fail("histoire must not be tagged as verb");
  const cands = FrParse.deterministicFunctions(q, tokens);
  if (cands.some((c) => /histoire/.test(c.name) || (c.span === "histoire" && /現在時|présent/.test(c.name)))) {
    fail(`histoire grammar candidate ${JSON.stringify(cands.map((c) => c.name))}`);
  }
  ok("l' article vs d' preposition; histoire not a verb");
}

{
  const q = "Qui entre dans l'histoire, entre dans le noir";
  const tokens = tokensOf(q);
  const hist = tokens.find((t) => t.form === "histoire");
  const noir = tokens.find((t) => t.form === "noir");
  if (hist?.pos === "動詞") fail("histoire tagged verb");
  if (noir?.pos === "動詞") fail("noir tagged verb");
  const cands = FrParse.deterministicFunctions(q, tokens);
  if (cands.some((c) => /histoire|noir/.test(String(c.name || "")))) {
    fail(`noun grammar cand ${cands.map((c) => c.name).join(",")}`);
  }
  const entreTok = tokens.filter((t) => t.form === "entre");
  if (!entreTok.some((t) => t.pos === "動詞")) fail("entre after qui should still be verb");
  ok("Qui entre… histoire/noir not grammar; entre still verb");
}

{
  const q = "J'ai une idée.";
  const tokens = tokensOf(q);
  const idee = tokens.find((t) => t.form === "idée" || t.form === "idee");
  if (idee?.pos === "動詞") fail("idée tagged as verb/PP");
  const cands = FrParse.deterministicFunctions(q, tokens);
  if (cands.some((c) => c.grammarKey === "tense:passe-compose")) {
    fail("une idée must not be passé composé");
  }
  ok("une idée is not passé composé");
}

{
  const q = "J'ai mangé.";
  const tokens = tokensOf(q);
  const cands = FrParse.deterministicFunctions(q, tokens);
  if (!cands.some((c) => c.grammarKey === "tense:passe-compose")) {
    fail(`mangé should still be passé composé ${cands.map((c) => c.grammarKey).join(",")}`);
  }
  ok("j'ai mangé still passé composé");
}

{
  const q = "donne-moi";
  const tokens = tokensOf(q);
  const words = tokens.filter((t) => t.pos !== "標點").map((t) => t.form);
  if (!words.includes("donne") || !words.includes("moi")) fail(`hyphen split ${words}`);
  ok("donne-moi hyphen clitics");
}

{
  const tokens = tokensOf("n'ai");
  const cands = FrParse.deterministicFunctions("n'ai", tokens);
  const checklist = FrParse.grammarChecklist(tokens, cands);
  if (!checklist.length) fail("empty checklist");
  const id = FrParse.candidateDecisionId(cands[0]);
  if (!id) fail("no decision id");
  ok("checklist + decision id");
}

{
  const q = "Je n'ai pas déjeuné.";
  const tokens = tokensOf(q);
  const cands = FrParse.deterministicFunctions(q, tokens);
  if (cands.some((c) => c.grammarKey === "neg:ne" || c.grammarKey === "neg:pas")) {
    fail(`standalone ne/pas should be covered by ne…pas ${cands.map((c) => c.grammarKey)}`);
  }
  const nePas = cands.find((c) => c.grammarKey === "neg:ne-pas");
  if (!nePas || nePas.needsDisambiguation || !nePas.cannotVeto) {
    fail("ne…pas should be local high-confidence");
  }
  const apiList = FrParse.grammarChecklist(tokens, cands, { apiOnly: true });
  const high = cands.filter((c) => FrParse.isHighConfidenceCandidate(c) && !c.needsDisambiguation);
  if (apiList.some((x) => high.some((c) => FrParse.candidateDecisionId(c) === x.id))) {
    fail("high-confidence ids in api-only checklist");
  }
  ok("ne…pas locally confirmed; standalone ne/pas dropped");
}

{
  const q = "leur livre";
  const tokens = tokensOf(q);
  const leur = tokens.find((t) => t.form === "leur");
  if (leur?.grammarKey !== "det:poss") fail(`leur before noun should be possessive, got ${leur?.grammarKey}`);
  if (leur.needsDisambiguation) fail("leur livre should not need API");
  ok("leur livre is possessive");
}

{
  const q = "en France";
  const tokens = tokensOf(q);
  const en = tokens.find((t) => t.form === "en");
  if (en?.grammarKey !== "prep:en") fail(`en France should be prep:en, got ${en?.grammarKey}`);
  if (!en.needsDisambiguation) fail("en France should still be disambiguation");
  const cands = FrParse.deterministicFunctions(q, tokens);
  const enCand = cands.find((c) => c.grammarKey === "prep:en");
  if (!enCand?.needsDisambiguation) fail("en prep candidate must be disamb");
  ok("en France is prep disambiguation, not auto-confirmed adverbial pronoun");
}

{
  const q = "Il lui dit assis.";
  const tokens = tokensOf(q);
  const lui = tokens.find((t) => t.form === "lui");
  if (lui?.grammarKey !== "pron:coi") fail(`lui COI key ${lui?.grammarKey}`);
  if (lui.needsDisambiguation) fail("lui should be local COI");
  const assis = tokens.find((t) => t.form === "assis");
  if (assis?.grammarKey === "pp:e") fail("assis tagged as -é");
  if (!String(assis?.grammarKey || "").startsWith("pp:irreg:")) {
    fail(`assis key ${assis?.grammarKey}`);
  }
  const cands = FrParse.deterministicFunctions(q, tokens);
  if (cands.some((c) => c.grammarKey === "pron:coi" || /間接賓語|代詞/.test(c.name || ""))) {
    fail(`lui must not be a grammar card ${cands.map((c) => c.name)}`);
  }
  ok("lui COI tagged but not a grammar card; assis irregular PP");
}

{
  const q = "Ça dure toujours, on s'en souvient";
  const tokens = tokensOf(q);
  const ca = tokens.find((t) => t.form === "ça" || t.form === "ca");
  if (ca?.pos === "名詞") fail("Ça at sentence start must not be a proper noun");
  if (ca?.grammarKey !== "pron:dem") fail(`Ça should be demonstrative pronoun, got ${ca?.pos} ${ca?.grammarKey}`);
  const on = tokens.find((t) => t.form === "on");
  if (on?.grammarKey !== "pron:subj") fail(`on should stay subject pronoun, got ${on?.grammarKey}`);
  const dure = tokens.find((t) => t.form === "dure");
  if (dure?.lexName !== "現在時（-er présent）") fail(`dure name ${dure?.lexName}`);
  if (dure?.grammarKey !== "verb:er:present") fail(`dure key ${dure?.grammarKey}`);
  const souvient = tokens.find((t) => t.form === "souvient");
  if (souvient?.lemma !== "souvenir") fail(`souvient lemma ${souvient?.lemma}`);
  if (souvient?.grammarKey !== "verb:souvenir:present") {
    fail(`souvient key ${souvient?.grammarKey}`);
  }
  if (souvient?.lexName !== "記得現在時（souvenir présent）") {
    fail(`souvient name ${souvient?.lexName}`);
  }
  const cands = FrParse.deterministicFunctions(q, tokens);
  if (cands.some((c) => FrParse.isPronounGrammar(c))) {
    fail(`pronouns must not be grammar cards ${cands.map((c) => c.name)}`);
  }
  const present = cands.filter((c) => /present/.test(c.grammarKey || ""));
  if (present.length !== 2) fail(`expected two present verbs, got ${present.map((c) => c.name)}`);
  if (!present.some((c) => c.grammarKey === "verb:er:present")) {
    fail(`dure should use -er présent ${present.map((c) => c.name + ":" + c.grammarKey)}`);
  }
  if (present.some((c) => /souvenir/.test(c.grammarKey || "") && /（-er/.test(c.name || ""))) {
    fail("souvenir must not use -er generic");
  }
  const local = FrParse.localConfirmedFromCandidates(cands);
  const items = FrParse.functionsToItems(tokens, local.functions, cands, {
    src: q,
    candidateDecisions: local.decisions,
  });
  if (items.some((it) => FrParse.isPronounGrammar(it) || /qu'on|省音/.test(it.name || ""))) {
    fail(`pronoun/qu'on leaked ${items.map((i) => i.name)}`);
  }
  ok("Ça dure… on s'en souvient: ça demonstrative; souvenir not -er; no pronoun grammar cards");
}

{
  const out = FrParse.ensureClosedClassVocab("Elle aime son frère et on part", [
    { surface: "aime", lemma: "aimer", gloss: "愛", pos: "動詞" },
    { surface: "frère", lemma: "frère", gloss: "", pos: "名詞" },
    { surface: "on", lemma: "on", gloss: "", pos: "代詞" },
    { surface: " ", lemma: "", gloss: "空白", pos: "其他" },
    { surface: "il", lemma: "il", gloss: "他", pos: "代詞" },
  ]);
  const glossOf = (s) => out.find((w) => String(w.surface || "").toLowerCase() === s)?.gloss || "";
  if (glossOf("elle") !== "她") fail(`elle gloss ${glossOf("elle")}`);
  if (glossOf("son") !== "他的／她的") fail(`son gloss ${glossOf("son")}`);
  if (glossOf("on") !== "有人／我們") fail(`on gloss ${glossOf("on")}`);
  if (glossOf("aime") !== "愛") fail("kept verb gloss overwritten");
  if (out.some((w) => !String(w.gloss || "").trim())) fail("blank gloss returned");
  if (out.some((w) => !String(w.surface || "").trim())) fail("blank surface returned");
  if (out.some((w) => w.surface === "frère")) fail("empty noun gloss should be dropped");
  if (glossOf("il") !== "他") fail("existing pronoun gloss overwritten");
  ok("API vocab keeps pronoun gloss and drops blank words");
}

{
  const q = "j'ai le sang si chaud";
  const tokens = tokensOf(q);
  const si = tokens.find((t) => t.form === "si");
  if (!si || si.pos !== "副詞" || si.grammarKey) {
    fail(`degree si should not be 條件 ${si && si.pos} ${si && si.grammarKey}`);
  }
  const cands = FrParse.deterministicFunctions(q, tokens);
  if (cands.some((c) => c.grammarKey === "conj:si" || /條件/.test(c.name || ""))) {
    fail(`si chaud still a conditional ${cands.map((c) => c.name).join(",")}`);
  }
  const ifQ = "si tu veux";
  const ifTokens = tokensOf(ifQ);
  const ifCands = FrParse.deterministicFunctions(ifQ, ifTokens);
  if (!ifCands.some((c) => c.grammarKey === "conj:si")) {
    fail(`si tu veux should stay 條件 ${ifCands.map((c) => c.name).join(",")}`);
  }
  ok("si chaud is degree adverb, si tu veux stays conditional");
}

{
  const rejected = {
    functions: [],
    decisions: [
      {
        candidateId: "pron:0:0",
        status: "rejected",
      },
    ],
  };
  const q = "en France";
  const tokens = tokensOf(q);
  const cands = FrParse.deterministicFunctions(q, tokens);
  const enCand = cands.find((c) => c.needsDisambiguation);
  const cid = FrParse.candidateDecisionId(enCand);
  const items = FrParse.functionsToItems(tokens, [], cands, {
    src: q,
    candidateDecisions: [{ candidateId: cid, status: "rejected" }],
  });
  if (items.some((it) => it.candidateId === cid || it.grammarKey === enCand.grammarKey)) {
    fail(`rejected disamb leaked ${JSON.stringify(items)}`);
  }
  void rejected;
  ok("rejected disamb does not leak into items");
}

console.log("ok fr-parse");
