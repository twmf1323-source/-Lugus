/**
 * 本地基礎分析（無 API 時的後備）
 * 依常見詞尾與不規則表推估原形／時態／人稱
 * 不規則動詞必須另立專屬規則，不可被「第一組 -er」等通則詞尾吞掉
 */
const Analyzer = (() => {
  /** 常見不規則動詞完整變位（供比對阻擋通則＋預填建卡） */
  const IRREGULAR_PARADIGMS = {
    être: {
      présent: { je: "suis", tu: "es", il: "est", nous: "sommes", vous: "êtes", ils: "sont" },
      imparfait: {
        je: "étais",
        tu: "étais",
        il: "était",
        nous: "étions",
        vous: "étiez",
        ils: "étaient",
      },
    },
    avoir: {
      présent: { je: "ai", tu: "as", il: "a", nous: "avons", vous: "avez", ils: "ont" },
      imparfait: {
        je: "avais",
        tu: "avais",
        il: "avait",
        nous: "avions",
        vous: "aviez",
        ils: "avaient",
      },
    },
    aller: {
      présent: { je: "vais", tu: "vas", il: "va", nous: "allons", vous: "allez", ils: "vont" },
      imparfait: {
        je: "allais",
        tu: "allais",
        il: "allait",
        nous: "allions",
        vous: "alliez",
        ils: "allaient",
      },
    },
    faire: {
      présent: { je: "fais", tu: "fais", il: "fait", nous: "faisons", vous: "faites", ils: "font" },
      imparfait: {
        je: "faisais",
        tu: "faisais",
        il: "faisait",
        nous: "faisions",
        vous: "faisiez",
        ils: "faisaient",
      },
    },
    pouvoir: {
      présent: {
        je: "peux",
        tu: "peux",
        il: "peut",
        nous: "pouvons",
        vous: "pouvez",
        ils: "peuvent",
      },
      imparfait: {
        je: "pouvais",
        tu: "pouvais",
        il: "pouvait",
        nous: "pouvions",
        vous: "pouviez",
        ils: "pouvaient",
      },
    },
    vouloir: {
      présent: {
        je: "veux",
        tu: "veux",
        il: "veut",
        nous: "voulons",
        vous: "voulez",
        ils: "veulent",
      },
      imparfait: {
        je: "voulais",
        tu: "voulais",
        il: "voulait",
        nous: "voulions",
        vous: "vouliez",
        ils: "voulaient",
      },
    },
    devoir: {
      présent: {
        je: "dois",
        tu: "dois",
        il: "doit",
        nous: "devons",
        vous: "devez",
        ils: "doivent",
      },
      imparfait: {
        je: "devais",
        tu: "devais",
        il: "devait",
        nous: "devions",
        vous: "deviez",
        ils: "devaient",
      },
    },
    savoir: {
      présent: {
        je: "sais",
        tu: "sais",
        il: "sait",
        nous: "savons",
        vous: "savez",
        ils: "savent",
      },
      imparfait: {
        je: "savais",
        tu: "savais",
        il: "savait",
        nous: "savions",
        vous: "saviez",
        ils: "savaient",
      },
    },
    venir: {
      présent: {
        je: "viens",
        tu: "viens",
        il: "vient",
        nous: "venons",
        vous: "venez",
        ils: "viennent",
      },
      imparfait: {
        je: "venais",
        tu: "venais",
        il: "venait",
        nous: "venions",
        vous: "veniez",
        ils: "venaient",
      },
    },
    prendre: {
      présent: {
        je: "prends",
        tu: "prends",
        il: "prend",
        nous: "prenons",
        vous: "prenez",
        ils: "prennent",
      },
      imparfait: {
        je: "prenais",
        tu: "prenais",
        il: "prenait",
        nous: "prenions",
        vous: "preniez",
        ils: "prenaient",
      },
    },
    mettre: {
      présent: {
        je: "mets",
        tu: "mets",
        il: "met",
        nous: "mettons",
        vous: "mettez",
        ils: "mettent",
      },
      imparfait: {
        je: "mettais",
        tu: "mettais",
        il: "mettait",
        nous: "mettions",
        vous: "mettiez",
        ils: "mettaient",
      },
    },
    dire: {
      présent: { je: "dis", tu: "dis", il: "dit", nous: "disons", vous: "dites", ils: "disent" },
      imparfait: {
        je: "disais",
        tu: "disais",
        il: "disait",
        nous: "disions",
        vous: "disiez",
        ils: "disaient",
      },
    },
    voir: {
      présent: {
        je: "vois",
        tu: "vois",
        il: "voit",
        nous: "voyons",
        vous: "voyez",
        ils: "voient",
      },
      imparfait: {
        je: "voyais",
        tu: "voyais",
        il: "voyait",
        nous: "voyions",
        vous: "voyiez",
        ils: "voyaient",
      },
    },
    boire: {
      présent: {
        je: "bois",
        tu: "bois",
        il: "boit",
        nous: "buvons",
        vous: "buvez",
        ils: "boivent",
      },
      imparfait: {
        je: "buvais",
        tu: "buvais",
        il: "buvait",
        nous: "buvions",
        vous: "buviez",
        ils: "buvaient",
      },
    },
    croire: {
      présent: {
        je: "crois",
        tu: "crois",
        il: "croit",
        nous: "croyons",
        vous: "croyez",
        ils: "croient",
      },
      imparfait: {
        je: "croyais",
        tu: "croyais",
        il: "croyait",
        nous: "croyions",
        vous: "croyiez",
        ils: "croyaient",
      },
    },
    écrire: {
      présent: {
        je: "écris",
        tu: "écris",
        il: "écrit",
        nous: "écrivons",
        vous: "écrivez",
        ils: "écrivent",
      },
      imparfait: {
        je: "écrivais",
        tu: "écrivais",
        il: "écrivait",
        nous: "écrivions",
        vous: "écriviez",
        ils: "écrivaient",
      },
    },
    lire: {
      présent: { je: "lis", tu: "lis", il: "lit", nous: "lisons", vous: "lisez", ils: "lisent" },
      imparfait: {
        je: "lisais",
        tu: "lisais",
        il: "lisait",
        nous: "lisions",
        vous: "lisiez",
        ils: "lisaient",
      },
    },
    partir: {
      présent: {
        je: "pars",
        tu: "pars",
        il: "part",
        nous: "partons",
        vous: "partez",
        ils: "partent",
      },
      imparfait: {
        je: "partais",
        tu: "partais",
        il: "partait",
        nous: "partions",
        vous: "partiez",
        ils: "partaient",
      },
    },
    sortir: {
      présent: {
        je: "sors",
        tu: "sors",
        il: "sort",
        nous: "sortons",
        vous: "sortez",
        ils: "sortent",
      },
      imparfait: {
        je: "sortais",
        tu: "sortais",
        il: "sortait",
        nous: "sortions",
        vous: "sortiez",
        ils: "sortaient",
      },
    },
    ouvrir: {
      présent: {
        je: "ouvre",
        tu: "ouvres",
        il: "ouvre",
        nous: "ouvrons",
        vous: "ouvrez",
        ils: "ouvrent",
      },
      imparfait: {
        je: "ouvrais",
        tu: "ouvrais",
        il: "ouvrait",
        nous: "ouvrions",
        vous: "ouvriez",
        ils: "ouvraient",
      },
    },
  };

  /** 形式 → { infinitive, tense, person, group } */
  const IRREGULARS = {};
  const IRREGULAR_INFINITIVES = new Set(Object.keys(IRREGULAR_PARADIGMS));

  const PERSON_LABEL = {
    je: "je",
    tu: "tu",
    il: "il/elle",
    nous: "nous",
    vous: "vous",
    ils: "ils/elles",
  };

  for (const [infinitive, tenses] of Object.entries(IRREGULAR_PARADIGMS)) {
    for (const [tense, persons] of Object.entries(tenses)) {
      for (const [pkey, formRaw] of Object.entries(persons)) {
        const form = String(formRaw || "")
          .trim()
          .toLowerCase()
          .normalize("NFC");
        if (!form) continue;
        const person = PERSON_LABEL[pkey] || pkey;
        const prev = IRREGULARS[form];
        if (prev && prev.infinitive === infinitive && prev.tense === tense) {
          // 合併 je/tu 等同形
          if (!String(prev.person).includes(person.split("/")[0])) {
            prev.person = `${prev.person}/${person}`.replace(/\/+/g, "/");
          }
          continue;
        }
        if (!prev) {
          IRREGULARS[form] = {
            infinitive,
            group: "3",
            tense,
            person,
            irregular: true,
          };
        }
      }
    }
  }

  // 長詞尾優先
  const ENDING_PATTERNS = [
    { ending: "aient", tense: "imparfait", person: "ils/elles", strip: 5 },
    { ending: "ions", tense: "imparfait", person: "nous", strip: 4, alt: "présent subjonctif" },
    { ending: "iez", tense: "imparfait", person: "vous", strip: 3, alt: "présent subjonctif" },
    { ending: "ais", tense: "imparfait", person: "je/tu", strip: 3 },
    { ending: "ait", tense: "imparfait", person: "il/elle", strip: 3 },
    { ending: "erai", tense: "futur simple", person: "je", strip: 2, keepInf: true },
    { ending: "eras", tense: "futur simple", person: "tu", strip: 2, keepInf: true },
    { ending: "era", tense: "futur simple", person: "il/elle", strip: 1, keepInf: true },
    { ending: "erons", tense: "futur simple", person: "nous", strip: 3, keepInf: true },
    { ending: "erez", tense: "futur simple", person: "vous", strip: 2, keepInf: true },
    { ending: "eront", tense: "futur simple", person: "ils/elles", strip: 3, keepInf: true },
    { ending: "irai", tense: "futur simple", person: "je", strip: 2, keepInf: true },
    { ending: "iras", tense: "futur simple", person: "tu", strip: 2, keepInf: true },
    { ending: "ira", tense: "futur simple", person: "il/elle", strip: 1, keepInf: true },
    { ending: "irons", tense: "futur simple", person: "nous", strip: 3, keepInf: true },
    { ending: "irez", tense: "futur simple", person: "vous", strip: 2, keepInf: true },
    { ending: "iront", tense: "futur simple", person: "ils/elles", strip: 3, keepInf: true },
    { ending: "ons", tense: "présent", person: "nous", strip: 3 },
    { ending: "ez", tense: "présent", person: "vous", strip: 2 },
    { ending: "ent", tense: "présent", person: "ils/elles", strip: 3 },
    { ending: "es", tense: "présent", person: "tu", strip: 2 },
    { ending: "is", tense: "présent / passé simple", person: "je/tu", strip: 2, groupHint: "2" },
    { ending: "it", tense: "présent / passé simple", person: "il/elle", strip: 2, groupHint: "2" },
    { ending: "e", tense: "présent", person: "je/il/elle", strip: 1 },
  ];

  const TENSE_ZH = {
    présent: "現在時",
    imparfait: "未完成過去",
    "futur simple": "簡單未來",
    "présent / passé simple": "現在時／簡單過去",
  };

  function normalize(form) {
    return (form || "")
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/^j['’]/, "")
      .replace(/\s+/g, "");
  }

  function lookupIrregular(rawForm) {
    const form = normalize(rawForm);
    if (!form) return null;
    const hit = IRREGULARS[form];
    if (!hit) return null;
    return { ...hit, form, groupLabel: groupLabel(hit.group) };
  }

  function isIrregularForm(rawForm) {
    return !!lookupIrregular(rawForm);
  }

  function isIrregularInfinitive(inf) {
    const t = String(inf || "")
      .trim()
      .toLowerCase()
      .normalize("NFC");
    return IRREGULAR_INFINITIVES.has(t);
  }

  /** 從標題／字串抽出已知不規則不定詞（若有） */
  function extractIrregularInfinitive(text) {
    const s = String(text || "")
      .toLowerCase()
      .normalize("NFC");
    if (!s) return null;
    // 較長不定詞優先（prendre 優於 rendre 誤撞較少）
    const list = [...IRREGULAR_INFINITIVES].sort((a, b) => b.length - a.length);
    for (const inf of list) {
      if (s.includes(inf)) return inf;
    }
    return null;
  }

  function getParadigm(infinitive, tense) {
    const block = IRREGULAR_PARADIGMS[infinitive];
    if (!block) return null;
    return block[tense] || null;
  }

  function guessGroup(infinitive) {
    if (!infinitive) return "未知";
    if (isIrregularInfinitive(infinitive)) return "3";
    if (infinitive.endsWith("er") && infinitive !== "aller") return "1";
    if (infinitive.endsWith("ir")) return "2（或 3）";
    if (infinitive.endsWith("re")) return "3";
    return "3／不規則";
  }

  /**
   * 不定詞 → 動詞組別（教學用 1／2／3 類）
   * @returns {{ code: string, label: string, short: string }|null}
   */
  function verbGroupForLemma(infinitive) {
    const inf = String(infinitive || "")
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/^s['’]/, ""); // s'asseoir → asseoir 近似
    if (!inf || inf === "?" || inf.length < 2) return null;

    let code;
    if (isIrregularInfinitive(inf) || inf === "aller") {
      code = "3";
    } else if (inf.endsWith("er")) {
      code = "1";
    } else if (inf.endsWith("ir")) {
      // 常見第三組 -ir（不完全列表）；其餘暫歸 2
      const thirdIr = new Set([
        "venir",
        "tenir",
        "devenir",
        "revenir",
        "obtenir",
        "appartenir",
        "partir",
        "sortir",
        "dormir",
        "mentir",
        "servir",
        "sentir",
        "courir",
        "mourir",
        "ouvrir",
        "couvrir",
        "offrir",
        "souffrir",
        "cueillir",
        "assaillir",
        "fuir",
        "bouillir",
      ]);
      code = thirdIr.has(inf) ? "3" : "2";
    } else if (inf.endsWith("re") || inf.endsWith("oir")) {
      code = "3";
    } else {
      code = "3";
    }

    const labels = {
      "1": { label: "第一組（-er）", short: "第1組" },
      "2": { label: "第二組（-ir）", short: "第2組" },
      "3": { label: "第三組／不規則", short: "第3組" },
    };
    const L = labels[code] || { label: groupLabel(code), short: `第${code}組` };
    return { code, label: L.label, short: L.short };
  }

  function guessInfinitiveFromStem(stem, tense, pattern) {
    if (!stem) return null;
    if (pattern && pattern.keepInf) {
      const base = stem;
      if (base.endsWith("er") || base.endsWith("ir") || base.endsWith("re")) return base;
      return base + "er";
    }
    if (tense === "imparfait") {
      return stem + "er";
    }
    return stem + "er";
  }

  function analyze(rawForm) {
    const form = normalize(rawForm);
    if (!form) {
      return { form: "", confidence: "none", guesses: [] };
    }

    const irreg = lookupIrregular(form);
    if (irreg) {
      return {
        form,
        confidence: "high",
        source: "local-irregular-table",
        irregular: true,
        primary: {
          infinitive: irreg.infinitive,
          group: irreg.group,
          groupLabel: irreg.groupLabel,
          tense: irreg.tense,
          person: irreg.person,
          matchedEnding: null,
          irregular: true,
        },
        guesses: [
          {
            infinitive: irreg.infinitive,
            group: irreg.group,
            groupLabel: irreg.groupLabel,
            tense: irreg.tense,
            person: irreg.person,
            irregular: true,
          },
        ],
      };
    }

    const guesses = [];
    for (const p of ENDING_PATTERNS) {
      if (form.length > p.ending.length && form.endsWith(p.ending)) {
        const stem = form.slice(0, form.length - p.strip);
        let inf = guessInfinitiveFromStem(
          p.keepInf ? form.slice(0, form.length - p.strip) : stem,
          p.tense,
          p
        );
        if (p.keepInf) {
          if (p.ending === "erai") inf = form.slice(0, -2);
          else if (p.ending === "eras") inf = form.slice(0, -2);
          else if (p.ending === "era") inf = form.slice(0, -1);
          else if (p.ending === "erons") inf = form.slice(0, -3);
          else if (p.ending === "erez") inf = form.slice(0, -2);
          else if (p.ending === "eront") inf = form.slice(0, -3);
          else if (p.ending === "irai") inf = form.slice(0, -2);
          else if (p.ending === "iras") inf = form.slice(0, -2);
          else if (p.ending === "ira") inf = form.slice(0, -1);
          else if (p.ending === "irons") inf = form.slice(0, -3);
          else if (p.ending === "irez") inf = form.slice(0, -2);
          else if (p.ending === "iront") inf = form.slice(0, -3);
        }

        const group = p.groupHint || guessGroup(inf);
        guesses.push({
          infinitive: inf,
          group: String(group).charAt(0),
          groupLabel: groupLabel(group),
          tense: p.tense,
          person: p.person,
          matchedEnding: p.ending,
          stem,
          note: p.alt ? `也可能是 ${p.alt}` : null,
          irregular: isIrregularInfinitive(inf),
        });
      }
    }

    const seen = new Set();
    const unique = [];
    for (const g of guesses) {
      const key = `${g.tense}|${g.person}|${g.infinitive}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(g);
    }

    return {
      form,
      confidence: unique.length ? "medium" : "low",
      source: "local-ending-heuristics",
      irregular: false,
      primary: unique[0] || {
        infinitive: "?",
        group: "?",
        groupLabel: "未知",
        tense: "未知",
        person: "未知",
        matchedEnding: null,
      },
      guesses: unique.slice(0, 5),
    };
  }

  function groupLabel(g) {
    const s = String(g);
    if (s.startsWith("1")) return "第一組（-er）";
    if (s.startsWith("2")) return "第二組（-ir）";
    if (s.startsWith("3")) return "第三組／不規則";
    return s || "未知";
  }

  function tenseZh(tense) {
    return TENSE_ZH[tense] || tense || "";
  }

  /**
   * 產生「建議查詢方向」文字（無 API 時）
   */
  function buildSuggestions(form, analysis) {
    const p = analysis.primary || {};
    const keywords = [];
    if (p.infinitive && p.infinitive !== "?") keywords.push(p.infinitive);
    if (p.tense && p.tense !== "未知") keywords.push(p.tense);
    if (p.groupLabel) keywords.push(p.groupLabel);
    keywords.push(form);

    const isIrreg = !!(analysis.irregular || p.irregular || isIrregularForm(form));

    const checklist = isIrreg
      ? [
          "確認不定詞（infinitif）與時態",
          "【不規則】勿套用第一組／通則詞尾，需另立此動詞專屬規則",
          "六人稱格子請填完整形（suis、peux…），不要只填 -ais",
          "規則名寫具體動詞：如 pouvoir 未完成過去（pouvoir imparfait）",
          "對照 Bescherelle／變位表核對其餘格",
        ]
      : [
          "確認這是哪個不定詞（infinitif）",
          "確認時態（présent / imparfait / futur / passé composé…）",
          "確認人稱與數（je, tu, il…）",
          "確認動詞組別（1 / 2 / 3）與是否不規則",
          "對照詞幹如何形成、詞尾如何添加",
        ];

    const sources = [
      "Bescherelle 或同類變位表",
      "Larousse / WordReference 動詞變位",
      "課堂講義或文法書對應章節",
      "本筆記本中相似時態的既有規則",
    ];

    let summary;
    if (isIrreg && p.infinitive && p.infinitive !== "?") {
      summary = `「${form}」為不規則動詞 ${p.infinitive} 的 ${p.tense || "變位"}。請另立「${p.infinitive}」專屬規則（完整形六格），不可只依賴第一組通則詞尾。`;
    } else if (p.infinitive && p.infinitive !== "?") {
      summary = `建議先查「${p.infinitive} + ${p.tense || "時態"}」的變位規則，並核對人稱「${p.person || "?"}」。`;
    } else {
      summary = `建議先用變位表查出「${form}」的原形與時態，再整理成規則卡片。`;
    }

    return {
      keywords: [...new Set(keywords.filter(Boolean))],
      checklist,
      sources,
      summary,
      irregular: isIrreg,
    };
  }

  function personToKey(person) {
    const p = (person || "").toLowerCase();
    if (p.includes("nous")) return "nous";
    if (p.includes("vous")) return "vous";
    if (p.includes("ils") || p.includes("elles")) return "ils";
    if (p.includes("tu") && !p.includes("je")) return "tu";
    if (p.includes("il") || p.includes("elle") || p.includes("on")) return "il";
    if (p.includes("je")) return "je";
    return null;
  }

  /**
   * 從分析結果預填規則草稿（規則名 + 說明 + 六格）
   * 不規則動詞：標題帶動詞名、六格優先完整形、禁止只當通則詞尾
   */
  function draftFromAnalysis(form, analysis) {
    const p = analysis.primary || {};
    const inf = p.infinitive && p.infinitive !== "?" ? p.infinitive : "";
    const tense = p.tense && p.tense !== "未知" ? p.tense : "";
    const isIrreg = !!(analysis.irregular || p.irregular || (inf && isIrregularInfinitive(inf)));

    const endings = { je: "", tu: "", il: "", nous: "", vous: "", ils: "" };

    // 不規則且表內有完整 paradigm → 預填六格完整形
    if (isIrreg && inf && tense) {
      const para = getParadigm(inf, tense);
      if (para) {
        for (const k of Object.keys(endings)) {
          if (para[k]) endings[k] = para[k];
        }
      }
    }

    // 至少填入查詢到的那一格
    const key = personToKey(p.person);
    const cellVal =
      isIrreg || !p.matchedEnding
        ? form
        : p.matchedEnding
          ? `-${p.matchedEnding}`
          : form;
    if (key) {
      if (!endings[key]) endings[key] = cellVal;
      if ((p.person || "").toLowerCase().includes("je") && (p.person || "").toLowerCase().includes("tu")) {
        if (!endings.je) endings.je = cellVal;
        if (!endings.tu) endings.tu = cellVal;
      }
    } else if (!Object.values(endings).some(Boolean)) {
      endings.je = form;
    }

    // 標題：不規則必帶動詞名
    let title;
    const zhT = tenseZh(tense);
    if (isIrreg && inf && tense) {
      title = `${inf} ${zhT || tense}（${inf} ${tense}）`;
    } else if (inf && tense) {
      title = `${zhT || tense}（${inf}）`;
    } else if (inf) {
      title = `${inf}（${form}）`;
    } else {
      title = form;
    }

    const explanation = isIrreg
      ? `「${form}」為不規則動詞 ${inf || "?"} 的 ${tense || "?"}（${p.person || "?"}）。不規則動詞須另立專屬規則，六格請填完整形，勿只依賴通則詞尾。請核對並補齊其餘格。`
      : analysis.confidence === "high"
        ? `「${form}」對應 ${inf || "?"} 的 ${tense || "?"}（${p.person || "?"}）。請補齊其餘格與說明。`
        : `由查詢「${form}」預填，請校正內容。`;

    return {
      title,
      category: "變位",
      explanation,
      has_persons: true,
      keywords: isIrreg && inf ? [inf, form] : [],
      endings,
      irregular: isIrreg,
    };
  }

  return {
    normalize,
    analyze,
    buildSuggestions,
    draftFromAnalysis,
    groupLabel,
    guessGroup,
    verbGroupForLemma,
    lookupIrregular,
    isIrregularForm,
    isIrregularInfinitive,
    extractIrregularInfinitive,
    getParadigm,
    tenseZh,
    IRREGULAR_INFINITIVES: [...IRREGULAR_INFINITIVES],
  };
})();
