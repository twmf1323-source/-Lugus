/**
 * 規則 CRUD 與本地搜尋
 * 簡化模型：規則名 + 詳細說明 + 六人稱詞尾
 * 整句支援法語省音／連寫（n'ai、j'ai、l'…）拆解比對
 */
const RulesService = (() => {
  let rules = [];

  const PERSONS = [
    { key: "je", label: "je" },
    { key: "tu", label: "tu" },
    { key: "il", label: "il / elle / on" },
    { key: "nous", label: "nous" },
    { key: "vous", label: "vous" },
    { key: "ils", label: "ils / elles" },
  ];

  /** 省音前綴 → 完整詞 */
  const ELISION_PREFIX = {
    n: "ne",
    j: "je",
    m: "me",
    t: "te",
    s: "se",
    l: "le",
    d: "de",
    c: "ce",
    qu: "que",
    jusqu: "jusque",
    lorsqu: "lorsque",
    puisqu: "puisque",
  };

  /**
   * 詞尾比對黑名單：尾巴碰巧像變位，但本身不是該規則產物
   * （副詞、連詞、形容詞／國名等固定詞）
   * 仍允許「完整形式」精確命中（若使用者把該詞寫進格子）
   */
  const SUFFIX_BLOCKLIST = new Set(
    [
      // 副詞（-ais / -ment 等易誤撞）
      "jamais",
      "toujours",
      "souvent",
      "déjà",
      "deja",
      "aussi",
      "ainsi",
      "puis",
      "ensuite",
      "encore",
      "même",
      "meme",
      "bien",
      "mal",
      "mieux",
      "moins",
      "plus",
      "très",
      "tres",
      "trop",
      "assez",
      "peu",
      "beaucoup",
      "partout",
      "ailleurs",
      "dehors",
      "dedans",
      "dessus",
      "dessous",
      "hier",
      "demain",
      "aujourd'hui",
      "maintenant",
      "parfois",
      "quelquefois",
      "surtout",
      "seulement",
      "vraiment",
      "certainement",
      "probablement",
      "peut-être",
      "peutetre",
      "ici",
      "là",
      "la",
      "oui",
      "non",
      "si",
      // 連詞／關係／小品
      "mais",
      "donc",
      "car",
      "or",
      "que",
      "qui",
      "quoi",
      "dont",
      "où",
      "ou",
      "comme",
      "quand",
      "lorsque",
      "puisque",
      "quoique",
      "bienque",
      "et",
      "ni",
      // 介詞／限定等
      "dans",
      "sur",
      "sous",
      "avec",
      "sans",
      "pour",
      "par",
      "chez",
      "entre",
      "vers",
      "devant",
      "derrière",
      "derriere",
      "après",
      "apres",
      "avant",
      "depuis",
      "pendant",
      "durant",
      "selon",
      "malgré",
      "malgre",
      "sauf",
      "excepté",
      "excepte",
      // 代詞／限定（完整詞；避免當詞尾殘段）
      "je",
      "tu",
      "il",
      "elle",
      "on",
      "nous",
      "vous",
      "ils",
      "elles",
      "me",
      "te",
      "se",
      "le",
      "la",
      "les",
      "lui",
      "leur",
      "y",
      "en",
      "ce",
      "cet",
      "cette",
      "ces",
      "mon",
      "ton",
      "son",
      "ma",
      "ta",
      "sa",
      "mes",
      "tes",
      "ses",
      "notre",
      "votre",
      "nos",
      "vos",
      "leurs",
      // 國名／形容詞等常見 -ais 結尾
      "français",
      "francais",
      "anglais",
      "hollandais",
      "irlandais",
      "écossais",
      "ecossais",
      "polonais",
      "portugais",
      "japonais",
      "chinois",
      "suédois",
      "suedois",
      "danais",
      "thailandais",
      // 其他常見假陽性
      "palais",
      "relais",
      "frais",
      "épais",
      "epais",
      "lais",
      "mais",
    ].map((w) => w.normalize("NFC").toLowerCase())
  );

  function isSuffixBlocked(form) {
    const f = normalizeToken(form);
    if (!f) return false;
    if (SUFFIX_BLOCKLIST.has(f)) return true;
    // 省音宿主：n'jamais 少見；一般 n'ai 不在黑名單
    const host = elisionHost(f);
    if (host !== f && SUFFIX_BLOCKLIST.has(host)) return true;
    // 以 -ment 結尾的副詞：不拿來套動詞詞尾規則
    if (f.length > 5 && f.endsWith("ment")) return true;
    return false;
  }

  /**
   * 規則標題／關鍵詞是否點名該不定詞（專屬規則 vs 通則）
   * 例：「pouvoir 未完成過去」→ 點名 pouvoir；「第一組 -er imparfait」→ 否
   */
  function ruleMentionsVerb(rule, infinitive) {
    const inf = String(infinitive || "")
      .trim()
      .toLowerCase()
      .normalize("NFC");
    if (!inf || inf.length < 2) return false;
    const mentions =
      typeof Analyzer !== "undefined" && typeof Analyzer.mentionsInfinitive === "function"
        ? (text) => Analyzer.mentionsInfinitive(text, inf)
        : (text) => {
            const s = String(text || "")
              .toLowerCase()
              .normalize("NFC");
            const re = new RegExp(
              `(^|[^a-zàâäéèêëïîôùûüçœæ])${inf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-zàâäéèêëïîôùûüçœæ])`,
              "i"
            );
            return re.test(s);
          };
    if (mentions(rule?.title || "")) return true;
    for (const kw of rule?.keywords || []) {
      if (mentions(kw)) return true;
    }
    // 六格若以完整形收錄該動詞 paradigm，也算專屬（不靠詞尾通則）
    if (typeof Analyzer !== "undefined" && Analyzer.getParadigm) {
      for (const tense of ["présent", "imparfait"]) {
        const para = Analyzer.getParadigm(inf, tense);
        if (!para) continue;
        const forms = new Set(
          Object.values(para).map((x) =>
            String(x || "")
              .toLowerCase()
              .normalize("NFC")
          )
        );
        let hits = 0;
        for (const { key } of PERSONS) {
          for (const p of expandCellForms(rule?.endings?.[key] || "")) {
            if (/^[-–—]/.test(p)) continue;
            const cell = stripDash(p);
            if (forms.has(cell)) hits++;
          }
        }
        if (hits >= 2) return true;
      }
    }
    return false;
  }

  /** 規則是否為「僅詞尾通則」（六格幾乎都是 -xxx，且未點名具體動詞） */
  function isGeneralEndingRule(rule) {
    if (!ruleHasPersons(rule) && !hasAnyEnding(rule?.endings)) return false;
    let suffixOnly = 0;
    let fullForm = 0;
    for (const { key } of PERSONS) {
      for (const p of expandCellForms(rule?.endings?.[key] || "")) {
        if (/^[-–—]/.test(p)) suffixOnly++;
        else if (p) fullForm++;
      }
    }
    if (fullForm > 0 || suffixOnly === 0) return false;
    // 標題若已點名已知不規則不定詞，不算通則
    if (typeof Analyzer !== "undefined" && Analyzer.extractIrregularInfinitive) {
      if (Analyzer.extractIrregularInfinitive(rule?.title || "")) return false;
    }
    return true;
  }

  function emptyEndings() {
    return { je: "", tu: "", il: "", nous: "", vous: "", ils: "" };
  }

  function normalizeKeywords(val) {
    if (!val) return [];
    if (Array.isArray(val)) {
      return val.map((x) => String(x).trim()).filter(Boolean);
    }
    return String(val)
      .split(/[,，;；|｜\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function hasAnyEnding(endings) {
    const e = endings || {};
    return PERSONS.some(({ key }) => String(e[key] || "").trim());
  }

  /** 規則是否顯示／使用六人稱表 */
  function ruleHasPersons(rule) {
    if (typeof rule?.has_persons === "boolean") return rule.has_persons;
    return hasAnyEnding(rule?.endings);
  }

  /** 收集規則所有可比對的完整形式／關鍵詞（含六格與 keywords） */
  function collectMatchForms(rule) {
    const out = [];
    for (const kw of rule.keywords || []) {
      for (const p of expandCellForms(kw)) out.push(p);
    }
    if (ruleHasPersons(rule) || hasAnyEnding(rule.endings)) {
      for (const { key } of PERSONS) {
        const val = rule.endings?.[key] || "";
        for (const p of expandCellForms(val)) {
          if (!/^[-–—]/.test(p)) out.push(p);
        }
      }
    }
    return out;
  }

  function setAll(next) {
    rules = Array.isArray(next) ? next.map((r) => normalizeRule(r, r)) : [];
    Storage.saveRules(rules);
    return rules;
  }

  function getAll() {
    return rules.slice().sort((a, b) => {
      const as = isSupplementaryUsage(a);
      const bs = isSupplementaryUsage(b);
      if (as !== bs) return as ? 1 : -1;
      const ta = a.updated_at || a.created_at || "";
      const tb = b.updated_at || b.created_at || "";
      return tb.localeCompare(ta);
    });
  }

  function getById(id) {
    return rules.find((r) => r.id === id) || null;
  }

  function uid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return "r_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function stripDash(s) {
    return String(s || "")
      .trim()
      .replace(/^[-–—]+/, "")
      .toLowerCase();
  }

  function migrateEndings(input) {
    if (input.endings && typeof input.endings === "object") {
      const e = emptyEndings();
      for (const { key } of PERSONS) {
        e[key] = String(input.endings[key] ?? "").trim();
      }
      if (!e.il && input.endings["il/elle/on"]) e.il = String(input.endings["il/elle/on"]).trim();
      if (!e.ils && input.endings["ils/elles"]) e.ils = String(input.endings["ils/elles"]).trim();
      return e;
    }

    const raw = input.ending_rule || "";
    if (raw) {
      const parts = raw
        .split(/[/／,，;；|]+/)
        .map((p) => p.replace(/^(je|tu|il|elle|on|nous|vous|ils|elles)[·.\s]*/i, "").trim())
        .filter(Boolean);
      const endings = parts
        .map((p) => {
          const m = p.match(/-?[a-zàâäéèêëïîôùûüçœæ]+$/i);
          return m ? m[0] : p;
        })
        .filter(Boolean);
      if (endings.length >= 6) {
        const asEnding = (s) => {
          const t = String(s).trim();
          if (!t) return "";
          if (/^[-–—]/.test(t)) return t.replace(/^[-–—]+/, "-");
          if (/^[a-zàâäéèêëïîôùûüçœæ]{1,8}$/i.test(t)) return "-" + t;
          return t;
        };
        return {
          je: asEnding(endings[0]),
          tu: asEnding(endings[1]),
          il: asEnding(endings[2]),
          nous: asEnding(endings[3]),
          vous: asEnding(endings[4]),
          ils: asEnding(endings[5]),
        };
      }
    }

    const e = emptyEndings();
    if (Array.isArray(input.examples)) {
      const mapPerson = (person) => {
        const p = (person || "").toLowerCase();
        if (p.includes("nous")) return "nous";
        if (p.includes("vous")) return "vous";
        if (p.includes("ils") || p.includes("elles")) return "ils";
        if (p.includes("tu") && !p.includes("je")) return "tu";
        if (p.includes("il") || p.includes("elle") || p.includes("on")) return "il";
        if (p.includes("je")) return "je";
        return null;
      };
      for (const ex of input.examples) {
        const form = (ex.form || "").trim();
        if (!form) continue;
        const key = mapPerson(ex.person);
        if (key && !e[key]) e[key] = form;
        if ((ex.person || "").toLowerCase().includes("je") && (ex.person || "").toLowerCase().includes("tu")) {
          if (!e.je) e.je = form;
          if (!e.tu) e.tu = form;
        }
      }
    }
    return e;
  }

  const SUPPLEMENTARY_CATEGORY = "補充用法";

  const CATEGORIES = [
    { key: "", label: "（未分類）" },
    { key: "變位", label: "變位" },
    { key: "時態", label: "時態" },
    { key: "否定", label: "否定" },
    { key: "代詞", label: "代詞" },
    { key: "介詞", label: "介詞" },
    { key: "冠詞", label: "冠詞" },
    { key: "句型", label: "句型" },
    { key: "形容詞", label: "形容詞" },
    { key: "其他", label: "其他" },
    { key: SUPPLEMENTARY_CATEGORY, label: "補充用法" },
  ];

  function isPronounGrammar(x) {
    if (typeof FrParse !== "undefined" && typeof FrParse.isPronounGrammar === "function") {
      return FrParse.isPronounGrammar(x);
    }
    if (!x || typeof x !== "object") return false;
    const cat = String(x.category || "").trim();
    if (cat === "代詞") return true;
    const key = String(x.grammarKey || x.frKind || x.g || "").trim();
    if (/^pron:/.test(key) || key === "det:dem") return true;
    const name = String(x.name || x.title || "").trim();
    return /代詞|主語代詞|反身代詞|副代詞|指示代詞|賓語代詞|重讀代詞|關係代詞|直接賓語|間接賓語/.test(
      name
    );
  }

  /** 成語／特定用法等：特殊色、列表最後、不句中上色 */
  function isSupplementaryUsage(ruleOrCat) {
    const c =
      typeof ruleOrCat === "string"
        ? ruleOrCat
        : ruleOrCat && typeof ruleOrCat === "object"
          ? ruleOrCat.category
          : "";
    return String(c || "").trim() === SUPPLEMENTARY_CATEGORY;
  }

  function normalizeRule(input, existing = null) {
    const now = new Date().toISOString();
    const endings = migrateEndings({ ...existing, ...input, endings: input.endings ?? existing?.endings });
    let keywords = normalizeKeywords(input.keywords ?? existing?.keywords);

    // 舊否定規則：六格塞 pas/ne/n' → 改為關鍵詞、關閉六格
    const title = (input.title ?? existing?.title ?? "").trim() || "未命名規則";
    const looksLikeNegation =
      (existing?.id || input.id) === "seed-negation-ne-pas" || /ne\s*\.{0,3}\s*pas|否定/.test(title);

    let hasPersons =
      typeof input.has_persons === "boolean"
        ? input.has_persons
        : typeof existing?.has_persons === "boolean"
          ? existing.has_persons
          : hasAnyEnding(endings);

    if (looksLikeNegation && typeof input.has_persons !== "boolean" && typeof existing?.has_persons !== "boolean") {
      const fromEndings = [];
      for (const { key } of PERSONS) {
        for (const p of expandCellForms(endings[key] || "")) {
          if (p && !/^[-–—]/.test(p)) fromEndings.push(p);
        }
      }
      keywords = normalizeKeywords([...keywords, ...fromEndings, "pas", "ne", "n'", "n"]);
      hasPersons = false;
    }

    let category = String(input.category ?? existing?.category ?? "").trim();
    if (category && !CATEGORIES.some((c) => c.key === category)) category = "其他";

    const resolvedKeywords = hasPersons
      ? keywords
      : keywords.length
        ? keywords
        : (() => {
            const fromEndings = [];
            for (const { key } of PERSONS) {
              for (const p of expandCellForms((input.endings && input.endings[key]) || endings[key] || "")) {
                if (p && !/^[-–—]/.test(p)) fromEndings.push(p);
              }
            }
            return normalizeKeywords(fromEndings);
          })();

    return {
      id: existing?.id || input.id || uid(),
      title,
      category,
      explanation: String(input.explanation ?? existing?.explanation ?? "").trim(),
      has_persons: hasPersons,
      endings: hasPersons ? endings : emptyEndings(),
      keywords: resolvedKeywords,
      created_at: existing?.created_at || input.created_at || now,
      updated_at: existing ? now : input.updated_at || existing?.updated_at || now,
    };
  }

  /** 標題正規化（不分大小寫、去空白） */
  function titleNorm(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/\s+/g, "")
      .replace(/[’‘‛′`]/g, "'")
      .replace(/…/g, "...")
      .replace(/·/g, "");
  }

  /** 解析「中文（法語）」→ { full, zh, fr } */
  function parseBilingualTitle(title) {
    const full = String(title || "").trim();
    const m = full.match(/^(.+?)[（(]\s*(.+?)\s*[）)]\s*$/);
    if (m) {
      return { full, zh: m[1].trim(), fr: m[2].trim(), ko: m[2].trim() };
    }
    return { full, zh: full, fr: "", ko: "" };
  }

  function titleKeys(title) {
    const p = parseBilingualTitle(title);
    const keys = new Set();
    if (p.full) keys.add(titleNorm(p.full));
    if (p.zh) keys.add(titleNorm(p.zh));
    if (p.fr) keys.add(titleNorm(p.fr));
    return keys;
  }

  function ruleMatchKeys(rule) {
    const keys = titleKeys(rule.title);
    const p = parseBilingualTitle(rule.title);
    if (p.fr) {
      p.fr.split(/[\/／,，|｜\s]+/).forEach((part) => {
        const t = titleNorm(part.replace(/^[-~〜]+/, ""));
        if (t.length >= 1) keys.add(t);
      });
    }
    for (const kw of rule.keywords || []) {
      const t = titleNorm(kw);
      if (t) keys.add(t);
    }
    return keys;
  }

  /** 僅靠時態／功能通名無法當「已收錄」的字（需更具體標題或句中形） */
  const GENERIC_GRAMMAR_KEYS = new Set(
    [
      "現在時",
      "過去",
      "未來",
      "否定",
      "變位",
      "動詞",
      "時態",
      "未完成",
      "未完成過去",
      "完成",
      "分詞",
      "過去分詞",
      "簡單未來",
      "複合過去",
      "présent",
      "present",
      "imparfait",
      "futur",
      "futursimple",
      "passécomposé",
      "passecompose",
      "participepassé",
      "participepasse",
      "infinitif",
      "indicatif",
      "er",
      "-er",
      "ir",
      "-ir",
      "re",
      "-re",
      "é",
      "-é",
      "ais",
      "-ais",
    ].map((x) => titleNorm(x))
  );

  /** 第三人稱：lui/leur＝COI，le/la/les＝COD，不可互套 */
  function pronounRoleConflict(rule, spanRaw, queryName) {
    const span = String(spanRaw || "")
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/^l['’]/, "l");
    if (!span) return false;
    const blob = [rule?.title, queryName, rule?.category]
      .filter(Boolean)
      .join("\n")
      .toLowerCase()
      .normalize("NFC");
    const isCod = /直接賓語|objets?\s*directs?|\bcod\b/.test(blob);
    const isCoi = /間接賓語|objets?\s*indirects?|\bcoi\b/.test(blob);
    if (isCod && /^(lui|leur)$/.test(span)) return true;
    if (isCoi && /^(le|la|les|l)$/.test(span)) return true;
    return false;
  }

  function isGenericGrammarKey(key) {
    const k = titleNorm(key);
    if (!k) return true;
    if (GENERIC_GRAMMAR_KEYS.has(k)) return true;
    if (k.length <= 2) return true;
    // 純詞尾標記
    if (/^[-–—]?[a-zéèêëàâäùûüôöîïœæ]{1,4}$/i.test(k) && k.length <= 4) return true;
    return false;
  }

  /**
   * span 只掃一次全部規則 → Map(ruleId → { score, matchType, form })
   * 避免 findMatchingRule 對每張卡重跑 matchTokenToRules（原 O(N²)）
   */
  function buildSpanHitMap(spanRaw) {
    const span = String(spanRaw || "").trim();
    /** @type {Map<string, { score: number, matchType: string, form?: string }>} */
    const map = new Map();
    if (!span) return map;

    const tokens = span.match(/[A-Za-zÀ-ÿœæŒÆ]+(?:['’][A-Za-zÀ-ÿœæŒÆ]+)*/g) || [span];
    for (const tok of tokens) {
      const hits = matchTokenToRules(tok, { sentenceMode: false });
      for (const h of hits) {
        const id = h.rule?.id;
        if (!id) continue;
        const s =
          h.matchType === "form"
            ? 40 + Math.min(20, (h.score || 0) / 50)
            : 18 + Math.min(10, (h.score || 0) / 80);
        const prev = map.get(id);
        if (!prev || s > prev.score) {
          map.set(id, { score: s, matchType: h.matchType || "ending", form: tok });
        }
      }
    }
    return map;
  }

  /**
   * 句中 span 對單一規則的命中強度（完整形 ≫ 詞尾）
   * @param {Map<string, { score: number, matchType: string, form?: string }>|null} [hitMap]
   *   若由 findMatchingRule 預先 buildSpanHitMap 傳入，則不再全表掃規則
   * @returns {{ score: number, matchType: 'form'|'ending'|'none', form?: string }}
   */
  function scoreRuleBySpan(rule, spanRaw, hitMap = null) {
    const span = String(spanRaw || "").trim();
    if (!span || !rule) return { score: 0, matchType: "none" };

    let best = { score: 0, matchType: "none" };
    const fromMap = hitMap
      ? hitMap.get(rule.id)
      : (() => {
          // 無預先 map 時仍只掃一次全表（相容單獨呼叫）
          return buildSpanHitMap(span).get(rule.id);
        })();
    if (fromMap && fromMap.score > best.score) {
      best = { score: fromMap.score, matchType: fromMap.matchType || "ending", form: fromMap.form };
    }

    // 關鍵詞規則：僅整詞／否定小詞精確（禁止 la⊂plan、et⊂est 這類 includes）
    if (!ruleHasPersons(rule) || (rule.keywords || []).length) {
      for (const kw of rule.keywords || []) {
        for (const raw of expandCellForms(kw)) {
          const k = normalizeToken(raw);
          const s = normalizeToken(span);
          if (!k) continue;
          if (s === k || particlesEqual(raw, span)) {
            if (28 > best.score) best = { score: 28, matchType: "form", form: span };
          } else if (
            // 多詞 span 才允許「空白分詞後」命中某一 token
            s.length > k.length + 1 &&
            k.length >= 2 &&
            new RegExp(
              `(^|[^a-zàâäéèêëïîôùûüçœæ])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-zàâäéèêëïîôùûüçœæ])`,
              "i"
            ).test(s)
          ) {
            if (12 > best.score) best = { score: 12, matchType: "form", form: span };
          }
        }
      }
    }
    return best;
  }

  /**
   * 標題語意分（嚴格優先；弱 includes 極低分）
   */
  /** 使用者把直陳式現在時叫做「現實式」。括號前的名稱要整段相等，避免誤傷其他卡。 */
  function realityPresentTitle(text) {
    const head = String(text || "")
      .trim()
      .replace(/[（(].*$/, "")
      .trim();
    return head === "現實式";
  }

  /** 時態／功能族：兩側同族可給軟加分（仍不足以單獨過門檻） */
  function grammarFamily(text) {
    const raw = String(text || "");
    const t = titleNorm(raw);
    if (!t) return "";
    if (/imparfait|未完成/.test(t)) return "imparfait";
    if (/futur|未來|将来/.test(t)) return "futur";
    if (/pass[eé]compos|複合過去|复合过去|passécomposé/.test(t)) return "pc";
    if (/participe|過去分詞|过去分词|分詞/.test(t) && /é|è|participe|分詞/.test(t)) return "pp";
    if (/infinitif|不定式|不定詞/.test(t)) return "inf";
    if (realityPresentTitle(raw) || /présent|现在|現在/.test(t)) return "present";
    if (/neg|nég|否定|ne\.\.\.pas|ne…pas|nepas/.test(t) || /\bpas\b/.test(t)) return "neg";
    if (/省音|elision|élision|quon|qu'on/.test(t)) return "elision";
    if (/主語/.test(t)) return "subj";
    if (/反身/.test(t)) return "se";
    if (/副代/.test(t)) return "advpron";
    if (/指示/.test(t)) return "dem";
    if (/直接賓|\bcod\b/.test(t)) return "cod";
    if (/間接賓|\bcoi\b/.test(t)) return "coi";
    return "";
  }

  function scoreRuleByTitle(rule, nameNorm, zhNorm, frNorm, queryKeys) {
    const rKeys = ruleMatchKeys(rule);
    const rp = parseBilingualTitle(rule.title);
    const rZh = titleNorm(rp.zh);
    const rFr = titleNorm(rp.fr);
    const rTitle = titleNorm(rule.title);
    let score = 0;
    let strongHits = 0; // 全等／專名級命中次數

    if (nameNorm && rTitle === nameNorm) {
      score += 40;
      strongHits += 2;
    }

    // 時態族：同族軟加分；異族重罰（不定式 ≠ avoir 現在時）
    const qFam = grammarFamily([nameNorm, zhNorm, frNorm].join(" "));
    const rFam = grammarFamily(rule.title);
    if (qFam && rFam && qFam === rFam) {
      score += 6;
    } else if (qFam && rFam && qFam !== rFam) {
      score -= 24;
    }

    // 中文側：全等才高分；通名「現在時」全等不能當專屬命中
    if (zhNorm && zhNorm.length >= 2) {
      if (rZh === zhNorm) {
        if (isGenericGrammarKey(zhNorm)) {
          score += 4;
        } else {
          score += 22;
          strongHits += 1;
        }
      } else if (rZh.includes(zhNorm) && zhNorm.length >= 4 && !isGenericGrammarKey(zhNorm)) {
        // 具體中文被規則標題包含（如「否定」太短／通名不給）
        score += 10;
      } else if (
        zhNorm.includes(rZh) &&
        rZh.length >= 4 &&
        !isGenericGrammarKey(rZh) &&
        zhNorm.length - rZh.length <= 10
      ) {
        score += 8;
      } else if (
        !isGenericGrammarKey(zhNorm) &&
        rZh &&
        (rZh.includes(zhNorm) || zhNorm.includes(rZh))
      ) {
        // 通名互相包含：幾乎不算
        if (isGenericGrammarKey(zhNorm) || isGenericGrammarKey(rZh)) score += 1;
        else score += 3;
      }
    }

    // 法語標記：全等優先；通名 présent 全等不能當專屬命中
    if (frNorm && frNorm.length >= 1) {
      if (rFr === frNorm) {
        if (isGenericGrammarKey(frNorm)) {
          score += 4;
        } else {
          score += frNorm.length >= 3 ? 24 : 10;
          strongHits += 1;
        }
      } else if (rKeys.has(frNorm) && !isGenericGrammarKey(frNorm)) {
        score += 16;
        strongHits += 1;
      } else if (rFr && frNorm.length >= 4 && rFr.includes(frNorm) && !isGenericGrammarKey(frNorm)) {
        score += 8;
      } else if (rFr && frNorm.includes(rFr) && rFr.length >= 4 && !isGenericGrammarKey(rFr)) {
        score += 6;
      }
    }

    // 鍵交集：通名鍵（imparfait、présent）權重極低
    let genericKeyHits = 0;
    let specificKeyHits = 0;
    for (const q of queryKeys) {
      if (!q) continue;
      if (rKeys.has(q)) {
        if (isGenericGrammarKey(q)) {
          genericKeyHits += 1;
          score += 2;
        } else {
          specificKeyHits += 1;
          score += q.length >= 4 ? 14 : 8;
          strongHits += 1;
        }
        continue;
      }
      // 禁止短 includes 刷分；僅允許較長、非通名的部分重疊
      if (isGenericGrammarKey(q) || q.length < 5) continue;
      for (const rk of rKeys) {
        if (!rk || isGenericGrammarKey(rk) || rk.length < 5) continue;
        if (rk === q) {
          score += 12;
          strongHits += 1;
          break;
        }
        // 一側完整包含另一側，且長度接近（避免 imparfait ⊂ xxximparfait 亂加）
        if (rk.includes(q) || q.includes(rk)) {
          const shorter = rk.length <= q.length ? rk : q;
          const longer = rk.length > q.length ? rk : q;
          if (shorter.length >= 5 && longer.length <= shorter.length + 6) {
            score += 4;
            break;
          }
        }
      }
    }

    // 僅有通名鍵命中、無專名 → 壓分
    if (genericKeyHits > 0 && specificKeyHits === 0 && strongHits === 0) {
      score = Math.min(score, 8);
    }

    return { score, strongHits, genericOnly: genericKeyHits > 0 && specificKeyHits === 0 };
  }

  /**
   * 從標題抽出被點名的不定詞（prendre／dire／déjeuner）
   * 通則「-er présent」沒有具體動詞 → null
   */
  function extractNamedInfinitive(text) {
    const s = String(text || "").trim();
    if (!s) return null;
    if (typeof Analyzer !== "undefined" && Analyzer.extractIrregularInfinitive) {
      const irr = Analyzer.extractIrregularInfinitive(s);
      if (irr) return irr;
    }
    const matches = s
      .toLowerCase()
      .normalize("NFC")
      .match(/\b[a-zàâäéèêëïîôùûüçœæ]{3,}(?:er|ir|re|oir)\b/gi);
    if (!matches) return null;
    const infs = matches
      .map((m) => m.toLowerCase().normalize("NFC"))
      .filter((m) => m && !isGenericGrammarKey(m));
    infs.sort((a, b) => b.length - a.length);
    return infs[0] || null;
  }

  function ruleNamedInfinitive(rule) {
    if (!rule) return null;
    const blob = [rule.title, ...(rule.keywords || [])].filter(Boolean).join(" ");
    return extractNamedInfinitive(blob);
  }

  function lookupKindTitle(key) {
    if (typeof FrParse !== "undefined" && typeof FrParse.titleForGrammarKey === "function") {
      return String(FrParse.titleForGrammarKey(key) || "").trim();
    }
    return "";
  }

  function lookupSeedId(key) {
    if (typeof FrParse !== "undefined" && typeof FrParse.seedIdForKind === "function") {
      const id = String(FrParse.seedIdForKind(key) || "").trim();
      if (id) return id;
    }
    const fallback = {
      "neg:ne-pas": "seed-negation-ne-pas",
      "verb:être:present": "seed-etre-present",
      "verb:etre:present": "seed-etre-present",
      "verb:avoir:present": "seed-avoir-present",
      "verb:pouvoir:imparfait": "seed-pouvoir-imparfait",
      "verb:er:present": "seed-present-er",
      "verb:er:imparfait": "seed-imparfait-er",
      "verb:futur": "seed-futur-simple",
      "pp:e": "seed-pp-er",
    };
    return fallback[String(key || "")] || "";
  }

  function infinitiveFromGrammarKey(key) {
    const k = String(key || "");
    const verb = /^verb:([^:]+):/.exec(k);
    if (verb && verb[1] && verb[1] !== "er") return verb[1];
    const pp = /^pp:irreg:(.+)$/.exec(k);
    return pp ? pp[1] : "";
  }

  function grammarFamilyFromKey(key) {
    const k = String(key || "").toLowerCase();
    if (/imparfait/.test(k)) return "imparfait";
    if (/futur/.test(k)) return "futur";
    if (/passe-compose|passécompos/.test(k)) return "pc";
    if (/^pp:/.test(k) || /participe/.test(k)) return "pp";
    if (/infinitif|^inf:/.test(k)) return "inf";
    if (/present|présent/.test(k)) return "present";
    if (/^neg:/.test(k)) return "neg";
    if (/pron:subj/.test(k)) return "subj";
    if (/pron:se/.test(k)) return "se";
    if (/pron:en|pron:y/.test(k)) return "advpron";
    if (/det:dem|pron:dem/.test(k)) return "dem";
    if (/pron:cod/.test(k)) return "cod";
    if (/pron:coi/.test(k)) return "coi";
    if (/elision|省音/.test(k)) return "elision";
    return "";
  }

  function isRegularGroup1(inf) {
    const s = String(inf || "")
      .trim()
      .toLowerCase()
      .normalize("NFC");
    if (!s) return false;
    if (typeof Analyzer !== "undefined") {
      if (Analyzer.isIrregularInfinitive && Analyzer.isIrregularInfinitive(s)) return false;
      const g = Analyzer.verbGroupForLemma && Analyzer.verbGroupForLemma(s);
      if (g?.code) return g.code === "1";
    }
    return s.endsWith("er") && s !== "aller";
  }

  function firstSpanToken(span) {
    const s = String(span || "").trim();
    if (!s) return "";
    const m = s.match(/[A-Za-zÀ-ÿœæŒÆ]+(?:['’][A-Za-zÀ-ÿœæŒÆ]+)*/);
    return m ? m[0] : s;
  }

  function verbIdentityConflict(rule, queryInf, qFam, spanIrreg) {
    if (!rule) return true;
    const rFam = grammarFamily(rule.title);
    if (qFam && rFam && qFam !== rFam) return true;
    const ruleInf = ruleNamedInfinitive(rule);
    if (queryInf && ruleInf && ruleInf !== queryInf) return true;
    if (
      spanIrreg &&
      isGeneralEndingRule(rule) &&
      !ruleMentionsVerb(rule, spanIrreg.infinitive)
    ) {
      return true;
    }
    return false;
  }

  /**
   * 標準種子或標準標題不在筆記本時，改掛同一時態族裡唯一的詞尾通則。
   * 名稱正好是「現實式」的卡也算直陳式現在時：詞尾通則直接掛；
   * 六格是完整形時只在句中形對得上才掛；六格還沒填也掛，讓已建立的卡能套上。
   */
  function uniqueSharedEndingRule(pool, fam, ctx) {
    if (!fam || !pool) return null;
    const spanTok = firstSpanToken(ctx?.span);
    if (spanBlocksSharedEndingRule(spanTok)) return null;
    const hits = [];
    const seen = new Set();
    for (const r of pool) {
      if (!r?.id || seen.has(r.id) || isSupplementaryUsage(r)) continue;
      const alias = fam === "present" && realityPresentTitle(r.title);
      const general = isGeneralEndingRule(r);
      if (!alias && !general) continue;
      const rFam = grammarFamily(r.title);
      if (rFam && rFam !== fam) continue;
      if (!rFam && !alias) continue;
      if (verbIdentityConflict(r, ctx.queryInf, fam, ctx.spanIrreg)) continue;
      if (ctx.spanIrreg && !ruleMentionsVerb(r, ctx.spanIrreg.infinitive)) continue;
      if (alias && !general) {
        const filled = hasAnyEnding(r.endings);
        if (filled && scoreRuleBySpan(r, ctx.span).matchType !== "form") continue;
      }
      seen.add(r.id);
      hits.push(r);
    }
    return hits.length === 1 ? hits[0] : null;
  }

  /** 標題像第一／二組通則時才走通則卡，避免「現在時（dire présent）」誤掛。 */
  function sharedFamilyFromItemName(name, nameFr, nameZh) {
    const blob = [name, nameFr, nameZh].filter(Boolean).join(" ");
    if (/-\s*er\b/i.test(blob) && /未完成|imparfait/i.test(blob)) return "imparfait";
    if (/-\s*ir\b/i.test(blob) && /未完成|imparfait/i.test(blob)) return "imparfait";
    if (/-\s*er\b/i.test(blob) && /現在|présent|現實式/i.test(blob)) return "present";
    if (/-\s*ir\b/i.test(blob) && /現在|présent|現實式/i.test(blob)) return "present";
    if (/簡單未來|futur simple/i.test(blob)) return "futur";
    if (/過去分詞/.test(blob) && /-\s*é\b/.test(blob)) return "pp";
    return "";
  }

  function matchRuleByGrammarKey(key, ctx) {
    const k = String(key || "").trim();
    if (!k) return { done: false };
    const pool = ctx.pool;
    const spanIrreg = ctx.spanIrreg;
    const qFam = ctx.qFam;

    if (k === "pp:e" && spanIrreg && /participe/.test(String(spanIrreg.tense || ""))) {
      return { done: true, result: { owned: false, rule: null, score: 0, reason: "irregular-pp" } };
    }

    const seedId = lookupSeedId(k);
    if (seedId) {
      const seed = pool.find((r) => r.id === seedId) || getById(seedId);
      if (seed && !isSupplementaryUsage(seed)) {
        const spanTok = firstSpanToken(ctx.span);
        if (
          (/^verb:(er|ir):/.test(k) || k === "pp:e") &&
          spanBlocksSharedEndingRule(spanTok)
        ) {
          return { done: true, result: { owned: false, rule: null, score: 0, reason: "function-span" } };
        }
        if (verbIdentityConflict(seed, ctx.queryInf, qFam, spanIrreg)) {
          return { done: true, result: { owned: false, rule: null, score: 0, reason: "key-seed-conflict" } };
        }
        return { done: true, result: { owned: true, rule: seed, score: 96, strict: true } };
      }
    }

    const wantTitle = lookupKindTitle(k);
    if (wantTitle) {
      const byTitle = pool.filter((r) => titleNorm(r.title) === titleNorm(wantTitle));
      if (byTitle.length === 1 && !verbIdentityConflict(byTitle[0], ctx.queryInf, qFam, spanIrreg)) {
        return { done: true, result: { owned: true, rule: byTitle[0], score: 95, strict: true } };
      }
    }

    const inf = infinitiveFromGrammarKey(k);
    if (inf && inf !== "er" && inf !== "ir") {
      const shared =
        typeof Analyzer !== "undefined" &&
        Analyzer.usesSharedGroupPattern &&
        Analyzer.usesSharedGroupPattern(inf);
      if (shared) {
        const spec =
          Analyzer.groupPatternSpec &&
          Analyzer.groupPatternSpec(inf, grammarFamilyFromKey(k) || ctx.qFam || "現在時");
        const specKey = spec?.key || "";
        const specSeed = specKey && lookupSeedId(specKey);
        if (specSeed) {
          const seed = pool.find((r) => r.id === specSeed) || getById(specSeed);
          const spanTok = firstSpanToken(ctx.span);
          if (seed && !spanBlocksSharedEndingRule(spanTok)) {
            return { done: true, result: { owned: true, rule: seed, score: 94, strict: true } };
          }
        }
        const famShared = grammarFamilyFromKey(specKey) || grammarFamilyFromKey(k) || qFam;
        const alt = uniqueSharedEndingRule(pool, famShared, ctx);
        if (alt) return { done: true, result: { owned: true, rule: alt, score: 72, strict: true } };
        return { done: false };
      }
      const fam = grammarFamilyFromKey(k) || qFam;
      const named = pool.filter((r) => {
        if (!ruleMentionsVerb(r, inf)) return false;
        const rFam = grammarFamily(r.title);
        if (fam && rFam && fam !== rFam) return false;
        return true;
      });
      if (named.length === 1) {
        return { done: true, result: { owned: true, rule: named[0], score: 94, strict: true } };
      }
      return { done: true, result: { owned: false, rule: null, score: 0, reason: "verb-key-unmatched" } };
    }

    if (k.startsWith("pp:irreg:")) {
      return { done: true, result: { owned: false, rule: null, score: 0, reason: "irregular-pp-unmatched" } };
    }

    if (/^verb:(er|ir):/.test(k) || k === "verb:futur" || k === "pp:e") {
      const fam = grammarFamilyFromKey(k) || qFam;
      const alt = uniqueSharedEndingRule(pool, fam, ctx);
      if (alt) return { done: true, result: { owned: true, rule: alt, score: 72, strict: true } };
    }

    return { done: false };
  }

  /**
   * 身分制對卡：grammarKey → 完整標題 → 唯一法語標記 → 動詞身分 → span 完整形。
   * 不再用 includes 分數湯當「已收錄」。
   */
  function matchInventoryIdentity(nameOrItem) {
    const item =
      typeof nameOrItem === "string" ? { name: nameOrItem } : nameOrItem && typeof nameOrItem === "object" ? nameOrItem : {};
    const name = String(item.name || item.title || "").trim();
    const nameFr = String(item.nameFr || item.nameKo || item.fr || "").trim();
    const nameZh = String(item.nameZh || item.zh || "").trim();
    const span = String(item.span || "").trim();
    const grammarKey = String(item.grammarKey || item.frKind || item.g || "").trim();

    const nameNorm = titleNorm(name);
    const parsed = parseBilingualTitle(name);
    const frNorm = titleNorm(nameFr || parsed.fr);
    const zhNorm = titleNorm(nameZh || parsed.zh);
    const qFam = grammarFamily([name, zhNorm, frNorm].join(" ")) || grammarFamilyFromKey(grammarKey);

    const titleBlob = [name, nameFr, nameZh, parsed.fr, parsed.zh].filter(Boolean).join(" ");
    const titleInf = extractNamedInfinitive(titleBlob);

    let spanIrreg = null;
    if (span && typeof Analyzer !== "undefined" && Analyzer.lookupIrregular) {
      const toks = span.match(/[A-Za-zÀ-ÿœæŒÆ]+(?:['’][A-Za-zÀ-ÿœæŒÆ]+)*/g) || [];
      for (const t of toks) {
        const hit = Analyzer.lookupIrregular(t);
        if (hit) {
          spanIrreg = hit;
          break;
        }
      }
    }
    const queryInf =
      infinitiveFromGrammarKey(grammarKey) ||
      (spanIrreg && spanIrreg.infinitive) ||
      titleInf ||
      null;

    const pool = rules.filter((r) => !isSupplementaryUsage(r));

    if (grammarKey) {
      const keyed = matchRuleByGrammarKey(grammarKey, {
        pool,
        span,
        queryInf,
        qFam,
        spanIrreg,
      });
      if (keyed.done) return keyed.result;
    }

    const exact = pool.filter((r) => nameNorm && titleNorm(r.title) === nameNorm);
    if (exact.length === 1) {
      const r = exact[0];
      if (pronounRoleConflict(r, span, name)) {
        return { owned: false, rule: null, score: 0, reason: "pronoun-role" };
      }
      if (!verbIdentityConflict(r, queryInf, qFam, spanIrreg)) {
        return { owned: true, rule: r, score: 100, strict: true };
      }
    }

    const marker = frNorm;
    if (marker && !isGenericGrammarKey(marker)) {
      const markerHits = pool.filter((r) => {
        const rp = parseBilingualTitle(r.title);
        return titleNorm(rp.fr) === marker;
      });
      const usable = markerHits.filter(
        (r) => !pronounRoleConflict(r, span, name) && !verbIdentityConflict(r, queryInf, qFam, spanIrreg)
      );
      if (usable.length === 1) {
        return { owned: true, rule: usable[0], score: 88, strict: true };
      }
      if (markerHits.length > 1) {
        const zhHits = usable.filter((r) => titleNorm(parseBilingualTitle(r.title).zh) === zhNorm);
        if (zhHits.length === 1) {
          return { owned: true, rule: zhHits[0], score: 90, strict: true };
        }
        if (usable.length !== 1) {
          return { owned: false, rule: null, score: 0, reason: "ambiguous-marker", strict: true };
        }
      }
    }

    if (queryInf) {
      const fam = qFam || grammarFamilyFromKey(grammarKey);
      const specific = pool.filter((r) => {
        if (!ruleMentionsVerb(r, queryInf)) return false;
        const rFam = grammarFamily(r.title);
        if (fam && rFam && fam !== rFam) return false;
        if (pronounRoleConflict(r, span, name)) return false;
        return true;
      });
      if (specific.length === 1) {
        return { owned: true, rule: specific[0], score: 86, strict: true };
      }

      const spanTok = firstSpanToken(span);
      const spanIsFunction = spanTok && isLocalFunctionWord(spanTok);
      const shared =
        !spanIsFunction &&
        (isRegularGroup1(queryInf) ||
          (typeof Analyzer !== "undefined" &&
            Analyzer.usesSharedGroupPattern &&
            Analyzer.usesSharedGroupPattern(queryInf)));
      if (shared) {
        const general = pool.filter((r) => {
          if (!isGeneralEndingRule(r)) return false;
          const rFam = grammarFamily(r.title);
          if (fam && rFam && fam !== rFam) return false;
          return true;
        });
        if (general.length === 1) {
          return { owned: true, rule: general[0], score: 70, strict: true };
        }
      }

      if (titleInf || spanIrreg || infinitiveFromGrammarKey(grammarKey)) {
        const keyInf = infinitiveFromGrammarKey(grammarKey);
        if (keyInf && keyInf !== "er" && keyInf !== "ir" && !shared) {
          return { owned: false, rule: null, score: 0, reason: "verb-unmatched", strict: true };
        }
        if (!shared && (spanIrreg || (titleInf && !isRegularGroup1(titleInf)))) {
          return { owned: false, rule: null, score: 0, reason: "verb-unmatched", strict: true };
        }
      }
    }

    if (span) {
      const spanTok = firstSpanToken(span);
      const shortFn = spanTok && (isGenericGrammarKey(titleNorm(spanTok)) || isLocalFunctionWord(spanTok));
      if (!shortFn) {
        const spanHitMap = buildSpanHitMap(span);
        const hits = [];
        for (const r of pool) {
          const part = scoreRuleBySpan(r, span, spanHitMap);
          if (part.matchType !== "form") continue;
          if (verbIdentityConflict(r, queryInf, qFam, spanIrreg)) continue;
          if (pronounRoleConflict(r, span, name)) continue;
          if (titleInf && ruleIsNonVerbGrammar(r) && !ruleMentionsVerb(r, titleInf)) continue;
          const rFam = grammarFamily(r.title);
          if (qFam && rFam && qFam !== rFam) continue;
          hits.push(r);
        }
        if (hits.length === 1) {
          return { owned: true, rule: hits[0], score: 60, strict: true };
        }
      }
    }

    const sharedFam = sharedFamilyFromItemName(name, nameFr, nameZh) || (qFam === "present" && realityPresentTitle(name) ? "present" : "");
    if (sharedFam) {
      const alt = uniqueSharedEndingRule(pool, sharedFam, {
        span,
        queryInf,
        qFam: sharedFam,
        spanIrreg,
      });
      if (alt) return { owned: true, rule: alt, score: 72, strict: true };
    }

    return { owned: false, rule: null, score: 0, strict: true };
  }

  function findMatchingRule(nameOrItem) {
    return matchInventoryIdentity(nameOrItem);
  }

  /** 盤點項對卡：grammarKey 身分優先，不用分數湯 */
  function findInventoryRule(item) {
    return matchInventoryIdentity(item);
  }

  /**
   * 把 API 盤點項掛到筆記本既有卡。只綁這次盤點列出的項目。
   */
  function attachLocalRulesToInventory(query, inventory) {
    if (typeof Analyzer !== "undefined" && typeof Analyzer.rewriteInventoryVerbTitles === "function") {
      inventory = Analyzer.rewriteInventoryVerbTitles(inventory);
    }
    const inv = inventory && typeof inventory === "object" ? { ...inventory } : { items: [] };
    if (Array.isArray(inv.items)) {
      inv.items = inv.items.filter((it) => !isPronounGrammar(it));
    }
    const items = Array.isArray(inv.items)
      ? inv.items.map((it) => (it && typeof it === "object" ? { ...it } : it))
      : [];
    const kept = [];

    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      if (it.manualRuleId && getById(it.manualRuleId)) {
        const rule = getById(it.manualRuleId);
        it.name = rule.title;
        const p = parseBilingualTitle(rule.title);
        if (p.zh) it.nameZh = p.zh;
        if (p.fr) it.nameFr = p.fr;
        if (isSupplementaryUsage(rule)) it.category = rule.category;
        kept.push(it);
        continue;
      }
      if (it.localRuleId && getById(it.localRuleId)) {
        const rule = getById(it.localRuleId);
        it.name = rule.title;
        const p = parseBilingualTitle(rule.title);
        if (p.zh) it.nameZh = p.zh;
        if (p.fr) it.nameFr = p.fr;
        if (!it.category) it.category = rule.category;
        kept.push(it);
        continue;
      }
      if (isSupplementaryUsage(it) || isSupplementaryUsage(it.category)) {
        kept.push(it);
        continue;
      }
      const match = findInventoryRule(it);
      if (match?.owned && match.rule) {
        it.localRuleId = match.rule.id;
        it.localAttached = true;
        it.name = match.rule.title;
        const p = parseBilingualTitle(match.rule.title);
        if (p.zh) it.nameZh = p.zh;
        if (p.fr) it.nameFr = p.fr;
        if (!it.category) it.category = match.rule.category;
      }
      kept.push(it);
    }

    inv.items = kept;
    return inv;
  }

  function expandNeedles(raw) {
    const out = new Set();
    const base = String(raw || "").trim().normalize("NFC");
    if (!base) return [];
    const stripDecor = (s) =>
      String(s || "")
        .replace(/^[-~〜～─–—]+/, "")
        .replace(/[-~〜～─–—]+$/, "")
        .trim();
    const add = (s) => {
      const t = String(s || "").trim().normalize("NFC");
      if (!t) return;
      out.add(t);
      out.add(t.toLowerCase());
      const noSpace = t.replace(/\s+/g, "");
      if (noSpace) {
        out.add(noSpace);
        out.add(noSpace.toLowerCase());
      }
      const stripped = stripDecor(t);
      if (stripped && stripped !== t) {
        out.add(stripped);
        out.add(stripped.toLowerCase());
      }
    };
    add(base);
    for (const part of base.split(/[\/／|｜,，]/)) add(part);
    return [...out].filter((n) => n && n.length >= 1 && !/^[-~〜～./／\s]+$/.test(n));
  }

  function locateNeedle(src, needle) {
    const found = [];
    if (!src || !needle) return found;
    const n = String(needle).normalize("NFC");
    const srcLower = src.toLowerCase();
    const nLower = n.toLowerCase();

    let from = 0;
    while (from < src.length) {
      const idx = srcLower.indexOf(nLower, from);
      if (idx < 0) break;
      found.push({
        start: idx,
        end: idx + n.length,
        text: src.slice(idx, idx + n.length),
        needle: n,
      });
      from = idx + Math.max(1, n.length);
    }
    if (found.length) return found;

    // 忽略空白
    const map = [];
    let norm = "";
    for (let i = 0; i < src.length; i++) {
      if (/\s/.test(src[i])) continue;
      map.push(i);
      norm += src[i];
    }
    const normLower = norm.toLowerCase();
    const nNorm = n.replace(/\s+/g, "").toLowerCase();
    if (!nNorm) return found;
    from = 0;
    while (from <= normLower.length - nNorm.length) {
      const idx = normLower.indexOf(nNorm, from);
      if (idx < 0) break;
      const start = map[idx];
      const endChar = map[idx + nNorm.length - 1];
      if (start == null || endChar == null) break;
      found.push({
        start,
        end: endChar + 1,
        text: src.slice(start, endChar + 1),
        needle: n,
      });
      from = idx + nNorm.length;
    }
    return found;
  }

  /** 冠詞／介詞 span 不可吞掉後面的名詞（l'histoire → l'） */
  function clipGrammarLocation(src, item, loc) {
    if (!loc) return loc;
    const blob = `${item?.category || ""} ${item?.name || ""} ${item?.nameZh || ""}`;
    if (!/冠詞|介詞|代詞|否定|連詞|élision|省音/.test(blob)) return loc;
    const slice = String(loc.text || src.slice(loc.start, loc.end) || "");
    const elision = slice.match(/^([jnmtsldc]|qu)['’]/i);
    if (elision) {
      const end = loc.start + elision[0].length;
      return { ...loc, end, text: src.slice(loc.start, end) };
    }
    const m = slice.match(/^[A-Za-zÀ-ÿœæŒÆ']+/);
    if (m && m[0].length < slice.replace(/\s+$/, "").length) {
      const first = m[0];
      if (isLocalFunctionWord(first) || first.length <= 5) {
        const end = loc.start + first.length;
        return { ...loc, end, text: src.slice(loc.start, end) };
      }
    }
    return loc;
  }

  /** 在原文定位 API item 的 span / nameFr */
  function locateApiItemInText(src, item) {
    const needles = [];
    if (item?.span) needles.push(...expandNeedles(item.span));
    if (item?.nameFr) needles.push(...expandNeedles(item.nameFr));
    if (item?.nameKo) needles.push(...expandNeedles(item.nameKo));
    const p = parseBilingualTitle(item?.name || "");
    if (p.fr) needles.push(...expandNeedles(p.fr));

    // 長 needle 優先
    const uniq = [...new Set(needles)].sort((a, b) => b.length - a.length);
    const all = [];
    const seen = new Set();
    for (const n of uniq) {
      for (const loc of locateNeedle(src, n)) {
        const clipped = clipGrammarLocation(src, item, loc);
        const key = clipped.start + ":" + clipped.end;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(clipped);
      }
    }
    return all;
  }

  function create(input) {
    const rule = normalizeRule(input);
    rules = [rule, ...rules];
    Storage.saveRules(rules);
    return rule;
  }

  function update(id, input) {
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error("找不到規則：" + id);
    const rule = normalizeRule(input, rules[idx]);
    rules = rules.slice();
    rules[idx] = rule;
    Storage.saveRules(rules);
    return rule;
  }

  function remove(id) {
    const before = rules.length;
    rules = rules.filter((r) => r.id !== id);
    if (rules.length === before) return false;
    Storage.saveRules(rules);
    return true;
  }

  function matchEndingCell(form, cellValue) {
    const raw = String(cellValue || "").trim();
    if (!raw || !form) return false;
    const isSuffix = /^[-–—]/.test(raw);
    const cell = stripDash(raw);
    if (!cell) return false;
    if (isSuffix) {
      return form.endsWith(cell) && form.length > cell.length;
    }
    return fullFormEquals(raw, form);
  }

  function normalizeToken(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/[’‘‛′`]/g, "'");
  }

  function elisionProclitic(form) {
    const s = normalizeToken(form);
    const m = s.match(/^(j|n|m|t|s|l|d|c|qu|jusqu|lorsqu|puisqu)'(.+)$/i);
    if (!m) return null;
    return {
      short: m[1],
      withApos: m[1] + "'",
      full: ELISION_PREFIX[m[1]] || m[1],
      host: m[2],
    };
  }

  function elisionHost(form) {
    const pro = elisionProclitic(form);
    return pro ? pro.host : normalizeToken(form);
  }

  /**
   * 比對變體：n'ai → n'ai / ai / ne / n' / j'ai …
   */
  function expandMatchVariants(rawToken) {
    const full = normalizeToken(rawToken);
    if (!full) return [];

    const out = [];
    const push = (form, role, bonus = 0) => {
      if (!form) return;
      const f = normalizeToken(form);
      if (!f) return;
      if (out.some((x) => x.form === f && x.role === role)) return;
      out.push({ form: f, role, bonus });
    };

    push(full, "full", 8);

    const pro = elisionProclitic(full);
    if (pro) {
      push(pro.host, "host", 24);
      push(pro.withApos, "proclitic", 16);
      push(pro.short, "proclitic-short", 4);
      push(pro.full, "proclitic-full", 18);
      // 格子常寫 j'ai，句中卻是 n'ai
      push("j'" + pro.host, "recomposed-j", 12);
      push("n'" + pro.host, "recomposed-n", 8);
      if (pro.short === "c" || pro.short === "s") {
        push(pro.short + "'" + pro.host, "full", 8);
      }
    }
    // 裸詞（entre／aime／est）不可合成 n'entre：格子 n'ai ↔ ai 由 fullFormEquals 處理

    const an = Analyzer.normalize(full);
    if (an && an !== full) push(an, "analyzer", 6);

    return out;
  }

  /** 格子可填多個形式：pas|ne|n' */
  function expandCellForms(raw) {
    return String(raw || "")
      .split(/[|｜/／,，;；]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** ne / n / n' 視為同一否定小詞（不含 n'ai／n'entre：那些是動詞＋前綴） */
  function asNegParticle(s) {
    const t = normalizeToken(s);
    if (!t) return null;
    if (t === "ne" || t === "n" || t === "n'") return "ne";
    if (t === "pas") return "pas";
    return null;
  }

  function particlesEqual(a, b) {
    const pa = asNegParticle(a);
    const pb = asNegParticle(b);
    return Boolean(pa && pb && pa === pb);
  }

  /** j'ai ↔ n'ai ↔ ai 互通；ne ↔ n' ↔ n */
  function fullFormEquals(cellRaw, form) {
    const cell = normalizeToken(cellRaw);
    const f = normalizeToken(form);
    if (!cell || !f) return false;
    if (cell === f) return true;

    // 否定小詞互通
    if (particlesEqual(cell, f)) return true;

    const anCell = Analyzer.normalize(cell);
    const anForm = Analyzer.normalize(f);
    if (anCell && (anCell === f || anCell === anForm)) return true;

    const hCell = elisionHost(cell);
    const hForm = elisionHost(f);
    if (hCell === f || hForm === cell) return true;
    if (hCell === hForm && hCell.length >= 2) return true;

    // 格子 "j'ai" vs 變體 "ai"
    if (elisionProclitic(cell) && elisionHost(cell) === f) return true;
    if (elisionProclitic(f) && elisionHost(f) === cell) return true;

    // 格子 "n'" vs 變體 "ne"
    if ((cell === "n'" || cell === "n") && (f === "ne" || f === "n'" || f === "n")) return true;
    if ((f === "n'" || f === "n") && (cell === "ne" || cell === "n'" || cell === "n")) return true;

    return false;
  }

  function tokenize(text) {
    const src = String(text || "");
    const tokens = [];
    const re = /[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+)*/g;
    let last = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) {
        tokens.push({ text: src.slice(last, m.index), start: last, end: m.index, isWord: false });
      }
      tokens.push({
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
        isWord: true,
      });
      last = m.index + m[0].length;
    }
    if (last < src.length) {
      tokens.push({ text: src.slice(last), start: last, end: src.length, isWord: false });
    }
    return tokens;
  }

  /**
   * 省音命中時拆 span：n'ai + host → 只標 ai；proclitic → 只標 n'
   */
  function resolveHitSpan(tok, hitForm, role) {
    const raw = tok.text;
    const norm = normalizeToken(raw);
    const pro = elisionProclitic(norm);
    const apoInRaw = raw.search(/['’]/);

    if (pro && apoInRaw >= 0) {
      const isHostRole =
        role === "host" ||
        role === "analyzer" ||
        role === "recomposed-j" ||
        role === "recomposed-n" ||
        hitForm === pro.host ||
        fullFormEquals(hitForm, pro.host);

      const isProRole =
        role === "proclitic" ||
        role === "proclitic-short" ||
        role === "proclitic-full" ||
        hitForm === pro.withApos ||
        hitForm === pro.short ||
        hitForm === pro.full ||
        fullFormEquals(hitForm, pro.full) ||
        fullFormEquals(hitForm, pro.withApos);

      if (isHostRole && !isProRole) {
        return {
          text: raw.slice(apoInRaw + 1),
          start: tok.start + apoInRaw + 1,
          end: tok.end,
        };
      }
      if (isProRole && !isHostRole) {
        return {
          text: raw.slice(0, apoInRaw + 1),
          start: tok.start,
          end: tok.start + apoInRaw + 1,
        };
      }
    }

    return { text: raw, start: tok.start, end: tok.end };
  }

  /**
   * 本地自動標記允許的虛詞（整詞精確比對）
   * 不含動詞變位；避免 la/et 等子字串誤中
   */
  const LOCAL_FUNCTION_WORDS = new Set(
    [
      // 冠詞／縮合
      "le",
      "la",
      "les",
      "un",
      "une",
      "des",
      "du",
      "de",
      "au",
      "aux",
      "l",
      "l'",
      // 介詞
      "dans",
      "sur",
      "sous",
      "avec",
      "sans",
      "pour",
      "par",
      "chez",
      "entre",
      "vers",
      "devant",
      "derrière",
      "derriere",
      "après",
      "apres",
      "avant",
      "depuis",
      "pendant",
      "durant",
      "selon",
      "malgré",
      "malgre",
      "sauf",
      "excepté",
      "excepte",
      "contre",
      "jusque",
      "jusqu",
      "jusqu'",
      // 連詞
      "et",
      "ou",
      "mais",
      "donc",
      "or",
      "ni",
      "car",
      "que",
      "quand",
      "comme",
      "si",
      "lorsque",
      "puisque",
      "quoique",
      "parce",
      // 代詞／限定（常見小詞）
      "je",
      "tu",
      "il",
      "elle",
      "on",
      "nous",
      "vous",
      "ils",
      "elles",
      "me",
      "te",
      "se",
      "lui",
      "leur",
      "y",
      "en",
      "ce",
      "cet",
      "cette",
      "ces",
      "mon",
      "ton",
      "son",
      "ma",
      "ta",
      "sa",
      "mes",
      "tes",
      "ses",
      "notre",
      "votre",
      "nos",
      "vos",
      "leurs",
      "qui",
      "quoi",
      "dont",
      "où",
      // 否定小詞
      "ne",
      "pas",
      "n",
      "n'",
      "jamais",
      "rien",
      "plus",
      "personne",
      // 其他常見虛詞（勿放裸 "a"：會與 avoir 的 a 衝突）
      "à",
      "là",
    ].map((w) => w.normalize("NFC").toLowerCase())
  );

  /**
   * 虛詞整詞才擋通則。j'aime／m'appelle／n'habite 的宿主是動詞，不擋「現在時（-er présent）」。
   * entre／pas／le 仍擋。
   */
  function spanBlocksSharedEndingRule(spanTok) {
    const tok = firstSpanToken(spanTok);
    if (!tok || !isLocalFunctionWord(tok)) return false;
    const pro = elisionProclitic(normalizeToken(tok));
    if (pro && pro.host && !LOCAL_FUNCTION_WORDS.has(normalizeToken(pro.host))) return false;
    return true;
  }

  function isLocalFunctionWord(raw) {
    const f = normalizeToken(raw);
    if (!f) return false;
    if (LOCAL_FUNCTION_WORDS.has(f)) return true;
    // 省音前綴：l' / n' / j' 等整段
    const pro = elisionProclitic(f);
    if (pro) {
      if (LOCAL_FUNCTION_WORDS.has(pro.withApos) || LOCAL_FUNCTION_WORDS.has(pro.short)) return true;
      // l'eau 的 l' 是冠詞；但 host 是實詞 → 僅 proclitic 段算虛詞（由 resolveHitSpan 處理）
      if (["l", "n", "j", "m", "t", "s", "d", "c"].includes(pro.short)) return true;
    }
    return false;
  }

  /** 規則是否屬動詞變位／時態通則（本地自動標記時略過） */
  function isVerbConjugationRuleForLocal(rule) {
    if (!rule) return false;
    if (isGeneralEndingRule(rule)) return true;
    const cat = String(rule.category || "").trim();
    if (cat === "變位" || cat === "時態") return true;
    if (ruleHasPersons(rule) && hasAnyEnding(rule.endings)) {
      // 六格有內容 → 當變位卡（即使也有 keywords）
      // 例外：否定種子可能 has_persons false
      return true;
    }
    const title = String(rule.title || "");
    if (/變位|imparfait|présent|futur|subjonctif|conjug|第一組|第二組|第三組|動詞.*時|時.*動詞/.test(title)) {
      // 標題像變位，且不是純虛詞規則
      const kws = (rule.keywords || []).map((k) => normalizeToken(k));
      const onlyFw = kws.length > 0 && kws.every((k) => isLocalFunctionWord(k));
      if (!onlyFw) return true;
    }
    return false;
  }

  /**
   * 關鍵詞是否可作本地虛詞命中（整詞精確；禁止子字串）
   */
  function keywordExactFunctionMatch(kwRaw, form) {
    const formN = normalizeToken(form);
    if (!formN) return false;
    for (const raw of expandCellForms(kwRaw)) {
      const kn = normalizeToken(raw);
      if (!kn) continue;
      // 必須整詞相等（或否定小詞互通 ne/n/n'）
      if (kn === formN || particlesEqual(raw, form)) {
        if (!isLocalFunctionWord(kn) && !isLocalFunctionWord(formN) && !particlesEqual(raw, form)) {
          continue;
        }
        // 表單側關鍵詞也應是虛詞（避免規則 keywords 塞了 parler 等）
        if (!isLocalFunctionWord(kn) && !particlesEqual(raw, form)) continue;
        return true;
      }
    }
    return false;
  }

  /**
   * @param {string} rawToken
   * @param {{ sentenceMode?: boolean, functionWordsOnly?: boolean }} opts
   *   functionWordsOnly / sentenceMode：本地自動標記 — 僅虛詞精確命中，不做動詞詞尾
   */
  function matchTokenToRules(rawToken, { sentenceMode = false, functionWordsOnly = false } = {}) {
    const full = normalizeToken(rawToken);
    if (!full) return [];

    // 本地自動掃描：虛詞 only（整句與單詞一致）
    const fwOnly = Boolean(functionWordsOnly || sentenceMode);

    // 虛詞模式：token 本身不是虛詞 → 直接不比對（省效能、避誤中）
    // 例外：n'ai 等省音 — proclitic 段仍可能是 ne
    if (fwOnly) {
      const pro = elisionProclitic(full);
      const tokenIsFw = isLocalFunctionWord(full) || (pro && isLocalFunctionWord(pro.short));
      if (!tokenIsFw) return [];
    }

    const variants = expandMatchVariants(rawToken);
    const candidates = [];

    for (const { form, role, bonus } of variants) {
      // 虛詞模式只接受 full／proclitic 角色，避免 host「ai」去套 avoir
      if (fwOnly) {
        if (role === "host" || role === "recomposed-j" || role === "recomposed-n" || role === "analyzer") {
          continue;
        }
        if (!isLocalFunctionWord(form) && !particlesEqual(form, "ne") && !particlesEqual(form, "pas")) {
          continue;
        }
      }

      for (const rule of rules) {
        // 本地自動：略過動詞變位／時態規則
        if (fwOnly && isVerbConjugationRuleForLocal(rule)) continue;

        const hitPersons = [];
        let bestEndLen = 0;
        let keywordHit = null;

        // 1) 關鍵詞（一般文法，如 ne…pas、dans、et）
        for (const kw of rule.keywords || []) {
          if (fwOnly) {
            if (keywordExactFunctionMatch(kw, form)) {
              keywordHit = expandCellForms(kw)[0] || kw;
              bestEndLen = Math.max(bestEndLen, normalizeToken(keywordHit).length);
            }
          } else {
            for (const raw of expandCellForms(kw)) {
              if (
                fullFormEquals(raw, form) ||
                particlesEqual(raw, form) ||
                normalizeToken(raw) === form
              ) {
                keywordHit = raw;
                bestEndLen = Math.max(bestEndLen, raw.length);
              }
            }
          }
        }

        // 2) 六人稱格子（動詞變位）— 本地虛詞模式完全不做
        if (!fwOnly && (ruleHasPersons(rule) || hasAnyEnding(rule.endings))) {
          for (const { key, label } of PERSONS) {
            const val = rule.endings?.[key] || "";
            const pieces = expandCellForms(val);
            if (!pieces.length) continue;

            for (const raw of pieces) {
              const isSuffix = /^[-–—]/.test(raw);
              const cell = stripDash(raw);
              if (!cell && raw !== "n'" && raw !== "n") continue;

              if (!isSuffix) {
                if (
                  fullFormEquals(raw, form) ||
                  fullFormEquals(cell || raw, form) ||
                  particlesEqual(raw, form)
                ) {
                  hitPersons.push({ key, label, value: val, kind: "form", role });
                  bestEndLen = Math.max(bestEndLen, Math.max((cell || raw).length, form.length));
                }
              } else if (cell && form.endsWith(cell) && form.length > cell.length) {
                // 黑名單：jamais 等不套詞尾規則（完整形式仍可中）
                if (isSuffixBlocked(form) || isSuffixBlocked(full)) continue;
                // 不規則動詞：禁止被「通則詞尾」吞掉，必須另立專屬規則（完整形命中才算）
                if (typeof Analyzer !== "undefined" && Analyzer.lookupIrregular) {
                  const irreg = Analyzer.lookupIrregular(form);
                  if (irreg && irreg.infinitive && !ruleMentionsVerb(rule, irreg.infinitive)) {
                    continue;
                  }
                }
                if (sentenceMode) {
                  const noisy = new Set(["e", "es", "s", "t", "a", "as", "ai", "ez", "ent", "ant"]);
                  if (noisy.has(cell)) continue;
                  const isParticiple = /^[éèiîuû]$/i.test(cell);
                  if (isParticiple) {
                    if (form.length < 5) continue;
                  } else if (cell.length < 3) {
                    continue;
                  }
                }
                if (form.length - cell.length < 2) continue;
                if (role === "proclitic" || role === "proclitic-short" || role === "proclitic-full") {
                  continue;
                }
                hitPersons.push({ key, label, value: val, kind: "ending", role });
                bestEndLen = Math.max(bestEndLen, cell.length);
              }
            }
          }
        }

        // 虛詞模式：也允許非變位規則把虛詞寫在 endings 完整形（少見），僅精確全等
        if (
          fwOnly &&
          !keywordHit &&
          !isVerbConjugationRuleForLocal(rule) &&
          (ruleHasPersons(rule) || hasAnyEnding(rule.endings))
        ) {
          for (const { key, label } of PERSONS) {
            for (const raw of expandCellForms(rule.endings?.[key] || "")) {
              if (/^[-–—]/.test(raw)) continue; // 詞尾一律不套
              const cell = stripDash(raw);
              if (cell && normalizeToken(cell) === form && isLocalFunctionWord(form)) {
                hitPersons.push({ key, label, value: raw, kind: "form", role });
                bestEndLen = Math.max(bestEndLen, cell.length);
              }
            }
          }
        }

        if (!hitPersons.length && !keywordHit) continue;
        if (keywordHit && !hitPersons.length) {
          hitPersons.push({
            key: "kw",
            label: "關鍵詞",
            value: keywordHit,
            kind: "form",
            role,
          });
        }

        const formHits = hitPersons.filter((h) => h.kind === "form");
        const usePersons = formHits.length ? formHits : hitPersons;
        const matchType = formHits.length ? "form" : "ending";

        // 虛詞模式不接受 ending
        if (fwOnly && matchType !== "form") continue;

        const roleBoost =
          role === "host"
            ? 35
            : role === "proclitic-full" || role === "proclitic"
              ? 20
              : role === "recomposed-j"
                ? 15
                : bonus;

        const score =
          (matchType === "form" ? 1000 : 100) +
          bestEndLen * 10 +
          form.length +
          (fwOnly ? 0 : roleBoost) +
          (form === full ? 5 : 0);

        candidates.push({
          rule,
          matchType,
          hitPersons: usePersons,
          score,
          form,
          role,
          token: rawToken,
        });
      }
    }

    const byRule = new Map();
    for (const c of candidates) {
      const prev = byRule.get(c.rule.id);
      if (!prev || c.score > prev.score) byRule.set(c.rule.id, c);
    }

    const list = Array.from(byRule.values()).sort((a, b) => b.score - a.score);
    if (!list.length) return [];

    if (sentenceMode || fwOnly) {
      const forms = list.filter((c) => c.matchType === "form");
      if (forms.length) {
        const top = forms[0].score;
        return forms.filter((c) => c.score >= top - 100).slice(0, 4);
      }
      return [];
    }

    return list;
  }

  /**
   * 偵測 ne…pas / n'…pas 句型，強制標註否定規則
   */
  function findNegationRule() {
    return (
      rules.find((r) => r.id === "seed-negation-ne-pas") ||
      rules.find((r) => /ne\s*\.{0,3}\s*pas|否定/.test(r.title || "")) ||
      rules.find((r) => {
        const blob = [...(r.keywords || []), ...Object.values(r.endings || {})]
          .join(" ")
          .toLowerCase();
        return blob.includes("pas") && (blob.includes("ne") || blob.includes("n'"));
      }) ||
      null
    );
  }

  function applyNegationPattern(wordTokens, addHit) {
    const negRule = findNegationRule();
    if (!negRule || !wordTokens.length) return;

    const neLike = [];
    const pasLike = [];

    for (const tok of wordTokens) {
      const n = normalizeToken(tok.text);
      const pro = elisionProclitic(n);
      if (n === "pas") {
        pasLike.push(tok);
        continue;
      }
      if (n === "ne" || n === "n" || n === "n'") {
        neLike.push({ tok, role: "proclitic-full", form: n === "pas" ? "pas" : "ne" });
        continue;
      }
      // n'ai / n'est / n'habite…
      if (pro && pro.short === "n") {
        neLike.push({ tok, role: "proclitic", form: "n'" });
      }
    }

    // 需同時有 pas，以及 ne 或 n'…
    if (!pasLike.length || !neLike.length) return;

    for (const { tok, role, form } of neLike) {
      addHit(tok, {
        rule: negRule,
        matchType: "form",
        hitPersons: [{ key: "il", label: "il / elle / on", value: "n'", kind: "form", role }],
        score: 1200,
        form,
        role,
        token: tok.text,
      });
    }
    for (const tok of pasLike) {
      addHit(tok, {
        rule: negRule,
        matchType: "form",
        hitPersons: [{ key: "je", label: "je", value: "pas", kind: "form", role: "full" }],
        score: 1200,
        form: "pas",
        role: "full",
        token: tok.text,
      });
    }
  }

  function searchByForm(rawForm) {
    const form = Analyzer.normalize(rawForm);
    if (!form && !normalizeToken(rawForm)) {
      return {
        mode: "single",
        query: rawForm || "",
        form: "",
        matches: [],
        partial: [],
        spans: [],
        legend: [],
      };
    }

    // 本地自動：僅虛詞精確命中，不做動詞變位詞尾
    const hits = matchTokenToRules(rawForm, {
      sentenceMode: false,
      functionWordsOnly: true,
    });
    const exact = hits.map((h) => ({
      rule: h.rule,
      matchType: h.matchType,
      hitPersons: h.hitPersons,
      score: h.score,
      spans: [{ text: rawForm, form: h.form }],
    }));

    const partial = [];
    const q = form || normalizeToken(rawForm);
    // 短虛詞不做「說明文字包含」模糊推薦，避免 et/la 刷出無關卡
    if (q && q.length >= 4 && !isLocalFunctionWord(q)) {
      for (const rule of rules) {
        if (exact.some((m) => m.rule.id === rule.id)) continue;
        if (isVerbConjugationRuleForLocal(rule)) continue;
        const blob = [
          rule.title,
          rule.explanation,
          ...(rule.keywords || []),
          ...Object.values(rule.endings || {}),
        ]
          .join(" ")
          .toLowerCase();
        if (blob.includes(q)) {
          partial.push({
            rule,
            matchType: "text",
            hitPersons: [],
            score: 40,
            spans: [],
          });
        }
      }
    }

    exact.sort((a, b) => b.score - a.score);
    partial.sort((a, b) => b.score - a.score);

    return {
      mode: "single",
      query: rawForm,
      form: q,
      matches: exact,
      partial: partial.slice(0, 8),
      analysis: Analyzer.analyze(q),
      spans: exact.length
        ? [
            {
              text: String(rawForm).trim(),
              start: 0,
              end: String(rawForm).trim().length,
              ruleId: exact[0].rule.id,
              colorIndex: 0,
            },
          ]
        : [],
      legend: exact.slice(0, 8).map((m, i) => ({
        ruleId: m.rule.id,
        title: m.rule.title,
        colorIndex: i,
      })),
    };
  }

  function searchSentence(rawText) {
    const query = String(rawText || "");
    const tokens = tokenize(query);
    const wordTokens = tokens.filter((t) => t.isWord);

    if (wordTokens.length === 0) {
      return searchByForm(query.trim());
    }
    // 單一詞且無撇號 → 單詞模式；有撇號（n'ai）仍走整句拆解
    if (wordTokens.length === 1 && !/['’]/.test(wordTokens[0].text)) {
      return searchByForm(query.trim());
    }

    const ruleMap = new Map();
    const rawSpans = [];

    function addHit(tok, h) {
      const role = h.role || "full";
      const piece = resolveHitSpan(tok, h.form, role);
      const span = {
        text: piece.text,
        start: piece.start,
        end: piece.end,
        form: h.form,
        hitPersons: h.hitPersons,
        matchType: h.matchType,
        ruleId: h.rule.id,
        score: h.score,
        role,
      };

      const existing = ruleMap.get(h.rule.id);
      if (!existing) {
        ruleMap.set(h.rule.id, {
          rule: h.rule,
          matchType: h.matchType,
          hitPersons: h.hitPersons.slice(),
          score: h.score,
          spans: [span],
        });
      } else {
        existing.spans.push(span);
        existing.score = Math.max(existing.score, h.score);
        const seen = new Set(existing.hitPersons.map((p) => p.key + "|" + p.value));
        for (const p of h.hitPersons) {
          const k = p.key + "|" + p.value;
          if (!seen.has(k)) {
            existing.hitPersons.push(p);
            seen.add(k);
          }
        }
      }
      rawSpans.push(span);
    }

    for (const tok of wordTokens) {
      const hits = matchTokenToRules(tok.text, { sentenceMode: true });
      for (const h of hits) addHit(tok, h);
    }

    // 句型：ne / n'… + pas → 強制掛上否定規則（解決 n'ai 只命中 avoir 的情況）
    applyNegationPattern(wordTokens, addHit);

    // 較短片段優先（n' / ai 優於整段 n'ai）
    const sorted = rawSpans.slice().sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      const la = a.end - a.start;
      const lb = b.end - b.start;
      if (la !== lb) return la - lb;
      return (b.score || 0) - (a.score || 0);
    });

    const spans = [];
    for (const sp of sorted) {
      if (spans.some((s) => s.start === sp.start && s.end === sp.end && s.ruleId === sp.ruleId)) {
        continue;
      }

      const sameRange = spans.find((s) => s.start === sp.start && s.end === sp.end);
      if (sameRange) {
        if ((sp.score || 0) > (sameRange.score || 0)) {
          const idx = spans.indexOf(sameRange);
          spans[idx] = { ...sp };
        }
        continue;
      }

      // 相鄰不重疊可並存；交叉則留高分
      const conflict = spans.find((s) => sp.start < s.end && sp.end > s.start);
      if (conflict) {
        const aContainsB = sp.start <= conflict.start && sp.end >= conflict.end;
        const bContainsA = conflict.start <= sp.start && conflict.end >= sp.end;
        if (aContainsB) {
          // 新片段較大：若已有較短精確片段，跳過大片段
          continue;
        }
        if (bContainsA) {
          // 新片段較小、更精確：可加入
        } else {
          // 真正交叉
          if ((sp.score || 0) <= (conflict.score || 0)) continue;
          const i = spans.indexOf(conflict);
          if (i >= 0) spans.splice(i, 1);
        }
      }

      spans.push({ ...sp });
    }

    spans.sort((a, b) => a.start - b.start);

    const appearance = [];
    for (const sp of spans) {
      if (!appearance.includes(sp.ruleId)) appearance.push(sp.ruleId);
    }
    const colorOf = new Map(appearance.map((id, i) => [id, i % 8]));
    for (const sp of spans) {
      sp.colorIndex = colorOf.get(sp.ruleId) ?? 0;
    }

    const matches = appearance
      .map((id) => {
        const m = ruleMap.get(id);
        if (!m) return null;
        return { ...m, colorIndex: colorOf.get(id) ?? 0 };
      })
      .filter(Boolean);

    const legend = matches.map((m) => ({
      ruleId: m.rule.id,
      title: m.rule.title,
      colorIndex: m.colorIndex,
      count: m.spans.length,
    }));

    return {
      mode: "sentence",
      query,
      form: query,
      tokens,
      spans,
      matches,
      partial: [],
      legend,
      analysis: null,
    };
  }

  /**
   * 是否為多詞／整句查詢
   */
  function isMultiWordQuery(rawQuery) {
    const text = String(rawQuery || "").trim();
    if (!text) return false;
    const words = tokenize(text).filter((t) => t.isWord);
    // 兩個以上詞；或明顯句號／問號等（整句）
    if (words.length > 1) return true;
    if (/[.!?…。？！]/.test(text) && words.length >= 1) return true;
    return false;
  }

  /**
   * 選字套用／歷史還原：單詞 → searchByForm；整句 → searchSentence
   * 自動標記策略：僅虛詞（la/et/dans/ne…pas…）整詞精確命中；不做動詞變位詞尾
   */
  function search(rawQuery) {
    const text = String(rawQuery || "").trim();
    if (!text) {
      return {
        mode: "single",
        query: "",
        form: "",
        matches: [],
        partial: [],
        spans: [],
        legend: [],
      };
    }
    if (isMultiWordQuery(text)) {
      return searchSentence(text);
    }
    return searchByForm(text);
  }

  function filterList(query) {
    const q = (query || "").trim().toLowerCase();
    return getAll().filter((rule) => {
      if (!q) return true;
      const blob = [
        rule.title,
        rule.category,
        rule.explanation,
        ...(rule.keywords || []),
        ...Object.values(rule.endings || {}),
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }

  /** 內建關鍵種子（file:// 無法 fetch 時仍可用） */
  const BUILTIN_SEEDS = [
    {
      id: "seed-avoir-present",
      title: "avoir 直陳式現在時（助動詞）",
      explanation:
        "avoir 現在時常用作 passé composé 助動詞。je 在元音前常寫成 j'ai；否定時 ne 省音為 n'ai pas。",
      endings: { je: "ai|j'ai|n'ai", tu: "as|n'as", il: "a|n'a", nous: "avons", vous: "avez", ils: "ont" },
    },
    {
      id: "seed-negation-ne-pas",
      title: "否定 ne … pas",
      explanation:
        "一般否定：ne + 動詞 + pas。動詞以元音或啞音 h 開頭時 ne 省音為 n'（如 n'ai、n'est）。",
      has_persons: false,
      keywords: ["pas", "ne", "n'", "n"],
      endings: { je: "", tu: "", il: "", nous: "", vous: "", ils: "" },
    },
    {
      id: "seed-pp-er",
      title: "過去分詞（-é）",
      explanation: "規則 -er 動詞過去分詞去 -er 加 -é（déjeuner → déjeuné）。",
      endings: { je: "-é", tu: "-é", il: "-é", nous: "-é", vous: "-é", ils: "-é" },
    },
  ];

  async function init() {
    const loaded = await Storage.initWithSeed();
    rules = (loaded || []).map((r) => {
      const n = normalizeRule(r, r);
      n.updated_at = r.updated_at || n.updated_at;
      n.created_at = r.created_at || n.created_at;
      return n;
    });
    // 合併新種子（fetch + 內建後備）
    await mergeMissingSeeds();
    ensureBuiltinSeeds();
    Storage.saveRules(rules);
    return rules;
  }

  function ensureBuiltinSeeds() {
    const have = new Set(rules.map((r) => r.id));
    for (const s of BUILTIN_SEEDS) {
      if (!have.has(s.id)) {
        const n = normalizeRule(s, s);
        n.created_at = s.created_at || n.created_at;
        n.updated_at = s.updated_at || n.updated_at;
        rules.push(n);
        have.add(s.id);
      } else {
        // 已存在則補上 endings 別名（不覆蓋使用者自訂 title/explanation，只合併空缺格的多形式）
        const idx = rules.findIndex((r) => r.id === s.id);
        if (idx < 0) continue;
        const cur = rules[idx];
        if (s.id === "seed-negation-ne-pas") {
          const kws = normalizeKeywords([
            ...(cur.keywords || []),
            "pas",
            "ne",
            "n'",
            "n",
            ...Object.values(cur.endings || {}),
          ]);
          rules[idx] = {
            ...cur,
            has_persons: false,
            keywords: kws,
            endings: emptyEndings(),
          };
        }
        if (s.id === "seed-avoir-present") {
          rules[idx] = {
            ...cur,
            endings: {
              je: mergeAlias(cur.endings?.je, "ai|j'ai|n'ai"),
              tu: mergeAlias(cur.endings?.tu, "as|n'as"),
              il: mergeAlias(cur.endings?.il, "a|n'a"),
              nous: cur.endings?.nous || "avons",
              vous: cur.endings?.vous || "avez",
              ils: cur.endings?.ils || "ont",
            },
          };
        }
      }
    }
  }

  function mergeAlias(existing, aliases) {
    const set = new Set([
      ...expandCellForms(existing || ""),
      ...expandCellForms(aliases || ""),
    ]);
    return Array.from(set).filter(Boolean).join("|");
  }

  async function mergeMissingSeeds() {
    try {
      const res = await fetch("data/seed-rules.json");
      if (!res.ok) return;
      const seed = await res.json();
      if (!Array.isArray(seed)) return;
      const have = new Set(rules.map((r) => r.id));
      for (const s of seed) {
        if (s && s.id && !have.has(s.id)) {
          rules.push(normalizeRule(s, s));
          have.add(s.id);
        }
      }
    } catch {
      /* file:// 可能失敗，改走 BUILTIN_SEEDS */
    }
  }

  return {
    PERSONS,
    CATEGORIES,
    SUPPLEMENTARY_CATEGORY,
    isPronounGrammar,
    isSupplementaryUsage,
    emptyEndings,
    init,
    setAll,
    getAll,
    getById,
    create,
    update,
    remove,
    search,
    searchByForm,
    searchSentence,
    isMultiWordQuery,
    tokenize,
    filterList,
    normalizeRule,
    stripDash,
    matchEndingCell,
    expandMatchVariants,
    fullFormEquals,
    ruleHasPersons,
    normalizeKeywords,
    isSuffixBlocked,
    normalizeToken,
    parseBilingualTitle,
    titleKeys,
    findMatchingRule,
    findInventoryRule,
    attachLocalRulesToInventory,
    extractNamedInfinitive,
    ruleNamedInfinitive,
    locateApiItemInText,
    locateNeedle,
    expandNeedles,
    ruleMentionsVerb,
    isGeneralEndingRule,
    rankRulesForSpan,
  };

  /** 規則是否與形容詞文法相關（勿用過寬的「修飾」以免冠詞誤中） */
  function ruleIsAdjectiveRelated(rule) {
    const title = String(rule?.title || "").toLowerCase().normalize("NFC");
    const cat = String(rule?.category || "").toLowerCase().normalize("NFC");
    const blob = [title, cat, rule?.explanation || "", ...(rule?.keywords || [])]
      .join("\n")
      .toLowerCase()
      .normalize("NFC");
    // 標題／分類明確是冠詞／代詞 → 不算形容詞卡
    if (/冠詞|article|代詞|pronoun|介詞|préposition/.test(title) || /冠詞|代詞|介詞/.test(cat)) {
      return false;
    }
    return /形容詞|adjectif|\badj\b|性數配合|陰陽配合|accord de l'adj|比較級|最高級|antepos|antépos|postpos|beau|nouveau|vieux|bel|vieil|主有形容|指示形容|品質形容/.test(
      blob
    );
  }

  /** 規則是否偏動詞變位／時態（選形容詞時應降權） */
  function ruleIsVerbConjugationHeavy(rule) {
    if (ruleIsAdjectiveRelated(rule)) return false;
    const cat = String(rule?.category || "");
    if (cat === "變位" || cat === "時態") return true;
    if (ruleHasPersons(rule) && hasAnyEnding(rule?.endings)) return true;
    const title = String(rule?.title || "").toLowerCase();
    return /變位|imparfait|présent|futur|subjonctif|passé|動詞|conjug|infinitif|分詞.*動詞|第一組|第二組|第三組/.test(
      title
    );
  }

  /**
   * 選定「動詞」時應排除的非動詞規則（冠詞／代詞／介詞／純形容詞通則等）
   */
  function ruleIsNonVerbGrammar(rule) {
    if (!rule) return false;
    if (ruleIsVerbConjugationHeavy(rule)) return false;
    if (ruleLooksInfinitiveRelated(rule)) return false;
    const cat = String(rule?.category || "").trim();
    if (/^(冠詞|代詞|介詞|句型|否定)$/.test(cat)) return true;
    const title = String(rule?.title || "");
    if (
      /冠詞|article|定冠|不定冠|部分冠|du\b|des\b|代詞|pronoun|人稱代|關係代|介詞|préposition|\bprép\b|主有形容|指示形容|數量詞|數詞|negation|否定|ne\s*[.…]*\s*pas|ne…pas/i.test(
        title
      )
    ) {
      // 否定 ne…pas 常跟動詞一起學，但選「單一變位形」時不應壓過變位卡
      return true;
    }
    // 純形容詞配合／無動詞訊號
    if (ruleIsAdjectiveRelated(rule) && !ruleHasPersons(rule)) return true;
    return false;
  }

  /** 動詞剖面是否足夠可信，可啟用「排除非動詞規則」 */
  function verbProfileIsConfident(vp) {
    if (!vp) return false;
    if (vp.irregular || vp.irregForm) return true;
    if (vp.isInfinitive && vp.infinitive) return true;
    if (vp.pos && posLooksLikeVerb(vp.pos)) return true;
    if (vp.infinitive && looksLikeInfinitiveOrthography(vp.infinitive) && !vp.isInfinitive) {
      // 變位形 + 已知原形（如 remue ← remuer）
      return true;
    }
    if (vp.tense && vp.groupCode) return true;
    if (vp.hasVocabCard && vp.infinitive) return true;
    return false;
  }

  /**
   * 推估選取字是否像形容詞
   * @param {string} sel
   * @param {{ pos?: string, gender?: string, vocab?: object[], lemma?: string, verbProfile?: object }} hints
   */
  function selectionLooksLikeAdjective(sel, hints = {}) {
    // 已判定為動詞 → 絕不當形容詞（remue 的 -ue 曾誤中）
    if (hints.verbProfile && verbProfileIsConfident(hints.verbProfile)) {
      return { yes: false, reason: "" };
    }
    const pos = String(hints.pos || "").trim();
    if (/動詞|verb/i.test(pos)) return { yes: false, reason: "" };
    if (/形容詞|adjectif|adj/i.test(pos)) return { yes: true, reason: "詞性：形容詞" };

    const list = Array.isArray(hints.vocab) ? hints.vocab : [];
    const selN = normalizeToken(sel);
    const lemmaHint = normalizeToken(hints.lemma || hints.verbProfile?.lemma || "");
    // 原形是 -er/-ir 動詞且選取≠原形 → 變位，非形容詞
    if (
      lemmaHint &&
      lemmaHint !== selN &&
      looksLikeInfinitiveOrthography(lemmaHint)
    ) {
      return { yes: false, reason: "" };
    }

    for (const w of list) {
      const surf = normalizeToken(w.surface || w.s);
      const lem = normalizeToken(w.lemma || w.l);
      if (surf === selN || lem === selN) {
        if (/動詞|verb/i.test(String(w.pos || w.p || ""))) {
          return { yes: false, reason: "" };
        }
        if (/形容詞|adjectif|adj/i.test(String(w.pos || w.p || ""))) {
          return { yes: true, reason: "API 詞彙：形容詞" };
        }
        // 單字卡 lemma 為不定詞且 surface 不同
        if (lem && lem !== selN && looksLikeInfinitiveOrthography(lem)) {
          return { yes: false, reason: "" };
        }
      }
    }

    const s = String(sel || "").trim().normalize("NFC");
    if (!s || s.length < 2) return { yes: false, reason: "" };
    // 常見形容詞詞尾（勿含裸 -u/-ue：remue/salue 等第一組變位會誤中）
    if (
      /(?:euse|euses|ique|iques|able|ables|ible|ibles|aire|aires|ive|ives|elle|elles|enne|ennes|esse|esses|ales|aux|euses|oise|aises?|ienne)$/i.test(
        s
      ) &&
      !/(?:er|ir|re|oir)$/i.test(s)
    ) {
      return { yes: true, reason: "形似形容詞詞尾" };
    }
    // 已有性別標記的詞彙（盤點 r）掛在同表面
    for (const w of list) {
      const surf = normalizeToken(w.surface || w.s);
      if (surf === selN && (w.gender || w.r) && !/動詞/.test(String(w.pos || ""))) {
        const g = String(w.gender || w.r || "");
        if (/m|f|陽|陰|mf/i.test(g) && !/動詞/.test(String(w.pos || ""))) {
          if (/名詞|noun/i.test(String(w.pos || ""))) return { yes: false, reason: "" };
          if (/形容|adj/i.test(String(w.pos || ""))) {
            return { yes: true, reason: "API 詞彙：形容詞" };
          }
        }
      }
    }
    return { yes: false, reason: "" };
  }

  /** 字串是否像法語不定詞形態（-er/-ir/-re/-oir 等） */
  function looksLikeInfinitiveOrthography(raw) {
    const s = normalizeToken(raw).replace(/^s['']/, "");
    if (!s || s.length < 2) return false;
    if (/^(être|etre|avoir|aller|faire|dire|voir|pouvoir|vouloir|devoir|savoir|falloir)$/i.test(s))
      return true;
    return /(?:er|ir|re|oir)$/i.test(s);
  }

  /**
   * 從本句 vocab／單字庫對到選取字的「單字卡」
   * 優先：surface 全等 → lemma 全等 → 區間重疊
   * @returns {null | { surface, lemma, pos, gender, verbGroup, phonetic, source }}
   */
  function resolveSelectionVocabCard(sel, opts = {}) {
    const selN = normalizeToken(sel);
    if (!selN) return null;
    const list = Array.isArray(opts.vocab) ? opts.vocab : [];
    const selStart = Number(opts.selStart);
    const selEnd = Number(opts.selEnd);
    const hasRange =
      Number.isFinite(selStart) && Number.isFinite(selEnd) && selEnd > selStart;

    let best = null;
    let bestScore = -1;
    for (const w of list) {
      if (!w || typeof w !== "object") continue;
      const surf = normalizeToken(w.surface || w.s);
      const lem = normalizeToken(w.lemma || w.l);
      let sc = 0;
      if (surf && surf === selN) sc = 100;
      else if (lem && lem === selN) sc = 85;
      else if (surf && selN.length >= 3 && (surf.startsWith(selN) || selN.startsWith(surf))) sc = 40;
      if (hasRange) {
        const a = Number(w.start ?? w.a);
        const b = Number(w.end ?? w.b);
        if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
          const lo = Math.max(selStart, a);
          const hi = Math.min(selEnd, b);
          if (hi > lo) sc = Math.max(sc, 70 + Math.round((50 * (hi - lo)) / (selEnd - selStart)));
        }
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = w;
      }
    }
    if (best && bestScore >= 40) {
      return {
        surface: String(best.surface || best.s || sel).trim(),
        lemma: String(best.lemma || best.l || "").trim(),
        pos: String(best.pos || best.p || opts.pos || "").trim(),
        gender: String(best.gender || best.r || opts.gender || "").trim(),
        verbGroup: String(best.verbGroup || best.vg || "").trim(),
        phonetic: String(best.phonetic || best.ipa || best.ip || "").trim(),
        source: best.fromBank || best.source === "local-bank" ? "bank" : "vocab",
        score: bestScore,
      };
    }

    // 外層已帶 lemma（selectionVocabHints）
    const optLemma = String(opts.lemma || "").trim();
    if (optLemma) {
      return {
        surface: String(opts.surface || sel).trim(),
        lemma: optLemma,
        pos: String(opts.pos || "").trim(),
        gender: String(opts.gender || "").trim(),
        verbGroup: String(opts.verbGroup || opts.vg || "").trim(),
        phonetic: "",
        source: "hint",
        score: 90,
      };
    }

    // 全域單字庫
    if (typeof Storage !== "undefined" && Storage.lookupVocabBank) {
      const hit = Storage.lookupVocabBank(sel);
      if (hit && (hit.lemma || hit.gloss)) {
        return {
          surface: String(hit.surface || sel).trim(),
          lemma: String(hit.lemma || "").trim(),
          pos: String(hit.pos || "").trim(),
          gender: String(hit.gender || "").trim(),
          verbGroup: String(hit.verbGroup || "").trim(),
          phonetic: String(hit.phonetic || "").trim(),
          source: "bank",
          score: 80,
        };
      }
    }
    return null;
  }

  function posLooksLikeVerb(pos) {
    return /動詞|verb|v\./i.test(String(pos || ""));
  }

  /**
   * 動詞剖面：結合單字卡原形（lemma）判斷不定式，再疊不規則／時態／組別
   * @returns {null | object}
   */
  function buildVerbProfile(sel, opts = {}) {
    const form = String(sel || "").trim();
    if (!form || form.length < 2) return null;
    if (selectionIsFragileSpan(normalizeToken(form), form)) return null;

    const card = resolveSelectionVocabCard(form, opts);
    const lemmaFromCard = card?.lemma ? normalizeToken(card.lemma) : "";
    const surfaceN = normalizeToken(card?.surface || form);
    const formN = normalizeToken(form);

    const irregForm =
      typeof Analyzer !== "undefined" && Analyzer.lookupIrregular
        ? Analyzer.lookupIrregular(form)
        : null;
    const analysis =
      typeof Analyzer !== "undefined" && Analyzer.analyze ? Analyzer.analyze(form) : null;
    const primary = analysis?.primary || null;

    let infinitive =
      lemmaFromCard ||
      (irregForm && irregForm.infinitive) ||
      (primary?.infinitive && primary.infinitive !== "?" ? primary.infinitive : "") ||
      "";
    infinitive = String(infinitive || "")
      .trim()
      .toLowerCase()
      .normalize("NFC");

    const irregInf =
      infinitive &&
      typeof Analyzer !== "undefined" &&
      Analyzer.isIrregularInfinitive &&
      Analyzer.isIrregularInfinitive(infinitive);
    const irregular = Boolean(irregForm || irregInf || primary?.irregular);

    // —— 不定式：優先「表面形 === 單字卡原形」——
    // 例：卡 surface=parler lemma=parler → 不定式
    //     surface=pouvais lemma=pouvoir → 非不定式（變位）
    let isInfinitive = false;
    let infReason = "";
    let infConfidence = "none";

    if (lemmaFromCard) {
      const lemmaIsInfShape = looksLikeInfinitiveOrthography(lemmaFromCard);
      const surfaceEqLemma =
        formN === lemmaFromCard ||
        surfaceN === lemmaFromCard ||
        fullFormEquals(form, card.lemma);
      if (surfaceEqLemma && (lemmaIsInfShape || posLooksLikeVerb(card.pos) || irregInf)) {
        isInfinitive = true;
        infReason = `單字卡原形「${card.lemma}」與選取相同`;
        infConfidence = "high";
      } else if (!surfaceEqLemma && lemmaFromCard) {
        isInfinitive = false;
        infReason = `單字卡原形「${card.lemma}」≠ 選取「${form}」（變位／屈折）`;
        infConfidence = "high";
      }
    }

    // 無單字卡時：詞形像不定詞且不是表內變位形
    if (infConfidence === "none") {
      if (irregForm && irregForm.tense && irregForm.tense !== "infinitif") {
        isInfinitive = false;
        infReason = "不規則變位表形";
        infConfidence = "high";
      } else if (looksLikeInfinitiveOrthography(form) && !irregForm) {
        isInfinitive = true;
        infReason = "詞形像不定詞（無單字卡，啟發式）";
        infConfidence = "medium";
        if (!infinitive) infinitive = formN;
      }
    }

    // 詞性不是動詞且無不規則命中 → 不建動詞剖面（避免名詞誤推）
    const pos = card?.pos || opts.pos || "";
    const likelyVerb =
      posLooksLikeVerb(pos) ||
      irregular ||
      isInfinitive ||
      Boolean(primary?.tense) ||
      looksLikeInfinitiveOrthography(infinitive || form);
    if (!likelyVerb && !irregForm) return null;

    let tense = "";
    let person = "";
    if (!isInfinitive) {
      tense = (irregForm && irregForm.tense) || primary?.tense || "";
      person = (irregForm && irregForm.person) || primary?.person || "";
      if (tense === "infinitif" || /不定/.test(tense)) {
        // 分析器偶爾標 infinitif
        if (!isInfinitive && lemmaFromCard && formN === lemmaFromCard) {
          isInfinitive = true;
          infReason = infReason || "分析為不定式";
        }
      }
    } else {
      tense = "infinitif";
    }

    let groupCode = String(card?.verbGroup || opts.verbGroup || "").trim();
    if (groupCode && !/^[123]$/.test(groupCode)) {
      if (/1|第一/.test(groupCode)) groupCode = "1";
      else if (/2|第二/.test(groupCode)) groupCode = "2";
      else if (/3|第三|不規則/.test(groupCode)) groupCode = "3";
      else groupCode = "";
    }
    if (!groupCode && infinitive && typeof Analyzer !== "undefined" && Analyzer.verbGroupForLemma) {
      const g = Analyzer.verbGroupForLemma(infinitive);
      if (g?.code) groupCode = g.code;
    }
    if (irregular && groupCode !== "1" && groupCode !== "2") groupCode = groupCode || "3";

    const groupLabel =
      groupCode === "1"
        ? "第一組（-er）"
        : groupCode === "2"
          ? "第二組（-ir）"
          : groupCode === "3"
            ? "第三組／不規則"
            : "";

    return {
      form,
      lemma: card?.lemma || infinitive || "",
      infinitive: infinitive || lemmaFromCard || "",
      isInfinitive,
      infReason,
      infConfidence,
      irregular,
      irregForm: irregForm || null,
      tense: tense || "",
      person: person || "",
      groupCode: groupCode || "",
      groupLabel,
      pos: pos || "",
      vocabSource: card?.source || "",
      hasVocabCard: Boolean(card && (card.lemma || card.pos)),
    };
  }

  /** 規則是否像「不定式／infinitif」文法 */
  function ruleLooksInfinitiveRelated(rule) {
    const blob = [
      rule?.title || "",
      rule?.category || "",
      rule?.explanation || "",
      ...(rule?.keywords || []),
    ]
      .join("\n")
      .toLowerCase()
      .normalize("NFC");
    return /不定式|不定詞|infinitif|\binf\b|原形.*動詞|動詞原形|原形用法/.test(blob);
  }

  /** 規則是否對齊某時態族 */
  function ruleMatchesTense(rule, tense) {
    if (!tense || !rule) return false;
    const fam = grammarFamily(tense);
    const rFam = grammarFamily(rule.title || "");
    if (fam && rFam && fam === rFam) return true;
    const t = titleNorm(tense);
    const blob = titleNorm([rule.title, rule.explanation, ...(rule.keywords || [])].join(" "));
    if (t.length >= 4 && blob.includes(t)) return true;
    // 中文時態
    if (typeof Analyzer !== "undefined" && Analyzer.tenseZh) {
      const zh = Analyzer.tenseZh(tense);
      if (zh && String(rule.title || "").includes(zh)) return true;
    }
    return false;
  }

  /** 規則是否對齊動詞組別通則 */
  function ruleMatchesVerbGroup(rule, groupCode) {
    if (!groupCode || !rule) return false;
    const blob = [rule.title, rule.category, rule.explanation, ...(rule.keywords || [])]
      .join("\n")
      .toLowerCase();
    if (groupCode === "1") {
      return (
        /第一組|第1組|groupe\s*1|第一组/.test(blob) ||
        (/\b-er\b|第一組動詞|規則\s*-?er/.test(blob) && !/第二組|第三組|不規則|imparfait/.test(blob))
      );
    }
    if (groupCode === "2") {
      return /第二組|第2組|groupe\s*2|第二组|規則\s*-?ir/.test(blob);
    }
    if (groupCode === "3") {
      return /第三組|第3組|groupe\s*3|不規則|irreg/.test(blob);
    }
    return false;
  }

  /** 選取是否像「純詞尾／過短片段」（易刷出通則卡） */
  function selectionIsFragileSpan(selNorm, selRaw) {
    const s = String(selNorm || "");
    if (!s) return true;
    if (s.length <= 2) return true;
    // 常見變位／分詞尾單獨選取
    if (
      /^(e|es|s|t|a|as|ai|ais|ait|ons|ez|ent|é|ée|és|ées|u|ue|us|ues|i|ie|is|ies|ant|ment)$/i.test(
        s
      )
    ) {
      return true;
    }
    // 只有連字號詞尾標記
    if (/^[-–—][a-zàâäéèêëïîôùûüçœæ]{1,4}$/i.test(String(selRaw || "").trim())) return true;
    return false;
  }

  /**
   * 盤點項目是否對齊目前選取（文字相等或字元區間重疊）
   * @returns {{ item: object, overlap: number }[]}
   */
  function inventoryItemsAlignedToSelection(sel, opts = {}) {
    const items = Array.isArray(opts.inventoryItems)
      ? opts.inventoryItems
      : Array.isArray(opts.inventory?.items)
        ? opts.inventory.items
        : [];
    if (!items.length) return [];

    const selNorm = normalizeToken(sel);
    const selStart = Number(opts.selStart);
    const selEnd = Number(opts.selEnd);
    const hasRange =
      Number.isFinite(selStart) && Number.isFinite(selEnd) && selEnd > selStart;
    const sentence = String(opts.sentence || opts.query || "");

    const out = [];
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      let overlap = 0;
      const span = String(it.span || "").trim();
      const spanN = normalizeToken(span);

      if (spanN && selNorm && (spanN === selNorm || fullFormEquals(span, sel))) {
        overlap = Math.max(overlap, 100);
      } else if (
        spanN &&
        selNorm &&
        selNorm.length >= 3 &&
        spanN.length >= 3 &&
        (spanN.includes(selNorm) || selNorm.includes(spanN))
      ) {
        overlap = Math.max(overlap, 40);
      }

      // 字元區間重疊（手動選取有 start/end 時）
      if (hasRange) {
        let iStart = Number(it.start);
        let iEnd = Number(it.end);
        if (
          !(Number.isFinite(iStart) && Number.isFinite(iEnd) && iEnd > iStart) &&
          span &&
          sentence &&
          typeof locateNeedle === "function"
        ) {
          const locs = locateNeedle(sentence, span);
          if (locs[0]) {
            iStart = locs[0].start;
            iEnd = locs[0].end;
          }
        }
        if (Number.isFinite(iStart) && Number.isFinite(iEnd) && iEnd > iStart) {
          const lo = Math.max(selStart, iStart);
          const hi = Math.min(selEnd, iEnd);
          if (hi > lo) {
            const cover = (hi - lo) / Math.max(1, selEnd - selStart);
            overlap = Math.max(overlap, Math.round(50 + cover * 50));
          }
        }
      }

      // nameFr 恰好是選取字（盤點法語標記）
      const nameFr = String(it.nameFr || it.nameKo || it.fr || "").trim();
      if (nameFr && normalizeToken(nameFr) === selNorm) {
        overlap = Math.max(overlap, 70);
      }

      if (overlap > 0) out.push({ item: it, overlap });
    }
    out.sort((a, b) => b.overlap - a.overlap);
    return out;
  }

  /**
   * 依選取片段排序規則（手動套用時建議置頂）
   * 分層：完整形／盤點對齊 ≫ 不規則專屬 ≫ 關鍵詞 ≫ 詞尾；短選取與通則嚴格壓分
   * @param {string} selectedText
   * @param {{
   *   minScore?: number,
   *   maxSuggest?: number,
   *   pos?: string,
   *   gender?: string,
   *   vocab?: object[],
   *   inventory?: object,
   *   inventoryItems?: object[],
   *   sentence?: string,
   *   query?: string,
   *   selStart?: number,
   *   selEnd?: number,
   *   appliedRuleIds?: string[],
   * }} opts
   * @returns {{ suggestions: { rule, score, reasons, tier?: string }[], rest: object[], hint?: object, meta?: object }}
   */
  function rankRulesForSpan(selectedText, opts = {}) {
    const sel = String(selectedText || "")
      .trim()
      .normalize("NFC");
    const maxSuggest = Number.isFinite(opts.maxSuggest) ? opts.maxSuggest : 6;
    const all = getAll();
    if (!sel) return { suggestions: [], rest: all, meta: { fragile: false } };

    const selNorm = normalizeToken(sel);
    const fragile = selectionIsFragileSpan(selNorm, sel);
    // 短／詞尾選取門檻拉高；一般詞維持可發現性
    const minScore = Number.isFinite(opts.minScore)
      ? opts.minScore
      : fragile
        ? 22
        : 12;

    // 整段 + 各 token 的本地命中（完整形優先；sentenceMode 擋短詞尾噪音）
    const tokenHits = matchTokenToRules(sel, { sentenceMode: fragile });
    const localById = new Map();
    for (const h of tokenHits) {
      if (!h?.rule?.id) continue;
      const prev = localById.get(h.rule.id);
      if (!prev || (h.score || 0) > (prev.score || 0)) localById.set(h.rule.id, h);
    }
    // 多詞選取：各詞分別比對，取每規則最佳
    const wordToks = tokenize(sel).filter((t) => t.isWord);
    if (wordToks.length > 1) {
      for (const wt of wordToks) {
        for (const h of matchTokenToRules(wt.text, { sentenceMode: true })) {
          if (!h?.rule?.id) continue;
          const prev = localById.get(h.rule.id);
          if (!prev || (h.score || 0) > (prev.score || 0)) {
            localById.set(h.rule.id, { ...h, multiToken: true });
          }
        }
      }
    }

    // 僅當選取「像規則名」時才用 findMatchingRule 當標題（避免 pouvais 當 title 亂撞）
    const looksLikeTitle =
      !fragile &&
      (sel.length >= 4 || /[（(]/.test(sel) || /[\u4e00-\u9fff]/.test(sel));
    const asName = looksLikeTitle
      ? findMatchingRule({ name: sel, nameFr: sel, span: sel })
      : { owned: false, rule: null, score: 0 };

    // 動詞剖面先算：用來壓制「形似形容詞」誤判，並排除非動詞規則
    const verbProfile = !fragile ? buildVerbProfile(sel, opts) : null;
    const verbConfident = verbProfileIsConfident(verbProfile);
    const adjHint = selectionLooksLikeAdjective(sel, {
      pos: opts.pos,
      gender: opts.gender,
      vocab: opts.vocab,
      lemma: opts.lemma || verbProfile?.lemma || "",
      verbProfile,
    });

    // 盤點對齊：選取落在 API item span → 對應本地卡置頂
    const aligned = inventoryItemsAlignedToSelection(sel, opts);
    /** @type {Map<string, { score: number, label: string }>} */
    const invBoostByRule = new Map();
    for (const { item, overlap } of aligned.slice(0, 6)) {
      const match = findMatchingRule({
        name: item.name || item.title || "",
        nameFr: item.nameFr || item.nameKo || item.fr || "",
        nameZh: item.nameZh || item.zh || "",
        span: item.span || sel,
      });
      if (match.owned && match.rule?.id) {
        const boost = 20 + Math.min(16, Math.round(overlap / 5));
        const label = `對齊盤點「${String(item.name || "").trim() || "項目"}」`;
        const prev = invBoostByRule.get(match.rule.id);
        if (!prev || boost > prev.score) {
          invBoostByRule.set(match.rule.id, { score: boost, label });
        }
      } else if (item.manualRuleId) {
        const r = getById(item.manualRuleId);
        if (r) {
          invBoostByRule.set(r.id, {
            score: 34,
            label: `對齊盤點「${String(item.name || "").trim() || "項目"}」`,
          });
        }
      }
    }

    // 不規則：表內變位形優先；否則用剖面的不定詞
    let irregHit =
      (verbProfile && verbProfile.irregForm) ||
      (typeof Analyzer !== "undefined" && Analyzer.lookupIrregular
        ? Analyzer.lookupIrregular(sel)
        : null);
    if (!irregHit && typeof Analyzer !== "undefined" && Analyzer.lookupIrregular) {
      for (const wt of wordToks) {
        const h = Analyzer.lookupIrregular(wt.text);
        if (h) {
          irregHit = h;
          break;
        }
      }
    }
    const namedInf =
      (irregHit && irregHit.infinitive) ||
      (verbProfile && verbProfile.infinitive) ||
      "";

    const applied = new Set(
      (opts.appliedRuleIds || []).map((id) => String(id || "")).filter(Boolean)
    );

    const scored = [];
    for (const rule of all) {
      let score = 0;
      const reasons = [];
      let tier = "weak"; // strong | medium | weak
      let hasStrongEvidence = false;

      let local = localById.get(rule.id);
      const nounHint = /名詞|noun/i.test(String(opts.pos || ""));
      if (nounHint && local && local.matchType === "ending" && ruleIsVerbConjugationHeavy(rule)) {
        local = null;
      }
      if (
        nounHint &&
        ruleIsVerbConjugationHeavy(rule) &&
        !(local && local.matchType === "form")
      ) {
        continue;
      }
      // 選定動詞：排除冠詞／代詞／介詞／純形容詞等（完整形命中該規則除外）
      if (
        verbConfident &&
        ruleIsNonVerbGrammar(rule) &&
        !(local && local.matchType === "form")
      ) {
        continue;
      }

      if (local) {
        if (local.matchType === "form") {
          const pts = fragile ? 18 : 28;
          score += pts;
          reasons.push("完整形命中");
          hasStrongEvidence = true;
          tier = "strong";
        } else {
          // 詞尾：短選取大幅降權；通則再壓
          let pts = fragile ? 4 : 14;
          if (isGeneralEndingRule(rule)) pts = Math.min(pts, fragile ? 2 : 8);
          // 不定式選取：詞尾變位通則幾乎無意義
          if (verbProfile?.isInfinitive && isGeneralEndingRule(rule)) {
            pts = 0;
          } else if (
            (irregHit || (verbProfile?.irregular && namedInf)) &&
            namedInf &&
            !ruleMentionsVerb(rule, namedInf) &&
            (isGeneralEndingRule(rule) || ruleIsVerbConjugationHeavy(rule))
          ) {
            pts = 0;
            reasons.push("略過：不規則勿套通則詞尾");
          }
          if (pts > 0) {
            score += pts;
            reasons.push(fragile ? "詞尾（弱）" : "詞尾命中");
            if (pts >= 12) tier = tier === "strong" ? "strong" : "medium";
          }
        }
      }

      const invB = invBoostByRule.get(rule.id);
      if (invB) {
        score += invB.score;
        reasons.push(invB.label);
        hasStrongEvidence = true;
        tier = "strong";
      }

      if (asName.owned && asName.rule?.id === rule.id) {
        score += 16;
        reasons.push("規則名對應");
        hasStrongEvidence = true;
        if (tier === "weak") tier = "medium";
      }

      const titleN = titleNorm(rule.title);
      if (selNorm && titleN === selNorm) {
        score += 28;
        reasons.push("與標題完全相同");
        hasStrongEvidence = true;
        tier = "strong";
      } else if (
        !fragile &&
        selNorm.length >= 4 &&
        titleN.includes(selNorm) &&
        !isGenericGrammarKey(selNorm)
      ) {
        // 禁止短選取／通名靠「標題包含」進榜
        score += 8;
        reasons.push("標題包含選取字");
      }

      // 六格完整形（與 local form 互補；避免 partial includes 刷分）
      const forms = collectMatchForms(rule);
      let formExact = false;
      for (const f of forms) {
        const fn = normalizeToken(f);
        if (!fn) continue;
        if (fn === selNorm || fullFormEquals(f, sel)) {
          score += local?.matchType === "form" ? 6 : 22;
          reasons.push(`格子「${f}」`);
          formExact = true;
          hasStrongEvidence = true;
          tier = "strong";
          break;
        }
      }
      // 部分包含：僅非 fragile、且選取夠長
      if (!formExact && !fragile && selNorm.length >= 4) {
        for (const f of forms) {
          const fn = normalizeToken(f);
          if (!fn || fn.length < 4) continue;
          if (fn.includes(selNorm) || selNorm.includes(fn)) {
            const shorter = fn.length <= selNorm.length ? fn : selNorm;
            const longer = fn.length > selNorm.length ? fn : selNorm;
            if (longer.length <= shorter.length + 4) {
              score += 6;
              reasons.push(`相關形「${f}」`);
              break;
            }
          }
        }
      }

      // 關鍵詞：精確優先；多詞選取時任一 token 命中也算
      let kwHit = false;
      for (const kw of rule.keywords || []) {
        for (const raw of expandCellForms(kw)) {
          const kn = normalizeToken(raw);
          if (!kn) continue;
          if (kn === selNorm || fullFormEquals(raw, sel) || particlesEqual(raw, sel)) {
            score += 18;
            reasons.push(`關鍵詞「${kw}」`);
            kwHit = true;
            hasStrongEvidence = true;
            if (tier === "weak") tier = "medium";
            break;
          }
          if (
            !fragile &&
            selNorm.length >= 3 &&
            kn.length >= 3 &&
            (kn === selNorm || selNorm.includes(kn))
          ) {
            score += 10;
            reasons.push(`關鍵詞「${kw}」`);
            kwHit = true;
            break;
          }
        }
        if (kwHit) break;
      }
      if (!kwHit && wordToks.length > 1) {
        for (const wt of wordToks) {
          for (const kw of rule.keywords || []) {
            for (const raw of expandCellForms(kw)) {
              if (fullFormEquals(raw, wt.text) || particlesEqual(raw, wt.text)) {
                score += 14;
                reasons.push(`關鍵詞「${kw}」←「${wt.text}」`);
                hasStrongEvidence = true;
                if (tier === "weak") tier = "medium";
                kwHit = true;
                break;
              }
            }
            if (kwHit) break;
          }
          if (kwHit) break;
        }
      }

      // —— 動詞剖面加分（單字卡原形 → 不定式／不規則／時態／組別）——
      if (verbProfile) {
        const vp = verbProfile;
        const mentionsInf = vp.infinitive && ruleMentionsVerb(rule, vp.infinitive);
        const infRelated = ruleLooksInfinitiveRelated(rule);
        const conjHeavy = ruleIsVerbConjugationHeavy(rule);
        const generalEnd = isGeneralEndingRule(rule);

        if (vp.isInfinitive) {
          // 不定式：推不定式文法 + 點名該原形的卡；壓低一般時態變位通則
          if (infRelated) {
            score += vp.infConfidence === "high" ? 30 : 22;
            reasons.push(
              vp.hasVocabCard ? "不定式（單字卡原形）" : "不定式相關"
            );
            hasStrongEvidence = true;
            tier = "strong";
          }
          if (mentionsInf) {
            score += 16;
            reasons.push(`原形 ${vp.infinitive}`);
            hasStrongEvidence = true;
            if (tier === "weak") tier = "medium";
          }
          if (vp.irregular && mentionsInf) {
            score += 10;
            reasons.push(`不規則原形 ${vp.infinitive}`);
          }
          // 時態變位通則（非不定式）降權
          if (conjHeavy && !infRelated && !mentionsInf) {
            score -= 16;
          } else if (generalEnd && !mentionsInf) {
            score -= 12;
          }
        } else {
          // 非不定式（變位）：不規則專屬 → 時態 → 組別通則
          if (vp.irregular || irregHit) {
            const inf = namedInf || vp.infinitive;
            if (inf && ruleMentionsVerb(rule, inf)) {
              score += 22;
              reasons.push(`不規則 ${inf}`);
              hasStrongEvidence = true;
              if (tier !== "strong") tier = "medium";
              if (vp.tense && ruleMatchesTense(rule, vp.tense)) {
                score += 12;
                reasons.push(`時態 ${vp.tense}`);
                tier = "strong";
              }
            } else if (generalEnd || (conjHeavy && !mentionsInf)) {
              score -= 18;
            }
          } else {
            // 規則動詞：時態 + 組別（兩者同時命中再加碼，利於「第一組 + présent」）
            let tenseHit = false;
            let groupHit = false;
            if (vp.tense && ruleMatchesTense(rule, vp.tense)) {
              score += 16;
              reasons.push(`時態 ${vp.tense}`);
              tenseHit = true;
              if (tier === "weak") tier = "medium";
            }
            if (vp.groupCode && (vp.groupCode === "1" || vp.groupCode === "2" || vp.groupCode === "3")) {
              if (ruleMatchesVerbGroup(rule, vp.groupCode)) {
                score += 16;
                reasons.push(vp.groupLabel || `第${vp.groupCode}組`);
                groupHit = true;
                if (tier === "weak") tier = "medium";
              } else if (
                (vp.groupCode === "1" || vp.groupCode === "2") &&
                ruleMatchesVerbGroup(rule, vp.groupCode === "1" ? "2" : "1")
              ) {
                score -= 10;
              }
            }
            if (tenseHit && groupHit && conjHeavy) {
              score += 14;
              reasons.push("組別+時態變位");
              hasStrongEvidence = true;
              tier = "strong";
            } else if ((tenseHit || groupHit) && conjHeavy) {
              score += 8;
              if (tier === "weak") tier = "medium";
            }
            if (vp.infinitive && mentionsInf) {
              score += 8;
              reasons.push(`動詞 ${vp.infinitive}`);
            }
            // 選定規則動詞時，非變位卡再壓一檔
            if (verbConfident && ruleIsNonVerbGrammar(rule)) {
              score -= 30;
            }
          }
          // 變位形不應優先「不定式用法」卡（除非標題也點名該動詞）
          if (infRelated && !mentionsInf) {
            score -= 10;
          }
        }
      } else if (irregHit && ruleMentionsVerb(rule, irregHit.infinitive)) {
        score += 20;
        reasons.push(`不規則 ${irregHit.infinitive}`);
        hasStrongEvidence = true;
        if (tier !== "strong") tier = "medium";
      } else if (
        irregHit &&
        isGeneralEndingRule(rule) &&
        !ruleMentionsVerb(rule, irregHit.infinitive)
      ) {
        score -= 18;
      }

      // 選取像形容詞 → 優先形容詞相關規則，壓低純動詞變位
      // 已有可信動詞剖面時完全不走這條（避免 remue → 冠詞／主有形容詞）
      if (adjHint.yes && !verbConfident) {
        if (ruleIsAdjectiveRelated(rule)) {
          score += 26;
          reasons.push("形容詞相關");
          if (tier === "weak") tier = "medium";
        } else if (ruleIsVerbConjugationHeavy(rule)) {
          score -= 12;
        }
      }

      // 本句已套用：略降（疊加仍可見，但不佔最強建議）
      if (applied.has(rule.id)) {
        score -= 4;
        reasons.push("本句已套用");
      }

      // 補充用法：手動選字時不搶一般文法建議（仍可在完整列表）
      if (isSupplementaryUsage(rule) && !invBoostByRule.has(rule.id)) {
        score -= 6;
      }

      // 無強證據時：壓掉「只靠標題模糊／弱詞尾」
      if (!hasStrongEvidence && fragile) {
        score = Math.min(score, minScore - 1);
      }

      if (score >= minScore && reasons.length) {
        // 再保險：fragile 且沒有 form／盤點／關鍵詞／不規則專屬 → 不進建議
        if (fragile && !hasStrongEvidence) continue;
        scored.push({
          rule,
          score: Math.round(score),
          reasons: [...new Set(reasons)].slice(0, 3),
          tier,
        });
      }
    }

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        (a.tier === "strong" ? 0 : 1) - (b.tier === "strong" ? 0 : 1) ||
        (a.rule.title || "").localeCompare(b.rule.title || "", "zh-Hant")
    );

    // 建議區：優先 strong，再 medium／高分
    const strong = scored.filter((s) => s.tier === "strong" || s.score >= minScore + 10);
    const strongIds = new Set(strong.map((s) => s.rule.id));
    const medium = scored.filter(
      (s) => !strongIds.has(s.rule.id) && (s.tier === "medium" || s.score >= minScore)
    );
    const suggestions = [...strong, ...medium].slice(0, maxSuggest);
    const suggestIds = new Set(suggestions.map((s) => s.rule.id));
    let rest = all.filter((r) => !suggestIds.has(r.id));

    // 其餘列表：有弱分的排前；動詞選取時變位卡優先、非動詞置後
    const scoreById = new Map(scored.map((s) => [s.rule.id, s.score]));
    rest = rest.slice().sort((a, b) => {
      if (verbConfident) {
        const va = ruleIsVerbConjugationHeavy(a) || ruleLooksInfinitiveRelated(a) ? 1 : 0;
        const vb = ruleIsVerbConjugationHeavy(b) || ruleLooksInfinitiveRelated(b) ? 1 : 0;
        if (vb !== va) return vb - va;
        const na = ruleIsNonVerbGrammar(a) ? 1 : 0;
        const nb = ruleIsNonVerbGrammar(b) ? 1 : 0;
        if (na !== nb) return na - nb;
      } else if (adjHint.yes) {
        const aa = ruleIsAdjectiveRelated(a) ? 1 : 0;
        const bb = ruleIsAdjectiveRelated(b) ? 1 : 0;
        if (bb !== aa) return bb - aa;
      }
      const sa = scoreById.get(a.id) || 0;
      const sb = scoreById.get(b.id) || 0;
      if (sb !== sa) return sb - sa;
      return (a.title || "").localeCompare(b.title || "", "zh-Hant");
    });

    // 動詞選取時，建議區再濾掉漏網的非動詞（雙重保險）
    let finalSuggestions = suggestions;
    if (verbConfident) {
      finalSuggestions = suggestions.filter(
        (s) => !ruleIsNonVerbGrammar(s.rule) || (s.tier === "strong" && s.score >= minScore + 20)
      );
      if (!finalSuggestions.length) finalSuggestions = suggestions.filter((s) => !ruleIsNonVerbGrammar(s.rule));
    }

    const meta = {
      fragile,
      minScore,
      alignedCount: aligned.length,
      verbFilter: verbConfident,
      irreg: irregHit
        ? irregHit.infinitive
        : verbProfile?.irregular
          ? verbProfile.infinitive
          : null,
      verb: verbProfile
        ? {
            isInfinitive: verbProfile.isInfinitive,
            lemma: verbProfile.lemma || verbProfile.infinitive || "",
            infinitive: verbProfile.infinitive || "",
            irregular: verbProfile.irregular,
            tense: verbProfile.tense || "",
            group: verbProfile.groupLabel || verbProfile.groupCode || "",
            infReason: verbProfile.infReason || "",
            hasVocabCard: verbProfile.hasVocabCard,
            confident: verbConfident,
          }
        : null,
    };

    return { suggestions: finalSuggestions, rest, hint: adjHint, meta };
  }
})();

