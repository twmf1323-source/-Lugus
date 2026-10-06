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
    souvenir: {
      présent: {
        je: "souviens",
        tu: "souviens",
        il: "souvient",
        nous: "souvenons",
        vous: "souvenez",
        ils: "souviennent",
      },
      imparfait: {
        je: "souvenais",
        tu: "souvenais",
        il: "souvenait",
        nous: "souvenions",
        vous: "souveniez",
        ils: "souvenaient",
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

  /** 不規則過去分詞（assis ≠ -é；未列在直陳式表內的也要擋通則） */
  const IRREGULAR_PARTICIPLES = {
    assis: "asseoir",
    assise: "asseoir",
    assises: "asseoir",
    mis: "mettre",
    mise: "mettre",
    mises: "mettre",
    pris: "prendre",
    prise: "prendre",
    prises: "prendre",
    faite: "faire",
    écrit: "écrire",
    écrite: "écrire",
    écrites: "écrire",
    ouvert: "ouvrir",
    ouverte: "ouvrir",
    ouvertes: "ouvrir",
    vu: "voir",
    vue: "voir",
    vues: "voir",
    dû: "devoir",
    due: "devoir",
    dues: "devoir",
    mort: "mourir",
    morte: "mourir",
    mortes: "mourir",
    né: "naître",
    née: "naître",
    nées: "naître",
    dite: "dire",
    couvert: "couvrir",
    couverte: "couvrir",
    offert: "offrir",
    offerte: "offrir",
    souffert: "souffrir",
    soufferte: "souffrir",
  };
  for (const [form, infinitive] of Object.entries(IRREGULAR_PARTICIPLES)) {
    IRREGULAR_INFINITIVES.add(infinitive);
    if (!IRREGULARS[form]) {
      IRREGULARS[form] = {
        infinitive,
        group: "3",
        tense: "participe passé",
        person: "",
        irregular: true,
      };
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

  const LATIN_LETTER_CLASS = "a-zàâäéèêëïîôùûüçœæ";

  function escapeRe(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** 整詞點名不定詞（avoir 不含 voir；savoir 不含 avoir） */
  function mentionsInfinitive(text, inf) {
    const s = String(text || "")
      .toLowerCase()
      .normalize("NFC");
    const i = String(inf || "")
      .trim()
      .toLowerCase()
      .normalize("NFC");
    if (!s || i.length < 2) return false;
    const re = new RegExp(
      `(^|[^${LATIN_LETTER_CLASS}])${escapeRe(i)}(?=$|[^${LATIN_LETTER_CLASS}])`,
      "i"
    );
    return re.test(s);
  }

  /** 從標題／字串抽出已知不規則不定詞（若有） */
  function extractIrregularInfinitive(text) {
    const s = String(text || "")
      .toLowerCase()
      .normalize("NFC");
    if (!s) return null;
    // 較長不定詞優先（prendre 優於 rendre 誤撞較少）；必須整詞
    const list = [...IRREGULAR_INFINITIVES].sort((a, b) => b.length - a.length);
    for (const inf of list) {
      if (mentionsInfinitive(s, inf)) return inf;
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
        "souvenir",
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
          "規則名寫具體動詞：如 pouvoir 未完成過去（imparfait）",
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

  function isGroup3Infinitive(infinitive) {
    const inf = String(infinitive || "")
      .trim()
      .toLowerCase()
      .normalize("NFC");
    if (!inf || inf === "?") return false;
    if (isIrregularInfinitive(inf) || inf === "aller") return true;
    const g = verbGroupForLemma(inf);
    return g?.code === "3";
  }

  const TITLE_TENSE_FR = {
    現在時: "présent",
    未完成過去: "imparfait",
    簡單未來式: "futur simple",
    簡單未來: "futur simple",
    過去分詞: "participe passé",
    不定式: "infinitif",
    複合過去: "passé composé",
    命令: "impératif",
    條件式: "conditionnel",
    虛擬式: "subjonctif",
  };

  function tenseLabelFromTitle(text) {
    const s = String(text || "").trim();
    const left = s.replace(/[（(].*$/, "").trim();
    const stripped = left.replace(/^[a-zàâäéèêëïîôùûüçœæ'’\s_-]+\s+/i, "").trim() || left;
    if (TITLE_TENSE_FR[stripped]) return stripped;
    if (/未完成/.test(s)) return "未完成過去";
    if (/過去分詞|participe/.test(s)) return "過去分詞";
    if (/複合過去|passé compos/.test(s)) return "複合過去";
    if (/簡單未來|futur/.test(s)) return "簡單未來式";
    if (/不定式|infinitif/.test(s)) return "不定式";
    if (/命令|impératif/.test(s)) return "命令";
    if (/條件|conditionnel/.test(s)) return "條件式";
    if (/虛擬|subjonctif/.test(s)) return "虛擬式";
    if (/現在|présent/.test(s)) return "現在時";
    return "現在時";
  }

  function stripVerbLemma(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/_/g, " ")
      .replace(/^se\s+/i, "")
      .replace(/^s['’]/i, "")
      .trim();
  }

  function infinitiveShaped(inf) {
    return /(?:er|ir|re|oir)$/i.test(String(inf || ""));
  }

  /**
   * API 常把第一／二組標成 3。不定詞能判定時以本地為準：
   * 規則 -er → 1，規則 -ir → 2，已知不規則與 -re／-oir → 3。
   */
  function group3StemCollision(guessed) {
    const stem = String(guessed || "").replace(/(?:er|ir|re|oir)$/i, "");
    if (stem.length < 3) return false;
    const ir = stem + "ir";
    if (ir !== guessed && verbGroupForLemma(ir)?.code === "3") return true;
    for (const inf of IRREGULAR_INFINITIVES) {
      if (inf !== guessed && inf.startsWith(stem) && verbGroupForLemma(inf)?.code === "3") return true;
    }
    return false;
  }

  function groupFromAnalyzedForm(form) {
    const guessed = stripVerbLemma(analyze(form)?.primary?.infinitive);
    if (!guessed || guessed === "?" || !infinitiveShaped(guessed)) return "";
    const info = verbGroupForLemma(guessed);
    if (!info?.code) return "";
    if ((info.code === "1" || info.code === "2") && group3StemCollision(guessed)) return "";
    return info.code;
  }

  function reconcileVerbGroup(apiCode, lemma, surface) {
    const api = String(apiCode || "").trim();
    const lem = stripVerbLemma(lemma);
    const surf = stripVerbLemma(surface);
    if (infinitiveShaped(lem)) {
      const info = verbGroupForLemma(lem);
      if (info?.code === "1" || info?.code === "2" || info?.code === "3") return info.code;
    }
    for (const form of [lem, surf]) {
      if (!form || form === lem && infinitiveShaped(lem)) continue;
      const code = groupFromAnalyzedForm(form);
      if (code === "1" || code === "2" || code === "3") return code;
    }
    return api === "1" || api === "2" || api === "3" ? api : "";
  }

  /** 第一／二組規則動詞：共用詞尾卡，不為每個動詞另立 */
  function usesSharedGroupPattern(infinitive) {
    const inf = String(infinitive || "")
      .trim()
      .toLowerCase()
      .normalize("NFC");
    if (!inf || inf === "?" || inf === "aller") return false;
    if (isIrregularInfinitive(inf) || isGroup3Infinitive(inf)) return false;
    const g = verbGroupForLemma(inf);
    return g?.code === "1" || g?.code === "2";
  }

  function groupPatternSpec(infinitive, tenseZhOrTitle) {
    const inf = String(infinitive || "")
      .trim()
      .toLowerCase()
      .normalize("NFC");
    const g = verbGroupForLemma(inf);
    const ending = g?.code === "2" ? "ir" : "er";
    const zh = tenseLabelFromTitle(tenseZhOrTitle);
    if (zh === "未完成過去") {
      return {
        name: `未完成過去（-${ending} imparfait）`,
        key: `verb:${ending}:imparfait`,
        category: "時態",
      };
    }
    if (zh === "過去分詞" && ending === "er") {
      return { name: "過去分詞（-é）", key: "pp:e", category: "時態" };
    }
    if (zh === "簡單未來式" || zh === "簡單未來") {
      return { name: "簡單未來式（futur simple）", key: "verb:futur", category: "時態" };
    }
    return {
      name: `現在時（-${ending} présent）`,
      key: `verb:${ending}:present`,
      category: "時態",
    };
  }

  /**
   * 不規則／第三組：不定詞＋時態（souvenir 現在時（présent））。
   * 第一／二組規則動詞用詞尾通則（現在時（-er présent））。
   */
  function specificVerbRuleTitle(infinitive, tenseZhOrTitle) {
    const inf = String(infinitive || "")
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/_/g, " ")
      .replace(/^se\s+/i, "")
      .replace(/^s['’]/i, "")
      .trim();
    if (!inf) return "";
    const raw = String(tenseZhOrTitle || "").trim();
    let zh = raw.replace(/[（(].*$/, "").trim() || "現在時";
    zh = zh.replace(new RegExp(`^${inf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), "").trim() || zh;
    const fr = TITLE_TENSE_FR[zh] || "";
    const frLabel = fr || zh;
    return `${inf} ${zh}（${frLabel}）`;
  }

  function isGenericGroupTitle(title) {
    const s = String(title || "");
    if (
      /（\s*-?\s*er\s*(présent|imparfait)?\s*）|（\s*-?\s*ir\s*(présent|imparfait)?\s*）|（\s*-é\s*）|第一組|第二組|-er présent|-ir présent|-er imparfait|-ir imparfait/.test(
        s
      )
    ) {
      return true;
    }
    const m = s.match(/^(.+?)[（(]\s*(.+?)\s*[）)]\s*$/);
    if (!m) return false;
    const zh = m[1].trim();
    const fr = m[2].trim();
    return (
      /^(現在時|未完成過去|簡單未來式|簡單未來|過去分詞)$/.test(zh) &&
      /^(présent|imparfait|futur simple|-é)$/i.test(fr)
    );
  }

  /**
   * 規則動詞維持／改回第一／二組通則名；不規則才改成不定詞＋時態。
   */
  function rewriteVerbTitle(name, extra = {}) {
    const s = String(name || "").trim();
    let inf = String(extra.infinitive || extra.lemma || "")
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/_/g, " ")
      .replace(/^se\s+/i, "")
      .replace(/^s['’]/i, "")
      .trim();
    const span = String(extra.span || extra.form || "").trim();
    if (!inf && span) {
      const hit = lookupIrregular(span);
      if (hit?.infinitive) inf = hit.infinitive;
    }
    if (!inf && span) {
      const a = analyze(span);
      const guess = a?.primary?.infinitive;
      if (guess && guess !== "?" && guess.length >= 2) inf = guess;
    }
    if (
      inf &&
      inf !== "?" &&
      !/^(er|ir|re)$/i.test(inf) &&
      inf.length >= 2 &&
      /(?:er|ir|re|oir)$/i.test(inf)
    ) {
      const tense = tenseLabelFromTitle(s) || extra.tense || "現在時";
      if (usesSharedGroupPattern(inf)) return groupPatternSpec(inf, tense).name;
      if (isGroup3Infinitive(inf) || isIrregularInfinitive(inf)) {
        return specificVerbRuleTitle(inf, tense);
      }
    }
    return rewriteSpecificVerbTitle(s);
  }

  /** 舊式「現在時（souvenir présent）」→「souvenir 現在時（présent）」 */
  function extractInfinitiveWord(text) {
    const words = String(text || "")
      .toLowerCase()
      .normalize("NFC")
      .split(/[^a-zàâäéèêëïîôùûüçœæ'-]+/i)
      .map((w) => w.replace(/^s['’]/, "").replace(/^se$/, ""))
      .filter((w) => w.length >= 4 && infinitiveShaped(w));
    words.sort((a, b) => b.length - a.length);
    return words[0] || "";
  }

  function rewriteSpecificVerbTitle(name) {
    const s = String(name || "").trim();
    if (!s || isGenericGroupTitle(s)) return s;
    const embedded = extractInfinitiveWord(s);
    if (embedded && usesSharedGroupPattern(embedded)) return groupPatternSpec(embedded, s).name;
    const m = s.match(/^(.+?)[（(]\s*(.+?)\s*[）)]\s*$/);
    if (!m) return s;
    const left = m[1].trim();
    const right = m[2]
      .trim()
      .replace(/_/g, " ")
      .replace(/^se\s+/i, "")
      .replace(/^s['’]/i, "");
    if (/^-?(er|ir|é)\b/i.test(right)) return s;

    const leftWords = left.split(/\s+/).filter(Boolean);
    if (leftWords.length >= 2) {
      const maybeInf = leftWords[0];
      const maybeZh = leftWords.slice(1).join(" ");
      if (TITLE_TENSE_FR[maybeZh] || maybeZh === "過去分詞" || maybeZh === "不定式") {
        if (usesSharedGroupPattern(maybeInf)) return groupPatternSpec(maybeInf, maybeZh).name;
        if (isGroup3Infinitive(maybeInf) || isIrregularInfinitive(maybeInf)) {
          return specificVerbRuleTitle(maybeInf, maybeZh);
        }
      }
    }

    if (!TITLE_TENSE_FR[left] && left !== "過去分詞" && left !== "不定式") return s;
    let inf = extractIrregularInfinitive(s);
    if (!inf) {
      const hit = String(right)
        .split(/\s+/)
        .map((w) => w.toLowerCase().normalize("NFC"))
        .find((w) => w.length >= 3 && /(?:er|ir|re|oir)$/i.test(w) && !isGenericGroupTitle(w));
      inf = hit || "";
    }
    if (!inf) return s;
    if (usesSharedGroupPattern(inf)) return groupPatternSpec(inf, left).name;
    if (!isGroup3Infinitive(inf) && !isIrregularInfinitive(inf) && !/(?:oir|re)$/i.test(inf)) {
      return s;
    }
    return specificVerbRuleTitle(inf, left);
  }

  function infinitiveForGrammarItem(it, vocab, tokens) {
    const span = String(it?.span || "").trim();
    const start = Number(it?.start);
    const end = Number(it?.end);
    for (const w of Array.isArray(vocab) ? vocab : []) {
      const lemma = String(w?.lemma || w?.l || "").trim();
      if (!lemma) continue;
      const pos = String(w?.pos || w?.p || "");
      const vg = String(w?.verbGroup || w?.vg || "");
      const isVerb = /動詞|verb/i.test(pos) || /^[123]$/.test(vg);
      if (!isVerb && pos && !/其他|other/i.test(pos)) continue;
      const surf = String(w?.surface || w?.s || "").trim();
      if (span && (surf === span || lemma === span)) return lemma;
      const ws = Number(w?.start ?? w?.a);
      const we = Number(w?.end ?? w?.b);
      if (Number.isFinite(start) && Number.isFinite(ws) && ws === start) return lemma;
      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        Number.isFinite(ws) &&
        Number.isFinite(we) &&
        ws >= start &&
        we <= end
      ) {
        return lemma;
      }
    }
    if (span) {
      const hit = lookupIrregular(span);
      if (hit?.infinitive) return hit.infinitive;
    }
    for (const t of Array.isArray(tokens) ? tokens : []) {
      if (t?.pos && t.pos !== "動詞") continue;
      if (span && t.form === span && t.lemma) return t.lemma;
      if (Number.isFinite(start) && t.start === start && t.lemma) return t.lemma;
    }
    return "";
  }

  function rewriteGenericGroup3Title(title, infinitive) {
    const inf = String(infinitive || "")
      .trim()
      .toLowerCase()
      .normalize("NFC");
    const t = String(title || "").trim();
    if (!inf || !isGroup3Infinitive(inf)) return t;
    if (mentionsInfinitive(t, inf)) return t;
    const other = extractIrregularInfinitive(t);
    if (other && other !== inf && !isGenericGroupTitle(t)) return t;
    if (
      isGenericGroupTitle(t) ||
      /現在時|未完成|過去分詞|未來|不定式|變位|présent|imparfait/.test(t)
    ) {
      return specificVerbRuleTitle(inf, t);
    }
    return t;
  }

  /** 不規則改成不定詞＋時態；規則動詞改回第一／二組通則 */
  function rewriteInventoryVerbTitles(inventory) {
    const inv = inventory && typeof inventory === "object" ? inventory : { items: [] };
    const items = Array.isArray(inv.items) ? inv.items : [];
    const vocab = Array.isArray(inv.vocab) ? inv.vocab : [];
    const tokens = Array.isArray(inv.tokens) ? inv.tokens : [];
    for (const it of items) {
      if (!it || it.manualRuleId) continue;
      const inf =
        infinitiveForGrammarItem(it, vocab, tokens) ||
        String(it.grammarKey || "").replace(/^verb:([^:]+):.*/, "$1");
      const cat = String(it.category || "");
      const looksVerb =
        /變位|時態/.test(cat) ||
        isGenericGroupTitle(it.name) ||
        /現在時|未完成|過去分詞|未來|不定式|變位|présent|imparfait/.test(it.name || "") ||
        /^verb:/.test(String(it.grammarKey || ""));
      if (!looksVerb) continue;
      const next = rewriteVerbTitle(it.name, { infinitive: inf, span: it.span });
      if (next && next !== it.name) {
        it.name = next;
        const m = next.match(/^(.+?)[（(]\s*(.+?)\s*[）)]\s*$/);
        if (m) {
          it.nameZh = m[1].trim();
          it.nameFr = m[2].trim();
          it.nameKo = it.nameFr;
        }
        if (inf && usesSharedGroupPattern(inf)) {
          it.grammarKey = groupPatternSpec(inf, next).key;
        } else if (inf && inf !== "er" && String(it.grammarKey || "").startsWith("verb:er:")) {
          const tense = String(it.grammarKey).split(":")[2] || "present";
          it.grammarKey = `verb:${inf}:${tense}`;
        }
      }
    }
    return inv;
  }

  function rewriteInventoryGroup3Titles(inventory) {
    return rewriteInventoryVerbTitles(inventory);
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
    const isG3 = !!(inf && isGroup3Infinitive(inf));
    const specific = isIrreg || isG3;

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

    // 標題：第三組／不規則必帶該動詞法語不定詞
    let title;
    const zhT = tenseZh(tense);
    if (specific && inf && tense) {
      title = specificVerbRuleTitle(inf, zhT || tense);
    } else if (inf && tense && usesSharedGroupPattern(inf)) {
      title = groupPatternSpec(inf, zhT || tense).name;
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
    reconcileVerbGroup,
    lookupIrregular,
    isIrregularForm,
    isIrregularInfinitive,
    extractIrregularInfinitive,
    mentionsInfinitive,
    getParadigm,
    tenseZh,
    isGroup3Infinitive,
    specificVerbRuleTitle,
    usesSharedGroupPattern,
    groupPatternSpec,
    rewriteSpecificVerbTitle,
    rewriteVerbTitle,
    tenseLabelFromTitle,
    isGenericGroupTitle,
    rewriteInventoryVerbTitles,
    rewriteGenericGroup3Title,
    rewriteInventoryGroup3Titles,
    IRREGULAR_INFINITIVES: [...IRREGULAR_INFINITIVES],
  };
})();
