/**
 * SpaceXAI / xAI API
 * 1) 查詢：文法盤點 + 實詞原形（短鍵 JSON）
 * 2) 表單：依規則名自動填寫說明／六人稱
 */
const AiService = (() => {
  const RULE_SYSTEM = `你是法語文法助教。依「規則名」產出筆記本卡片 JSON（不要 markdown／圍欄／其他文字）。

短鍵（必用）：
{"n":"極短中文用法名（法語標記）","c":"變位|時態|否定|代詞|介詞|冠詞|句型|其他","e":"繁中說明2–5句","p":true或false,"k":["關鍵詞"],"d":{"je":"","tu":"","il":"","nous":"","vous":"","ils":""}}

規則：
1. n 必須「極短中文用法名（法語標記）」，全形括號。標準例：**否定（ne…pas）**、未完成過去（imparfait）、命令（impératif）。中文極短；括號內只寫法語標記。禁止長句標題、禁止只寫「動詞」「時態」。
2. 動詞變位：p=true，d 填六格詞尾（-ais）或完整形（suis、ai）；k 可 []。
3. 一般文法：p=false，d 六格全 ""，k 填 pas、ne、n' 等表面形。
4. e 只寫用法，盡量無例句。不要 structure。
5. 一次一主題。第三組必須寫出該動詞的中文意思，禁止只寫「不規則」。
6. 標題括號內法語標記要具體，避免空泛「動詞」「時態」。
7. 【動詞標題】第一／二組規則動詞用通則：dure／parle → 現在時（-er présent）；finir → 現在時（-ir présent）。第三組一律「中文意思＋時態或用法（原形＋法語時態或用法）」：dit → 說現在時（dire présent）；suis → 是現在時（être présent）；pouvais → 能未完成過去（pouvoir imparfait）；souvient → 記得現在時（souvenir présent）；assis → 坐過去分詞（asseoir participe passé）。括號內是原形加法語，不要只寫時態，也不要把原形放在括號外。不規則 d 填完整形，禁止只填 -ais/-e。`;

  const INVENTORY_SYSTEM = `你是法語文法助教。盤點句中文法，並給實詞原形與簡義。只輸出一個 JSON（無 markdown／圍欄）。

【短鍵・必用】禁止 summary/translation/items 等長鍵：
{
  "u": "摘要可空",
  "t": "整句繁中翻譯（必填）",
  "i": [
    {"n":"極短中文用法名（法語標記）","c":"變位|時態|否定|代詞|介詞|冠詞|句型|其他","s":"句中片段","f":"h|m|l"}
  ],
  "v": [
    {"s":"句中表面形","l":"詞典原形／不定詞","g":"簡短中文義","p":"動詞|形容詞|名詞|副詞|代詞|數詞|其他","r":"m|f|mf|","vg":"1|2|3|","ip":"IPA音標","a":0,"b":2}
  ]
}

欄位：n=全名；c=分類；s=span 或 surface；f=h/m/l；v 中 l=lemma，g=gloss，p=詞性完整中文，r=性別（名詞／有性形容詞必填），vg=動詞組別（僅動詞），ip=句中表面形 s 的 IPA 音標（實詞必填，勿標原形 l），a/b=原文 start/end（0-based，b 不含）。

文法 i：
1. n 格式「極短中文用法名（法語標記）」，全形括號。如 **否定（ne…pas）**、過去分詞（-é）、現在時（présent）。中文極短；括號內只寫法語。
2. **獨立盤點**：不要推測或迎合使用者的本地筆記本。n 用標準功能名；句中實際文法都要列。
   - **規則動詞用第一／二組通則**：dure／parle／habite → 現在時（-er présent）；不要為每個 -er 動詞另立卡。
   - **第三組一律「中文意思＋時態或用法（原形＋法語）」**：souvient → 記得現在時（souvenir présent）；dit → 說現在時（dire présent）；suis → 是現在時（être présent）。禁止 souvenir 現在時（présent）、禁止 現在時（se souvenir）、禁止只在括號裡寫時態。
   - **不要把代詞列成文法卡**：主語／反身／賓語／副代詞 en／指示 ça／關係代詞。代詞當詞彙即可。
3. 禁止 n 只寫「不規則」「動詞變位」「現在時」「imparfait」等統稱。
4. 【第三組另立規則】suis/vais/peux/dit/souvient 等：n＝「中文意思＋時態或用法（原形＋法語時態或用法）」（是現在時（être présent）、記得現在時（souvenir présent）、能未完成過去（pouvoir imparfait））。不可併入 -er 通則，也不可套用另一個動詞名。
5. 只列值得建卡的點。不要參考任何本地筆記本標題。
6. 不要在 i 寫用法長文。
7. 一次一主題；句中只有 pouvais 不要列其他時態。
8. **s（span）極重要**：必須是查詢原文裡原樣找得到的最短法文（indexOf／不分大小寫能命中）。
   - 正確：pouvais、n'ai、pas、suis、déjeuné
   - 錯誤：-ais、imparfait、抽象標籤、ne…pas（若句中是 n'ai 與 pas 分開，可各報或用 n'ai pas 連續字）
   - 省音保留撇號：n'ai、j'ai、l'
10. 否定 ne…pas 可列一則；勿拆成無關的 ne、pas 兩張（除非只出現 pas）。
11. i 寧可少而準。
11b. **人稱代詞 COD／COI 勿混**：me／te／nous／vous 可能是直接或間接賓語。dire／parler／donner／demander 等「對人說／給」的對象是**間接賓語 COI**（te dit、lui parle），不要標成直接賓語（pronoms objets directs）。le／la／les＝COD；lui／leur＝第三人稱 COI。
11c. **不定式不是 avoir**：d'y voir、à faire、de parler 是不定式（infinitif），n 寫「不定式（infinitif）」或「不定式（voir）」。禁止套用 avoir／être 現在時或助動詞卡。avoir 只在有 ai／as／a／avons… 或複合過去助動詞時才報。
11d. **省音分清**：d'＝de 省音（d'y、d'un）；l'＝le／la 冠詞省音（l'histoire）。不可把 d' 標成 élision l'。
11e. **不規則過去分詞禁止套用 -é**：assis／assise（asseoir）、mis、pris、fait、dit、écrit、ouvert、vu 不是第一組 -é。n 寫「中文意思＋過去分詞（原形 participe passé）」，如 坐過去分詞（asseoir participe passé）、說過去分詞（dire participe passé）。不要寫成「過去分詞（-é）」或「過去分詞（assis）」。-é 只用於規則 -er（déjeuné、parlé）。
11f. **絕對構句**：須是「名詞＋分詞」獨立結構（la leçon finie, il partit）。分詞當狀語／同位（lui dit assis dans…）不要標 construction absolue。
11g. **普通名詞不是文法**：histoire／noir／idée／année 只進 v，不要進 i（不要「名詞（histoire）」這種卡）。冠詞／介詞的 s 只標標記本身（l'、le、dans），禁止包後面的名詞（不要把 l'histoire、dans la ville 當冠詞／介詞 span）。

詞彙 v（實詞原形・句中有實詞則必填）：
12. 列實詞，也列代詞與主有詞（on、il、elle、son、je、tu、nous、vous、se、mon、sa…）。每筆 g 必填簡短繁中義，禁止空白 g。冠詞與否定 ne/pas/le/de/un 不要進 v（le/la/les 作直接賓語代詞時要列入並寫意思）。
13. 動詞 l 用不定詞：pouvais→pouvoir；suis→être；déjeuné→déjeuner。
14. 名詞帶冠詞時 l 為名詞本體；g 一句內語境簡義（短）。
15. 同 l 去重；a/b 盡量給準。
16. **r（性別）極重要**：
   - 名詞必填：陽性 m、陰性 f、兩性皆可 mf
   - 有陰陽變化的形容詞：依詞典／本句形式標 m 或 f（或 mf）
   - 動詞、副詞、無性別詞：r 填空字串 ""
   - 例：étudiant→r=m；table→r=f；livre→r=m；eau→r=f；ami(e) 類可 mf
17. 單字查詢（query 只有一個詞）時，該詞若為名詞／形容詞仍必須在 v 給出 r。
18. **vg（動詞組別）· 動詞必填**：
   - "1"＝第一組（規則 -er，如 parler、déjeuner；aller 例外屬 3）
   - "2"＝第二組（規則 -ir，如 finir、choisir，nous -issons）
   - "3"＝第三組／不規則（être、avoir、aller、faire、pouvoir、prendre、venir、voir、mettre，以及 -re／-oir）
   - 規則 -er（parler、aimer、chanter、manger）必須 vg=1，不要標 3
   - 規則 -ir 且 nous 為 -issons（finir、choisir、réussir、grandir）必須 vg=2，不要標 3
   - 非動詞：vg 填空字串 ""
   - 例：déjeuné→l=déjeuner,vg=1；parle→l=parler,vg=1；finis→l=finir,vg=2；pouvais→l=pouvoir,vg=3；suis→l=être,vg=3
19. **ip（音標）· 實詞必填・標句中表面形**：
   - 用法語 IPA，對應 **s 句中表面形** 的實際讀音（變位形、複數、陰陽性等），**不要**標 l 原形／不定詞的音
   - 格式：斜線包住，如 /puvɛ/、/tabl/、/ɛtʁ/
   - 可省略重音符號；不要寫成拼音或英文近似
   - 例：s=pouvais,l=pouvoir → ip=/puvɛ/（不是 /puvwaʁ/）
   - 例：s=suis,l=être → ip=/sɥi/（不是 /ɛtʁ/）
   - 例：s=déjeuné,l=déjeuner → ip=/deʒœne/ 或 /deʒøne/（過去分詞讀音）
   - 例：s=table,l=table → ip=/tabl/（表面即原形時才相同）
20. **歌詞夾雜的英文**（翻譯行、yeah／baby／oh、the／you／I 等）不要列入 v；只列法語實詞。`

  function getConfig() {
    const s = Storage.loadSettings();
    return {
      apiKey: s.apiKey || "",
      baseUrl: (s.baseUrl || Storage.DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ""),
      model: s.model || Storage.DEFAULT_SETTINGS.model,
    };
  }

  function extractJson(text) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("API 回傳空白內容");
    try {
      return JSON.parse(raw);
    } catch {
      /* continue */
    }
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        /* continue */
      }
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("無法解析 API 回傳的 JSON");
  }

  const ALLOWED_CAT = new Set([
    "變位",
    "時態",
    "否定",
    "代詞",
    "介詞",
    "冠詞",
    "句型",
    "形容詞",
    "其他",
    "補充用法",
  ]);

  function pickField(obj, shortKey, ...longKeys) {
    if (obj == null || typeof obj !== "object") return "";
    if (obj[shortKey] != null && String(obj[shortKey]).trim() !== "") {
      return obj[shortKey];
    }
    for (const k of longKeys) {
      if (obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
    }
    return "";
  }

  const CONF_MAP = {
    h: "high",
    m: "medium",
    l: "low",
    high: "high",
    medium: "medium",
    low: "low",
  };

  function normalizePosLabel(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const key = s.toLowerCase().replace(/\s+/g, "");
    const map = {
      動: "動詞",
      動詞: "動詞",
      v: "動詞",
      verb: "動詞",
      形: "形容詞",
      形容詞: "形容詞",
      adj: "形容詞",
      adjective: "形容詞",
      名: "名詞",
      名詞: "名詞",
      n: "名詞",
      noun: "名詞",
      副: "副詞",
      副詞: "副詞",
      adv: "副詞",
      adverb: "副詞",
      代: "代詞",
      代詞: "代詞",
      pron: "代詞",
      數: "數詞",
      數詞: "數詞",
      其他: "其他",
      other: "其他",
    };
    if (map[key] || map[s]) return map[key] || map[s];
    if (/詞$|词$/.test(s) || s.length >= 2) return s;
    return s;
  }

  /**
   * 法語性別 → 統一中文標籤
   * @returns {""|"陽性"|"陰性"|"陽性／陰性"}
   */
  /**
   * 動詞組別：1／2／3 或空
   * 接受 1、2、3、第一組、1er、groupe 1 等
   */
  /** 法語 IPA：補 /…/、去掉多餘空白 */
  function normalizePhonetic(raw) {
    let s = String(raw || "")
      .trim()
      .normalize("NFC")
      .replace(/\s+/g, "");
    if (!s) return "";
    // 去掉常見括號包法，統一成 /ipa/
    s = s.replace(/^[\[\(（【]+/, "").replace(/[\]\)）】]+$/, "");
    if (!s.startsWith("/")) s = "/" + s;
    if (!s.endsWith("/")) s = s + "/";
    // 避免 // 空
    if (s === "//" || s.length < 3) return "";
    return s;
  }

  function normalizeVerbGroup(raw) {
    const s = String(raw || "")
      .trim()
      .toLowerCase()
      .normalize("NFC");
    if (!s) return "";
    if (s === "1" || s === "2" || s === "3") return s;
    if (/^(1er|premier|groupe\s*1|第一組|第一组|第1組|第1组)$/.test(s) || /^1\b/.test(s))
      return "1";
    if (
      /^(2e|deuxi[eè]me|groupe\s*2|第二組|第二组|第2組|第2组)$/.test(s) ||
      /^2\b/.test(s)
    )
      return "2";
    if (
      /^(3e|troisi[eè]me|groupe\s*3|第三組|第三组|第3組|第3组|不規則|不规则|irreg)/.test(s) ||
      /^3\b/.test(s)
    )
      return "3";
    const m = s.match(/(?:groupe|group|組|组)\s*([123])/i) || s.match(/^([123])$/);
    return m ? m[1] : "";
  }

  function normalizeGender(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const key = s
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[.（）().]/g, "")
      .replace(/性$/, "");
    if (
      key === "m" ||
      key === "masc" ||
      key === "masculin" ||
      key === "masculine" ||
      key === "陽" ||
      key === "陽性" ||
      key === "阳" ||
      key === "阳性" ||
      key === "男" ||
      key === "雄"
    ) {
      return "陽性";
    }
    if (
      key === "f" ||
      key === "fem" ||
      key === "féminin" ||
      key === "feminin" ||
      key === "feminine" ||
      key === "陰" ||
      key === "陰性" ||
      key === "阴" ||
      key === "阴性" ||
      key === "女" ||
      key === "雌"
    ) {
      return "陰性";
    }
    if (
      key === "mf" ||
      key === "fm" ||
      key === "m/f" ||
      key === "f/m" ||
      key === "both" ||
      key === "epicene" ||
      key === "épicène" ||
      key === "epicène" ||
      key === "兩性" ||
      key === "两性" ||
      key === "陽性陰性" ||
      key === "阳性阴性" ||
      key === "陽／陰" ||
      key === "阳／阴"
    ) {
      return "陽性／陰性";
    }
    // 已是中文標籤
    if (s === "陽性" || s === "陰性" || s === "陽性／陰性") return s;
    return "";
  }

  function normalizeDraft(data, fallbackTitle, opts = {}) {
    const d = data || {};
    const keepCategory = String(opts.keepCategory || "").trim();
    const endingsIn =
      (typeof d.d === "object" && d.d) ||
      (typeof d.endings === "object" && d.endings) ||
      {};
    const pick = (...keys) => {
      for (const k of keys) {
        const v = endingsIn[k];
        if (v != null && String(v).trim()) return String(v).trim();
      }
      return "";
    };
    const endings = {
      je: pick("je"),
      tu: pick("tu"),
      il: pick("il", "il/elle/on"),
      nous: pick("nous"),
      vous: pick("vous"),
      ils: pick("ils", "ils/elles"),
    };

    let hasPersons;
    const pRaw = pickField(d, "p", "has_persons");
    if (typeof pRaw === "boolean") hasPersons = pRaw;
    else if (pRaw === true || pRaw === "true" || pRaw === 1 || pRaw === "1") hasPersons = true;
    else if (pRaw === false || pRaw === "false" || pRaw === 0 || pRaw === "0") hasPersons = false;
    else hasPersons = Object.values(endings).some((v) => v);

    let category = String(pickField(d, "c", "category")).trim();
    if (keepCategory === "補充用法") {
      category = "補充用法";
      hasPersons = false;
    } else if (!ALLOWED_CAT.has(category)) {
      category = hasPersons ? "變位" : "其他";
    }

    let keywords = [];
    const kRaw = d.k != null ? d.k : d.keywords;
    if (Array.isArray(kRaw)) {
      keywords = kRaw.map((x) => String(x).trim()).filter(Boolean);
    }

    return {
      title:
        String(pickField(d, "n", "title")).trim() ||
        String(fallbackTitle || "").trim() ||
        fallbackTitle,
      category,
      explanation: String(pickField(d, "e", "explanation")).trim(),
      has_persons: hasPersons,
      keywords,
      endings: hasPersons
        ? endings
        : { je: "", tu: "", il: "", nous: "", vous: "", ils: "" },
    };
  }

  function normalizeInventory(data) {
    const raw = data || {};
    const summary = String(pickField(raw, "u", "summary")).trim();
    const translation = String(
      pickField(raw, "t", "translation", "sentenceTranslation", "fullTranslation")
    ).trim();

    const rawItems = Array.isArray(raw.i)
      ? raw.i
      : Array.isArray(raw.items)
        ? raw.items
        : [];

    const items = rawItems
      .map((it) => {
        let name = String(pickField(it, "n", "name", "title")).trim();
        let nameZh = String(pickField(it, "z", "nameZh", "zh")).trim();
        let nameFr = String(pickField(it, "k", "nameFr", "nameKo", "fr", "ko")).trim();
        // 短鍵 k 在 item 也可能被模型當 nameKo；若 n 已含括號，以 n 為準
        if (!name && (nameZh || nameFr)) {
          name = nameFr ? `${nameZh || "文法"}（${nameFr}）` : nameZh;
        }
        if (!name) return null;
        const zhOnly = name.replace(/[（(].*$/, "").trim();
        if (
          /^(名詞|普通名詞|可數名詞|不可數名詞|專有名詞|nouns?)$/i.test(zhOnly) &&
          !/複數|性數|配合/.test(name)
        ) {
          return null;
        }
        if (!nameZh || !nameFr) {
          const m = name.match(/^(.+?)[（(]\s*(.+?)\s*[）)]\s*$/);
          if (m) {
            nameZh = nameZh || m[1].trim();
            nameFr = nameFr || m[2].trim();
          } else {
            nameZh = nameZh || name;
          }
        }
        let category = String(pickField(it, "c", "category")).trim();
        if (!ALLOWED_CAT.has(category)) category = "其他";
        let confidence = String(pickField(it, "f", "confidence") || "m").toLowerCase();
        confidence = CONF_MAP[confidence] || "medium";

        const item = {
          name,
          nameZh,
          nameFr,
          nameKo: nameFr,
          category,
          span: String(pickField(it, "s", "span")).trim(),
          confidence,
        };
        // 保留手動校正欄位（歷史／專案快照再正規化時）
        if (it.source) item.source = String(it.source);
        if (it.manualRuleId) item.manualRuleId = String(it.manualRuleId);
        if (it.locatedManually) item.locatedManually = true;
        const st = it.start != null ? Number(it.start) : it.a != null ? Number(it.a) : NaN;
        const en = it.end != null ? Number(it.end) : it.b != null ? Number(it.b) : NaN;
        if (Number.isFinite(st) && Number.isFinite(en) && en > st) {
          item.start = st;
          item.end = en;
        }
        return item;
      })
      .filter(Boolean)
      .filter((it) => !(typeof FrParse !== "undefined" && FrParse.isPronounGrammar && FrParse.isPronounGrammar(it)));

    const rawVocab = Array.isArray(raw.v)
      ? raw.v
      : Array.isArray(raw.vocab)
        ? raw.vocab
        : [];

    const vocab = rawVocab
      .map((w) => {
        const surface = String(pickField(w, "s", "surface")).trim();
        const lemma = String(pickField(w, "l", "lemma", "base", "dictionaryForm")).trim();
        if (!surface && !lemma) return null;
        const gloss = String(pickField(w, "g", "gloss", "meaning", "translation")).trim();
        const pos = normalizePosLabel(pickField(w, "p", "pos", "partOfSpeech"));
        const gender = normalizeGender(
          pickField(w, "r", "gender", "genre", "sex", "性別", "阴阳", "陰陽")
        );
        let verbGroup = normalizeVerbGroup(
          pickField(w, "vg", "verbGroup", "group", "groupe", "verb_group", "conjugationGroup")
        );
        const lemmaFinal = lemma || surface;
        const looksInf =
          /(?:er|ir|re|oir)$/i.test(lemmaFinal) ||
          (typeof Analyzer !== "undefined" &&
            Analyzer.isIrregularInfinitive &&
            Analyzer.isIrregularInfinitive(lemmaFinal));
        const isVerb =
          pos === "動詞" || /動詞|verb/i.test(pos) || ((!pos || pos === "其他") && looksInf);
        // 第一／二組以本地不定詞為準，不採用 API 誤標的 3
        if (isVerb && typeof Analyzer !== "undefined" && Analyzer.reconcileVerbGroup) {
          const next = Analyzer.reconcileVerbGroup(verbGroup, lemmaFinal, surface);
          if (next) verbGroup = next;
        } else if (!verbGroup && isVerb && typeof Analyzer !== "undefined" && Analyzer.verbGroupForLemma) {
          const info = Analyzer.verbGroupForLemma(lemmaFinal);
          if (info?.code) verbGroup = info.code;
        }
        // 非動詞不保留組別
        if (!isVerb) {
          verbGroup = "";
        }
        const phonetic = normalizePhonetic(
          pickField(w, "ip", "ipa", "phonetic", "pronunciation", "pron", "音標", "讀音")
        );
        let start = w.a != null ? Number(w.a) : w.start != null ? Number(w.start) : NaN;
        let end = w.b != null ? Number(w.b) : w.end != null ? Number(w.end) : NaN;
        if (!Number.isFinite(start)) start = null;
        if (!Number.isFinite(end)) end = null;
        return {
          surface: surface || lemma,
          lemma: lemmaFinal,
          gloss,
          pos,
          gender,
          verbGroup: verbGroup || "",
          phonetic,
          start,
          end,
        };
      })
      .filter(Boolean)
      .filter((w) => !(typeof Storage !== "undefined" && Storage.isEnglishVocabSkip && Storage.isEnglishVocabSkip(w.surface, w.lemma)));

    const tokens = Array.isArray(raw.tokens) ? raw.tokens : [];
    const out = { summary, translation, items, vocab };
    if (tokens.length) out.tokens = tokens;
    if (raw.mappingFailed) out.mappingFailed = true;
    if (raw.fallbackLegacy) out.fallbackLegacy = true;
    const rejected = Number(raw.apiRejectedCount);
    const unresolved = Number(raw.unresolvedGrammarCount);
    if (Number.isFinite(rejected) && rejected > 0) out.apiRejectedCount = rejected;
    if (Number.isFinite(unresolved) && unresolved > 0) out.unresolvedGrammarCount = unresolved;
    if (raw.apiRepairUsed) out.apiRepairUsed = true;
    return out;
  }

  async function chatComplete({ messages, temperature = 0.3, jsonObject = false }) {
    const { apiKey, baseUrl, model } = getConfig();
    if (!apiKey) throw new Error("尚未設定 API Key，請先到「設定」填入");

    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          stream: false,
          ...(jsonObject ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    } catch (err) {
      const msg = err?.message || String(err);
      if (/Failed to fetch|NetworkError|CORS/i.test(msg)) {
        throw new Error("無法連線 API（可能是網路或瀏覽器 CORS）。請確認 Base URL 與金鑰。");
      }
      throw new Error("網路錯誤：" + msg);
    }

    const bodyText = await res.text();
    let body;
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      body = { raw: bodyText };
    }

    if (!res.ok) {
      const detail =
        body?.error?.message ||
        body?.message ||
        body?.error ||
        bodyText?.slice(0, 200) ||
        res.statusText;
      if (res.status === 401 || res.status === 403) {
        throw new Error("API Key 無效或無權限（" + res.status + "）");
      }
      throw new Error(`API 錯誤 ${res.status}：${detail}`);
    }

    const content = body?.choices?.[0]?.message?.content;
    if (!content) throw new Error("API 回傳沒有內容");
    return content;
  }

  async function completeRuleFromTitle(title, opts = {}) {
    const t = String(title || "").trim();
    if (!t) throw new Error("請先填寫規則名");
    const keepCategory = String(opts.keepCategory || "").trim();
    const isSupp = keepCategory === "補充用法";

    const userContent = isSupp
      ? `規則名：${t}\n\n這是一張「補充用法」卡片（成語／慣用／語境補充，不是一般文法規則）。\n請依此產出短鍵 JSON。n 必須是「極短中文用法名（法語標記）」。\n**c 必須輸出「補充用法」**，不可改成變位／時態／否定／代詞／介詞／冠詞／句型／形容詞／其他。\np 通常為 false，d 六格全空。說明聚焦此用法的語境、語氣與注意點。`
      : `規則名：${t}\n\n請產出短鍵 JSON。n 必須「極短中文用法名（法語標記）」，如 否定（ne…pas）。動詞填六人稱 d；不要 structure。`;

    const content = await chatComplete({
      messages: [
        { role: "system", content: RULE_SYSTEM },
        {
          role: "user",
          content: userContent,
        },
      ],
      temperature: 0.25,
    });

    return normalizeDraft(extractJson(content), t, { keepCategory });
  }

  /** 僅單字／原形：短 prompt、不帶本地規則標題（省 tokens） */
  const VOCAB_ONLY_SYSTEM = `你是法語詞彙助教。只做實詞原形與簡義，不盤點文法。只輸出一個 JSON（無 markdown／圍欄）。

短鍵：
{"u":"","t":"整句繁中翻譯（單詞則給該詞義）","v":[{"s":"表面形","l":"詞典原形／不定詞","g":"簡短中文義","p":"動詞|形容詞|名詞|副詞|代詞|數詞|其他","r":"m|f|mf|","vg":"1|2|3|","ip":"/句中形IPA/","a":0,"b":2}]}

規則：
1. 禁止輸出文法陣列 i／items；不要寫變位通則、否定結構等文法卡。
2. v 要列實詞，也要列代詞與主有詞：on、il、elle、je、tu、nous、vous、ils、elles、me、te、se、lui、mon／ma／mes、ton／ta／tes、son／sa／ses、notre、votre。每筆 g 必填簡短繁中義（on→有人／我們，son→他的／她的，il→他，elle→她）。g 空白的詞不要放進 v。
3. 冠詞與否定 ne／pas／le／la／un／de／du／des 不要進 v。le／la／les 若是直接賓語代詞才列入，並寫意思。
4. 動詞 l 用不定詞；名詞 l 為名詞本體。
5. r：名詞／有性形容詞填 m|f|mf；動詞等填 ""。
6. vg：動詞填 1|2|3；非動詞 ""。規則 -er 是 1，規則 -ir（finir 型，nous -issons）是 2。不要把第一組、第二組標成 3。只有真正不規則（être、aller、pouvoir、-re、-oir、venir／partir／ouvrir 型）才是 3。
7. ip：實詞必填 IPA，必須是 **s 句中表面形** 的讀音（變位／複數等），禁止標 l 原形音。例：s=pouvais→/puvɛ/；s=suis→/sɥi/。代詞可寫 ip，沒有把握可留空，但 g 仍必填。
8. 同 l 可多筆不同 s；a/b 盡量準。
9. 夾雜的英文（翻譯行、yeah／baby／oh、the／you／I 等）不要列入 v。`;

  const MAP_SYSTEM = `你是法語文法審核器。只審「需消歧」項目並給整句翻譯。本地高信心項已判定，禁止改判或否決。不知道使用者有哪些本地卡。只輸出 JSON。

格式：{"u":"短摘要","t":"整句繁中翻譯","fn":[{"q":"清單ID或new:序號","x":"confirmed|rejected|reclassified|unknown","g":"穩定文法key","n":"極短中文名（法語標記）","a":0,"b":0,"c":"變位|時態|否定|代詞|介詞|冠詞|句型|形容詞|其他","f":"h|m|l","e":"短理由"}]}

硬性規則：
1. 必處理清單每個 ID 在 fn 恰好一次。confirmed＝此處成立；reclassified＝種類不對、改 g/n；rejected＝此處不成立；unknown＝無法判斷。
2. rejected／unknown 可省 n/g/a/b；confirmed／reclassified 必填 g/n/a/b/c/f。清單外補漏用 q="new:1" 起編。
3. g 必須是 ASCII 語義鍵（article:def、pron:cod、pron:coi、prep:en、prep:de、verb:etre:present、inf:infinitif），不可用本地卡名。
4. a/b 是切詞編號含兩端，只蓋文法標記，不要包後面實詞。
5. 確認項 n 必須等於清單名稱。改判：規則 -er／-ir 用 現在時（-er présent）／現在時（-ir présent）；第三組用 記得現在時（souvenir présent）、說現在時（dire présent）這種「中文意思＋時態（原形＋法語）」。禁止把規則動詞改成 durer 現在時（présent），也禁止把第三組寫成 souvenir 現在時（présent）。
6. 同形異義依語境：le/la/les 後接動詞＝pron:cod，後接名詞＝article:def；en 後接地名／語言＝prep:en，否則 pron:en；leur 後接名詞＝det:poss，否則 pron:coi。
7. 不要否決或改寫「已本地確認」列。不要把普通名詞當文法。不要把代詞（je／on／se／en／ça／lui）列成文法。t 必填繁中翻譯。`;

  /**
   * 切詞後請模型把區間對上文法功能（不傳本地卡名）。
   */
  async function mapGrammarFunctions(query, tokens, candidates, checklistInput, repairOnly = false) {
    const q = String(query || "").trim();
    const checklist = Array.isArray(checklistInput)
      ? checklistInput
      : FrParse.grammarChecklist(tokens, candidates, { apiOnly: true });
    const tokenLines =
      typeof FrParse !== "undefined" && FrParse.compactTokenLines
        ? FrParse.compactTokenLines(tokens)
        : "";
    const disambForPrompt = (candidates || []).filter((c) => c.needsDisambiguation);
    const candLines =
      typeof FrParse !== "undefined" && FrParse.compactCandidateLines
        ? FrParse.compactCandidateLines(disambForPrompt)
        : "";
    const localLines =
      typeof FrParse.compactLocalConfirmedLines === "function"
        ? FrParse.compactLocalConfirmedLines(candidates)
        : "";
    const checklistLines =
      typeof FrParse.compactChecklistLines === "function"
        ? FrParse.compactChecklistLines(checklist)
        : "";
    const content = await chatComplete({
      messages: [
        { role: "system", content: MAP_SYSTEM },
        {
          role: "user",
          content: `原文：\n${q}\n\n切詞：\n${tokenLines}\n\n需消歧候選：\n${candLines || "（無）"}\n\n已本地確認（禁止改判／否決）：\n${localLines || "（無）"}\n\n必處理清單（每個 ID 恰答一次）：\n${checklistLines || "（空；仍須填 t 翻譯，可補 new 文法）"}${
            repairOnly ? "\n\n這是補查：只回答上列未完成 ID，不要新增 new 項目。" : ""
          }`,
        },
      ],
      temperature: 0.2,
      jsonObject: true,
    });
    return FrParse.parseMappedFunctions(extractJson(content));
  }

  function mergeMappedGrammar(base, patch) {
    const left = base || {};
    const right = patch || {};
    const decisionMap = new Map();
    for (const d of [...(left.decisions || []), ...(right.decisions || [])]) {
      const id = String(d?.candidateId || "").trim();
      if (id) decisionMap.set(id, d);
    }
    const fnMap = new Map();
    for (const fn of [...(left.functions || []), ...(right.functions || [])]) {
      const id = String(fn?.candidateId || "").trim();
      const key = id || `${fn?.grammarKey || fn?.name || "?"}:${fn?.tokenFrom}:${fn?.tokenTo}`;
      fnMap.set(key, fn);
    }
    const rejected = new Set(
      [...decisionMap.values()]
        .filter((d) => d.status === "rejected" || d.status === "unknown")
        .map((d) => d.candidateId)
    );
    return {
      functions: [...fnMap.values()].filter(
        (fn) => !fn.candidateId || !rejected.has(fn.candidateId)
      ),
      decisions: [...decisionMap.values()],
      translation: left.translation || right.translation || "",
      summary: left.summary || right.summary || "",
    };
  }

  async function repairGrammarFunctions(query, tokens, candidates, unresolved) {
    const ids = new Set((unresolved || []).map((x) => x.id));
    const relevant = (candidates || []).filter((c) => ids.has(FrParse.candidateDecisionId(c)));
    return mapGrammarFunctions(query, tokens, relevant, unresolved, true);
  }

  /**
   * 先本地切詞、再獨立對卡。切詞失敗時由呼叫端回退舊盤點。
   */
  async function inventoryByFrParse(query, opts = {}) {
    const q = String(query || "").trim();
    if (!q) throw new Error("請輸入查詢內容");
    if (typeof FrParse === "undefined" || !FrParse.tokenize) {
      throw new Error("FrParse 未載入");
    }

    const tokens = FrParse.tokenize(q);
    if (!tokens.length) throw new Error("切詞結果沒有有效語素");

    const candidates = FrParse.deterministicFunctions(q, tokens);
    const localConfirmed =
      typeof FrParse.localConfirmedFromCandidates === "function"
        ? FrParse.localConfirmedFromCandidates(candidates)
        : { functions: [], decisions: [] };
    const checklist = FrParse.grammarChecklist(tokens, candidates, { apiOnly: true });
    let mapped = {
      functions: localConfirmed.functions.slice(),
      decisions: localConfirmed.decisions.slice(),
      translation: "",
      summary: "",
    };
    let firstMappingFailed = false;
    try {
      const apiMapped = await mapGrammarFunctions(q, tokens, candidates, checklist);
      mapped = mergeMappedGrammar(mapped, apiMapped);
    } catch (err) {
      console.warn("[mapGrammarFunctions]", err);
      firstMappingFailed = true;
      mapped.summary = mapped.summary || "切詞完成；消歧未完成，僅列出高信心項目";
    }

    let unresolved = FrParse.unresolvedGrammarChecklist(checklist, mapped);
    let apiRepairUsed = false;
    if (unresolved.length) {
      apiRepairUsed = true;
      try {
        const repaired = await repairGrammarFunctions(q, tokens, candidates, unresolved);
        mapped = mergeMappedGrammar(mapped, repaired);
      } catch (err) {
        console.warn("[repairGrammarFunctions]", err);
      }
      unresolved = FrParse.unresolvedGrammarChecklist(checklist, mapped);
    }
    const mappingFailed = unresolved.length > 0;
    const items = FrParse.functionsToItems(tokens, mapped.functions, candidates, {
      mappingFailed,
      src: q,
      candidateDecisions: mapped.decisions,
    });
    const vocab = opts.skipVocab ? [] : FrParse.tokensToVocab(tokens);
    const nTok = tokens.filter((t) => t.pos !== "標點" && t.pos !== "空白").length;
    const apiRejectedCount = (mapped.decisions || []).filter((d) => d.status === "rejected").length;
    return {
      summary:
        mapped.summary ||
        (mappingFailed
          ? `切詞 ${nTok} 塊 · 尚有 ${unresolved.length} 項待確認`
          : `切詞 ${nTok} 塊 · 文法 ${items.length} 點`),
      translation: mapped.translation || "",
      items,
      vocab,
      tokens: FrParse.slimTokens(tokens),
      mappingFailed,
      firstMappingFailed,
      apiRejectedCount,
      unresolvedGrammarCount: unresolved.length,
      apiRepairUsed,
    };
  }

  async function inventoryGrammar(query, _localTitles = []) {
    const q = String(query || "").trim();
    if (!q) throw new Error("請輸入查詢內容");

    const content = await chatComplete({
      messages: [
        { role: "system", content: INVENTORY_SYSTEM },
        {
          role: "user",
          content: `查詢內容：\n${q}\n\n請先獨立盤點句中所有實際文法，不參考任何本地筆記本內容。請輸出短鍵 JSON（u/t/i/v）。\n- 名詞／形容詞 v 項必須填 r 性別（m／f／mf）；動詞 r 填 ""、vg 填 1|2|3\n- 實詞 v 項必須填 ip＝**句中表面形 s 的 IPA**（變位音），勿標原形 l 的音\n- i[].s 必須是原文中找得到的片段\n- 不規則動詞勿套第一組通則標題，也勿因同為「現在時」而套用其他動詞名（dit ≠ prendre）`,
        },
      ],
      temperature: 0.15,
      jsonObject: true,
    });

    const inv = normalizeInventory(extractJson(content));
    if (typeof FrParse !== "undefined" && FrParse.ensureClosedClassVocab) {
      inv.vocab = FrParse.ensureClosedClassVocab(q, inv.vocab);
    }
    return inv;
  }

  /**
   * 僅 API 單字（無文法盤點）：輕量請求，不傳本地規則標題
   * @param {string} query
   */
  async function inventoryVocabOnly(query) {
    const q = String(query || "").trim();
    if (!q) throw new Error("請輸入查詢內容");

    const content = await chatComplete({
      messages: [
        { role: "system", content: VOCAB_ONLY_SYSTEM },
        {
          role: "user",
          content: `查詢內容：\n${q}\n\n只輸出 u/t/v（禁止 i）。名詞／形容詞填 r；動詞填 vg 與 r=""；實詞填 ip＝**s 句中形**的 IPA（不是 l 原形音）。`,
        },
      ],
      temperature: 0.15,
    });

    const inv = normalizeInventory(extractJson(content));
    inv.items = [];
    inv.mode = "vocab-only";
    inv.source = inv.source || "api-vocab";
    if (typeof FrParse !== "undefined" && FrParse.ensureClosedClassVocab) {
      inv.vocab = FrParse.ensureClosedClassVocab(q, inv.vocab);
    } else {
      inv.vocab = (inv.vocab || []).filter((w) => String(w.gloss || "").trim() && String(w.surface || w.lemma || "").trim());
    }
    if (!inv.summary) inv.summary = `API 單字：${(inv.vocab || []).length} 詞`;
    return inv;
  }

  /**
   * 單一選取詞的 AI 填寫
   * @param {string} surface
   * @param {string} [sentence]
   */
  async function completeWordFromSurface(surface, sentence = "") {
    const surf = String(surface || "").trim();
    if (!surf) throw new Error("沒有選取的詞");
    if (
      typeof Storage !== "undefined" &&
      Storage.isEnglishVocabSkip &&
      Storage.isEnglishVocabSkip(surf, "", sentence)
    ) {
      throw new Error("這是英文詞，已略過（不查詢、不收入單字庫）");
    }
    const ctx = String(sentence || "").trim();
    const content = await chatComplete({
      messages: [
        {
          role: "system",
          content: `你是法語詞彙助教。使用者選定一個詞，請補齊詞彙。只輸出一個 JSON（無 markdown）：
{"s":"句中表面形","l":"詞典原形／不定詞","g":"簡短繁中義","p":"動詞|名詞|形容詞|副詞|代詞|其他","r":"陽|陰|（可空）","vg":"1|2|3|（僅動詞）","ip":"句中形 IPA 音標"}
名詞／形容詞填 r；動詞填 vg 與 r 空；ip 是 surface 的讀音。`,
        },
        {
          role: "user",
          content: ctx
            ? `選定詞：「${surf}」\n所在句子：${ctx}\n請依語境填寫該詞 JSON。`
            : `選定詞：「${surf}」\n請填寫該詞 JSON。`,
        },
      ],
      temperature: 0.15,
    });
    const parsed = extractJson(content);
    const raw =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Array.isArray(parsed.v)
          ? parsed.v[0]
          : Array.isArray(parsed.vocab)
            ? parsed.vocab[0]
            : parsed
        : null;
    const inv = normalizeInventory({ u: "", t: "", i: [], v: raw ? [raw] : [] });
    let w = (inv.vocab || [])[0];
    if (w && !w.surface) w.surface = surf;
    if (typeof FrParse !== "undefined" && FrParse.ensureClosedClassVocab) {
      const filled = FrParse.ensureClosedClassVocab(ctx || surf, w ? [w] : [{ surface: surf }]);
      const form = surf.normalize("NFC").toLowerCase();
      w =
        filled.find((item) => String(item.surface || "").normalize("NFC").toLowerCase() === form) ||
        filled[0] ||
        w;
    }
    if (!w || !String(w.gloss || "").trim()) throw new Error("AI 未回傳這個詞的意思");
    if (!w.surface) w.surface = surf;
    return w;
  }

  const LYRIC_SPLIT_SYSTEM = `你是法語歌詞編輯。把文本依「畫面／短語／子句」切開，讓每一行是一個完整意思單位。

必須只輸出一個 JSON 物件（不要 markdown、不要圍欄、不要其他文字）：
{"lines":["第一行","第二行"]}

規則：
1. 不要改寫、不要翻譯、不要增刪用字、不要加標點。只決定換行。原文順序與用字必須原樣保留。
2. 空白是單詞分隔，不是行界：不要每個空格都斷行。已有換行可當句界；不要合併意思不相接的行。
3. 每一行最多 36 字（含空格與標點，一字算 1）。超過 36 字必須再切；已 ≤36 且意思完整的行不要再切。
4. 切在「畫面／短語／子句交界」，不要切在修飾關係中間：
   - 冠詞＋名詞（le ciel、l'amour、une chanson）整組保留。
   - 介詞短語（sous le ciel、dans le cœur、d'aujourd'hui）盡量整組保留。
   - 代詞＋動詞（je t'aime、ne me quitte、s'envole）不要切開。
   - 省音（l'、d'、j'、n'、c'、qu'、s'）絕對不要與後面的詞切開。
5. 不要把單詞從中間切斷，也不要切斷連字號詞（peut-être）。
6. 連接詞 et／mais／ou／puis 可當切點（切在連接詞之前）。

正確例子：
輸入：Sous le ciel de Paris s'envole une chanson elle est née d'aujourd'hui dans le cœur d'un garçon
輸出：{"lines":["Sous le ciel de Paris","s'envole une chanson","elle est née d'aujourd'hui","dans le cœur d'un garçon"]}`;

  const PHONE_LINE_SOFT = 28;
  const PHONE_LINE_HARD = 36;
  const FR_CLITIC =
    /^(?:l|d|j|n|c|s|m|t|qu|le|la|les|un|une|des|de|du|au|aux|je|tu|il|ils|elle|elles|on|ce|cet|cette|mon|ma|mes|ton|ta|tes|son|sa|ses|ne|me|te|se|y|en|dans|sur|sous|vers|chez|avec|pour|par|sans)$/i;
  const FR_CONJ = /^(?:et|mais|ou|puis|donc|car|ni|quand|lorsque|si|comme|parce)$/i;
  const FR_CLAUSE_START =
    /^(?:je|tu|il|elle|on|nous|vous|ils|elles|dans|sur|sous|vers|chez|avec|pour|sans)$/i;

  function charLen(s) {
    return Array.from(String(s || "")).length;
  }

  function compactSource(s) {
    return String(s || "").replace(/\s+/g, "");
  }

  function indexAfterChars(s, count) {
    return Array.from(String(s || "")).slice(0, Math.max(0, count)).join("").length;
  }

  function frWordBefore(chars, i) {
    let end = i;
    while (end > 0 && /\s/.test(chars[end - 1])) end -= 1;
    let start = end;
    while (start > 0 && /[A-Za-zÀ-ÿĀ-ž'’\-]/.test(chars[start - 1])) start -= 1;
    return chars.slice(start, end).join("").toLowerCase();
  }

  function frWordAfter(chars, i) {
    let start = i;
    while (start < chars.length && /\s/.test(chars[start])) start += 1;
    let end = start;
    while (end < chars.length && /[A-Za-zÀ-ÿĀ-ž'’\-]/.test(chars[end])) end += 1;
    return chars.slice(start, end).join("").toLowerCase();
  }

  function isDanglingLeftWord(w) {
    const s = String(w || "").toLowerCase();
    if (FR_CLITIC.test(s)) return true;
    if (/^[ldjncsmqt]u?['’]$/.test(s)) return true;
    return false;
  }

  function scoreMeaningCut(chars, i) {
    const n = chars.length;
    if (i < 8 || i > n - 4) return -1;
    const last = chars[i - 1] || "";
    const next = chars[i] || "";
    if (last === "'" || last === "’" || last === "-") return -1;
    if (/[A-Za-zÀ-ÿ]/.test(last) && /[A-Za-zÀ-ÿ]/.test(next)) return -1;
    const atBound = /\s/.test(last) || /\s/.test(next) || /[.,;:!?…»"]/.test(last);
    if (!atBound) return -1;
    if (isDanglingLeftWord(frWordBefore(chars, i))) return -1;
    const rightFull = frWordAfter(chars, i);
    const rightW = rightFull.replace(/['’].*$/, "");
    let score = 0;
    if (/[.!?…]/.test(last)) score += 100;
    else if (/[,;:]/.test(last)) score += 86;
    else if (FR_CONJ.test(rightW)) score += 74;
    else if (FR_CLAUSE_START.test(rightW) || /^(?:[sjnmt]['’])[a-zà-ÿ]{2,}/i.test(rightFull)) {
      score += 70;
    }
    else if (FR_CONJ.test(frWordBefore(chars, i))) score += 22;
    else if (/\s/.test(last) || /\s/.test(next)) score += 36;
    else return -1;
    if (i <= PHONE_LINE_HARD) score += 8;
    const dist = Math.abs(i - PHONE_LINE_SOFT);
    score += Math.max(0, 14 - dist);
    return score;
  }

  function findMeaningCut(s) {
    const chars = Array.from(String(s || ""));
    const n = chars.length;
    if (n <= PHONE_LINE_HARD) return 0;
    const min = 8;
    const max = Math.min(PHONE_LINE_HARD, n - 4);
    let bestI = 0;
    let bestScore = 9;
    for (let i = max; i >= min; i -= 1) {
      const sc = scoreMeaningCut(chars, i);
      if (sc > bestScore) {
        bestScore = sc;
        bestI = i;
      }
    }
    if (bestI) return indexAfterChars(s, bestI);
    for (let i = max; i >= min; i -= 1) {
      if (/\s/.test(chars[i - 1]) || /\s/.test(chars[i])) return indexAfterChars(s, i);
    }
    return 0;
  }

  function splitLongLineByMeaning(line) {
    const s = String(line || "").trim();
    if (!s) return [];
    if (charLen(s) <= PHONE_LINE_HARD) return [s];
    const cut = findMeaningCut(s);
    if (!cut) {
      const chars = Array.from(s);
      const left = chars.slice(0, PHONE_LINE_HARD).join("");
      const right = chars.slice(PHONE_LINE_HARD).join("");
      return [left, ...splitLongLineByMeaning(right)];
    }
    const left = s.slice(0, cut).trim();
    const right = s.slice(cut).trim();
    if (!left || !right) return [s];
    return [left, ...splitLongLineByMeaning(right)];
  }

  function enforcePhoneLineLength(lines) {
    return (Array.isArray(lines) ? lines : [lines])
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .flatMap((line) => splitLongLineByMeaning(line));
  }

  function chunkLyricText(text) {
    const lines = String(text || "").split(/\r?\n/);
    const chunks = [];
    let buf = [];
    let size = 0;
    const flush = () => {
      if (!buf.length) return;
      chunks.push(buf.join("\n"));
      buf = [];
      size = 0;
    };
    for (const line of lines) {
      const add = line.length + 1;
      if (buf.length && size + add > 1400) flush();
      buf.push(line);
      size += add;
    }
    flush();
    return chunks.length ? chunks : [String(text || "")];
  }

  function normalizeSplitLines(parsed) {
    let arr = [];
    if (Array.isArray(parsed)) arr = parsed;
    else if (Array.isArray(parsed?.lines)) arr = parsed.lines;
    else if (Array.isArray(parsed?.sentences)) arr = parsed.sentences;
    return arr.map((x) => String(x || "").trim()).filter(Boolean);
  }

  async function splitLyricChunk(chunk) {
    const content = await chatComplete({
      messages: [
        { role: "system", content: LYRIC_SPLIT_SYSTEM },
        {
          role: "user",
          content: `請依畫面／短語切開，每行最多 36 字。空白是詞界不是行界。只輸出 JSON。\n\n${chunk}`,
        },
      ],
      temperature: 0.15,
      jsonObject: true,
    });
    return normalizeSplitLines(extractJson(content));
  }

  async function splitLyricLines(text) {
    const raw = String(text || "");
    if (!raw.trim()) throw new Error("請先貼上歌詞或文本");
    const chunks = chunkLyricText(raw);
    const collected = [];
    for (const chunk of chunks) {
      const part = await splitLyricChunk(chunk);
      collected.push(...part);
    }
    const lines = enforcePhoneLineLength(collected);
    if (!lines.length) throw new Error("AI 沒有回傳可分行的句子");
    const src = compactSource(raw);
    const out = compactSource(lines.join(""));
    if (src && out && src !== out) {
      if (src.includes(out) || out.includes(src)) {
        return lines;
      }
      throw new Error("AI 改動了原文用字，已取消套用");
    }
    return lines;
  }

  async function testConnection() {
    const content = await chatComplete({
      messages: [
        { role: "system", content: "Reply with exactly: ok" },
        { role: "user", content: "ping" },
      ],
      temperature: 0,
    });
    return { ok: true, sample: String(content).slice(0, 80) };
  }

  return {
    getConfig,
    completeRuleFromTitle,
    completeWordFromSurface,
    splitLyricLines,
    enforcePhoneLineLength,
    mapGrammarFunctions,
    inventoryByFrParse,
    inventoryGrammar,
    inventoryVocabOnly,
    normalizeDraft,
    normalizeInventory,
    testConnection,
  };
})();
