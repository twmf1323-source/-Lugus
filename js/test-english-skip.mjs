/**
 * 英法同形詞不可當英文略過；明確英文仍略過
 */
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, "storage.js"), "utf8");

function fail(msg) {
  console.error("FAIL", msg);
  process.exit(1);
}
function ok(msg) {
  console.log("ok", msg);
}

const ls = new Map();
const ctx = {
  localStorage: {
    getItem(k) {
      return ls.has(k) ? ls.get(k) : null;
    },
    setItem(k, v) {
      ls.set(String(k), String(v));
    },
    removeItem(k) {
      ls.delete(k);
    },
    get length() {
      return ls.size;
    },
    key(i) {
      return [...ls.keys()][i] ?? null;
    },
  },
  indexedDB: undefined,
  document: { addEventListener() {} },
  window: { addEventListener() {} },
  console,
  crypto: { randomUUID: () => "id_test" },
  setTimeout,
  clearTimeout,
};
vm.createContext(ctx);
vm.runInContext(`${code}\nthis.__Storage = Storage;`, ctx);
const S = ctx.__Storage;

const keep = [
  "but",
  "cause",
  "mine",
  "ours",
  "comment",
  "table",
  "important",
  "orange",
  "date",
  "fine",
  "long",
  "type",
  "mode",
  "place",
  "chance",
  "a",
  "as",
  "or",
  "on",
  "car",
  "son",
  "dont",
  "content",
  "note",
  "air",
  "plan",
];
for (const w of keep) {
  if (S.isEnglishVocabSkip(w)) fail(`kept French homograph skipped: ${w}`);
}
ok("French homographs are kept");

const skip = ["the", "you", "gonna", "yeah", "baby", "what's", "don't", "I", "they"];
for (const w of skip) {
  if (!S.isEnglishVocabSkip(w)) fail(`English word not skipped: ${w}`);
}
ok("unambiguous English still skipped");

if (S.isEnglishVocabSkip("c'est")) fail("c'est skipped as contraction");
if (S.isEnglishVocabSkip("j'ai")) fail("j'ai skipped");
if (S.isEnglishVocabSkip("n'est")) fail("n'est skipped");
if (!S.isEnglishVocabSkip("it's")) fail("it's not skipped");
if (!S.isEnglishVocabSkip("I'm")) fail("I'm not skipped");
ok("French elision kept; English contractions skipped");

const mixed = S.stripEnglishFromVocabQuery("Baby je t'aime\nLe but du jeu\nI love you");
if (!/je t'aime/i.test(mixed)) fail(`stripped French line: ${mixed}`);
if (!/but/i.test(mixed)) fail(`stripped French but: ${mixed}`);
if (/I love you/i.test(mixed)) fail(`kept English line: ${mixed}`);
if (/^baby/i.test(mixed.trim())) fail(`kept leading Baby: ${mixed}`);
ok("stripEnglish keeps French lines and homographs");

if (!S.vocabQueryHasTargetLanguage("Le but du jeu")) fail("French query not target");
if (S.vocabQueryHasTargetLanguage("I love you yeah")) fail("English query counted as French");
ok("vocabQueryHasTargetLanguage");

const filtered = S.filterEnglishVocab(
  [
    { surface: "but", lemma: "but" },
    { surface: "the", lemma: "the" },
    { surface: "cause", lemma: "cause" },
    { surface: "you", lemma: "you" },
  ],
  "C'est la cause et le but"
);
const surfs = filtered.map((w) => w.surface).sort();
if (surfs.join(",") !== "but,cause") fail(`filter ${surfs.join(",")}`);
ok("filterEnglishVocab keeps homographs, drops the/you");

const ete = S.stripEnglishFromVocabQuery("un été");
if (!/été/.test(ete)) fail(`accent word mangled: ${ete}`);
ok("accented French not split by ASCII regex");

console.log("all ok");
