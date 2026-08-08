/**
 * SpaceXAI / xAI API
 * 1) 查詢：文法盤點 + 實詞原形（短鍵 JSON）
 * 2) 表單：依規則名自動填寫說明／六人稱
 */
const AiService = (() => {
  const RULE_SYSTEM = `你是法語文法助教。依「規則名」產出筆記本卡片 JSON（不要 markdown／圍欄／其他文字）。

短鍵（必用）：
{"n":"中文（法語）","c":"變位|時態|否定|代詞|介詞|冠詞|句型|其他","e":"繁中說明2–5句","p":true或false,"k":["關鍵詞"],"d":{"je":"","tu":"","il":"","nous":"","vous":"","ils":""}}

規則：
1. n 必須「中文（法語）」，如 未完成過去（imparfait）、否定（ne…pas）、être 現在時（être présent）。
2. 動詞變位：p=true，d 填六格詞尾（-ais）或完整形（suis、ai）；k 可 []。
3. 一般文法：p=false，d 六格全 ""，k 填 pas、ne、n' 等表面形。
4. e 只寫用法，盡量無例句。不要 structure。
5. 一次一主題。不規則必須寫具體動詞名（如 pouvoir 現在時），禁止只寫「不規則」。
6. 標題括號內法語標記要具體，避免空泛「動詞」「時態」。
7. 【不規則另立規則】être／avoir／aller／faire／pouvoir／vouloir／devoir／savoir／venir／prendre 等：n 必須含不定詞（如 pouvoir 未完成過去（pouvoir imparfait））；d 填完整形，禁止只填通則詞尾 -ais/-e；不可做成「第一組 -er」通則卡。`;

  const INVENTORY_SYSTEM = `你是法語文法助教。盤點句中文法，並給實詞原形與簡義。只輸出一個 JSON（無 markdown／圍欄）。

【短鍵・必用】禁止 summary/translation/items 等長鍵：
{
  "u": "摘要可空",
  "t": "整句繁中翻譯（必填）",
  "i": [
    {"n":"中文（法語）","c":"變位|時態|否定|代詞|介詞|冠詞|句型|其他","s":"句中片段","f":"h|m|l"}
  ],
  "v": [
    {"s":"句中表面形","l":"詞典原形／不定詞","g":"簡短中文義","p":"動詞|形容詞|名詞|副詞|代詞|數詞|其他","r":"m|f|mf|","vg":"1|2|3|","ip":"IPA音標","a":0,"b":2}
  ]
}

欄位：n=全名；c=分類；s=span 或 surface；f=h/m/l；v 中 l=lemma，g=gloss，p=詞性完整中文，r=性別（名詞／有性形容詞必填），vg=動詞組別（僅動詞），ip=句中表面形 s 的 IPA 音標（實詞必填，勿標原形 l），a/b=原文 start/end（0-based，b 不含）。

文法 i：
1. n 格式 中文（法語），如 過去分詞（-é）、否定（ne…pas）、avoir 現在時（avoir présent）。
2. **優先沿用「本地已有規則標題」原文**（user 訊息會列出）。若句中文法已有對應卡，n 必須與列表中某一標題**完全一致**（一字不改），方便系統判「已收錄」。
3. 通則與具體動詞分開：pouvais → 若本地有「pouvoir 未完成過去（pouvoir imparfait）」就用該標題；勿只寫「未完成過去」或「第一組…imparfait」。
4. 禁止 n 只寫「不規則」「動詞變位」「現在時」「imparfait」等統稱。
5. 【不規則另立規則】句中不規則動詞（suis/vais/peux/veux/fais/allais/voulais…）的 n 必須含該不定詞；不可併入「第一組動詞現在時／未完成過去」通則。規則 -er 動詞才可用通則名。
6. 只列值得建卡的點；已有本地規則也可列（標題用本地原文）。
7. 不要在 i 寫用法長文。
8. 一次一主題；句中只有 pouvais 不要列其他時態。
9. **s（span）極重要**：必須是查詢原文裡原樣找得到的最短法文（indexOf／不分大小寫能命中）。
   - 正確：pouvais、n'ai、pas、suis、déjeuné
   - 錯誤：-ais、imparfait、抽象標籤、ne…pas（若句中是 n'ai 與 pas 分開，可各報或用 n'ai pas 連續字）
   - 省音保留撇號：n'ai、j'ai、l'
10. 否定 ne…pas 可列一則；勿拆成無關的 ne、pas 兩張（除非只出現 pas）。
11. i 寧可少而準。

詞彙 v（實詞原形・句中有實詞則必填）：
12. 只列實詞（名/動/形/副/代等）；語法小詞 ne/pas/le/de 等不要進 v（文法進 i）。
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
   - "3"＝第三組／不規則（être、avoir、aller、faire、pouvoir、prendre、venir、voir、mettre…）
   - 非動詞：vg 填空字串 ""
   - 例：déjeuné→l=déjeuner,vg=1；pouvais→l=pouvoir,vg=3；finis→l=finir,vg=2；suis→l=être,vg=3
19. **ip（音標）· 實詞必填・標句中表面形**：
   - 用法語 IPA，對應 **s 句中表面形** 的實際讀音（變位形、複數、陰陽性等），**不要**標 l 原形／不定詞的音
   - 格式：斜線包住，如 /puvɛ/、/tabl/、/ɛtʁ/
   - 可省略重音符號；不要寫成拼音或英文近似
   - 例：s=pouvais,l=pouvoir → ip=/puvɛ/（不是 /puvwaʁ/）
   - 例：s=suis,l=être → ip=/sɥi/（不是 /ɛtʁ/）
   - 例：s=déjeuné,l=déjeuner → ip=/deʒœne/ 或 /deʒøne/（過去分詞讀音）
   - 例：s=table,l=table → ip=/tabl/（表面即原形時才相同）`;

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

  function normalizeDraft(data, fallbackTitle) {
    const d = data || {};
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
    if (!ALLOWED_CAT.has(category)) category = hasPersons ? "變位" : "其他";

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
      .filter(Boolean);

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
        // 動詞：API 未給 vg 時，本地依不定詞推估組別
        if (!verbGroup && isVerb && typeof Analyzer !== "undefined" && Analyzer.verbGroupForLemma) {
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
      .filter(Boolean);

    return { summary, translation, items, vocab };
  }

  async function chatComplete({ messages, temperature = 0.3 }) {
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
        body: JSON.stringify({ model, messages, temperature, stream: false }),
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

  async function completeRuleFromTitle(title) {
    const t = String(title || "").trim();
    if (!t) throw new Error("請先填寫規則名");

    const content = await chatComplete({
      messages: [
        { role: "system", content: RULE_SYSTEM },
        {
          role: "user",
          content: `規則名：${t}\n\n請產出短鍵 JSON。標題「中文（法語）」；動詞填六人稱 d；不要 structure。`,
        },
      ],
      temperature: 0.25,
    });

    return normalizeDraft(extractJson(content), t);
  }

  /** 僅單字／原形：短 prompt、不帶本地規則標題（省 tokens） */
  const VOCAB_ONLY_SYSTEM = `你是法語詞彙助教。只做實詞原形與簡義，不盤點文法。只輸出一個 JSON（無 markdown／圍欄）。

短鍵：
{"u":"","t":"整句繁中翻譯（單詞則給該詞義）","v":[{"s":"表面形","l":"詞典原形／不定詞","g":"簡短中文義","p":"動詞|形容詞|名詞|副詞|代詞|數詞|其他","r":"m|f|mf|","vg":"1|2|3|","ip":"/句中形IPA/","a":0,"b":2}]}

規則：
1. 禁止輸出文法陣列 i／items；不要寫變位通則、否定結構等文法卡。
2. v 只列實詞；ne/pas/le/de 等小詞不要進 v。
3. 動詞 l 用不定詞；名詞 l 為名詞本體。
4. r：名詞／有性形容詞填 m|f|mf；動詞等填 ""。
5. vg：動詞填 1|2|3；非動詞 ""。
6. ip：實詞必填 IPA，必須是 **s 句中表面形** 的讀音（變位／複數等），禁止標 l 原形音。例：s=pouvais→/puvɛ/；s=suis→/sɥi/。
7. 同 l 可多筆不同 s；a/b 盡量準。`;

  async function inventoryGrammar(query, localTitles = []) {
    const q = String(query || "").trim();
    if (!q) throw new Error("請輸入查詢內容");

    const titles = (localTitles || []).map((t) => String(t || "").trim()).filter(Boolean);
    const titleList = titles.slice(0, 100).join("\n") || "（尚無本地規則）";
    const content = await chatComplete({
      messages: [
        { role: "system", content: INVENTORY_SYSTEM },
        {
          role: "user",
          content: `查詢內容：\n${q}\n\n本地已有規則標題（若文法已收錄，i[].n 請優先複製下列標題原文，勿改寫）：\n${titleList}\n\n請輸出短鍵 JSON 盤點（含 v 詞彙）。\n- 名詞／形容詞 v 項必須填 r 性別（m／f／mf）；動詞 r 填 ""、vg 填 1|2|3\n- 實詞 v 項必須填 ip＝**句中表面形 s 的 IPA**（變位音），勿標原形 l 的音\n- i[].s 必須是原文中找得到的片段\n- 不規則動詞勿套第一組通則標題`,
        },
      ],
      temperature: 0.15,
    });

    return normalizeInventory(extractJson(content));
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
    const w = (inv.vocab || [])[0];
    if (!w) throw new Error("AI 未回傳可用的單字資訊");
    if (!w.surface) w.surface = surf;
    return w;
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
    inventoryGrammar,
    inventoryVocabOnly,
    normalizeInventory,
    testConnection,
  };
})();
