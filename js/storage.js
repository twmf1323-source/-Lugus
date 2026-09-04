/**
 * 規則／待辦／設定：localStorage（fvgn_*）
 * 專案句子快照：IndexedDB（fvgn_idb_v1），不受約 5MB 上限
 */
const Storage = (() => {
  const RULES_KEY = "fvgn_rules_v1";
  const TODOS_KEY = "fvgn_todos_v1";
  const META_KEY = "fvgn_meta_v1";
  const SETTINGS_KEY = "fvgn_settings_v1";
  const HISTORY_KEY = "fvgn_history_v1";
  const HISTORY_MAX = 40;
  const PROJECTS_KEY = "fvgn_projects_v1";
  const IDB_NAME = "fvgn_idb_v1";
  const IDB_VERSION = 1;
  const IDB_STORE = "kv";
  const IDB_PROJECTS_KEY = "projects_v1";
  const ACTIVE_PROJECT_KEY = "fvgn_active_project_v1";
  const VOCAB_BANK_KEY = "fvgn_vocab_bank_v1";
  const VOCAB_BANK_MAX = 5000;
  const VOCAB_BANK_FIELDS = [
    "surface",
    "lemma",
    "gloss",
    "pos",
    "gender",
    "verbGroup",
    "phonetic",
  ];

  const DEFAULT_LOOKUP_MODES = {
    apiGrammar: true,
    localGrammar: false,
    apiVocab: true,
  };

  const DEFAULT_SETTINGS = {
    apiKey: "",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.5",
    apiProvider: "grok",
    apiProfiles: {},
    apiTtsEnabled: false,
    lookupModes: { ...DEFAULT_LOOKUP_MODES },
  };

  const API_PROVIDERS = [
    {
      id: "grok",
      label: "Grok",
      hint: "SpaceXAI / xAI · OpenAI 相容",
      signup: "https://console.x.ai",
      signupLabel: "console.x.ai",
      keyPlaceholder: "xAI API Key",
      baseUrl: "https://api.x.ai/v1",
      defaultModel: "grok-4.6",
      urlLocked: true,
      models: [
        { id: "grok-4.6", label: "Grok 4.6" },
        { id: "grok-4.5", label: "Grok 4.5" },
        { id: "grok-4-1-fast", label: "Grok 4.1 Fast" },
        { id: "grok-code-fast-1", label: "Grok Code Fast" },
      ],
    },
    {
      id: "google",
      label: "Google",
      hint: "Gemini · OpenAI 相容端點",
      signup: "https://aistudio.google.com/apikey",
      signupLabel: "Google AI Studio",
      keyPlaceholder: "Gemini API Key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      defaultModel: "gemini-2.5-flash",
      urlLocked: true,
      models: [
        { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
        { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      ],
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      hint: "DeepSeek Chat / Reasoner · OpenAI 相容",
      signup: "https://platform.deepseek.com",
      signupLabel: "platform.deepseek.com",
      keyPlaceholder: "DeepSeek API Key",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      urlLocked: true,
      models: [
        { id: "deepseek-chat", label: "DeepSeek Chat" },
        { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
      ],
    },
    {
      id: "custom",
      label: "自訂",
      hint: "其他 OpenAI 相容端點（自行填 Base URL 與模型名）",
      signup: "",
      signupLabel: "",
      keyPlaceholder: "API Key",
      baseUrl: "",
      defaultModel: "",
      urlLocked: false,
      models: [],
    },
  ];

  function getApiProvider(id) {
    return API_PROVIDERS.find((p) => p.id === id) || API_PROVIDERS[0];
  }

  function inferApiProviderId(settings) {
    const explicit = String(settings?.apiProvider || "").trim();
    if (API_PROVIDERS.some((p) => p.id === explicit)) return explicit;
    const url = String(settings?.baseUrl || "").toLowerCase();
    if (/generativelanguage\.googleapis\.com/.test(url)) return "google";
    if (/deepseek\.com/.test(url)) return "deepseek";
    if (/x\.ai/.test(url) || !url.trim()) return "grok";
    return "custom";
  }

  function canonicalizeBaseUrl(url, providerId) {
    const preset = getApiProvider(providerId);
    let next = String(url || "").trim().replace(/\/+$/, "");
    if (preset.urlLocked && preset.baseUrl) {
      return String(preset.baseUrl).trim().replace(/\/+$/, "");
    }
    if (/^https?:\/\/api\.x\.ai$/i.test(next)) return "https://api.x.ai/v1";
    return next;
  }

  function emptyApiProfiles() {
    const out = {};
    for (const p of API_PROVIDERS) {
      out[p.id] = { apiKey: "", baseUrl: p.baseUrl, model: p.defaultModel };
    }
    return out;
  }

  function normalizeApiProfiles(raw, current) {
    const out = emptyApiProfiles();
    const src = raw && typeof raw === "object" ? raw : {};
    for (const p of API_PROVIDERS) {
      const row = src[p.id] && typeof src[p.id] === "object" ? src[p.id] : {};
      out[p.id] = {
        apiKey: typeof row.apiKey === "string" ? row.apiKey : "",
        baseUrl: canonicalizeBaseUrl(row.baseUrl || p.baseUrl || "", p.id),
        model: String(row.model || p.defaultModel || "").trim(),
      };
    }
    const pid = inferApiProviderId(current);
    if (current?.apiKey && !out[pid].apiKey) {
      out[pid] = {
        apiKey: String(current.apiKey || "").trim(),
        baseUrl: canonicalizeBaseUrl(current.baseUrl || out[pid].baseUrl || "", pid),
        model: String(current.model || out[pid].model || "").trim(),
      };
    }
    return out;
  }

  function upsertCurrentApiProfile(settings) {
    const pid = inferApiProviderId(settings);
    const profiles = normalizeApiProfiles(settings?.apiProfiles, settings);
    profiles[pid] = {
      apiKey: String(settings?.apiKey || "").trim(),
      baseUrl: canonicalizeBaseUrl(settings?.baseUrl, pid),
      model: String(settings?.model || "").trim(),
    };
    return {
      ...settings,
      apiProvider: pid,
      baseUrl: profiles[pid].baseUrl,
      apiProfiles: profiles,
    };
  }

  function applyProviderProfile(settings, providerId) {
    const pid = getApiProvider(providerId).id;
    const preset = getApiProvider(pid);
    const profiles = normalizeApiProfiles(settings?.apiProfiles, settings);
    const saved = profiles[pid] || {};
    const baseUrl = canonicalizeBaseUrl(saved.baseUrl || preset.baseUrl, pid);
    return {
      ...settings,
      apiProvider: pid,
      apiKey: saved.apiKey || "",
      baseUrl,
      model: saved.model || preset.defaultModel,
      apiProfiles: profiles,
    };
  }

  function switchApiProvider(id, currentFields) {
    let s = loadSettings();
    if (currentFields && typeof currentFields === "object") s = { ...s, ...currentFields };
    s = upsertCurrentApiProfile(s);
    s = applyProviderProfile(s, id);
    return saveSettings(s);
  }

  function loadRules() {
    try {
      const raw = localStorage.getItem(RULES_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveRules(rules) {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
    setMeta({ lastSaved: new Date().toISOString() });
  }

  function loadTodos() {
    try {
      const raw = localStorage.getItem(TODOS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveTodos(todos) {
    localStorage.setItem(TODOS_KEY, JSON.stringify(todos));
  }

  function getMeta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function setMeta(partial) {
    const next = { ...getMeta(), ...partial };
    localStorage.setItem(META_KEY, JSON.stringify(next));
    return next;
  }

  const TITLE_RENAMES = {
    "第一組動詞未完成過去（-er imparfait）": "未完成過去（-er imparfait）",
    "pouvoir 未完成過去（pouvoir imparfait）": "未完成過去（pouvoir imparfait）",
    "第一組動詞現在時（-er présent）": "現在時（-er présent）",
    "être 現在時（être présent）": "現在時（être）",
    "avoir 現在時（avoir présent）": "現在時（avoir）",
    "第一組過去分詞（-é）": "過去分詞（-é）",
    "第一組動詞過去分詞（-é）": "過去分詞（-é）",
  };

  function migrateRuleTitles(rules) {
    if (!Array.isArray(rules)) return { rules: [], changed: false };
    let changed = false;
    const next = rules.map((r) => {
      if (!r) return r;
      const t = String(r.title || "").trim();
      const mapped = TITLE_RENAMES[t];
      if (!mapped || mapped === t) return r;
      changed = true;
      return { ...r, title: mapped };
    });
    return { rules: next, changed };
  }

  async function initWithSeed() {
    let rules = loadRules();
    if (rules && rules.length > 0) {
      const mig = migrateRuleTitles(rules);
      if (mig.changed) saveRules(mig.rules);
      return mig.rules;
    }
    try {
      const res = await fetch("data/seed-rules.json");
      if (!res.ok) throw new Error("seed fetch failed");
      rules = await res.json();
    } catch {
      rules = [];
    }
    saveRules(rules);
    setMeta({ seeded: true, seededAt: new Date().toISOString() });
    return rules;
  }

  function exportRulesJSON(rules) {
    return JSON.stringify(rules, null, 2);
  }

  /**
   * 資料管理：規則 + 專案一併匯出
   * 相容舊版純規則陣列匯入；新檔為 { type, rules, projects }
   */
  function exportDataJSON(rules) {
    const list = Array.isArray(rules) ? rules : loadRules() || [];
    return JSON.stringify(
      {
        type: "lugus-french-grammar-backup",
        version: 2,
        exportedAt: new Date().toISOString(),
        rules: list,
        projects: listProjects(),
        collections: listCollections(),
      },
      null,
      2
    );
  }

  function importRulesJSON(text, mode = "merge") {
    const incoming = JSON.parse(text);
    // 新備份：{ rules, projects }
    if (
      incoming &&
      typeof incoming === "object" &&
      !Array.isArray(incoming) &&
      Array.isArray(incoming.rules)
    ) {
      return importRulesArray(incoming.rules, mode);
    }
    if (!Array.isArray(incoming)) {
      throw new Error("匯入格式必須是規則陣列 JSON，或含 rules 的備份檔");
    }
    return importRulesArray(incoming, mode);
  }

  function importRulesArray(incoming, mode = "merge") {
    if (!Array.isArray(incoming)) throw new Error("規則必須是陣列");
    const current = loadRules() || [];
    if (mode === "replace") {
      saveRules(incoming);
      return incoming;
    }
    const byId = new Map(current.map((r) => [r.id, r]));
    for (const r of incoming) {
      if (r && r.id) byId.set(r.id, r);
    }
    const merged = Array.from(byId.values());
    saveRules(merged);
    return merged;
  }

  /**
   * 統一匯入：規則陣列、備份檔（rules+projects）、或舊版專案檔
   * @returns {{ rules: object[], projects?: { added, updated, total }, kind: string }}
   */
  function importDataJSON(text, mode = "merge") {
    const data = JSON.parse(text);
    // 1) 舊：純規則陣列
    if (Array.isArray(data)) {
      const rules = importRulesArray(data, mode);
      return { rules, kind: "rules-only" };
    }
    if (!data || typeof data !== "object") {
      throw new Error("無法辨識的 JSON 格式");
    }
    // 2) 備份檔或含 rules
    if (Array.isArray(data.rules)) {
      const rules = importRulesArray(data.rules, mode);
      let projectsResult = null;
      if (Array.isArray(data.collections) && data.collections.length) {
        importCollectionsList(data.collections, mode);
      }
      if (Array.isArray(data.projects) && data.projects.length) {
        projectsResult = importProjectsList(data.projects, mode);
      }
      return {
        rules,
        projects: projectsResult,
        kind: projectsResult ? "backup" : "rules-bundle",
      };
    }
    // 3) 純專案
    if (
      data.type === "lugus-french-grammar-projects" ||
      data.type === "mal-korean-grammar-projects" ||
      Array.isArray(data.projects) ||
      (data.id && (data.entries || data.name))
    ) {
      const projectsResult = importProjectsJSON(JSON.stringify(data));
      return {
        rules: loadRules() || [],
        projects: {
          added: projectsResult.added,
          updated: projectsResult.updated,
          total: projectsResult.projects.length,
        },
        kind: "projects-only",
      };
    }
    throw new Error("匯入格式需為規則陣列，或 { rules, projects } 備份檔");
  }

  function resetToSeed() {
    localStorage.removeItem(RULES_KEY);
    localStorage.removeItem(TODOS_KEY);
    setMeta({ resetAt: new Date().toISOString() });
  }

  /**
   * 查詢模式：API 文法 · API 單字（可獨立）
   * localGrammar 永遠關閉（歷史快照 source/mode「local」仍可顯示）
   */
  function normalizeLookupModes(input) {
    const src = input && typeof input === "object" ? input : null;
    let apiGrammar;
    let apiVocab;
    if (src && ("apiGrammar" in src || "localGrammar" in src || "apiVocab" in src)) {
      apiGrammar = Boolean(src.apiGrammar);
      apiVocab = Boolean(src.apiVocab);
    } else {
      // 預設：API 文法 + API 單字（與舊版整句盤點行為接近）
      apiGrammar = true;
      apiVocab = true;
    }
    return { apiGrammar, localGrammar: false, apiVocab };
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        return {
          ...DEFAULT_SETTINGS,
          lookupModes: { ...DEFAULT_LOOKUP_MODES },
        };
      }
      const parsed = JSON.parse(raw);
      const base = {
        ...DEFAULT_SETTINGS,
        ...(parsed && typeof parsed === "object" ? parsed : {}),
        apiKey: typeof parsed?.apiKey === "string" ? parsed.apiKey : "",
        baseUrl:
          (typeof parsed?.baseUrl === "string" && parsed.baseUrl.trim()) ||
          DEFAULT_SETTINGS.baseUrl,
        model:
          (typeof parsed?.model === "string" && parsed.model.trim()) ||
          DEFAULT_SETTINGS.model,
        apiTtsEnabled: parsed?.apiTtsEnabled === true,
      };
      base.lookupModes = normalizeLookupModes(
        parsed && typeof parsed === "object" ? parsed.lookupModes : null
      );
      delete base.structureTheme;
      base.apiProfiles = normalizeApiProfiles(parsed?.apiProfiles, base);
      base.apiProvider = inferApiProviderId(base);
      base.baseUrl = canonicalizeBaseUrl(base.baseUrl, base.apiProvider);
      const next = upsertCurrentApiProfile(base);
      const oldUrl = String(parsed?.baseUrl || "").trim().replace(/\/+$/, "");
      const oldGrok = String(parsed?.apiProfiles?.grok?.baseUrl || "")
        .trim()
        .replace(/\/+$/, "");
      if (
        oldUrl !== next.baseUrl ||
        (oldGrok && oldGrok !== next.apiProfiles?.grok?.baseUrl)
      ) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      }
      return next;
    } catch {
      return {
        ...DEFAULT_SETTINGS,
        lookupModes: { ...DEFAULT_LOOKUP_MODES },
      };
    }
  }

  function saveSettings(partial) {
    const next = { ...loadSettings(), ...partial };
    next.apiKey = String(next.apiKey || "").trim();
    next.model = String(next.model || DEFAULT_SETTINGS.model).trim();
    next.apiTtsEnabled = next.apiTtsEnabled === true;
    delete next.structureTheme;
    next.apiProvider = inferApiProviderId(next);
    next.baseUrl = canonicalizeBaseUrl(next.baseUrl, next.apiProvider);
    Object.assign(next, upsertCurrentApiProfile(next));
    if (partial && Object.prototype.hasOwnProperty.call(partial, "lookupModes")) {
      next.lookupModes = normalizeLookupModes(partial.lookupModes);
    } else {
      next.lookupModes = normalizeLookupModes(next.lookupModes);
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  function clearApiKey() {
    const s = loadSettings();
    const pid = inferApiProviderId(s);
    const profiles = normalizeApiProfiles(s.apiProfiles, s);
    if (profiles[pid]) profiles[pid] = { ...profiles[pid], apiKey: "" };
    return saveSettings({ apiKey: "", apiProfiles: profiles, apiProvider: pid });
  }

  function hasApiKey() {
    return Boolean(loadSettings().apiKey);
  }

  function loadLookupModes() {
    return normalizeLookupModes(loadSettings().lookupModes);
  }

  /**
   * @param {Partial<{apiGrammar:boolean,localGrammar:boolean,apiVocab:boolean}>} partial
   */
  function saveLookupModes(partial) {
    const cur = loadLookupModes();
    const p = partial && typeof partial === "object" ? partial : {};
    const merged = { ...cur, ...p };
    const next = normalizeLookupModes(merged);
    saveSettings({ lookupModes: next });
    return next;
  }

  function isApiLookupEnabled() {
    const m = loadLookupModes();
    return Boolean(m.apiGrammar || m.apiVocab);
  }

  function formatLookupModesLabel(modes) {
    const m = modes || loadLookupModes();
    const parts = [];
    if (m.apiGrammar) parts.push("API 文法");
    if (m.apiVocab) parts.push("API 單字");
    return parts.length ? parts.join(" · ") : "未啟用";
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  }

  function slimInventoryItems(items) {
    return (Array.isArray(items) ? items : [])
      .slice(0, 80)
      .map((it) => {
        const row = {
          name: String(it?.name || "").trim(),
          nameFr: String(it?.nameFr || it?.nameKo || "").trim(),
          nameZh: String(it?.nameZh || "").trim(),
          category: String(it?.category || "").trim(),
          span: String(it?.span || "").trim(),
          confidence: String(it?.confidence || "medium").trim(),
        };
        // 本句手動校正欄位（選字套用／定位／本句移除後寫回歷史）
        if (it?.source) row.source = String(it.source).trim();
        if (it?.manualRuleId) row.manualRuleId = String(it.manualRuleId).trim();
        if (it?.locatedManually) row.locatedManually = true;
        const start = Number(it?.start);
        const end = Number(it?.end);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          row.start = start;
          row.end = end;
        }
        return row;
      })
      .filter((it) => it.name);
  }

  function slimVocabItems(vocab) {
    return (Array.isArray(vocab) ? vocab : [])
      .slice(0, 80)
      .map((w) => {
        const row = {
          surface: String(w?.surface || "").trim(),
          lemma: String(w?.lemma || "").trim(),
          gloss: String(w?.gloss || "").trim(),
          pos: String(w?.pos || "").trim(),
          start: Number.isFinite(w?.start) ? w.start : w?.start == null ? null : Number(w.start),
          end: Number.isFinite(w?.end) ? w.end : w?.end == null ? null : Number(w.end),
        };
        const gender = String(w?.gender || "").trim();
        if (gender) row.gender = gender;
        const verbGroup = String(w?.verbGroup || w?.vg || "").trim();
        if (verbGroup) row.verbGroup = verbGroup;
        const phonetic = String(w?.phonetic || w?.ipa || w?.ip || "").trim();
        if (phonetic) row.phonetic = phonetic;
        return row;
      })
      .filter((w) => w.surface || w.lemma);
  }

  /* —— 全域單字庫（跨句複用） —— */

  function normVocabBankKey(s) {
    return String(s || "")
      .trim()
      .normalize("NFC")
      .toLowerCase();
  }

  const FR_DIACRITIC_RE = /[àâäæçéèêëîïôœùûüÿÀÂÄÆÇÉÈÊËÎÏÔŒÙÛÜŸ]/;
  const FR_LATIN_TOKEN_RE = /[A-Za-zÀ-ÖØ-öø-ÿ']+/g;
  /** 英法同形／法語功能詞：一律當法語保留，不可當英文略過 */
  const FR_KEEP_WORDS = new Set([
    "a", "ai", "as", "au", "aux", "an", "or", "on", "car", "son", "sa", "ses",
    "me", "te", "se", "si", "en", "y", "ne", "ni", "ou", "et", "est", "es",
    "pas", "pour", "sur", "plus", "dans", "avec", "des", "du", "de", "le", "la", "les",
    "un", "une", "ce", "cette", "ces", "mon", "ma", "mes", "ton", "ta", "tes",
    "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "lui", "leur",
    "moi", "toi", "mais", "donc", "que", "qui", "dont", "où", "ou",
    "but", "cause", "mine", "ours", "comment", "content", "note", "air", "plan",
    "table", "important", "possible", "orange", "date", "fine", "long", "type",
    "mode", "nature", "image", "village", "courage", "place", "chance", "page",
    "message", "voyage", "stage", "large", "simple", "terrible", "horrible",
    "double", "couple", "trouble", "article", "service", "force", "course",
    "source", "culture", "structure", "future", "figure", "question", "action",
    "nation", "condition", "position", "situation", "information", "attention",
    "emotion", "moment", "parent", "present", "patient", "different", "unique",
    "public", "normal", "final", "social", "original", "visible", "capable",
    "noble", "stable", "role", "police", "hotel", "menu", "genre", "elite",
    "debut", "ballet", "garage", "collage", "massage", "salon", "costume",
    "critique", "antique", "boutique", "fatigue", "technique", "physique",
    "prestige", "regime", "envelope", "restaurant", "vision", "session",
    "solution", "mention", "intention", "region", "decision", "profession",
    "expression", "capture", "measure", "pressure", "silence", "absence",
    "presence", "science", "distance", "importance", "violence", "patience",
    "defense", "immense", "intense", "dense", "guide", "grave", "brave",
    "cave", "vague", "change", "charge", "danger", "rage", "cage", "sage",
    "usage", "visage", "passage", "age", "centre", "center", "local", "royal",
    "national", "capital", "animal", "general", "central", "sensible",
    "variable", "notable", "portable", "justice", "instance", "substance",
    "conference", "reference", "independence", "audience", "licence", "offense",
    "suspense", "evidence", "residence", "conscience", "experience",
    "apparence", "difference", "ont", "suis", "sommes", "sont", "fait", "faire",
    "dit", "dire", "va", "vais", "vont", "aller", "peut", "peuvent", "sans",
    "sous", "chez", "entre", "apres", "avant", "depuis", "pendant", "contre",
    "vers", "parmi", "selon", "malgre", "toute", "tout", "tous", "toutes",
    "cette", "cet", "leurs", "nos", "vos", "rien", "tout", "peu", "tres",
  ]);
  /** 幾乎不可能是法語的英文詞（歌詞夾雜） */
  const EN_SKIP_WORDS = new Set([
    "the", "you", "i", "we", "they", "he", "she", "it",
    "is", "are", "was", "were", "am", "been", "being",
    "this", "that", "these", "those",
    "my", "your", "his", "her", "its", "our", "their",
    "him", "us", "them", "yours", "theirs",
    "and", "if", "not", "yes", "yeah", "yea", "yup", "nope", "nah",
    "oh", "ooh", "uh", "huh", "hey", "hi", "hello", "wow", "whoa", "yo",
    "baby", "babe", "love", "like", "just", "know", "got", "get",
    "gonna", "wanna", "gotta", "kinda", "lemme", "lets",
    "dont", "cant", "wont", "aint",
    "im", "youre", "thats", "whats", "whos", "theyre", "ive", "weve",
    "youd", "wed", "theyd", "youll", "theyll",
    "what", "when", "where", "who", "why", "how",
    "come", "want", "need", "make", "take", "give", "let",
    "going", "gone", "go", "went",
    "from", "with", "for", "about", "into", "over", "after", "before",
    "than", "then", "now", "here", "there",
    "all", "some", "any", "can", "will", "would", "should", "could",
    "have", "has", "had", "do", "does", "did", "done",
    "no", "never", "always", "only", "really", "true",
    "girl", "boy", "man", "woman", "world", "time", "life", "dream",
    "tonight", "today", "tomorrow", "goodbye", "bye",
    "please", "thank", "thanks", "sorry",
    "heart", "night", "day", "feel", "feeling",
    "because", "something", "nothing", "everything", "anything",
    "down", "up", "out", "off", "back", "away", "again", "still",
    "even", "too", "very", "more", "most",
    "one", "two", "three", "see", "look", "say", "said", "tell", "told",
    "think", "thought", "remember",
    "to", "of", "in", "at", "by", "so", "ok", "okay",
  ]);
  const FR_LINE_HINTS = new Set([
    "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "on",
    "le", "la", "les", "un", "une", "des", "du", "de", "et", "est", "sont",
    "pas", "que", "qui", "dans", "pour", "avec", "sur",
    "ce", "cette", "ces", "mon", "ma", "mes", "ton", "ta", "tes",
    "son", "sa", "ses", "ne", "ni", "ou", "si", "mais", "donc", "car",
    "y", "en", "se", "lui", "leur", "moi", "toi", "ça", "ca", "au", "aux",
    "j", "c", "d", "l", "n", "m", "t", "s", "me", "te",
    "jai", "cest", "nest", "quon", "dune", "dun", "as", "es", "suis", "sommes",
    "a", "ai", "ont", "fait", "va", "sans", "tout", "tous",
  ]);

  function normalizeEnToken(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/['’]/g, "'")
      .replace(/^[^a-zàâäæçéèêëîïôœùûüÿ]+|[^a-zàâäæçéèêëîïôœùûüÿ']+$/gi, "");
  }

  function isEnglishContraction(tok) {
    const t = normalizeEnToken(tok);
    if (!t) return false;
    if (t === "let's" || t === "lets") return true;
    if (/n't$/.test(t)) return true;
    return /^(i|you|he|she|it|we|they|that|what|who|there|here)'(?:re|ll|ve|d|s|m)$/.test(t);
  }

  function isFrenchKeepToken(raw) {
    const s = String(raw || "").trim();
    if (!s) return false;
    if (FR_DIACRITIC_RE.test(s)) return true;
    const tok = normalizeEnToken(s);
    if (!tok) return false;
    if (isEnglishContraction(tok)) return false;
    const bare = tok.replace(/'/g, "");
    return (
      FR_KEEP_WORDS.has(tok) ||
      FR_KEEP_WORDS.has(bare) ||
      FR_LINE_HINTS.has(tok) ||
      FR_LINE_HINTS.has(bare)
    );
  }

  function isUnambiguousEnglishToken(raw) {
    const s = String(raw || "").trim();
    if (!s) return false;
    if (isFrenchKeepToken(s)) return false;
    const tok = normalizeEnToken(s);
    if (!tok) return false;
    const parts = tok.split(/[\s/-]+/).filter(Boolean);
    if (parts.length > 1) {
      return parts.every((p) => isUnambiguousEnglishToken(p));
    }
    if (isEnglishContraction(tok)) return true;
    const bare = tok.replace(/'/g, "");
    return EN_SKIP_WORDS.has(tok) || EN_SKIP_WORDS.has(bare);
  }

  /**
   * 歌詞夾雜的英文 — 不查 API、不收入單字庫。
   * 英法同形詞（but／cause／table／comment…）一律保留為法語。
   * @param {string} [query] 所在句子；有法語線索時更不略過同形詞
   */
  function isEnglishVocabSkip(surface, lemma, query) {
    const pieces = [surface, lemma].map((x) => String(x || "").trim()).filter(Boolean);
    if (!pieces.length) return false;
    if (pieces.some((p) => isFrenchKeepToken(p))) return false;
    if (query && queryLooksFrench(query)) return pieces.every((p) => isUnambiguousEnglishToken(p));
    return pieces.some((p) => isUnambiguousEnglishToken(p));
  }

  function queryLooksFrench(query) {
    const s = String(query || "").trim();
    if (!s) return false;
    if (FR_DIACRITIC_RE.test(s)) return true;
    const tokens = s.match(FR_LATIN_TOKEN_RE) || [];
    return tokens.some((t) => isFrenchKeepToken(t));
  }

  function filterEnglishVocab(list, query) {
    if (!Array.isArray(list)) return [];
    return list.filter((w) => !isEnglishVocabSkip(w?.surface, w?.lemma, query));
  }

  function isEnglishOnlyLine(line) {
    const t = String(line || "").trim();
    if (!t) return false;
    if (FR_DIACRITIC_RE.test(t)) return false;
    const tokens = t.match(FR_LATIN_TOKEN_RE) || [];
    if (!tokens.length) return false;
    let fr = 0;
    let en = 0;
    for (const tok of tokens) {
      if (isFrenchKeepToken(tok)) fr += 1;
      else if (isUnambiguousEnglishToken(tok)) en += 1;
    }
    if (fr > 0) return false;
    return en >= 2 || (en >= 1 && tokens.length <= 6 && en / tokens.length >= 0.5);
  }

  function stripEnglishFromVocabQuery(query) {
    const lines = String(query || "").split(/\r?\n/);
    const kept = [];
    for (const line of lines) {
      if (isEnglishOnlyLine(line)) continue;
      kept.push(
        line.replace(FR_LATIN_TOKEN_RE, (tok) => (isEnglishVocabSkip(tok, "", line) ? " " : tok))
      );
    }
    return kept
      .join("\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function vocabQueryHasTargetLanguage(query) {
    const s = String(query || "").trim();
    if (!s) return false;
    if (FR_DIACRITIC_RE.test(s)) return true;
    const tokens = s.match(FR_LATIN_TOKEN_RE) || [];
    return tokens.some((t) => !isEnglishVocabSkip(t, "", s));
  }

  const SENSE_KEYS = VOCAB_BANK_FIELDS.filter((k) => k !== "surface");

  function senseHasPayload(sense) {
    if (!sense) return false;
    return SENSE_KEYS.some((k) => String(sense[k] || "").trim());
  }

  function pickSenseFields(src) {
    const out = {};
    for (const k of SENSE_KEYS) out[k] = String(src?.[k] || "").trim();
    return out;
  }

  function vocabBankHasPayload(row) {
    if (!row) return false;
    if (Array.isArray(row.senses) && row.senses.some(senseHasPayload)) return true;
    if (Array.isArray(row.alts) && row.alts.some(senseHasPayload)) return true;
    return SENSE_KEYS.some((k) => String(row[k] || "").trim());
  }

  function getPrimarySense(entry) {
    if (!entry) return null;
    const senses = Array.isArray(entry.senses) ? entry.senses : [];
    if (!senses.length) return null;
    const pid = entry.primarySenseId;
    return senses.find((s) => s && s.id === pid) || senses[0];
  }

  /** 扁平舊資料／alts → senses；同步主要義到頂層欄位 */
  function ensureBankEntrySenses(entry) {
    if (!entry || !(entry.surface || entry.lemma)) return entry;
    let senses = Array.isArray(entry.senses) ? entry.senses.filter(Boolean) : [];
    if (!senses.length) {
      const primary = {
        id: entry.primarySenseId || "primary",
        ...pickSenseFields(entry),
        updatedAt: entry.updatedAt || new Date().toISOString(),
      };
      if (senseHasPayload(primary)) senses = [primary];
    }
    (Array.isArray(entry.alts) ? entry.alts : []).forEach((a, i) => {
      if (!senseHasPayload(a)) return;
      const gloss = String(a.gloss || "").trim();
      const lemma = String(a.lemma || "").trim();
      const exists = senses.some(
        (s) => String(s.gloss || "").trim() === gloss && String(s.lemma || "").trim() === lemma
      );
      if (exists) return;
      senses.push({
        id: a.id || `alt-${i}`,
        ...pickSenseFields(a),
        updatedAt: a.updatedAt || entry.updatedAt || new Date().toISOString(),
      });
    });
    if (!senses.length) return entry;
    delete entry.alts;
    if (!entry.primarySenseId || !senses.some((s) => s.id === entry.primarySenseId)) {
      entry.primarySenseId = senses[0].id;
    }
    entry.senses = senses;
    const p = getPrimarySense(entry);
    if (p) {
      for (const k of SENSE_KEYS) entry[k] = p[k] || "";
      entry.updatedAt = p.updatedAt || entry.updatedAt;
    }
    return entry;
  }

  function flattenBankHit(entry) {
    if (!entry) return null;
    const e = ensureBankEntrySenses({
      ...entry,
      senses: (entry.senses || []).map((s) => ({ ...s })),
      alts: (entry.alts || []).map((a) => ({ ...a })),
    });
    if (!vocabBankHasPayload(e)) return null;
    const primary = getPrimarySense(e);
    const flat = {
      surface: e.surface,
      ...pickSenseFields(primary || e),
      updatedAt: e.updatedAt || primary?.updatedAt || "",
      primarySenseId: e.primarySenseId,
      senses: e.senses,
      bankAlts: (e.senses || [])
        .filter((s) => s && s.id !== e.primarySenseId)
        .map((s) => ({ id: s.id, ...pickSenseFields(s) })),
    };
    return flat;
  }

  function rebuildLemmaIndex(bank) {
    const byLemma = {};
    for (const [sk, raw] of Object.entries(bank.bySurface || {})) {
      const row = ensureBankEntrySenses(raw);
      bank.bySurface[sk] = row;
      const lemmas = new Set();
      const pl = normVocabBankKey(row?.lemma);
      if (pl && pl !== sk) lemmas.add(pl);
      for (const s of row.senses || []) {
        const lem = normVocabBankKey(s?.lemma);
        if (lem && lem !== sk) lemmas.add(lem);
      }
      for (const lem of lemmas) {
        if (!byLemma[lem]) byLemma[lem] = [];
        if (!byLemma[lem].includes(sk)) byLemma[lem].push(sk);
      }
    }
    bank.byLemma = byLemma;
    return bank;
  }

  function loadVocabBank() {
    try {
      const raw = localStorage.getItem(VOCAB_BANK_KEY);
      if (!raw) return { bySurface: {}, byLemma: {} };
      const parsed = JSON.parse(raw);
      const bySurface =
        parsed?.bySurface && typeof parsed.bySurface === "object"
          ? parsed.bySurface
          : {};
      let byLemma =
        parsed?.byLemma && typeof parsed.byLemma === "object" ? parsed.byLemma : {};
      const bank = { bySurface, byLemma };
      if (Object.keys(bySurface).length && !Object.keys(byLemma).length) {
        rebuildLemmaIndex(bank);
      }
      return bank;
    } catch {
      return { bySurface: {}, byLemma: {} };
    }
  }

  function pruneVocabBank(bank) {
    const keys = Object.keys(bank.bySurface || {});
    if (keys.length <= VOCAB_BANK_MAX) return bank;
    keys
      .map((k) => ({ k, at: String(bank.bySurface[k]?.updatedAt || "") }))
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, keys.length - VOCAB_BANK_MAX)
      .forEach(({ k }) => {
        delete bank.bySurface[k];
      });
    rebuildLemmaIndex(bank);
    return bank;
  }

  function saveVocabBank(bank) {
    rebuildLemmaIndex(bank);
    const next = pruneVocabBank({
      bySurface: bank?.bySurface && typeof bank.bySurface === "object" ? bank.bySurface : {},
      byLemma: bank?.byLemma && typeof bank.byLemma === "object" ? bank.byLemma : {},
    });
    localStorage.setItem(VOCAB_BANK_KEY, JSON.stringify(next));
    return next;
  }

  function findVocabBankHit(bank, surface, lemma) {
    const bySurface = bank.bySurface || {};
    const byLemma = bank.byLemma || {};
    const sk = normVocabBankKey(surface);
    if (sk && bySurface[sk] && vocabBankHasPayload(bySurface[sk])) {
      return ensureBankEntrySenses(bySurface[sk]);
    }
    const lk = normVocabBankKey(lemma || surface);
    if (lk && bySurface[lk] && vocabBankHasPayload(bySurface[lk])) {
      return ensureBankEntrySenses(bySurface[lk]);
    }
    if (lk && Array.isArray(byLemma[lk])) {
      let best = null;
      for (const id of byLemma[lk]) {
        const row = bySurface[id];
        if (!row || !vocabBankHasPayload(row)) continue;
        const er = ensureBankEntrySenses(row);
        if (!best || String(er.updatedAt || "") > String(best.updatedAt || "")) best = er;
      }
      return best;
    }
    return null;
  }

  function fillVocabRowFromHit(row, hit) {
    if (!hit) return row;
    const flat = flattenBankHit(hit);
    if (!flat) return row;
    const out = { ...row };
    for (const k of SENSE_KEYS) {
      if (!String(out[k] || "").trim() && String(flat[k] || "").trim()) out[k] = flat[k];
    }
    if (flat.bankAlts?.length) out.bankAlts = flat.bankAlts;
    if (!out.fromBank) out.fromBank = true;
    return out;
  }

  function upsertVocabBankEntries(list, opts = {}) {
    const preferIncoming = Boolean(opts.preferIncoming);
    const bank = loadVocabBank();
    const now = new Date().toISOString();
    let n = 0;
    for (const w of Array.isArray(list) ? list : []) {
      if (isEnglishVocabSkip(w?.surface, w?.lemma)) continue;
      const surfaceRaw = String(w?.surface || w?.lemma || "").trim();
      const surface = normVocabBankKey(surfaceRaw);
      if (!surface) continue;
      const incoming = pickSenseFields(w);
      if (!incoming.phonetic) incoming.phonetic = String(w?.ipa || w?.ip || "").trim();
      if (!incoming.verbGroup) incoming.verbGroup = String(w?.vg || "").trim();
      if (!senseHasPayload(incoming)) continue;

      let entry = bank.bySurface[surface]
        ? ensureBankEntrySenses({ ...bank.bySurface[surface] })
        : { surface: surfaceRaw, senses: [], primarySenseId: "" };

      entry.surface = surfaceRaw || entry.surface || surface;
      if (!Array.isArray(entry.senses)) entry.senses = [];

      const sameGloss = entry.senses.find(
        (s) =>
          String(s.gloss || "").trim() === incoming.gloss &&
          String(s.lemma || "").trim() === incoming.lemma
      );

      if (preferIncoming && incoming.gloss) {
        if (sameGloss) {
          Object.assign(sameGloss, { ...incoming, updatedAt: now });
          entry.primarySenseId = sameGloss.id;
        } else {
          const primary = getPrimarySense(entry);
          const primaryGloss = String(primary?.gloss || "").trim();
          if (primary && primaryGloss && primaryGloss !== incoming.gloss) {
            const sense = { id: newId("vs_"), ...incoming, updatedAt: now };
            entry.senses.push(sense);
            entry.primarySenseId = sense.id;
          } else if (primary) {
            Object.assign(primary, { ...incoming, updatedAt: now });
            entry.primarySenseId = primary.id;
          } else {
            const sense = { id: newId("vs_"), ...incoming, updatedAt: now };
            entry.senses = [sense];
            entry.primarySenseId = sense.id;
          }
        }
      } else {
        let primary = getPrimarySense(entry);
        if (!primary) {
          primary = { id: newId("vs_"), ...incoming, updatedAt: now };
          entry.senses = [primary];
          entry.primarySenseId = primary.id;
        } else {
          for (const k of SENSE_KEYS) {
            if (!String(primary[k] || "").trim() && incoming[k]) primary[k] = incoming[k];
          }
          primary.updatedAt = now;
        }
      }

      entry = ensureBankEntrySenses(entry);
      entry.updatedAt = now;
      if (!vocabBankHasPayload(entry)) continue;
      bank.bySurface[surface] = entry;
      n += 1;
    }
    if (n) saveVocabBank(bank);
    return n;
  }

  function lookupVocabBank(surfaceOrLemma) {
    const key = normVocabBankKey(surfaceOrLemma);
    if (!key) return null;
    const hit = findVocabBankHit(loadVocabBank(), key, key);
    return hit ? flattenBankHit(hit) : null;
  }

  function mergeVocabWithBank(vocabList, queryText, opts = {}) {
    const bank = loadVocabBank();
    if (!bank.byLemma || !Object.keys(bank.byLemma).length) rebuildLemmaIndex(bank);
    const bySurface = bank.bySurface || {};
    const src = String(queryText || "");
    const srcLower = src.toLowerCase();
    const list = filterEnglishVocab(Array.isArray(vocabList) ? vocabList : [], src);
    const seen = new Set();

    function enrich(row) {
      const key = normVocabBankKey(row?.surface);
      if (key) seen.add(key);
      const hit = findVocabBankHit(bank, row?.surface, row?.lemma);
      return hit ? fillVocabRowFromHit(row, hit) : row;
    }

    const out = list.map(enrich);
    if (src) {
      const keys = Object.keys(bySurface)
        .filter((k) => k.length >= 2 && srcLower.includes(k) && !seen.has(k))
        .sort((a, b) => b.length - a.length || a.localeCompare(b));
      let added = 0;
      for (const k of keys) {
        if (added >= 40) break;
        if (isEnglishVocabSkip(k, "", src)) continue;
        const hit = bySurface[k];
        if (!hit || !vocabBankHasPayload(hit)) continue;
        const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let boundaryOk = srcLower.includes(k);
        try {
          const re = new RegExp(
            `(^|[^A-Za-zÀ-ÖØ-öø-ÿ0-9'])${esc}(?=$|[^A-Za-zÀ-ÖØ-öø-ÿ0-9'])`,
            "i"
          );
          boundaryOk = re.test(src);
        } catch {
          /* keep includes */
        }
        if (!boundaryOk) continue;
        const idx = srcLower.indexOf(k);
        const surfaceInSent = idx >= 0 ? src.slice(idx, idx + k.length) : hit.surface || k;
        const flat = flattenBankHit(hit) || hit;
        out.push({
          surface: surfaceInSent,
          lemma: flat.lemma || "",
          gloss: flat.gloss || "",
          pos: flat.pos || "",
          gender: flat.gender || "",
          verbGroup: flat.verbGroup || "",
          phonetic: flat.phonetic || "",
          bankAlts: flat.bankAlts || [],
          fromBank: true,
          source: "local-bank",
        });
        seen.add(k);
        added += 1;
      }
    }
    const hints = Array.isArray(opts.tokenHints) ? opts.tokenHints : [];
    let hintAdded = 0;
    for (const t of hints) {
      if (hintAdded >= 40) break;
      const surf = String(t?.surface || "").trim();
      if (!surf) continue;
      if (isEnglishVocabSkip(surf, t?.lemma, src)) continue;
      const sk = normVocabBankKey(surf);
      if (sk && seen.has(sk)) continue;
      const hit = findVocabBankHit(bank, surf, t?.lemma);
      if (!hit || !vocabBankHasPayload(hit)) continue;
      if (src && !src.toLowerCase().includes(surf.toLowerCase())) continue;
      const flat = flattenBankHit(hit) || hit;
      const row = {
        surface: surf,
        lemma: flat.lemma || String(t.lemma || "").trim() || "",
        gloss: flat.gloss || "",
        pos: flat.pos || "",
        gender: flat.gender || "",
        verbGroup: flat.verbGroup || "",
        phonetic: flat.phonetic || "",
        bankAlts: flat.bankAlts || [],
        fromBank: true,
        source: "local-bank",
      };
      const a = Number(t.start);
      const b = Number(t.end);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
        row.start = a;
        row.end = b;
      }
      out.push(row);
      if (sk) seen.add(sk);
      hintAdded += 1;
    }
    return out;
  }

  function harvestVocabBankFromSnapshots() {
    const bank = loadVocabBank();
    if (Object.keys(bank.bySurface || {}).length) return 0;
    const collected = [];
    for (const h of loadHistory()) {
      if (Array.isArray(h?.vocab)) collected.push(...h.vocab);
    }
    try {
      for (const p of listProjects()) {
        for (const e of p.entries || []) {
          if (Array.isArray(e?.vocab)) collected.push(...e.vocab);
        }
      }
    } catch {
      /* ignore */
    }
    return upsertVocabBankEntries(collected, { preferIncoming: false });
  }

  function listVocabBankEntries(filterQ = "") {
    const bank = loadVocabBank();
    const q = normVocabBankKey(filterQ);
    const rows = Object.entries(bank.bySurface || {})
      .map(([key, raw]) => {
        const e = ensureBankEntrySenses({ ...raw });
        bank.bySurface[key] = e;
        return { key, entry: e, flat: flattenBankHit(e) };
      })
      .filter((r) => r.flat && vocabBankHasPayload(r.entry));
    let list = rows;
    if (q) {
      list = rows.filter(({ entry, flat }) => {
        const blob = [
          entry.surface,
          flat.lemma,
          flat.gloss,
          flat.pos,
          flat.phonetic,
          ...(entry.senses || []).map((s) => `${s.gloss} ${s.lemma}`),
        ]
          .join("\n")
          .toLowerCase();
        return blob.includes(q);
      });
    }
    list.sort(
      (a, b) =>
        String(b.entry.updatedAt || "").localeCompare(String(a.entry.updatedAt || "")) ||
        String(a.entry.surface || "").localeCompare(String(b.entry.surface || ""))
    );
    return list.map(({ key, entry, flat }) => ({
      key,
      surface: entry.surface,
      ...flat,
      senseCount: (entry.senses || []).length,
    }));
  }

  function removeVocabBankEntry(surfaceKey) {
    const bank = loadVocabBank();
    const k = normVocabBankKey(surfaceKey);
    if (!k || !bank.bySurface[k]) return false;
    delete bank.bySurface[k];
    saveVocabBank(bank);
    return true;
  }

  function removeVocabBankSense(surfaceKey, senseId) {
    const bank = loadVocabBank();
    const k = normVocabBankKey(surfaceKey);
    const entry = bank.bySurface[k];
    if (!entry) return false;
    ensureBankEntrySenses(entry);
    const before = entry.senses.length;
    entry.senses = entry.senses.filter((s) => s.id !== senseId);
    if (!entry.senses.length) {
      delete bank.bySurface[k];
    } else {
      if (entry.primarySenseId === senseId) entry.primarySenseId = entry.senses[0].id;
      ensureBankEntrySenses(entry);
      bank.bySurface[k] = entry;
    }
    saveVocabBank(bank);
    return entry.senses ? entry.senses.length < before || !bank.bySurface[k] : true;
  }

  function setVocabBankPrimarySense(surfaceKey, senseId) {
    const bank = loadVocabBank();
    const k = normVocabBankKey(surfaceKey);
    const entry = bank.bySurface[k];
    if (!entry) return false;
    ensureBankEntrySenses(entry);
    if (!entry.senses.some((s) => s.id === senseId)) return false;
    entry.primarySenseId = senseId;
    ensureBankEntrySenses(entry);
    entry.updatedAt = new Date().toISOString();
    bank.bySurface[k] = entry;
    saveVocabBank(bank);
    return true;
  }

  function estimateVocabBankCoverage(query, tokenHints = []) {
    const src = String(query || "").trim();
    if (!src) return { ratio: 0, hit: 0, total: 0 };
    const bank = loadVocabBank();
    const hints = Array.isArray(tokenHints) ? tokenHints : [];
    if (hints.length) {
      const content = hints.filter((t) => String(t?.surface || "").trim().length >= 2);
      if (!content.length) return { ratio: 0, hit: 0, total: 0 };
      let hit = 0;
      for (const t of content) {
        const h = findVocabBankHit(bank, t.surface, t.lemma);
        if (h && String(h.gloss || "").trim()) hit += 1;
      }
      return { ratio: hit / content.length, hit, total: content.length };
    }

    // 依詞邊界切 token，避免「maison」因庫內有 ma/on 等子字串被誤判已覆蓋
    const tokens = src.match(/[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+)*/g) || [];
    const content = tokens.filter((t) => t.replace(/['’]/g, "").length >= 2);
    if (!content.length) return { ratio: 0, hit: 0, total: 0 };

    // 純單字：只認「整詞」命中；沒有 gloss 不算覆蓋（仍應打 API）
    if (content.length === 1) {
      const w = content[0];
      const h = findVocabBankHit(bank, w, w);
      const ok = Boolean(h && String(h.gloss || "").trim());
      return { ratio: ok ? 1 : 0, hit: ok ? 1 : 0, total: 1, exact: true };
    }

    let hit = 0;
    for (const t of content) {
      const h = findVocabBankHit(bank, t, t);
      if (h && String(h.gloss || "").trim()) hit += 1;
    }
    return { ratio: hit / content.length, hit, total: content.length };
  }

  function mergeKeptTranslation(prev, incoming, replace) {
    if (replace) return String(incoming || "").trim();
    const old = String(prev || "").trim();
    if (old) return old;
    return String(incoming || "").trim();
  }

  function addHistoryEntry(entry) {
    const q = String(entry?.query || "").trim();
    if (!q) return loadHistory();
    const norm = q.replace(/\s+/g, " ");
    const prevList = loadHistory();
    const prev = prevList.find((h) => String(h.query || "").replace(/\s+/g, " ") === norm);
    let list = prevList.filter(
      (h) => String(h.query || "").replace(/\s+/g, " ") !== norm
    );
    const item = {
      id:
        (crypto.randomUUID && crypto.randomUUID()) ||
        "h_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      query: q,
      at: new Date().toISOString(),
      summary: String(entry.summary || "").trim(),
      translation: mergeKeptTranslation(prev?.translation, entry.translation, entry.replaceTranslation),
      ownedCount: Number.isFinite(entry.ownedCount) ? entry.ownedCount : null,
      missingCount: Number.isFinite(entry.missingCount) ? entry.missingCount : null,
      localCount: Number.isFinite(entry.localCount) ? entry.localCount : null,
      items: slimInventoryItems(entry.items),
      vocab: slimVocabItems(entry.vocab),
    };
    list.unshift(item);
    if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
    saveHistory(list);
    return list;
  }

  function removeHistoryEntry(id) {
    const list = loadHistory().filter((h) => h.id !== id);
    saveHistory(list);
    return list;
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    return [];
  }

  /* —— 專案（有序、永久保存；不與一般歷史混用） —— */

  function newId(prefix) {
    return (
      (crypto.randomUUID && crypto.randomUUID()) ||
      prefix + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)
    );
  }

  function normalizeQueryKey(q) {
    return String(q || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  /* 大項 collections 只做容器；句子只存在分項 project */
  const UNGROUPED_COLLECTION_ID = "";

  function normalizeCollection(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = String(raw.id || "").trim();
    if (!id) return null;
    return {
      id,
      name: String(raw.name || "未命名").trim() || "未命名",
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
      lastProjectId: String(raw.lastProjectId || "").trim(),
    };
  }

  function normalizeProjectRecord(p, i = 0) {
    if (!p || !p.id) return null;
    return {
      id: String(p.id),
      name: String(p.name || "未命名專案").trim() || "未命名專案",
      collectionId: String(p.collectionId || UNGROUPED_COLLECTION_ID).trim(),
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
      entries: Array.isArray(p.entries)
        ? p.entries
            .filter((e) => e && e.query)
            .map((e, ei) => ({
              id: String(e.id || newId("pe_")),
              seq: Number.isFinite(Number(e.seq)) ? Number(e.seq) : ei + 1,
              query: String(e.query || "").trim(),
              at: e.at || new Date().toISOString(),
              summary: String(e.summary || "").trim(),
              translation: String(e.translation || "").trim(),
              ownedCount: Number.isFinite(e.ownedCount) ? e.ownedCount : null,
              missingCount: Number.isFinite(e.missingCount) ? e.missingCount : null,
              items: slimInventoryItems(e.items),
              vocab: slimVocabItems(e.vocab),
            }))
        : [],
    };
  }

  /** 記憶體快取：讀寫同步；IndexedDB 非同步落盤 */
  let projectsCache = null;
  let projectsBackend = "localStorage";
  let projectsDb = null;
  let projectsDirty = false;
  let projectsFlushTimer = null;
  let projectsFlushPromise = null;
  let projectsInitPromise = null;

  function emptyProjectsStore() {
    return { collections: [], projects: [] };
  }

  function isProjectsIdbStub(parsed) {
    return Boolean(parsed && typeof parsed === "object" && parsed.__idb === true);
  }

  function storePayloadCount(store) {
    return (store?.projects?.length || 0) + (store?.collections?.length || 0);
  }

  function normalizeProjectsStoreObject(parsed) {
    if (!parsed || typeof parsed !== "object" || isProjectsIdbStub(parsed)) {
      return emptyProjectsStore();
    }
    const projectsRaw = Array.isArray(parsed.projects)
      ? parsed.projects
      : Array.isArray(parsed)
        ? parsed
        : [];
    const collections = (Array.isArray(parsed.collections) ? parsed.collections : [])
      .map((c) => normalizeCollection(c))
      .filter(Boolean);
    const colIds = new Set(collections.map((c) => c.id));
    const projects = projectsRaw
      .map((p, i) => normalizeProjectRecord(p, i))
      .filter(Boolean)
      .map((p) => {
        if (p.collectionId && !colIds.has(p.collectionId)) p.collectionId = UNGROUPED_COLLECTION_ID;
        return p;
      });
    for (const c of collections) {
      if (c.lastProjectId && !projects.some((x) => x.id === c.lastProjectId)) {
        c.lastProjectId = "";
      }
    }
    return { collections, projects };
  }

  function readProjectsLocalStorageRaw() {
    try {
      return localStorage.getItem(PROJECTS_KEY);
    } catch {
      return null;
    }
  }

  function parseProjectsLocalStorage() {
    const raw = readProjectsLocalStorageRaw();
    if (!raw) return { store: emptyProjectsStore(), stub: false, missing: true };
    try {
      const parsed = JSON.parse(raw);
      if (isProjectsIdbStub(parsed)) {
        return { store: emptyProjectsStore(), stub: true, missing: false };
      }
      return { store: normalizeProjectsStoreObject(parsed), stub: false, missing: false };
    } catch {
      return { store: emptyProjectsStore(), stub: false, missing: false };
    }
  }

  function quotaError(err) {
    const msg = String(err && (err.name + " " + err.message));
    if (/quota|QuotaExceeded/i.test(msg)) {
      return new Error("瀏覽器儲存空間不足，無法再寫入專案句子");
    }
    return null;
  }

  function writeProjectsLocalStorageFull(store) {
    localStorage.setItem(
      PROJECTS_KEY,
      JSON.stringify({
        collections: Array.isArray(store?.collections) ? store.collections : [],
        projects: Array.isArray(store?.projects) ? store.projects : [],
      })
    );
  }

  function writeProjectsLocalStorageStub() {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify({ __idb: true }));
  }

  function idbAvailable() {
    return typeof indexedDB !== "undefined";
  }

  function openProjectsDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB 無法開啟"));
    });
  }

  function idbGet(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbPut(db, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("IndexedDB 寫入中止"));
      tx.onerror = () => reject(tx.error || new Error("IndexedDB 寫入失敗"));
      tx.objectStore(IDB_STORE).put(value, key);
    });
  }

  function adoptProjectsCache(store) {
    projectsCache = {
      collections: Array.isArray(store?.collections) ? store.collections : [],
      projects: Array.isArray(store?.projects) ? store.projects : [],
    };
    return projectsCache;
  }

  async function initProjectsDb() {
    if (projectsInitPromise) return projectsInitPromise;
    projectsInitPromise = (async () => {
      const fromLs = parseProjectsLocalStorage();
      if (!idbAvailable()) {
        adoptProjectsCache(fromLs.store);
        projectsBackend = "localStorage";
        return { backend: projectsBackend };
      }
      try {
        projectsDb = await openProjectsDb();
        const idbVal = await idbGet(projectsDb, IDB_PROJECTS_KEY);
        const fromIdb =
          idbVal && typeof idbVal === "object"
            ? normalizeProjectsStoreObject(idbVal)
            : null;
        const idbHas = fromIdb && storePayloadCount(fromIdb) > 0;
        const lsHas = !fromLs.stub && storePayloadCount(fromLs.store) > 0;
        const idbRecordExists = idbVal != null;

        if (idbHas || (idbRecordExists && !lsHas)) {
          adoptProjectsCache(fromIdb || emptyProjectsStore());
          projectsBackend = "idb";
          projectsDirty = false;
          try {
            writeProjectsLocalStorageStub();
          } catch {
            /* 騰出 localStorage；失敗不影響 IndexedDB */
          }
          return { backend: "idb", migrated: false };
        }

        adoptProjectsCache(lsHas ? fromLs.store : emptyProjectsStore());
        await idbPut(projectsDb, IDB_PROJECTS_KEY, projectsCache);
        projectsBackend = "idb";
        projectsDirty = false;
        try {
          writeProjectsLocalStorageStub();
        } catch {
          /* 騰出 localStorage；失敗不影響 IndexedDB */
        }
        return { backend: "idb", migrated: lsHas };
      } catch (err) {
        console.warn("[projects idb init]", err);
        if (!projectsCache) {
          adoptProjectsCache(fromLs.stub ? emptyProjectsStore() : fromLs.store);
        }
        projectsBackend = "localStorage";
        try {
          if (projectsCache && storePayloadCount(projectsCache)) {
            writeProjectsLocalStorageFull(projectsCache);
          }
        } catch {
          /* 記憶體仍可讀；下次再開 IndexedDB */
        }
        return { backend: "localStorage", error: String(err && err.message) };
      }
    })();
    return projectsInitPromise;
  }

  function loadProjectsStore() {
    if (projectsCache) return projectsCache;
    const fromLs = parseProjectsLocalStorage();
    return adoptProjectsCache(fromLs.store);
  }

  function saveProjectsStore(store) {
    const next = adoptProjectsCache({
      collections: Array.isArray(store?.collections) ? store.collections : [],
      projects: Array.isArray(store?.projects) ? store.projects : [],
    });
    projectsDirty = true;
    if (projectsBackend === "idb") {
      scheduleProjectsFlush();
      return next;
    }
    try {
      writeProjectsLocalStorageFull(next);
      projectsDirty = false;
    } catch (err) {
      const q = quotaError(err);
      if (q) throw q;
      throw err;
    }
    return next;
  }

  function scheduleProjectsFlush() {
    if (projectsFlushTimer || projectsFlushPromise) return;
    projectsFlushTimer = setTimeout(() => {
      projectsFlushTimer = null;
      flushProjects();
    }, 0);
  }

  async function runProjectsFlush() {
    while (projectsDirty) {
      projectsDirty = false;
      const snapshot = projectsCache || emptyProjectsStore();
      try {
        if (projectsBackend === "idb" && projectsDb) {
          await idbPut(projectsDb, IDB_PROJECTS_KEY, snapshot);
        } else {
          writeProjectsLocalStorageFull(snapshot);
        }
      } catch (err) {
        if (projectsBackend === "idb") {
          try {
            writeProjectsLocalStorageFull(snapshot);
            projectsBackend = "localStorage";
            console.warn("[projects idb] 改回 localStorage", err);
          } catch (err2) {
            projectsDirty = true;
            const q = quotaError(err2);
            throw q || err2;
          }
        } else {
          projectsDirty = true;
          const q = quotaError(err);
          throw q || err;
        }
      }
    }
  }

  function flushProjects() {
    if (projectsFlushTimer) {
      clearTimeout(projectsFlushTimer);
      projectsFlushTimer = null;
    }
    if (projectsFlushPromise) return projectsFlushPromise;
    if (!projectsDirty) return Promise.resolve();
    projectsFlushPromise = runProjectsFlush().finally(() => {
      projectsFlushPromise = null;
      if (projectsDirty) scheduleProjectsFlush();
    });
    return projectsFlushPromise;
  }

  function getProjectsBackend() {
    return projectsBackend;
  }

  function estimateProjectsCacheBytes() {
    if (!projectsCache) return 0;
    try {
      return JSON.stringify(projectsCache).length * 2;
    } catch {
      return 0;
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushProjects();
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
      flushProjects();
    });
  }

  function touchCollectionInStore(store, collectionId, patch = {}) {
    if (!collectionId) return;
    const c = store.collections.find((x) => x.id === collectionId);
    if (!c) return;
    c.updatedAt = new Date().toISOString();
    if (patch.lastProjectId !== undefined) c.lastProjectId = String(patch.lastProjectId || "");
  }

  function listCollections() {
    const { collections } = loadProjectsStore();
    return collections
      .slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  function getCollection(id) {
    if (!id) return null;
    return loadProjectsStore().collections.find((c) => c.id === id) || null;
  }

  function createCollection(name) {
    const n = String(name || "").trim() || "未命名";
    const store = loadProjectsStore();
    const now = new Date().toISOString();
    const collection = {
      id: newId("col_"),
      name: n,
      createdAt: now,
      updatedAt: now,
      lastProjectId: "",
    };
    store.collections.push(collection);
    saveProjectsStore(store);
    return collection;
  }

  function renameCollection(id, name) {
    const store = loadProjectsStore();
    const c = store.collections.find((x) => x.id === id);
    if (!c) return null;
    const n = String(name || "").trim();
    if (!n) return c;
    c.name = n;
    c.updatedAt = new Date().toISOString();
    saveProjectsStore(store);
    return c;
  }

  /**
   * @param {string} id
   * @param {{ deleteChildren?: boolean }} [opts]
   *   deleteChildren true：連分項刪除；false：分項回到未分類
   */
  function deleteCollection(id, opts = {}) {
    const store = loadProjectsStore();
    const exists = store.collections.some((c) => c.id === id);
    if (!exists) return store;
    const deleteChildren = Boolean(opts.deleteChildren);
    if (deleteChildren) {
      const gone = new Set(
        store.projects.filter((p) => p.collectionId === id).map((p) => p.id)
      );
      store.projects = store.projects.filter((p) => p.collectionId !== id);
      if (gone.has(getActiveProjectId())) setActiveProjectId(null);
    } else {
      for (const p of store.projects) {
        if (p.collectionId === id) p.collectionId = UNGROUPED_COLLECTION_ID;
      }
    }
    store.collections = store.collections.filter((c) => c.id !== id);
    saveProjectsStore(store);
    return store;
  }

  function listProjectsByCollection(collectionId) {
    const cid = String(collectionId || UNGROUPED_COLLECTION_ID);
    return listProjects().filter((p) => String(p.collectionId || "") === cid);
  }

  function countUngroupedProjects() {
    return listProjectsByCollection(UNGROUPED_COLLECTION_ID).length;
  }

  function summarizeCollection(collectionId) {
    const cid = String(collectionId || UNGROUPED_COLLECTION_ID);
    const projects = listProjectsByCollection(cid);
    const sentenceCount = projects.reduce((n, p) => n + (p.entries || []).length, 0);
    const col = cid ? getCollection(cid) : null;
    const last = col?.lastProjectId ? getProject(col.lastProjectId) : projects[0] || null;
    return {
      projectCount: projects.length,
      sentenceCount,
      lastProjectId: last?.id || "",
      lastProjectName: last?.name || "",
      updatedAt: col?.updatedAt || projects[0]?.updatedAt || "",
    };
  }

  function rememberCollectionLastProject(collectionId, projectId) {
    if (!collectionId || !projectId) return null;
    const store = loadProjectsStore();
    touchCollectionInStore(store, collectionId, { lastProjectId: projectId });
    saveProjectsStore(store);
    return getCollection(collectionId);
  }

  function moveProject(projectId, collectionId) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) return null;
    const nextId = String(collectionId || UNGROUPED_COLLECTION_ID);
    if (nextId && !store.collections.some((c) => c.id === nextId)) return p;
    const prevId = String(p.collectionId || "");
    if (prevId === nextId) return getProject(projectId);
    p.collectionId = nextId;
    p.updatedAt = new Date().toISOString();
    touchCollectionInStore(store, prevId);
    touchCollectionInStore(store, nextId, { lastProjectId: p.id });
    saveProjectsStore(store);
    return getProject(projectId);
  }

  function listProjects() {
    const { projects } = loadProjectsStore();
    return projects
      .slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  function getProject(id) {
    if (!id) return null;
    return loadProjectsStore().projects.find((p) => p.id === id) || null;
  }

  function createProject(name, opts = {}) {
    const n = String(name || "").trim() || "未命名專案";
    const store = loadProjectsStore();
    const now = new Date().toISOString();
    let collectionId = String(opts.collectionId || UNGROUPED_COLLECTION_ID);
    if (collectionId && !store.collections.some((c) => c.id === collectionId)) {
      collectionId = UNGROUPED_COLLECTION_ID;
    }
    const project = {
      id: newId("proj_"),
      name: n,
      collectionId,
      createdAt: now,
      updatedAt: now,
      entries: [],
    };
    store.projects.push(project);
    touchCollectionInStore(store, collectionId, { lastProjectId: project.id });
    saveProjectsStore(store);
    return project;
  }

  function deleteProject(id) {
    const store = loadProjectsStore();
    const doomed = store.projects.find((p) => p.id === id);
    store.projects = store.projects.filter((p) => p.id !== id);
    if (doomed?.collectionId) {
      const col = store.collections.find((c) => c.id === doomed.collectionId);
      if (col && col.lastProjectId === id) col.lastProjectId = "";
      touchCollectionInStore(store, doomed.collectionId);
    }
    saveProjectsStore(store);
    if (getActiveProjectId() === id) setActiveProjectId(null);
    return store.projects;
  }

  function renameProject(id, name) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === id);
    if (!p) return null;
    const n = String(name || "").trim();
    if (!n) return p;
    p.name = n;
    p.updatedAt = new Date().toISOString();
    touchCollectionInStore(store, p.collectionId);
    saveProjectsStore(store);
    return p;
  }

  function getActiveProjectId() {
    try {
      const id = localStorage.getItem(ACTIVE_PROJECT_KEY);
      if (!id) return null;
      return getProject(id) ? id : null;
    } catch {
      return null;
    }
  }

  function setActiveProjectId(id) {
    if (!id) {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
      return null;
    }
    if (!getProject(id)) {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
      return null;
    }
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    return id;
  }

  function getActiveProject() {
    return getProject(getActiveProjectId());
  }

  /** 專案內句子依序號排序（序號永久固定，刪除後可有空缺） */
  function getProjectEntriesSorted(projectOrId) {
    const p = typeof projectOrId === "string" ? getProject(projectOrId) : projectOrId;
    if (!p) return [];
    return (p.entries || [])
      .slice()
      .sort(
        (a, b) =>
          (a.seq || 0) - (b.seq || 0) || String(a.at || "").localeCompare(String(b.at || ""))
      );
  }

  /**
   * 查詢成功後寫入專案：
   * - forceNew：即使同句已存在也新增一筆（批量副歌各自佔號）
   * - 有 id／seq：更新該筆，序號不變
   * - 否則同句（空白正規化後相同）已存在 → 更新快照，序號不變
   * - 新句 → append，序號 = max(seq)+1（永久固定）
   * 回傳寫入的那一筆；不寫入一般歷史。
   */
  function pickExistingProjectEntry(entries, entry) {
    const list = Array.isArray(entries) ? entries : [];
    if (entry?.forceNew) return null;
    if (entry?.id) {
      const byId = list.find((e) => e.id === entry.id);
      if (byId) return byId;
    }
    const seq = Number(entry?.seq);
    if (Number.isFinite(seq) && seq > 0) {
      const bySeq = list.find((e) => Number(e.seq) === seq);
      if (bySeq) return bySeq;
    }
    const norm = normalizeQueryKey(entry?.query);
    if (!norm) return null;
    return list.find((e) => normalizeQueryKey(e.query) === norm) || null;
  }

  function upsertProjectEntry(projectId, entry) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) return null;
    const q = String(entry?.query || "").trim();
    if (!q) return null;
    const now = new Date().toISOString();
    const existing = pickExistingProjectEntry(p.entries, entry);
    let written;
    if (existing) {
      existing.query = q;
      existing.at = now;
      existing.summary = String(entry.summary || "").trim();
      existing.translation = mergeKeptTranslation(
        existing.translation,
        entry.translation,
        entry.replaceTranslation
      );
      existing.ownedCount = Number.isFinite(entry.ownedCount) ? entry.ownedCount : null;
      existing.missingCount = Number.isFinite(entry.missingCount) ? entry.missingCount : null;
      existing.items = slimInventoryItems(entry.items);
      existing.vocab = slimVocabItems(entry.vocab);
      written = existing;
    } else {
      const maxSeq = (p.entries || []).reduce((m, e) => Math.max(m, Number(e.seq) || 0), 0);
      p.entries = p.entries || [];
      written = {
        id: newId("pe_"),
        seq: maxSeq + 1,
        query: q,
        at: now,
        summary: String(entry.summary || "").trim(),
        translation: String(entry.translation || "").trim(),
        ownedCount: Number.isFinite(entry.ownedCount) ? entry.ownedCount : null,
        missingCount: Number.isFinite(entry.missingCount) ? entry.missingCount : null,
        items: slimInventoryItems(entry.items),
        vocab: slimVocabItems(entry.vocab),
      };
      p.entries.push(written);
    }
    p.updatedAt = now;
    touchCollectionInStore(store, p.collectionId);
    saveProjectsStore(store);
    return written;
  }

  function snapshotLooksReusable(entry) {
    if (!entry) return false;
    if (String(entry.mode || entry.source || "") === "failed") return false;
    if (/分析失敗/.test(String(entry.summary || ""))) return false;
    if (Array.isArray(entry.items) && entry.items.length) return true;
    if (Array.isArray(entry.vocab) && entry.vocab.length) return true;
    if (String(entry.translation || "").trim()) return true;
    const sum = String(entry.summary || "").trim();
    return Boolean(sum) && sum !== "手動模式";
  }

  /** 其他專案／歷史已查過的同句快照，供批量重複句沿用（不重打 API） */
  function findReusableSnapshotByQuery(query, opts = {}) {
    const norm = normalizeQueryKey(query);
    if (!norm) return null;
    const preferId = String(opts.projectId || "");
    const projects = listProjects();
    const ordered = preferId
      ? projects.filter((p) => p.id === preferId).concat(projects.filter((p) => p.id !== preferId))
      : projects;
    for (const p of ordered) {
      const entries = p.entries || [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (normalizeQueryKey(e.query) !== norm) continue;
        if (!snapshotLooksReusable(e)) continue;
        return e;
      }
    }
    try {
      const hist = loadHistory();
      for (const h of hist || []) {
        if (normalizeQueryKey(h?.query) === norm && snapshotLooksReusable(h)) return h;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function removeProjectEntry(projectId, entryId) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) return null;
    p.entries = (p.entries || []).filter((e) => e.id !== entryId);
    p.updatedAt = new Date().toISOString();
    touchCollectionInStore(store, p.collectionId);
    saveProjectsStore(store);
    return getProject(projectId);
  }

  function findProjectEntryByQuery(projectId, query) {
    const p = getProject(projectId);
    if (!p) return null;
    const norm = normalizeQueryKey(query);
    return (p.entries || []).find((e) => normalizeQueryKey(e.query) === norm) || null;
  }

  function findProjectEntryBySeq(projectId, seq) {
    const p = getProject(projectId);
    if (!p) return null;
    const n = Number(seq);
    return (p.entries || []).find((e) => Number(e.seq) === n) || null;
  }

  function exportProjectsJSON(projectIds) {
    const all = listProjects();
    const set = projectIds && projectIds.length ? new Set(projectIds) : null;
    const projects = set ? all.filter((p) => set.has(p.id)) : all;
    return JSON.stringify(
      {
        type: "lugus-french-grammar-projects",
        version: 2,
        exportedAt: new Date().toISOString(),
        collections: listCollections(),
        projects,
      },
      null,
      2
    );
  }

  function importCollectionsList(incoming, mode = "merge") {
    const list = Array.isArray(incoming) ? incoming : [];
    const store = loadProjectsStore();
    let byId = new Map(store.collections.map((c) => [c.id, c]));
    if (mode === "replace") byId = new Map();
    for (const raw of list) {
      const col = normalizeCollection({
        ...raw,
        id: raw?.id || newId("col_"),
      });
      if (!col) continue;
      byId.set(col.id, col);
    }
    store.collections = Array.from(byId.values());
    saveProjectsStore(store);
    return store.collections;
  }

  function importProjectsList(incoming, mode = "merge") {
    const list = Array.isArray(incoming) ? incoming : [];
    const store = loadProjectsStore();
    let byId = new Map(store.projects.map((p) => [p.id, p]));
    if (mode === "replace") byId = new Map();
    let added = 0;
    let updated = 0;
    const colIds = new Set(store.collections.map((c) => c.id));
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const id = String(raw.id || newId("proj_"));
      const project = normalizeProjectRecord({
        ...raw,
        id,
      });
      if (!project) continue;
      if (project.collectionId && !colIds.has(project.collectionId)) {
        project.collectionId = UNGROUPED_COLLECTION_ID;
      }
      if (byId.has(id)) updated += 1;
      else added += 1;
      byId.set(id, project);
    }
    store.projects = Array.from(byId.values());
    saveProjectsStore(store);
    return { projects: store.projects, added, updated, total: store.projects.length };
  }

  function importProjectsJSON(text) {
    const data = JSON.parse(text);
    let incoming = [];
    if (Array.isArray(data)) {
      incoming = data;
    } else if (data && Array.isArray(data.projects)) {
      if (Array.isArray(data.collections)) importCollectionsList(data.collections, "merge");
      incoming = data.projects;
    } else if (data && data.id && (data.entries || data.name)) {
      incoming = [data];
    } else {
      throw new Error("匯入格式需為專案物件、專案陣列，或 { projects: [...] }");
    }
    return importProjectsList(incoming, "merge");
  }

  function formatStorageBytes(n) {
    const b = Math.max(0, Number(n) || 0);
    if (b < 1024) return `${Math.round(b)} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  /**
   * localStorage 每個來源約 5MB（法語 fvgn_* 與韓／日同網址會共用）。
   * 專案句子快照在 IndexedDB，不計入此上限。UTF-16（鍵+值×2）估算。
   */
  function measureLocalStorageUsage() {
    const quota = 5 * 1024 * 1024;
    const rows = [];
    let total = 0;
    let app = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const val = localStorage.getItem(key) || "";
        const bytes = (key.length + val.length) * 2;
        total += bytes;
        const mine = /^(fvgn_|fgn_|kgn_|jgn_)/.test(key);
        if (mine) app += bytes;
        rows.push({ key, bytes, mine });
      }
    } catch {
      /* ignore */
    }
    rows.sort((a, b) => b.bytes - a.bytes);
    const pct = quota ? total / quota : 0;
    let level = "ok";
    if (pct >= 0.95) level = "full";
    else if (pct >= 0.8) level = "warn";
    const idbBytes = estimateProjectsCacheBytes();
    return {
      total,
      app,
      quota,
      pct,
      level,
      rows,
      backend: projectsBackend,
      idbBytes,
      idbLabel: formatStorageBytes(idbBytes),
      totalLabel: formatStorageBytes(total),
      appLabel: formatStorageBytes(app),
      quotaLabel: formatStorageBytes(quota),
    };
  }

  return {
    loadRules,
    saveRules,
    loadTodos,
    saveTodos,
    getMeta,
    setMeta,
    initWithSeed,
    exportRulesJSON,
    exportDataJSON,
    importRulesJSON,
    importDataJSON,
    resetToSeed,
    loadSettings,
    saveSettings,
    clearApiKey,
    hasApiKey,
    API_PROVIDERS,
    getApiProvider,
    inferApiProviderId,
    switchApiProvider,
    loadLookupModes,
    saveLookupModes,
    isApiLookupEnabled,
    formatLookupModesLabel,
    DEFAULT_LOOKUP_MODES,
    loadHistory,
    saveHistory,
    addHistoryEntry,
    removeHistoryEntry,
    clearHistory,
    slimInventoryItems,
    slimVocabItems,
    loadVocabBank,
    saveVocabBank,
    upsertVocabBankEntries,
    lookupVocabBank,
    listVocabBankEntries,
    removeVocabBankEntry,
    removeVocabBankSense,
    setVocabBankPrimarySense,
    estimateVocabBankCoverage,
    mergeVocabWithBank,
    isEnglishVocabSkip,
    filterEnglishVocab,
    stripEnglishFromVocabQuery,
    vocabQueryHasTargetLanguage,
    harvestVocabBankFromSnapshots,
    VOCAB_BANK_MAX,
    HISTORY_MAX,
    DEFAULT_SETTINGS,
    UNGROUPED_COLLECTION_ID,
    listCollections,
    getCollection,
    createCollection,
    renameCollection,
    deleteCollection,
    listProjectsByCollection,
    countUngroupedProjects,
    summarizeCollection,
    rememberCollectionLastProject,
    moveProject,
    listProjects,
    getProject,
    createProject,
    deleteProject,
    renameProject,
    getActiveProjectId,
    setActiveProjectId,
    getActiveProject,
    getProjectEntriesSorted,
    upsertProjectEntry,
    removeProjectEntry,
    findProjectEntryByQuery,
    findReusableSnapshotByQuery,
    findProjectEntryBySeq,
    exportProjectsJSON,
    importProjectsJSON,
    initProjectsDb,
    flushProjects,
    getProjectsBackend,
    measureLocalStorageUsage,
    formatStorageBytes,
    normalizeQueryKey,
  };
})();
