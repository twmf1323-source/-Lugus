/**
 * 法語學校文法切詞後處理：空白／省音／代詞連字號切分、程式候選、checklist、盤點 items。
 * 管線：切詞 → KIND_META 候選（高信心本地確認／消歧才進 API）→ 前端 grammarKey 對卡。
 */
const FrParse = (() => {
  const CONTENT_POS = new Set(["名詞", "動詞", "形容詞", "副詞", "代詞"]);
  const SKIP_POS = new Set(["標點", "空白", "改行"]);
  const FUNCTION_POS = new Set(["冠詞", "介詞", "代詞", "否定", "連詞"]);

  const CLITIC_RIGHT = new Set(
    [
      "moi",
      "toi",
      "lui",
      "leur",
      "nous",
      "vous",
      "le",
      "la",
      "les",
      "y",
      "en",
      "ce",
      "il",
      "elle",
      "on",
      "je",
      "tu",
      "t",
      "ci",
      "là",
      "la",
    ].map((s) => s.normalize("NFC").toLowerCase())
  );

  const ELISION_PRO = new Set(["l", "d", "n", "j", "m", "t", "s", "c", "qu"]);

  /** 虛詞 → 標準功能名（API 不看本地卡；前端再對照） */
  const LEXICON = (() => {
    const rows = [
      ["le", "冠詞", "DET", "定冠詞（le/la/les）", "冠詞", "article:def", true, "le"],
      ["la", "冠詞", "DET", "定冠詞（le/la/les）", "冠詞", "article:def", true, "le"],
      ["les", "冠詞", "DET", "定冠詞（le/la/les）", "冠詞", "article:def", true, "le"],
      ["l", "冠詞", "DET", "定冠詞（le/la/les）", "冠詞", "article:def", true, "le"],
      ["l'", "冠詞", "DET", "定冠詞（le/la/les）", "冠詞", "article:def", true, "le"],
      ["un", "冠詞", "DET", "不定冠詞（un/une）", "冠詞", "article:indef", false, "un"],
      ["une", "冠詞", "DET", "不定冠詞（un/une）", "冠詞", "article:indef", false, "un"],
      ["des", "冠詞", "DET", "不定冠詞（des）", "冠詞", "article:des", true, "des"],
      ["du", "冠詞", "DET", "部分冠詞（du）", "冠詞", "article:part", true, "du"],
      ["au", "介詞", "P+D", "縮合（à＋le）", "介詞", "prep:au", false, "à"],
      ["aux", "介詞", "P+D", "縮合（à＋les）", "介詞", "prep:aux", false, "à"],
      ["à", "介詞", "P", "介詞（à）", "介詞", "prep:a", false, "à"],
      ["de", "介詞", "P", "介詞（de）", "介詞", "prep:de", true, "de"],
      ["d", "介詞", "P", "介詞（de）", "介詞", "prep:de", true, "de"],
      ["d'", "介詞", "P", "介詞（de）", "介詞", "prep:de", true, "de"],
      ["dans", "介詞", "P", "介詞（dans）", "介詞", "prep:dans", false, "dans"],
      ["sur", "介詞", "P", "介詞（sur）", "介詞", "prep:sur", false, "sur"],
      ["sous", "介詞", "P", "介詞（sous）", "介詞", "prep:sous", false, "sous"],
      ["avec", "介詞", "P", "介詞（avec）", "介詞", "prep:avec", false, "avec"],
      ["sans", "介詞", "P", "介詞（sans）", "介詞", "prep:sans", false, "sans"],
      ["pour", "介詞", "P", "介詞（pour）", "介詞", "prep:pour", false, "pour"],
      ["par", "介詞", "P", "介詞（par）", "介詞", "prep:par", false, "par"],
      ["chez", "介詞", "P", "介詞（chez）", "介詞", "prep:chez", false, "chez"],
      ["en", "代詞", "PRO", "副代詞（en）", "代詞", "pron:en", true, "en"],
      ["y", "代詞", "PRO", "副代詞（y）", "代詞", "pron:y", false, "y"],
      ["je", "代詞", "CLS", "主語代詞（je）", "代詞", "pron:subj", false, "je"],
      ["j", "代詞", "CLS", "主語代詞（je）", "代詞", "pron:subj", false, "je"],
      ["j'", "代詞", "CLS", "主語代詞（je）", "代詞", "pron:subj", false, "je"],
      ["tu", "代詞", "CLS", "主語代詞（tu）", "代詞", "pron:subj", false, "tu"],
      ["il", "代詞", "CLS", "主語代詞（il）", "代詞", "pron:subj", false, "il"],
      ["elle", "代詞", "CLS", "主語代詞（elle）", "代詞", "pron:subj", false, "elle"],
      ["on", "代詞", "CLS", "主語代詞（on）", "代詞", "pron:subj", false, "on"],
      ["nous", "代詞", "CLS", "主語代詞（nous）", "代詞", "pron:subj", true, "nous"],
      ["vous", "代詞", "CLS", "主語代詞（vous）", "代詞", "pron:subj", true, "vous"],
      ["ils", "代詞", "CLS", "主語代詞（ils）", "代詞", "pron:subj", false, "ils"],
      ["elles", "代詞", "CLS", "主語代詞（elles）", "代詞", "pron:subj", false, "elles"],
      ["me", "代詞", "CLO", "賓語代詞（me）", "代詞", "pron:obj", true, "me"],
      ["m", "代詞", "CLO", "賓語代詞（me）", "代詞", "pron:obj", true, "me"],
      ["m'", "代詞", "CLO", "賓語代詞（me）", "代詞", "pron:obj", true, "me"],
      ["te", "代詞", "CLO", "賓語代詞（te）", "代詞", "pron:obj", true, "te"],
      ["t", "代詞", "CLO", "賓語代詞（te）", "代詞", "pron:obj", true, "te"],
      ["t'", "代詞", "CLO", "賓語代詞（te）", "代詞", "pron:obj", true, "te"],
      ["se", "代詞", "CLR", "反身代詞（se）", "代詞", "pron:se", false, "se"],
      ["s", "代詞", "CLR", "反身代詞（se）", "代詞", "pron:se", false, "se"],
      ["s'", "代詞", "CLR", "反身代詞（se）", "代詞", "pron:se", false, "se"],
      ["lui", "代詞", "CLO", "間接賓語（lui/leur）", "代詞", "pron:coi", false, "lui"],
      ["leur", "代詞", "CLO", "間接賓語（lui/leur）", "代詞", "pron:coi", true, "leur"],
      ["moi", "代詞", "PRO", "重讀代詞（moi）", "代詞", "pron:tonic", false, "moi"],
      ["toi", "代詞", "PRO", "重讀代詞（toi）", "代詞", "pron:tonic", false, "toi"],
      ["ne", "否定", "NEG", "否定（ne…pas）", "否定", "neg:ne", true, "ne"],
      ["n", "否定", "NEG", "否定（ne…pas）", "否定", "neg:ne", true, "ne"],
      ["n'", "否定", "NEG", "否定（ne…pas）", "否定", "neg:ne", true, "ne"],
      ["pas", "否定", "NEG", "否定（ne…pas）", "否定", "neg:pas", true, "pas"],
      ["jamais", "否定", "NEG", "否定（ne…jamais）", "否定", "neg:jamais", false, "jamais"],
      ["rien", "否定", "NEG", "否定（ne…rien）", "否定", "neg:rien", false, "rien"],
      ["plus", "否定", "NEG", "否定（ne…plus）", "否定", "neg:plus", true, "plus"],
      ["personne", "否定", "NEG", "否定（ne…personne）", "否定", "neg:personne", true, "personne"],
      ["et", "連詞", "CONJ", "並列（et）", "句型", "conj:et", false, "et"],
      ["ou", "連詞", "CONJ", "選擇（ou）", "句型", "conj:ou", false, "ou"],
      ["mais", "連詞", "CONJ", "轉折（mais）", "句型", "conj:mais", false, "mais"],
      ["donc", "連詞", "CONJ", "因果（donc）", "句型", "conj:donc", false, "donc"],
      ["car", "連詞", "CONJ", "原因（car）", "句型", "conj:car", false, "car"],
      ["si", "連詞", "CONJ", "條件（si）", "句型", "conj:si", false, "si"],
      ["que", "連詞", "CONJ", "從屬（que）", "句型", "conj:que", true, "que"],
      ["qui", "代詞", "PRO", "關係代詞（qui）", "代詞", "pron:qui", true, "qui"],
      ["dont", "代詞", "PRO", "關係代詞（dont）", "代詞", "pron:dont", false, "dont"],
      ["où", "代詞", "PRO", "關係代詞（où）", "代詞", "pron:ou", true, "où"],
      ["ça", "代詞", "DEM", "指示代詞（ça）", "代詞", "pron:dem", false, "cela"],
      ["cela", "代詞", "DEM", "指示代詞（ça）", "代詞", "pron:dem", false, "cela"],
      ["ce", "代詞", "DEM", "指示（ce/cet/cette/ces）", "代詞", "det:dem", true, "ce"],
      ["cet", "冠詞", "DEM", "指示（ce/cet/cette/ces）", "冠詞", "det:dem", false, "ce"],
      ["cette", "冠詞", "DEM", "指示（ce/cet/cette/ces）", "冠詞", "det:dem", false, "ce"],
      ["ces", "冠詞", "DEM", "指示（ce/cet/cette/ces）", "冠詞", "det:dem", false, "ce"],
      ["mon", "冠詞", "POSS", "主有形容詞（mon/ma/mes）", "冠詞", "det:poss", false, "mon"],
      ["ma", "冠詞", "POSS", "主有形容詞（mon/ma/mes）", "冠詞", "det:poss", false, "mon"],
      ["mes", "冠詞", "POSS", "主有形容詞（mon/ma/mes）", "冠詞", "det:poss", false, "mon"],
      ["ton", "冠詞", "POSS", "主有形容詞（ton/ta/tes）", "冠詞", "det:poss", false, "ton"],
      ["ta", "冠詞", "POSS", "主有形容詞（ton/ta/tes）", "冠詞", "det:poss", false, "ton"],
      ["tes", "冠詞", "POSS", "主有形容詞（ton/ta/tes）", "冠詞", "det:poss", false, "ton"],
      ["son", "冠詞", "POSS", "主有形容詞（son/sa/ses）", "冠詞", "det:poss", false, "son"],
      ["sa", "冠詞", "POSS", "主有形容詞（son/sa/ses）", "冠詞", "det:poss", false, "son"],
      ["ses", "冠詞", "POSS", "主有形容詞（son/sa/ses）", "冠詞", "det:poss", false, "son"],
      ["qui", "代詞", "PRO", "關係代詞（qui）", "代詞", "pron:qui", true, "qui"],
    ];
    const map = new Map();
    for (const [form, pos, tag, name, category, grammarKey, disamb, lemma] of rows) {
      const key = String(form).normalize("NFC").toLowerCase();
      if (!map.has(key)) {
        map.set(key, { pos, tag, name, category, grammarKey, needsDisambiguation: disamb, lemma });
      }
    }
    return map;
  })();

  /**
   * 穩定文法種類（對齊韓語 KIND_META）。
   * disamb：必須 API 看語境。cannotVeto：本地高信心，API 否決也保留。
   */
  const KIND_META = {
    "article:def": { name: "定冠詞（le/la/les）", category: "冠詞", cannotVeto: true },
    "article:indef": { name: "不定冠詞（un/une）", category: "冠詞", cannotVeto: true },
    "article:des": { name: "不定冠詞（des）", category: "冠詞", disamb: true },
    "article:part": { name: "部分冠詞（du）", category: "冠詞", disamb: true },
    "prep:au": { name: "縮合（à＋le）", category: "介詞", cannotVeto: true },
    "prep:aux": { name: "縮合（à＋les）", category: "介詞", cannotVeto: true },
    "prep:a": { name: "介詞（à）", category: "介詞", cannotVeto: true },
    "prep:de": { name: "介詞（de）", category: "介詞", disamb: true },
    "prep:dans": { name: "介詞（dans）", category: "介詞", cannotVeto: true },
    "prep:sur": { name: "介詞（sur）", category: "介詞", cannotVeto: true },
    "prep:sous": { name: "介詞（sous）", category: "介詞", cannotVeto: true },
    "prep:avec": { name: "介詞（avec）", category: "介詞", cannotVeto: true },
    "prep:sans": { name: "介詞（sans）", category: "介詞", cannotVeto: true },
    "prep:pour": { name: "介詞（pour）", category: "介詞", cannotVeto: true },
    "prep:par": { name: "介詞（par）", category: "介詞", cannotVeto: true },
    "prep:chez": { name: "介詞（chez）", category: "介詞", cannotVeto: true },
    "prep:en": { name: "介詞（en）", category: "介詞", disamb: true },
    "pron:en": { name: "副代詞（en）", category: "代詞", disamb: true },
    "pron:y": { name: "副代詞（y）", category: "代詞", disamb: true },
    "pron:subj": { name: "主語代詞", category: "代詞", cannotVeto: true },
    "pron:obj": { name: "賓語代詞（me/te）", category: "代詞", disamb: true },
    "pron:se": { name: "反身代詞（se）", category: "代詞", cannotVeto: true },
    "pron:coi": { name: "間接賓語（lui/leur）", category: "代詞" },
    "pron:cod": { name: "直接賓語（le/la/les）", category: "代詞", disamb: true },
    "pron:tonic": { name: "重讀代詞", category: "代詞", cannotVeto: true },
    "neg:ne": { name: "否定（ne…pas）", category: "否定", disamb: true },
    "neg:pas": { name: "否定（ne…pas）", category: "否定", disamb: true },
    "neg:ne-pas": {
      name: "否定（ne…pas）",
      category: "否定",
      cannotVeto: true,
      seedId: "seed-negation-ne-pas",
    },
    "neg:jamais": { name: "否定（ne…jamais）", category: "否定", cannotVeto: true },
    "neg:rien": { name: "否定（ne…rien）", category: "否定", cannotVeto: true },
    "neg:plus": { name: "否定（ne…plus）", category: "否定", disamb: true },
    "neg:personne": { name: "否定（ne…personne）", category: "否定", disamb: true },
    "conj:et": { name: "並列（et）", category: "句型", cannotVeto: true },
    "conj:ou": { name: "選擇（ou）", category: "句型", cannotVeto: true },
    "conj:mais": { name: "轉折（mais）", category: "句型", cannotVeto: true },
    "conj:donc": { name: "因果（donc）", category: "句型", cannotVeto: true },
    "conj:car": { name: "原因（car）", category: "句型", cannotVeto: true },
    "conj:si": { name: "條件（si）", category: "句型", disamb: true },
    "conj:que": { name: "從屬（que）", category: "句型", disamb: true },
    "pron:qui": { name: "關係代詞（qui）", category: "代詞", disamb: true },
    "pron:dont": { name: "關係代詞（dont）", category: "代詞", cannotVeto: true },
    "pron:ou": { name: "關係代詞（où）", category: "代詞", disamb: true },
    "det:dem": { name: "指示（ce/cet/cette/ces）", category: "代詞", disamb: true },
    "pron:dem": { name: "指示代詞（ça）", category: "代詞", cannotVeto: true },
    "det:poss": { name: "主有形容詞", category: "冠詞", cannotVeto: true },
    "verb:er:present": {
      name: "現在時（-er présent）",
      category: "時態",
      disamb: true,
      seedId: "seed-present-er",
    },
    "verb:er:imparfait": {
      name: "未完成過去（-er imparfait）",
      category: "時態",
      disamb: true,
      seedId: "seed-imparfait-er",
    },
    "verb:ir:present": {
      name: "現在時（-ir présent）",
      category: "時態",
      disamb: true,
    },
    "verb:ir:imparfait": {
      name: "未完成過去（-ir imparfait）",
      category: "時態",
      disamb: true,
    },
    "verb:futur": {
      name: "簡單未來式（futur simple）",
      category: "時態",
      disamb: true,
      seedId: "seed-futur-simple",
    },
    "pp:e": { name: "過去分詞（-é）", category: "時態", cannotVeto: true, seedId: "seed-pp-er" },
    "tense:passe-compose": {
      name: "複合過去（passé composé）",
      category: "時態",
      cannotVeto: true,
    },
    "inf:infinitif": { name: "不定式（infinitif）", category: "變位", disamb: true },
  };

  const SEED_BY_KIND = {
    "verb:être:present": "seed-etre-present",
    "verb:etre:present": "seed-etre-present",
    "verb:avoir:present": "seed-avoir-present",
    "verb:pouvoir:imparfait": "seed-pouvoir-imparfait",
  };

  function kindMeta(key) {
    const k = String(key || "").trim();
    if (!k) return null;
    if (KIND_META[k]) return KIND_META[k];
    const verb = /^verb:([^:]+):(.+)$/.exec(k);
    if (verb) {
      const inf = cleanInfinitiveLabel(verb[1]);
      const tense = verb[2];
      if (inf === "er") return KIND_META[`verb:er:${tense}`] || KIND_META["verb:er:present"];
      if (inf === "ir") return KIND_META[`verb:ir:${tense}`] || KIND_META["verb:ir:present"];
      if (
        typeof Analyzer !== "undefined" &&
        Analyzer.usesSharedGroupPattern &&
        Analyzer.usesSharedGroupPattern(inf)
      ) {
        const spec = Analyzer.groupPatternSpec(inf, tense === "present" ? "présent" : tense);
        return {
          name: spec.name,
          category: spec.category || "時態",
          disamb: true,
          seedId: SEED_BY_KIND[spec.key] || KIND_META[spec.key]?.seedId || "",
        };
      }
      const tenseZh =
        typeof Analyzer !== "undefined" && Analyzer.tenseZh
          ? Analyzer.tenseZh(tense === "present" ? "présent" : tense)
          : tense;
      const name =
        typeof Analyzer !== "undefined" && Analyzer.specificVerbRuleTitle
          ? Analyzer.specificVerbRuleTitle(inf, tenseZh || tense)
          : `${tenseZh || tense}（${inf}）`;
      return {
        name,
        category: "變位",
        cannotVeto: true,
        seedId: SEED_BY_KIND[k] || SEED_BY_KIND[`verb:${inf}:${tense}`] || "",
      };
    }
    if (k.startsWith("pp:irreg:")) {
      const inf = cleanInfinitiveLabel(k.slice("pp:irreg:".length));
      const name =
        typeof Analyzer !== "undefined" && Analyzer.specificVerbRuleTitle
          ? Analyzer.specificVerbRuleTitle(inf, "過去分詞")
          : `${inf} 過去分詞（participe passé）`;
      return { name, category: "變位", cannotVeto: true };
    }
    return null;
  }

  function seedIdForKind(key) {
    const k = String(key || "").trim();
    if (SEED_BY_KIND[k]) return SEED_BY_KIND[k];
    const meta = kindMeta(k);
    return String(meta?.seedId || "").trim();
  }

  function titleForGrammarKey(key) {
    const meta = kindMeta(key);
    return String(meta?.name || "").trim();
  }

  function canonForm(raw) {
    return String(raw || "")
      .trim()
      .normalize("NFC")
      .toLowerCase()
      .replace(/’/g, "'");
  }

  function isLetter(ch) {
    return /[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]/.test(ch);
  }

  function makeToken(src, start, end, extra = {}) {
    const word = String(src).slice(start, end);
    return {
      word,
      form: canonForm(word),
      pos: extra.pos || "其他",
      tag: extra.tag || "",
      lemma: extra.lemma || "",
      start,
      end,
      grammarKey: extra.grammarKey || "",
      needsDisambiguation: Boolean(extra.needsDisambiguation),
    };
  }

  function matchElision(src, i) {
    const slice = src.slice(i);
    const m = slice.match(/^(l|d|n|j|m|t|s|c|qu)['’]([A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+)/i);
    if (!m) return null;
    const proLen = m[1].length + 1;
    const hostLen = m[2].length;
    return {
      proEnd: i + proLen,
      end: i + proLen + hostLen,
    };
  }

  function splitHyphenWord(src, start, end) {
    const raw = src.slice(start, end);
    if (!raw.includes("-") && !raw.includes("‐")) return [makeToken(src, start, end)];
    const parts = [];
    let offset = 0;
    const segs = raw.split(/(-)/);
    const forms = segs.filter((s) => s && s !== "-").map((s) => canonForm(s));
    const shouldSplit = forms.some((f) => CLITIC_RIGHT.has(f) || LEXICON.has(f));
    if (!shouldSplit) return [makeToken(src, start, end)];
    for (const seg of segs) {
      if (!seg) continue;
      const a = start + offset;
      const b = a + seg.length;
      offset += seg.length;
      if (seg === "-") {
        parts.push(makeToken(src, a, b, { pos: "標點", tag: "HYPH" }));
      } else {
        parts.push(makeToken(src, a, b));
      }
    }
    return parts;
  }

  function lookupLex(form) {
    const f = canonForm(form);
    if (!f) return null;
    if (LEXICON.has(f)) return LEXICON.get(f);
    if (f.endsWith("'") && LEXICON.has(f)) return LEXICON.get(f);
    const noApos = f.replace(/'$/, "");
    if (ELISION_PRO.has(noApos) && LEXICON.has(noApos)) return LEXICON.get(noApos);
    if (LEXICON.has(noApos + "'")) return LEXICON.get(noApos + "'");
    return null;
  }

  function cleanInfinitiveLabel(raw) {
    return String(raw || "")
      .trim()
      .normalize("NFC")
      .replace(/_/g, " ")
      .replace(/^se\s+/i, "")
      .replace(/^s['’]/i, "")
      .trim();
  }

  function cleanGrammarName(name) {
    let s = String(name || "")
      .replace(/se_([A-Za-zÀ-ÿœæŒÆ]+)/g, "$1")
      .replace(/s['’]([A-Za-zÀ-ÿœæŒÆ]+)/g, "$1");
    if (typeof Analyzer !== "undefined" && Analyzer.rewriteSpecificVerbTitle) {
      s = Analyzer.rewriteSpecificVerbTitle(s) || s;
    }
    return s;
  }

  function verbNameFromAnalysis(form, analysis) {
    const p = analysis?.primary || analysis?.guesses?.[0] || {};
    const inf = cleanInfinitiveLabel(p.infinitive || "");
    const tense = String(p.tense || "");
    const irreg = Boolean(analysis?.irregular || p.irregular);
    const tenseZh =
      typeof Analyzer !== "undefined" && Analyzer.tenseZh
        ? Analyzer.tenseZh(tense) || tense
        : tense;
    if (tense === "participe passé" || /participe/.test(tense)) {
      if (irreg && inf) {
        const name =
          typeof Analyzer !== "undefined" && Analyzer.specificVerbRuleTitle
            ? Analyzer.specificVerbRuleTitle(inf, "過去分詞")
            : `${inf} 過去分詞（participe passé）`;
        return { name, category: "變位", key: `pp:irreg:${inf}` };
      }
      if (/é[es]?$/i.test(form) && !irreg) {
        return { name: "過去分詞（-é）", category: "時態", key: "pp:e" };
      }
      return { name: `過去分詞（${inf || form}）`, category: "變位", key: `pp:${inf || form}` };
    }
    const tenseKey = tense === "présent" ? "present" : tense || "x";
    const shared =
      inf &&
      typeof Analyzer !== "undefined" &&
      Analyzer.usesSharedGroupPattern &&
      Analyzer.usesSharedGroupPattern(inf);
    if (shared) {
      const spec = Analyzer.groupPatternSpec(inf, tenseZh || tense || "現在時");
      return { name: spec.name, category: spec.category || "時態", key: spec.key };
    }
    if (inf && inf !== "?" && inf.length >= 2 && !/^(er|ir|re)$/i.test(inf)) {
      const zh = tenseZh || tense || "現在時";
      const name =
        typeof Analyzer !== "undefined" && Analyzer.specificVerbRuleTitle
          ? Analyzer.specificVerbRuleTitle(inf, zh)
          : `${inf} ${zh}（${tense || zh}）`;
      return { name, category: "變位", key: `verb:${inf}:${tenseKey}` };
    }
    if (tense === "imparfait") {
      return { name: "未完成過去（-er imparfait）", category: "時態", key: "verb:er:imparfait" };
    }
    if (tense === "présent") {
      return { name: "現在時（-er présent）", category: "時態", key: "verb:er:present" };
    }
    if (tense === "futur simple") {
      return { name: "簡單未來式（futur simple）", category: "時態", key: "verb:futur" };
    }
    return { name: `${tenseZh || "變位"}（${form}）`, category: "變位", key: `verb:${form}` };
  }

  function applyVerbName(t, form, analysis, tag) {
    const named = verbNameFromAnalysis(form, analysis);
    t.pos = "動詞";
    t.tag = tag;
    t.lemma = cleanInfinitiveLabel((analysis.primary && analysis.primary.infinitive) || form) || form;
    t.grammarKey = named.key;
    t.lexName = named.name;
    t.lexCategory = named.category;
    t.verbInfo = analysis.primary;
    const irreg = Boolean(analysis?.irregular || analysis?.primary?.irregular);
    t.needsDisambiguation = !irreg && (named.key.startsWith("verb:er:") || named.key === "verb:futur");
    t.cannotVeto = irreg;
  }

  function prevVisibleToken(tokens, i) {
    for (let j = i - 1; j >= 0; j--) {
      if (SKIP_POS.has(tokens[j].pos)) continue;
      return tokens[j];
    }
    return null;
  }

  function nextVisibleToken(tokens, i) {
    const list = Array.isArray(tokens) ? tokens : [];
    for (let j = i + 1; j < list.length; j++) {
      if (SKIP_POS.has(list[j].pos)) continue;
      return list[j];
    }
    return null;
  }

  function looksNounLike(t) {
    if (!t) return false;
    if (t.pos === "名詞" || t.pos === "形容詞" || t.pos === "其他") return true;
    return false;
  }

  /** si + 形容詞／副詞＝「這麼」，不是條件連詞 si（如果）。si tu／si le 仍是條件。 */
  function isDegreeSiTarget(next) {
    if (!next) return false;
    const f = String(next.form || "");
    if (/^(seulement|possible|nécessaire|necessaire|besoin)$/.test(f)) return false;
    if (next.pos === "形容詞" || next.pos === "副詞") return true;
    if (
      next.pos === "代詞" ||
      next.pos === "連詞" ||
      next.pos === "冠詞" ||
      next.pos === "介詞" ||
      next.pos === "動詞" ||
      next.pos === "否定" ||
      next.pos === "名詞"
    ) {
      return false;
    }
    const w = String(next.word || "");
    if (!w || /^[A-ZÀ-ÖØ-Þ]/.test(w)) return false;
    if (looksInfinitiveForm(f)) return false;
    return next.pos === "其他" || !next.pos;
  }

  function looksInfinitiveForm(form) {
    const f = String(form || "").toLowerCase();
    return f.length >= 3 && /(?:er|ir|re|oir)$/i.test(f);
  }

  function isDeterminerToken(t) {
    if (!t) return false;
    if (t.pos === "冠詞") return true;
    if (t.grammarKey === "det:poss" || t.grammarKey === "det:dem") return true;
    return /^(mon|ma|mes|ton|ta|tes|son|sa|ses|notre|votre|nos|vos|leur|leurs)$/.test(t.form);
  }

  /** 冠詞／主有／指示後面是名詞槽，不要當成變位 */
  function inNounSlot(tokens, i) {
    const prev = prevVisibleToken(tokens, i);
    if (!prev) return false;
    if (isDeterminerToken(prev)) return true;
    if (prev.pos === "介詞") return true;
    return false;
  }

  function applyVerbHeuristics(tokens) {
    const list = Array.isArray(tokens) ? tokens : [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.pos !== "其他") continue;
      const form = t.form;
      if (!form || form.length < 2) continue;
      const prev = prevVisibleToken(list, i);
      const nounSlot = inNounSlot(list, i);
      const infAfterPrep = Boolean(prev && prev.pos === "介詞" && looksInfinitiveForm(form));
      if (nounSlot && !infAfterPrep) {
        t.pos = "名詞";
        t.tag = "N";
        continue;
      }
      if (
        t.pos === "其他" &&
        /^[A-ZÀ-ÖØ-Þ]/.test(t.word || "") &&
        t.word !== String(t.word || "").toLowerCase() &&
        !lookupLex(form)
      ) {
        t.pos = "名詞";
        t.tag = "N";
        continue;
      }
      if (typeof Analyzer === "undefined") continue;
      if (/é[es]?$/i.test(form) && form.length >= 3) {
        t.pos = "動詞";
        t.tag = "VPP";
        t.lemma = form.replace(/[eé][es]?$/i, "er");
        t.grammarKey = "pp:e";
        t.lexName = "過去分詞（-é）";
        t.lexCategory = "時態";
        t.verbInfo = { tense: "participe passé", infinitive: t.lemma };
        t.needsDisambiguation = false;
        t.cannotVeto = true;
        continue;
      }
      const analysis = Analyzer.analyze ? Analyzer.analyze(form) : null;
      const hit = analysis && analysis.confidence === "high" && analysis.primary;
      if (hit || (analysis && analysis.guesses && analysis.guesses.length && form.length >= 4)) {
        applyVerbName(t, form, analysis, analysis.irregular ? "VIRR" : "V");
      }
    }
  }

  function tagToken(t) {
    if (t.pos === "標點" || t.pos === "空白") return t;
    const form = t.form;
    if (!form || /^-+$/.test(form)) {
      t.pos = "標點";
      t.tag = t.tag || "PUNCT";
      return t;
    }
    const lex = lookupLex(form);
    if (lex) {
      t.pos = lex.pos;
      t.tag = lex.tag;
      t.lemma = lex.lemma || form;
      t.grammarKey = lex.grammarKey;
      t.lexName = lex.name;
      t.lexCategory = lex.category;
      const meta = kindMeta(lex.grammarKey);
      t.needsDisambiguation = Boolean(lex.needsDisambiguation);
      t.cannotVeto = !t.needsDisambiguation;
      return t;
    }
    if (typeof Analyzer !== "undefined") {
      const irreg = Analyzer.lookupIrregular && Analyzer.lookupIrregular(form);
      if (irreg) {
        const use = { primary: irreg, irregular: true };
        applyVerbName(t, form, use, "VIRR");
        t.needsDisambiguation = false;
        t.cannotVeto = true;
        return t;
      }
    }
    t.pos = "其他";
    t.tag = "X";
    t.lemma = form;
    return t;
  }

  function nearbyHasNe(tokens, i) {
    const list = Array.isArray(tokens) ? tokens : [];
    const lo = Math.max(0, i - 8);
    const hi = Math.min(list.length - 1, i + 8);
    for (let j = lo; j <= hi; j++) {
      if (j === i) continue;
      const f = list[j]?.form;
      if (f === "ne" || f === "n" || f === "n'") return true;
    }
    return false;
  }

  function nearbyHasPas(tokens, i) {
    return findPasIndex(tokens, Math.max(0, i - 1)) >= 0 || findPasIndex(tokens, i + 1) >= 0;
  }

  /** 依後接／前接語境修正同形異義（le 冠詞 vs COD、leur 主有 vs COI…） */
  function refineFunctionTags(tokens) {
    const list = Array.isArray(tokens) ? tokens : [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || SKIP_POS.has(t.pos)) continue;
      const form = t.form;
      const next = nextVisibleToken(list, i);
      const prev = prevVisibleToken(list, i);

      if (/^(le|la|les|l|l')$/.test(form) && (t.grammarKey === "article:def" || t.pos === "冠詞")) {
        if (next && next.pos === "動詞") {
          t.pos = "代詞";
          t.tag = "CLO";
          t.lexName = "直接賓語（le/la/les）";
          t.lexCategory = "代詞";
          t.grammarKey = "pron:cod";
          t.needsDisambiguation = true;
          t.cannotVeto = false;
        } else if (looksNounLike(next) || next?.pos === "形容詞") {
          t.needsDisambiguation = false;
          t.cannotVeto = true;
        } else {
          t.needsDisambiguation = true;
          t.cannotVeto = false;
        }
      }

      if (form === "leur") {
        if (looksNounLike(next) || next?.pos === "形容詞") {
          t.pos = "冠詞";
          t.tag = "POSS";
          t.lexName = "主有形容詞（leur/leurs）";
          t.lexCategory = "冠詞";
          t.grammarKey = "det:poss";
          t.lemma = "leur";
          t.needsDisambiguation = false;
          t.cannotVeto = true;
        } else {
          t.pos = "代詞";
          t.tag = "CLO";
          t.lexName = "間接賓語（lui/leur）";
          t.lexCategory = "代詞";
          t.grammarKey = "pron:coi";
          t.needsDisambiguation = true;
          t.cannotVeto = false;
        }
      }

      if (form === "lui") {
        t.needsDisambiguation = false;
        t.cannotVeto = true;
        t.grammarKey = t.grammarKey || "pron:coi";
      }

      if (form === "en") {
        t.needsDisambiguation = true;
        t.cannotVeto = false;
        const nextPlace =
          looksNounLike(next) ||
          (next && /^[A-ZÀ-ÖØ-Þ]/.test(next.word || "")) ||
          (next && /ant$/.test(next.form || ""));
        if (nextPlace) {
          t.pos = "介詞";
          t.tag = "P";
          t.lexName = "介詞（en）";
          t.lexCategory = "介詞";
          t.grammarKey = "prep:en";
        }
      }

      if (form === "y") {
        t.needsDisambiguation = true;
        t.cannotVeto = false;
        t.grammarKey = t.grammarKey || "pron:y";
      }

      if (form === "si") {
        if (isDegreeSiTarget(next)) {
          t.pos = "副詞";
          t.tag = "ADV";
          t.lexName = "";
          t.lexCategory = "";
          t.grammarKey = "";
          t.lemma = "si";
          t.needsDisambiguation = false;
          t.cannotVeto = false;
        }
      }

      if (form === "entre") {
        const afterSubj =
          prev &&
          (prev.grammarKey === "pron:subj" ||
            prev.form === "qui" ||
            prev.pos === "代詞");
        if (afterSubj && (!next || next.pos !== "冠詞")) {
          if (t.pos !== "動詞") {
            t.pos = "動詞";
            t.tag = "V";
            t.lemma = "entrer";
            t.grammarKey = "verb:er:present";
            t.lexName = "現在時（-er présent）";
            t.lexCategory = "時態";
          }
          t.needsDisambiguation = true;
          t.cannotVeto = false;
        } else {
          t.pos = "介詞";
          t.tag = "P";
          t.lexName = "介詞（entre）";
          t.lexCategory = "介詞";
          t.grammarKey = "prep:entre";
          t.needsDisambiguation = true;
          t.cannotVeto = false;
        }
      }

      if (t.pos === "否定" && (form === "pas" || form === "ne" || form === "n" || form === "n'")) {
        const pair =
          form === "pas" ? nearbyHasNe(list, i) : nearbyHasPas(list, i);
        t.needsDisambiguation = !pair;
        t.cannotVeto = pair;
      }
    }
  }

  function tokenize(source) {
    const src = String(source ?? "").normalize("NFC");
    const raw = [];
    const n = src.length;
    let i = 0;
    while (i < n) {
      const ch = src[i];
      if (/\s/.test(ch)) {
        let j = i + 1;
        while (j < n && /\s/.test(src[j])) j++;
        raw.push(makeToken(src, i, j, { pos: "空白", tag: "WS" }));
        i = j;
        continue;
      }
      const el = matchElision(src, i);
      if (el) {
        raw.push(makeToken(src, i, el.proEnd));
        raw.push(makeToken(src, el.proEnd, el.end));
        i = el.end;
        continue;
      }
      if (isLetter(ch)) {
        let j = i + 1;
        while (j < n && (isLetter(src[j]) || src[j] === "'" || src[j] === "’" || src[j] === "-")) {
          j++;
        }
        while (j > i + 1 && src[j - 1] === "-") j--;
        const parts = splitHyphenWord(src, i, j);
        raw.push(...parts);
        i = j;
        continue;
      }
      raw.push(makeToken(src, i, i + 1, { pos: "標點", tag: "PUNCT" }));
      i += 1;
    }
    const tokens = raw.map(tagToken);
    applyVerbHeuristics(tokens);
    refineFunctionTags(tokens);
    const joined = tokens.map((t) => t.word).join("");
    if (joined !== src) {
      throw new Error("切詞結果無法還原原文");
    }
    return tokens;
  }

  function isPronounGrammar(x) {
    if (!x || typeof x !== "object") return false;
    const cat = String(x.category || x.lexCategory || "").trim();
    if (cat === "代詞") return true;
    const key = String(x.grammarKey || x.frKind || x.g || "").trim();
    if (/^pron:/.test(key) || key === "det:dem") return true;
    if (x.pos === "代詞") return true;
    const name = String(x.name || x.title || x.lexName || "").trim();
    return /代詞|主語代詞|反身代詞|副代詞|指示代詞|賓語代詞|重讀代詞|關係代詞|直接賓語|間接賓語/.test(
      name
    );
  }

  function isGrammarToken(t) {
    if (!t || SKIP_POS.has(t.pos)) return false;
    if (t.pos === "名詞") return false;
    if (isPronounGrammar(t)) return false;
    return FUNCTION_POS.has(t.pos) || t.pos === "動詞" || Boolean(t.lexName);
  }

  function candidateConfidence(t, meta) {
    if (t?.needsDisambiguation || meta?.disamb) return "medium";
    return "high";
  }

  function candidateCannotVeto(t, meta, disamb) {
    if (disamb) return false;
    if (t?.cannotVeto) return true;
    return Boolean(meta?.cannotVeto);
  }

  function candidateFromToken(i, t) {
    if (!t || SKIP_POS.has(t.pos)) return null;
    if (isPronounGrammar(t)) return null;
    if (!t.lexName && !FUNCTION_POS.has(t.pos) && t.pos !== "動詞") return null;
    const meta = kindMeta(t.grammarKey);
    const name = t.lexName || meta?.name || (t.pos === "動詞" ? `變位（${t.form}）` : "");
    if (!name) return null;
    const disamb = Boolean(t.needsDisambiguation);
    return {
      name,
      tokenFrom: i,
      tokenTo: i,
      note: t.verbInfo ? `${t.lemma || ""} ${t.verbInfo.tense || ""}`.trim() : "",
      confidence: candidateConfidence(t, meta),
      needsDisambiguation: disamb,
      cannotVeto: candidateCannotVeto(t, meta, disamb),
      category: t.lexCategory || meta?.category || (t.pos === "動詞" ? "變位" : "其他"),
      grammarKey: t.grammarKey || `${t.pos}:${i}`,
      frKind: t.grammarKey || "",
      kind: (t.grammarKey || t.pos).split(":")[0] || "token",
    };
  }

  function findPasIndex(tokens, from) {
    for (let i = from; i < tokens.length && i <= from + 8; i++) {
      if (tokens[i].form === "pas") return i;
    }
    return -1;
  }

  function isAvoirEtreAux(t) {
    const inf = String(t?.lemma || "").toLowerCase();
    if (inf === "avoir" || inf === "être") return true;
    const f = t?.form;
    return /^(ai|as|a|avons|avez|ont|suis|es|est|sommes|êtes|etes|sont)$/.test(f);
  }

  function looksParticiple(t) {
    if (!t) return false;
    if (t.pos === "名詞" || t.pos === "冠詞" || t.pos === "介詞") return false;
    if (t.verbInfo && /participe/.test(String(t.verbInfo.tense || ""))) return true;
    const f = t.form || "";
    if (t.pos === "動詞" && /é[es]?$/.test(f) && f.length >= 3) return true;
    if (typeof Analyzer !== "undefined" && Analyzer.lookupIrregular) {
      const hit = Analyzer.lookupIrregular(f);
      if (hit && /participe/.test(String(hit.tense || ""))) return true;
    }
    return false;
  }

  function deterministicFunctions(src, tokens) {
    const list = Array.isArray(tokens) ? tokens : [];
    const out = [];
    const seen = new Set();
    function add(fn) {
      if (!fn || !fn.name) return;
      if (isPronounGrammar(fn)) return;
      const key = `${fn.grammarKey || fn.name}:${fn.tokenFrom}:${fn.tokenTo}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(fn);
    }

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const c = candidateFromToken(i, t);
      if (c) add(c);

      if (t.pos === "否定" && (t.form === "ne" || t.form === "n" || t.form === "n'")) {
        const pas = findPasIndex(list, i + 1);
        if (pas >= 0) {
          add({
            name: "否定（ne…pas）",
            tokenFrom: i,
            tokenTo: pas,
            note: "ne … pas",
            confidence: "high",
            needsDisambiguation: false,
            cannotVeto: true,
            category: "否定",
            grammarKey: "neg:ne-pas",
            frKind: "neg:ne-pas",
            kind: "neg",
          });
        }
      }

      if (t.pos === "動詞" && isAvoirEtreAux(t)) {
        for (let j = i + 1; j < list.length && j <= i + 4; j++) {
          if (SKIP_POS.has(list[j].pos) || FUNCTION_POS.has(list[j].pos)) continue;
          if (looksParticiple(list[j])) {
            const sure = Boolean(
              list[j].grammarKey === "pp:e" ||
                (list[j].grammarKey && String(list[j].grammarKey).startsWith("pp:irreg:")) ||
                (list[j].verbInfo && /participe/.test(String(list[j].verbInfo.tense || "")))
            );
            add({
              name: "複合過去（passé composé）",
              tokenFrom: i,
              tokenTo: j,
              note: "助動詞＋過去分詞",
              confidence: sure ? "high" : "medium",
              needsDisambiguation: !sure,
              cannotVeto: sure,
              category: "時態",
              grammarKey: "tense:passe-compose",
              frKind: "tense:passe-compose",
              kind: "tense",
            });
          }
          break;
        }
      }
    }

    const coveredNeg = new Set();
    for (const fn of out) {
      if (fn.grammarKey !== "neg:ne-pas") continue;
      const from = Number(fn.tokenFrom);
      const to = Number(fn.tokenTo);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      for (let i = from; i <= to; i++) {
        if (list[i]?.pos === "否定") coveredNeg.add(i);
      }
    }
    return out.filter((fn) => {
      if (fn.grammarKey !== "neg:ne" && fn.grammarKey !== "neg:pas") return true;
      if (fn.tokenFrom !== fn.tokenTo) return true;
      return !coveredNeg.has(fn.tokenFrom);
    });
  }

  function candidateDecisionId(candidate) {
    if (!candidate) return "";
    const kind = String(candidate.kind || candidate.grammarKey || "candidate").trim() || "candidate";
    const from = Number(candidate.tokenFrom ?? candidate.from);
    const to = Number(candidate.tokenTo ?? candidate.to ?? from);
    if (!Number.isFinite(from)) return "";
    return `${kind}:${from}:${Number.isFinite(to) ? to : from}`;
  }

  function isHighConfidenceCandidate(c) {
    if (!c) return false;
    if (c.cannotVeto) return true;
    return !c.needsDisambiguation && c.confidence === "high";
  }

  function grammarChecklist(tokens, candidates, opts = {}) {
    const apiOnly = Boolean(opts.apiOnly);
    const list = [];
    const covered = new Set();
    for (const c of candidates || []) {
      if (apiOnly && isHighConfidenceCandidate(c) && !c.needsDisambiguation) continue;
      const id = candidateDecisionId(c);
      if (!id) continue;
      const from = Number(c.tokenFrom);
      const to = Number(c.tokenTo);
      list.push({
        id,
        type: "candidate",
        tokenFrom: from,
        tokenTo: to,
        label: c.name || id,
      });
      if (Number.isFinite(from) && Number.isFinite(to)) {
        for (let i = from; i <= to; i++) covered.add(i);
      }
    }
    (tokens || []).forEach((t, i) => {
      if (covered.has(i)) return;
      if (!isGrammarToken(t)) return;
      if (apiOnly && !t.needsDisambiguation) return;
      list.push({
        id: `morph:${i}`,
        type: "morph",
        tokenFrom: i,
        tokenTo: i,
        label: `${t.form || t.word || "?"}/${t.pos || t.tag || "?"}`,
      });
    });
    return list;
  }

  function localConfirmedFromCandidates(candidates) {
    const functions = [];
    const decisions = [];
    for (const c of candidates || []) {
      if (!isHighConfidenceCandidate(c) || c.needsDisambiguation) continue;
      const id = candidateDecisionId(c);
      if (!id) continue;
      functions.push({
        name: c.name,
        tokenFrom: c.tokenFrom,
        tokenTo: c.tokenTo,
        note: c.note || "local",
        confidence: "high",
        category: c.category || "",
        grammarKey: c.grammarKey || "",
        candidateId: id,
        status: "confirmed",
        cannotVeto: true,
      });
      decisions.push({
        candidateId: id,
        status: "confirmed",
        note: "local",
        tokenFrom: c.tokenFrom,
        tokenTo: c.tokenTo,
      });
    }
    return { functions, decisions };
  }

  function compactLocalConfirmedLines(candidates) {
    return (candidates || [])
      .filter((c) => isHighConfidenceCandidate(c) && !c.needsDisambiguation)
      .map((c) => {
        const id = candidateDecisionId(c);
        return `${id} ${c.tokenFrom}-${c.tokenTo} ${c.name} [${c.grammarKey || ""}]`;
      })
      .join("\n");
  }

  function compactTokenLines(tokens) {
    return (tokens || [])
      .map((t, i) => {
        const bits = [`${i}`, (t.word || "").replace(/\n/g, "\\n"), t.pos || "", t.tag || ""];
        if (t.lemma && t.lemma !== t.form) bits.push(`原=${t.lemma}`);
        return bits.join(" ");
      })
      .join("\n");
  }

  function compactCandidateLines(cands) {
    return (cands || [])
      .map((c) => {
        const flag = c.needsDisambiguation ? "消歧" : "高信心";
        const id = candidateDecisionId(c);
        return `${id} ${c.tokenFrom}-${c.tokenTo} ${c.name} [${flag}]${c.note ? " " + c.note : ""}`;
      })
      .join("\n");
  }

  function compactChecklistLines(checklist) {
    return (checklist || [])
      .map((x) => `${x.id} ${x.tokenFrom}-${x.tokenTo} ${x.label}`)
      .join("\n");
  }

  function unresolvedGrammarChecklist(checklist, mapped) {
    const decisions = Array.isArray(mapped?.decisions) ? mapped.decisions : [];
    const decided = new Set(
      decisions
        .filter((d) => String(d?.status || "").toLowerCase() !== "unknown")
        .map((d) => String(d?.candidateId || "").trim())
        .filter(Boolean)
    );
    return (checklist || []).filter((target) => !decided.has(target.id));
  }

  function splitRuleName(name) {
    const s = String(name || "").trim();
    const m = s.match(/^(.+?)[（(]\s*(.+?)\s*[）)]\s*$/);
    if (m) return { name: s, nameZh: m[1].trim(), nameFr: m[2].trim() };
    return { name: s, nameZh: s, nameFr: "" };
  }

  function isBareNounGrammar(fn) {
    const n = String(fn?.name || "").trim();
    const zh = n.replace(/[（(].*$/, "").trim();
    if (/^(名詞|普通名詞|可數名詞|不可數名詞|專有名詞|nouns?)$/i.test(zh)) return true;
    if (/^名詞（/.test(n) && !/複數|性數|配合/.test(n)) return true;
    return false;
  }

  function isFunctionGrammarFn(fn, fromTok) {
    const blob = `${fn?.category || ""} ${fn?.name || ""} ${fn?.grammarKey || ""}`;
    if (/冠詞|介詞|代詞|否定|連詞|article|prep|pron|neg|conj|det|élision|省音/.test(blob)) {
      return true;
    }
    return Boolean(fromTok && FUNCTION_POS.has(fromTok.pos));
  }

  function fnLooksSharedVerb(fn) {
    const key = String(fn?.grammarKey || "");
    if (!key || /^verb:(er|ir):/.test(key) || key === "verb:futur" || key === "pp:e") return true;
    return /（\s*-?\s*(?:er|ir)\b|（\s*-é\s*）/i.test(String(fn?.name || ""));
  }

  function verbTokenAgrees(token, fn) {
    const key = String(fn?.grammarKey || "");
    const tk = String(token?.grammarKey || "");
    if (!key || !tk) return false;
    if (key === tk) return true;
    const fm = /^verb:(er|ir):([^:]+)$/.exec(key);
    const tm = /^verb:([^:]+):([^:]+)$/.exec(tk);
    if (!fm || !tm || fm[2] !== tm[2]) return false;
    if (tm[1] === fm[1]) return true;
    return Boolean(
      typeof Analyzer !== "undefined" &&
        Analyzer.usesSharedGroupPattern &&
        Analyzer.usesSharedGroupPattern(tm[1])
    );
  }

  /** 不定詞才允許把 verb:er: 改成 verb:某動詞。il、vit 不是不定詞。 */
  function lemmaCanOwnVerbKey(lemma) {
    const s = String(lemma || "")
      .trim()
      .toLowerCase()
      .normalize("NFC");
    if (!s || s === "er" || s === "ir") return false;
    if (typeof Analyzer !== "undefined" && Analyzer.isIrregularInfinitive && Analyzer.isIrregularInfinitive(s)) {
      return true;
    }
    return s.length >= 4 && /(?:er|ir|re|oir)$/i.test(s);
  }

  function fnIsVerbGrammar(fn) {
    const blob = `${fn?.category || ""} ${fn?.name || ""} ${fn?.grammarKey || ""}`;
    if (/冠詞|介詞|代詞|否定|連詞|article|prep|pron:|neg:|conj:|det:|élision|省音/.test(blob)) return false;
    return /變位|時態|動詞|présent|imparfait|futur|分詞|infinitif|不定式|^verb:|^pp:/.test(blob);
  }

  function clipGrammarTokenRange(tokens, from, to, fn) {
    const n = tokens.length;
    if (!n) return { from, to };
    if (fnIsVerbGrammar(fn)) {
      const agreed = [];
      const verbs = [];
      for (let i = from; i <= to; i++) {
        const t = tokens[i];
        if (!t || t.pos !== "動詞") continue;
        verbs.push(i);
        if (verbTokenAgrees(t, fn)) agreed.push(i);
      }
      const pick = agreed.length ? agreed[0] : verbs.length === 1 && fnLooksSharedVerb(fn) ? verbs[0] : -1;
      if (pick >= 0) return { from: pick, to: pick };
      while (to > from) {
        const t = tokens[to];
        if (!t || SKIP_POS.has(t.pos)) {
          to -= 1;
          continue;
        }
        if (t.pos === "動詞" || FUNCTION_POS.has(t.pos)) break;
        to -= 1;
      }
      return { from, to };
    }
    if (isFunctionGrammarFn(fn, tokens[from])) {
      while (to > from) {
        const t = tokens[to];
        if (!t || SKIP_POS.has(t.pos)) {
          to -= 1;
          continue;
        }
        if (FUNCTION_POS.has(t.pos) || t.pos === "動詞") break;
        to -= 1;
      }
    }
    return { from, to };
  }

  function functionToItem(tokens, fn, srcHint) {
    if (isBareNounGrammar(fn) || isPronounGrammar(fn)) return null;
    const n = tokens.length;
    if (!n) return null;
    let from = Number(fn.tokenFrom);
    let to = Number(fn.tokenTo);
    if (!Number.isFinite(from)) from = 0;
    if (!Number.isFinite(to)) to = from;
    from = Math.max(0, Math.min(n - 1, from));
    to = Math.max(0, Math.min(n - 1, to));
    if (to < from) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    const clipped = clipGrammarTokenRange(tokens, from, to, fn);
    from = clipped.from;
    to = clipped.to;
    if (tokens[from]?.pos === "名詞" && tokens[to]?.pos === "名詞") {
      if (isFunctionGrammarFn(fn, tokens[from])) return null;
      if (!/複數|性數|配合/.test(String(fn.name || ""))) return null;
    }
    const slice = tokens.slice(from, to + 1);
    const src = String(srcHint || "") || slice.map((t) => t.word).join("");
    const vis = slice.filter((t) => Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start);
    const start = vis.length ? vis[0].start : slice[0].start;
    const end = vis.length ? vis[vis.length - 1].end : slice[slice.length - 1].end;
    const span =
      Number.isFinite(start) && Number.isFinite(end) && end > start
        ? src.slice(start, end)
        : slice.map((t) => t.form || t.word).join("");
    const tokenLemma = cleanInfinitiveLabel(tokens[from]?.lemma || "");
    const fnLemma = cleanInfinitiveLabel(fn.lemma || "");
    const lemma = lemmaCanOwnVerbKey(tokenLemma)
      ? tokenLemma
      : lemmaCanOwnVerbKey(fnLemma)
        ? fnLemma
        : tokenLemma || fnLemma;
    let rawName = cleanGrammarName(fn.name);
    if (typeof Analyzer !== "undefined" && Analyzer.rewriteVerbTitle) {
      rawName = Analyzer.rewriteVerbTitle(rawName, { infinitive: lemma, span }) || rawName;
    }
    const names = splitRuleName(rawName);
    if (!names.name) return null;
    let grammarKey = String(fn.grammarKey || fn.frKind || "");
    const sharedLemma =
      lemma &&
      typeof Analyzer !== "undefined" &&
      Analyzer.usesSharedGroupPattern &&
      Analyzer.usesSharedGroupPattern(lemma);
    if (sharedLemma && typeof Analyzer.groupPatternSpec === "function") {
      grammarKey = Analyzer.groupPatternSpec(lemma, names.name).key || grammarKey;
    } else if (lemma && lemma !== "er" && grammarKey.startsWith("verb:er:") && lemmaCanOwnVerbKey(lemma)) {
      grammarKey = `verb:${lemma}:${grammarKey.split(":")[2] || "present"}`;
    }
    const item = {
      name: names.name,
      nameZh: names.nameZh,
      nameFr: names.nameFr,
      nameKo: names.nameFr,
      category: fn.category || kindMeta(grammarKey)?.category || "其他",
      span,
      start,
      end,
      note: String(fn.note || "").trim(),
      confidence: ["high", "medium", "low"].includes(fn.confidence) ? fn.confidence : "medium",
      tokenFrom: from,
      tokenTo: to,
      grammarKey,
      frKind: String(fn.frKind || grammarKey),
      candidateId: String(fn.candidateId || ""),
    };
    if (fn.cannotVeto) item.cannotVeto = true;
    return item;
  }

  function rangeOverlapsIdx(aFrom, aTo, bFrom, bTo) {
    return !(aTo < bFrom || aFrom > bTo);
  }

  function functionsToItems(tokens, aiFunctions, candidates, opts = {}) {
    const list = Array.isArray(tokens) ? tokens : [];
    if (!list.length) return [];
    const src = String(opts.src || "");
    const items = [];
    const ranges = [];

    function addFn(fn) {
      const item = functionToItem(list, fn, src);
      if (!item) return;
      const dup = items.some(
        (it) => it.name === item.name && it.start === item.start && it.end === item.end
      );
      if (dup) return;
      const sameSpan = items.findIndex(
        (it) => it.tokenFrom === item.tokenFrom && it.tokenTo === item.tokenTo
      );
      if (sameSpan >= 0) {
        const prev = items[sameSpan];
        const prevLocal = Boolean(prev.cannotVeto) || prev.confidence === "high";
        const nextLocal = Boolean(item.cannotVeto) || item.confidence === "high";
        if (prevLocal && !nextLocal) return;
        if (nextLocal && !prevLocal) {
          items[sameSpan] = item;
          ranges[sameSpan] = {
            from: item.tokenFrom,
            to: item.tokenTo,
            name: item.name,
            grammarKey: item.grammarKey || "",
          };
          return;
        }
        return;
      }
      items.push(item);
      ranges.push({
        from: item.tokenFrom,
        to: item.tokenTo,
        name: item.name,
        grammarKey: item.grammarKey || "",
      });
    }

    for (const fn of Array.isArray(aiFunctions) ? aiFunctions : []) {
      const linked = (candidates || []).find(
        (c) => candidateDecisionId(c) === String(fn?.candidateId || "").trim()
      );
      const linkedStatus = String(fn?.status || "confirmed");
      const confirmedOrReclass =
        linked && (linkedStatus === "confirmed" || linkedStatus === "reclassified");
      if (confirmedOrReclass && linkedStatus === "confirmed") {
        addFn({
          ...fn,
          name: linked.name || fn.name,
          category: linked.category || fn.category,
          grammarKey: linked.grammarKey || fn.grammarKey,
          frKind: linked.frKind || linked.grammarKey || fn.grammarKey,
          cannotVeto: linked.cannotVeto || fn.cannotVeto,
        });
      } else if (linkedStatus === "reclassified") {
        const key = String(fn.grammarKey || "").trim();
        const canon = titleForGrammarKey(key);
        addFn({
          ...fn,
          name: canon || fn.name,
          grammarKey: key || fn.grammarKey,
          frKind: key || fn.frKind,
        });
      } else {
        addFn(fn);
      }
    }

    const decisionRows = Array.isArray(opts.candidateDecisions) ? opts.candidateDecisions : [];
    const resolvedCandidateIds = new Set(
      decisionRows
        .filter((d) => String(d?.status || "").toLowerCase() !== "unknown")
        .map((d) => String(d?.candidateId || "").trim())
        .filter(Boolean)
    );
    const rejectedIds = new Set(
      decisionRows
        .filter((d) => {
          const s = String(d?.status || "").toLowerCase();
          return s === "rejected" || s === "unknown";
        })
        .map((d) => String(d?.candidateId || "").trim())
        .filter(Boolean)
    );
    for (const c of candidates || []) {
      const cid = candidateDecisionId(c);
      const keepLocal = isHighConfidenceCandidate(c) && !c.needsDisambiguation;
      if (rejectedIds.has(cid)) {
        if (keepLocal || c.cannotVeto) addFn(c);
        continue;
      }
      if (resolvedCandidateIds.has(cid)) continue;
      if (c.needsDisambiguation) continue;
      if (!keepLocal) continue;
      const covered = ranges.some(
        (r) =>
          (c.grammarKey && r.grammarKey && c.grammarKey === r.grammarKey) ||
          String(c.name || "").trim() === String(r.name || "").trim()
      );
      if (covered) continue;
      addFn(c);
    }

    items.sort((a, b) => a.start - b.start || b.end - a.end - (a.end - a.start));
    return items;
  }

  function parseMappedFunctions(parsed) {
    const raw = Array.isArray(parsed?.functions)
      ? parsed.functions
      : Array.isArray(parsed?.fn)
        ? parsed.fn
        : Array.isArray(parsed?.items)
          ? parsed.items
          : Array.isArray(parsed)
            ? parsed
            : [];
    const normalizedRows = raw
      .map((fn) => {
        const name = String(fn?.name || fn?.n || "").trim();
        const candidateId = String(fn?.candidateId || fn?.q || fn?.id || "").trim();
        let status = String(fn?.status || fn?.x || (name ? "confirmed" : "")).toLowerCase();
        if (status === "confirm") status = "confirmed";
        if (status === "reject") status = "rejected";
        if (status === "reclassify") status = "reclassified";
        if (!name && status !== "rejected" && status !== "unknown") return null;
        const tokenFrom = Number(fn.tokenFrom ?? fn.from ?? fn.a);
        const tokenTo = Number(fn.tokenTo ?? fn.to ?? fn.b ?? tokenFrom);
        if (!Number.isFinite(tokenFrom) && status !== "rejected" && status !== "unknown") return null;
        let confidence = String(fn.confidence || fn.f || "medium").toLowerCase();
        if (confidence === "h") confidence = "high";
        else if (confidence === "m") confidence = "medium";
        else if (confidence === "l") confidence = "low";
        if (!["high", "medium", "low"].includes(confidence)) confidence = "medium";
        const grammarKey = String(fn.grammarKey || fn.g || fn.key || "").trim();
        if (candidateId && (status === "confirmed" || status === "reclassified") && !grammarKey) {
          status = "unknown";
        }
        return {
          name,
          tokenFrom,
          tokenTo: Number.isFinite(tokenTo) ? tokenTo : tokenFrom,
          note: String(fn.note || fn.e || "").trim(),
          confidence,
          category: String(fn.category || fn.c || "").trim(),
          grammarKey,
          candidateId,
          status: ["confirmed", "rejected", "reclassified", "unknown"].includes(status)
            ? status
            : "unknown",
        };
      })
      .filter(Boolean);

    const extraDecisions = Array.isArray(parsed?.decisions)
      ? parsed.decisions
      : Array.isArray(parsed?.d)
        ? parsed.d
        : [];
    const decisionRows = [
      ...normalizedRows,
      ...extraDecisions.map((d) => ({
        candidateId: String(d?.candidateId || d?.q || d?.id || "").trim(),
        status: String(d?.status || d?.x || "rejected").toLowerCase(),
        note: String(d?.note || d?.e || d?.reason || "").trim(),
        tokenFrom: Number(d?.tokenFrom ?? d?.from ?? d?.a),
        tokenTo: Number(d?.tokenTo ?? d?.to ?? d?.b ?? d?.tokenFrom ?? d?.a),
      })),
    ].filter((d) => d.candidateId);

    const decisionsById = new Map();
    for (const d of decisionRows) {
      let status = String(d.status || "unknown").toLowerCase();
      if (status === "confirm") status = "confirmed";
      if (status === "reject") status = "rejected";
      if (status === "reclassify") status = "reclassified";
      if (!["confirmed", "rejected", "reclassified", "unknown"].includes(status)) status = "unknown";
      decisionsById.set(d.candidateId, {
        candidateId: d.candidateId,
        status,
        note: d.note || "",
        tokenFrom: d.tokenFrom,
        tokenTo: d.tokenTo,
      });
    }
    const functions = normalizedRows.filter(
      (fn) => fn.name && (fn.status === "confirmed" || fn.status === "reclassified")
    );
    return {
      functions,
      decisions: [...decisionsById.values()],
      translation: String(parsed?.translation || parsed?.t || "").trim(),
      summary: String(parsed?.summary || parsed?.u || "").trim(),
    };
  }

  function slimTokens(tokens) {
    return (Array.isArray(tokens) ? tokens : []).slice(0, 240).map((t) => ({
      word: String(t.word ?? ""),
      form: String(t.form || ""),
      pos: String(t.pos || ""),
      tag: String(t.tag || ""),
      lemma: String(t.lemma || ""),
      start: Number.isFinite(t.start) ? t.start : null,
      end: Number.isFinite(t.end) ? t.end : null,
    }));
  }

  function normClosedForm(s) {
    return String(s || "")
      .normalize("NFC")
      .toLowerCase()
      .replace(/’/g, "'");
  }

  /** 人稱／主有：API 沒寫意思時用的短義。le／de／ne 這類冠詞與否定不在這裡。 */
  const CLOSED_PRON_GLOSS = {
    je: "我",
    "j'": "我",
    tu: "你",
    il: "他",
    elle: "她",
    on: "有人／我們",
    nous: "我們",
    vous: "您／你們",
    ils: "他們",
    elles: "她們",
    me: "我",
    "m'": "我",
    te: "你",
    "t'": "你",
    se: "自己",
    "s'": "自己",
    moi: "我",
    toi: "你",
    soi: "自己",
    lui: "他／她",
    ça: "這",
    ca: "這",
    cela: "這",
    ceci: "這",
    qui: "誰",
    dont: "其",
    où: "哪裡",
    mon: "我的",
    ma: "我的",
    mes: "我的",
    ton: "你的",
    ta: "你的",
    tes: "你的",
    son: "他的／她的",
    sa: "他的／她的",
    ses: "他的／她的",
    notre: "我們的",
    nos: "我們的",
    votre: "您的",
    vos: "您的",
  };

  const CLOSED_CLITIC_GLOSS = {
    j: "我",
    m: "我",
    t: "你",
    s: "自己",
  };

  function closedClassGlossForToken(t) {
    if (!t) return "";
    const pos = String(t.pos || "");
    if (pos === "名詞" || pos === "動詞" || pos === "形容詞" || pos === "副詞" || pos === "標點" || pos === "空白") {
      return "";
    }
    const form = normClosedForm(t.form || t.word);
    const key = String(t.grammarKey || "");
    if (key === "det:poss") {
      if (form === "leur" || form === "leurs") return "他們的";
      return CLOSED_PRON_GLOSS[form] || "";
    }
    if (key === "pron:coi") return form === "leur" ? "他們" : "他／她";
    if (key === "pron:en") return "其中";
    if (key === "pron:y") return "那裡";
    if (key === "pron:cod") {
      if (form === "le" || form === "l'") return "他／它";
      if (form === "la") return "她／它";
      if (form === "les") return "他們";
      return "";
    }
    if (pos === "代詞" || key.indexOf("pron:") === 0) {
      if (form === "en" || form === "y" || form === "le" || form === "la" || form === "les") return "";
      return CLOSED_PRON_GLOSS[form] || CLOSED_CLITIC_GLOSS[form] || "";
    }
    return CLOSED_PRON_GLOSS[form] || "";
  }

  function closedClassGlossForSurface(surface) {
    const form = normClosedForm(surface);
    return CLOSED_PRON_GLOSS[form] || "";
  }

  /**
   * API 單字：代詞與主有詞補上短義；沒有意思的項目不留。
   * 已有意思的不覆蓋。
   */
  function ensureClosedClassVocab(query, vocab) {
    const list = (Array.isArray(vocab) ? vocab : []).map((w) => ({ ...w }));
    let tokens = [];
    try {
      tokens = tokenize(String(query || ""));
    } catch {
      tokens = [];
    }
    const claimed = new Set();

    function claimToken(t) {
      if (t && Number.isFinite(t.start)) claimed.add(t.start);
    }

    function tokenFor(w) {
      if (Number.isFinite(w.start)) {
        const byStart = tokens.find((t) => t.start === w.start);
        if (byStart) return byStart;
      }
      const form = normClosedForm(w.surface || w.lemma);
      if (!form) return null;
      return (
        tokens.find((t) => !claimed.has(t.start) && normClosedForm(t.word) === form) || null
      );
    }

    for (const w of list) {
      if (String(w.gloss || "").trim()) {
        const t = tokenFor(w);
        claimToken(t);
        continue;
      }
      const t = tokenFor(w);
      const g = (t && closedClassGlossForToken(t)) || closedClassGlossForSurface(w.surface || w.lemma);
      if (g) {
        w.gloss = g;
        if (!w.pos || w.pos === "其他" || w.pos === "冠詞") w.pos = "代詞";
        claimToken(t);
      }
    }

    for (const t of tokens) {
      if (claimed.has(t.start)) continue;
      const g = closedClassGlossForToken(t);
      if (!g) continue;
      const surface = String(t.word || "");
      const form = normClosedForm(surface);
      const already = list.some((w) => {
        if (!String(w.gloss || "").trim()) return false;
        if (Number.isFinite(w.start) && w.start === t.start) return true;
        return normClosedForm(w.surface) === form;
      });
      if (already) {
        claimToken(t);
        continue;
      }
      list.push({
        surface,
        lemma: t.lemma || surface,
        gloss: g,
        pos: "代詞",
        start: Number.isFinite(t.start) ? t.start : null,
        end: Number.isFinite(t.end) ? t.end : null,
      });
      claimToken(t);
    }

    return list.filter((w) => {
      const surface = String(w.surface || w.lemma || "").trim();
      const gloss = String(w.gloss || "").trim();
      return Boolean(surface && gloss);
    });
  }

  function tokensToVocab(tokens) {
    const out = [];
    const seen = new Set();
    for (const t of tokens || []) {
      if (!CONTENT_POS.has(t.pos)) continue;
      const surface = t.word;
      if (!surface || /^\s+$/.test(surface)) continue;
      const key = `${surface}:${t.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        surface,
        lemma: t.lemma || surface,
        gloss: "",
        pos: t.pos,
        start: Number.isFinite(t.start) ? t.start : null,
        end: Number.isFinite(t.end) ? t.end : null,
      });
    }
    return out;
  }

  return {
    tokenize,
    deterministicFunctions,
    functionsToItems,
    parseMappedFunctions,
    compactTokenLines,
    compactCandidateLines,
    candidateDecisionId,
    grammarChecklist,
    compactChecklistLines,
    unresolvedGrammarChecklist,
    tokensToVocab,
    ensureClosedClassVocab,
    slimTokens,
    isPronounGrammar,
    cleanGrammarName,
    cleanInfinitiveLabel,
    KIND_META,
    kindMeta,
    seedIdForKind,
    titleForGrammarKey,
    isHighConfidenceCandidate,
    localConfirmedFromCandidates,
    compactLocalConfirmedLines,
  };
})();
