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
    const title = String(rule?.title || "")
      .toLowerCase()
      .normalize("NFC");
    if (title.includes(inf)) return true;
    for (const kw of rule?.keywords || []) {
      if (
        String(kw || "")
          .toLowerCase()
          .normalize("NFC")
          .includes(inf)
      ) {
        return true;
      }
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

    // 關鍵詞規則：span 含 pas / n' 等（僅掃該規則 keywords，O(k)）
    if (!ruleHasPersons(rule) || (rule.keywords || []).length) {
      for (const kw of rule.keywords || []) {
        for (const raw of expandCellForms(kw)) {
          const k = normalizeToken(raw);
          const s = normalizeToken(span);
          if (!k) continue;
          if (s === k || fullFormEquals(raw, span) || particlesEqual(raw, span)) {
            if (28 > best.score) best = { score: 28, matchType: "form", form: span };
          } else if (k.length >= 2 && s.includes(k)) {
            if (12 > best.score) best = { score: 12, matchType: "ending", form: span };
          }
        }
      }
    }
    return best;
  }

  /**
   * 標題語意分（嚴格優先；弱 includes 極低分）
   */
  /** 時態／功能族：兩側同族可給軟加分（仍不足以單獨過門檻） */
  function grammarFamily(text) {
    const t = titleNorm(text);
    if (!t) return "";
    if (/imparfait|未完成/.test(t)) return "imparfait";
    if (/futur|未來|将来/.test(t)) return "futur";
    if (/pass[eé]compos|複合過去|复合过去|passécomposé/.test(t)) return "pc";
    if (/participe|過去分詞|过去分词|分詞/.test(t) && /é|è|participe|分詞/.test(t)) return "pp";
    if (/présent|现在|現在/.test(t)) return "present";
    if (/neg|nég|否定|ne\.\.\.pas|ne…pas|nepas/.test(t) || /\bpas\b/.test(t)) return "neg";
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

    // 時態族軟加分（需搭配 span 才容易過門檻）
    const qFam = grammarFamily([nameNorm, zhNorm, frNorm].join(" "));
    const rFam = grammarFamily(rule.title);
    if (qFam && rFam && qFam === rFam) {
      score += 6;
    }

    // 中文側：全等才高分；「未完成過去」⊂「第一組動詞未完成過去」給中等分
    if (zhNorm && zhNorm.length >= 2) {
      if (rZh === zhNorm) {
        score += 22;
        strongHits += 1;
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

    // 法語標記：全等優先；「pouvoir imparfait」vs「-er imparfait」不應因共用 imparfait 大勝
    if (frNorm && frNorm.length >= 1) {
      if (rFr === frNorm) {
        score += frNorm.length >= 3 ? 24 : 10;
        strongHits += 1;
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
   * API 盤點「已收錄」嚴格比對
   * 優先：完整標題／專名 ＋ 句中 span 對六格／關鍵詞
   * @returns {{ owned: boolean, rule: object|null, score: number, reason?: string }}
   */
  function findMatchingRule(nameOrItem) {
    const name =
      typeof nameOrItem === "string"
        ? nameOrItem
        : nameOrItem?.name || nameOrItem?.title || "";
    const nameFr =
      typeof nameOrItem === "object"
        ? nameOrItem?.nameFr || nameOrItem?.nameKo || nameOrItem?.fr || ""
        : "";
    const nameZh =
      typeof nameOrItem === "object" ? nameOrItem?.nameZh || nameOrItem?.zh || "" : "";
    const span =
      typeof nameOrItem === "object" ? String(nameOrItem?.span || "").trim() : "";

    const nameNorm = titleNorm(name);
    const parsed = parseBilingualTitle(name);
    const frNorm = titleNorm(nameFr || parsed.fr);
    const zhNorm = titleNorm(nameZh || parsed.zh);

    const queryKeys = new Set();
    if (nameNorm) queryKeys.add(nameNorm);
    if (frNorm) queryKeys.add(frNorm);
    if (zhNorm) queryKeys.add(zhNorm);
    if (parsed.fr) {
      parsed.fr.split(/[\/／,，|｜\s]+/).forEach((part) => {
        const t = titleNorm(part.replace(/^[-~〜]+/, ""));
        if (t) queryKeys.add(t);
      });
    }
    // 標題裡的不定詞／專名也進 query（pouvoir、être…）
    const blobForVerb = [name, nameFr, nameZh, parsed.fr, parsed.zh, span]
      .filter(Boolean)
      .join(" ");
    const queryVerb =
      typeof Analyzer !== "undefined" && Analyzer.extractIrregularInfinitive
        ? Analyzer.extractIrregularInfinitive(blobForVerb)
        : null;
    // 也嘗試抓標題中的 -er 不定詞（déjeuner 等規則動詞）
    let namedInf = queryVerb;
    if (!namedInf) {
      const m = blobForVerb.match(
        /\b([a-zàâäéèêëïîôùûüçœæ]{3,}(?:er|ir|re|oir))\b/i
      );
      if (m) namedInf = m[1].toLowerCase().normalize("NFC");
    }

    // span 若為已知不規則形，強制對應其不定詞
    let spanIrreg = null;
    if (span && typeof Analyzer !== "undefined" && Analyzer.lookupIrregular) {
      const toks = span.match(/[A-Za-zÀ-ÿœæŒÆ]+(?:['’][A-Za-zÀ-ÿœæŒÆ]+)*/g) || [];
      for (const t of toks) {
        const hit = Analyzer.lookupIrregular(t);
        if (hit) {
          spanIrreg = hit;
          if (!namedInf) namedInf = hit.infinitive;
          break;
        }
      }
    }

    // span → 規則命中表只建一次（A2：避免每張卡重掃全庫）
    const spanHitMap = span ? buildSpanHitMap(span) : null;

    const candidates = [];

    for (const rule of rules) {
      const titlePart = scoreRuleByTitle(rule, nameNorm, zhNorm, frNorm, queryKeys);
      let score = titlePart.score;
      const spanPart = span
        ? scoreRuleBySpan(rule, span, spanHitMap)
        : { score: 0, matchType: "none" };
      score += spanPart.score;

      // 點名同一不定詞（標題／專屬卡）
      if (namedInf && ruleMentionsVerb(rule, namedInf)) {
        score += 18;
      } else if (namedInf && isGeneralEndingRule(rule)) {
        // 有具體動詞時，通則卡降權（避免 pouvais → 第一組 imparfait）
        score -= 12;
      }

      // 不規則 span：禁止被未點名該動詞的通則詞尾規則吞掉
      if (spanIrreg && isGeneralEndingRule(rule) && !ruleMentionsVerb(rule, spanIrreg.infinitive)) {
        if (spanPart.matchType === "ending") score -= 50;
        else score -= 20;
      }

      // 僅詞尾命中、標題幾乎無關 → 不可當已收錄
      if (spanPart.matchType === "ending" && titlePart.score < 8 && titlePart.strongHits === 0) {
        score = Math.min(score, 15);
      }

      // 無 span 且只有通名標題分 → 壓低
      if (!span && titlePart.genericOnly && titlePart.strongHits === 0) {
        score = Math.min(score, 10);
      }

      if (score > 0) {
        candidates.push({
          rule,
          score,
          strongHits: titlePart.strongHits,
          spanType: spanPart.matchType,
          general: isGeneralEndingRule(rule),
          named: namedInf ? ruleMentionsVerb(rule, namedInf) : false,
        });
      }
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // 同分：完整形 > 點名動詞 > 非通則 > 標題長
      const rank = (c) =>
        (c.spanType === "form" ? 8 : 0) +
        (c.named ? 4 : 0) +
        (c.general ? 0 : 2) +
        (c.strongHits || 0);
      if (rank(b) !== rank(a)) return rank(b) - rank(a);
      return (b.rule.title || "").length - (a.rule.title || "").length;
    });

    let best = candidates[0] || null;

    // 次佳若明顯更「專屬」（form + named）且分數接近，改採次佳
    if (best && candidates[1]) {
      const a = candidates[0];
      const b = candidates[1];
      if (
        a.general &&
        !b.general &&
        b.named &&
        a.score - b.score <= 8 &&
        (b.spanType === "form" || b.strongHits >= a.strongHits)
      ) {
        best = b;
      }
    }

    if (!best) return { owned: false, rule: null, score: 0 };

    // 門檻：有 span 完整形可較低；僅標題模糊需更高
    const genericZh =
      zhNorm &&
      /^(現在時|過去|未來|否定|變位|動詞|時態|未完成|未完成過去|完成|分詞|過去分詞)$/i.test(
        zhNorm
      );
    const sameFamily =
      grammarFamily([name, zhNorm, frNorm].join(" ")) &&
      grammarFamily([name, zhNorm, frNorm].join(" ")) === grammarFamily(best.rule.title);

    let threshold = 18;
    if (best.spanType === "form") threshold = 16;
    else if (best.spanType === "ending" && sameFamily) threshold = 18;
    else if (best.strongHits >= 1 && best.spanType === "ending") threshold = 20;
    else if (best.strongHits >= 2) threshold = 18;
    else if (genericZh && !best.spanType) threshold = 28;
    else if (best.general && best.spanType !== "ending" && best.spanType !== "form")
      threshold = 26;
    else if (!span) threshold = 22;

    // 不規則 span 卻選到未點名通則 → 否決
    if (
      spanIrreg &&
      best.general &&
      !ruleMentionsVerb(best.rule, spanIrreg.infinitive)
    ) {
      // 若有專屬卡在候選裡，改用專屬
      const specific = candidates.find(
        (c) => c.named || ruleMentionsVerb(c.rule, spanIrreg.infinitive)
      );
      if (specific && specific.score >= 14) {
        best = specific;
      } else {
        return { owned: false, rule: null, score: best.score, reason: "irregular-needs-own-rule" };
      }
    }

    if (best.score >= threshold) {
      return { owned: true, rule: best.rule, score: best.score };
    }
    return { owned: false, rule: null, score: best.score };
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
        const key = loc.start + ":" + loc.end;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(loc);
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
    } else {
      // 無撇號：仍用 j'/n' 寫法對照格子
      if (
        full.length <= 6 &&
        (/^[aeiouyàâäéèêëïîôùûühœæ]/i.test(full) ||
          /^(ai|as|a|est|ont|aime|étais|étais)$/i.test(full))
      ) {
        push("j'" + full, "recomposed-j", 8);
        push("n'" + full, "recomposed-n", 6);
      }
    }

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

  /** ne / n / n' 視為同一否定小詞 */
  function asNegParticle(s) {
    const t = normalizeToken(s);
    if (!t) return null;
    if (t === "ne" || t === "n" || t === "n'") return "ne";
    // n'ai / n'est / n'habite → 前綴 ne
    const pro = elisionProclitic(t);
    if (pro && pro.short === "n") return "ne";
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

  function matchTokenToRules(rawToken, { sentenceMode = false } = {}) {
    const full = normalizeToken(rawToken);
    if (!full) return [];

    const variants = expandMatchVariants(rawToken);
    const candidates = [];

    for (const { form, role, bonus } of variants) {
      for (const rule of rules) {
        const hitPersons = [];
        let bestEndLen = 0;
        let keywordHit = null;

        // 1) 關鍵詞（一般文法，如 ne…pas）
        for (const kw of rule.keywords || []) {
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

        // 2) 六人稱格子（動詞變位）
        if (ruleHasPersons(rule) || hasAnyEnding(rule.endings)) {
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
                // 例：voulais / allais / étais 不可命中「第一組 -er imparfait」的 -ais
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
          roleBoost +
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

    if (sentenceMode) {
      const forms = list.filter((c) => c.matchType === "form");
      if (forms.length) {
        // 並列：n'→否定、ai→avoir
        const top = forms[0].score;
        return forms.filter((c) => c.score >= top - 100).slice(0, 4);
      }
      return list.slice(0, 1);
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

    const hits = matchTokenToRules(rawForm, { sentenceMode: false });
    const exact = hits.map((h) => ({
      rule: h.rule,
      matchType: h.matchType,
      hitPersons: h.hitPersons,
      score: h.score,
      spans: [{ text: rawForm, form: h.form }],
    }));

    const partial = [];
    const q = form || normalizeToken(rawForm);
    for (const rule of rules) {
      if (exact.some((m) => m.rule.id === rule.id)) continue;
      const blob = [
        rule.title,
        rule.explanation,
        ...(rule.keywords || []),
        ...Object.values(rule.endings || {}),
      ]
        .join(" ")
        .toLowerCase();
      if (q && blob.includes(q)) {
        partial.push({
          rule,
          matchType: "text",
          hitPersons: [],
          score: 40,
          spans: [],
        });
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
   * 本地查詢：僅單詞／單一形式（含 j'ai 這類一詞省音）
   * 整句本地掃描已停用 → 請走 API 盤點
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
    // 整句：不跑本地標註（已取消本地查詢句子）
    if (isMultiWordQuery(text)) {
      return {
        mode: "sentence",
        query: text,
        form: text,
        matches: [],
        partial: [],
        spans: [],
        legend: [],
        localDisabled: true,
        analysis: null,
      };
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
      title: "第一組動詞過去分詞（-é）",
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
    locateApiItemInText,
    locateNeedle,
    expandNeedles,
    ruleMentionsVerb,
    isGeneralEndingRule,
    rankRulesForSpan,
  };

  /** 規則是否與形容詞文法相關 */
  function ruleIsAdjectiveRelated(rule) {
    const blob = [
      rule?.title || "",
      rule?.category || "",
      rule?.explanation || "",
      ...(rule?.keywords || []),
    ]
      .join("\n")
      .toLowerCase()
      .normalize("NFC");
    return /形容詞|adjectif|\badj\b|性數|性／數|性\/數|陰陽性|陰陽配合|性數配合|accord|比較級|最高級|修飾|antepos|antépos|postpos|beau|nouveau|vieux|bel|vieil|陽性.*陰性|陰性.*-e|複數.*形容|形容.*複數|形容.*陰|形容.*陽/.test(
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
   * 推估選取字是否像形容詞
   * @param {string} sel
   * @param {{ pos?: string, gender?: string, vocab?: object[] }} hints
   */
  function selectionLooksLikeAdjective(sel, hints = {}) {
    const pos = String(hints.pos || "").trim();
    if (/形容詞|adjectif|adj/i.test(pos)) return { yes: true, reason: "詞性：形容詞" };

    const list = Array.isArray(hints.vocab) ? hints.vocab : [];
    const selN = normalizeToken(sel);
    for (const w of list) {
      const surf = normalizeToken(w.surface || w.s);
      const lem = normalizeToken(w.lemma || w.l);
      if (surf === selN || lem === selN) {
        if (/形容詞|adjectif|adj/i.test(String(w.pos || w.p || ""))) {
          return { yes: true, reason: "API 詞彙：形容詞" };
        }
      }
    }

    const s = String(sel || "").trim().normalize("NFC");
    if (!s || s.length < 2) return { yes: false, reason: "" };
    // 常見形容詞詞尾／形（啟發式，非詞典）
    if (
      /(?:euse|euses|ique|iques|able|ables|ible|ibles|aire|aires|ive|ives|elle|elles|enne|ennes|esse|esses|al|ale|ales|aux|eux|euse|ois|oise|aises?|ien|ienne|u|ue|ues|ée?s?)$/i.test(
        s
      ) &&
      !/(?:er|ir|re|oir)$/i.test(s) // 不像不定詞
    ) {
      return { yes: true, reason: "形似形容詞詞尾" };
    }
    // 已有性別標記的詞彙（盤點 r）掛在同表面
    for (const w of list) {
      const surf = normalizeToken(w.surface || w.s);
      if (surf === selN && (w.gender || w.r) && !/動詞/.test(String(w.pos || ""))) {
        const g = String(w.gender || w.r || "");
        if (/m|f|陽|陰|mf/i.test(g) && !/動詞/.test(String(w.pos || ""))) {
          // 名詞也有性別；僅當無明確名詞標籤時略提
          if (/名詞|noun/i.test(String(w.pos || ""))) return { yes: false, reason: "" };
          if (/形容|adj/i.test(String(w.pos || "")) || !w.pos) {
            if (/形容|adj/i.test(String(w.pos || "")))
              return { yes: true, reason: "API 詞彙：形容詞" };
          }
        }
      }
    }
    return { yes: false, reason: "" };
  }

  /**
   * 依選取片段排序規則（手動套用時建議置頂）
   * @param {string} selectedText
   * @param {{ minScore?: number, maxSuggest?: number, pos?: string, vocab?: object[] }} opts
   * @returns {{ suggestions: { rule, score, reasons }[], rest: object[], hint?: object }}
   */
  function rankRulesForSpan(selectedText, opts = {}) {
    const sel = String(selectedText || "")
      .trim()
      .normalize("NFC");
    const minScore = Number.isFinite(opts.minScore) ? opts.minScore : 8;
    const maxSuggest = Number.isFinite(opts.maxSuggest) ? opts.maxSuggest : 8;
    const all = getAll();
    if (!sel) return { suggestions: [], rest: all };

    const selNorm = normalizeToken(sel);
    const tokenHits = matchTokenToRules(sel, { sentenceMode: false });
    const localById = new Map(tokenHits.map((h) => [h.rule.id, h]));
    const asName = findMatchingRule({ name: sel, nameFr: sel, span: sel });
    const adjHint = selectionLooksLikeAdjective(sel, {
      pos: opts.pos,
      gender: opts.gender,
      vocab: opts.vocab,
    });

    const scored = [];
    for (const rule of all) {
      let score = 0;
      const reasons = [];
      const local = localById.get(rule.id);
      if (local) {
        const boost = local.matchType === "form" ? 22 : 12;
        score += Math.min(24, boost + Math.min(8, (local.score || 0) / 100));
        reasons.push(local.matchType === "form" ? "完整形命中" : "詞尾命中");
      }
      if (asName.owned && asName.rule?.id === rule.id) {
        score += 18;
        reasons.push("規則名對應");
      }
      const titleN = titleNorm(rule.title);
      if (selNorm && titleN === selNorm) {
        score += 28;
        reasons.push("與標題完全相同");
      } else if (selNorm.length >= 2 && titleN.includes(selNorm)) {
        score += 12;
        reasons.push("標題包含選取字");
      }
      const forms = collectMatchForms(rule);
      for (const f of forms) {
        const fn = normalizeToken(f);
        if (!fn) continue;
        if (fn === selNorm || fullFormEquals(f, sel)) {
          score += 20;
          reasons.push(`格子「${f}」`);
          break;
        }
        if (selNorm.length >= 3 && fn.length >= 3 && (fn.includes(selNorm) || selNorm.includes(fn))) {
          score += 8;
          reasons.push(`相關形「${f}」`);
          break;
        }
      }
      for (const kw of rule.keywords || []) {
        const kn = normalizeToken(kw);
        if (kn && (kn === selNorm || (selNorm.length >= 2 && kn.includes(selNorm)))) {
          score += 14;
          reasons.push(`關鍵詞「${kw}」`);
          break;
        }
      }
      if (typeof Analyzer !== "undefined" && Analyzer.lookupIrregular) {
        const irreg = Analyzer.lookupIrregular(sel);
        if (irreg && ruleMentionsVerb(rule, irreg.infinitive)) {
          score += 16;
          reasons.push(`不規則 ${irreg.infinitive}`);
        }
      }

      // 選取像形容詞 → 優先形容詞相關規則，壓低純動詞變位
      if (adjHint.yes) {
        if (ruleIsAdjectiveRelated(rule)) {
          score += 26;
          reasons.push("形容詞相關");
        } else if (ruleIsVerbConjugationHeavy(rule)) {
          score -= 10;
        }
      }

      if (score >= minScore) {
        scored.push({
          rule,
          score,
          reasons: [...new Set(reasons)].slice(0, 3),
        });
      }
    }

    scored.sort(
      (a, b) => b.score - a.score || (a.rule.title || "").localeCompare(b.rule.title || "")
    );
    const suggestions = scored.slice(0, maxSuggest);
    const suggestIds = new Set(suggestions.map((s) => s.rule.id));
    let rest = all.filter((r) => !suggestIds.has(r.id));
    // 形容詞選取時，其餘列表也把形容詞相關規則排前面
    if (adjHint.yes) {
      rest = rest.slice().sort((a, b) => {
        const aa = ruleIsAdjectiveRelated(a) ? 1 : 0;
        const bb = ruleIsAdjectiveRelated(b) ? 1 : 0;
        if (bb !== aa) return bb - aa;
        return (a.title || "").localeCompare(b.title || "");
      });
    }
    return { suggestions, rest, hint: adjHint };
  }
})();

