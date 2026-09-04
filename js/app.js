/**
 * Lugus · 法語文法筆記本 — 主應用
 * API 文法／單字 · 手動選字套用 · 歷史 · 專案（同 Mal）
 */
const App = (() => {
  const state = {
    view: "lookup",
    editingId: null,
    draft: null,
    todoSourceId: null,
    formSource: null,
    lastQuery: "",
    lastSearch: null,
    lastInventory: null,
    aiBusy: false,
    lookupBusy: false,
    /** 進行中查詢的世代 token（新查詢遞增，舊回傳不覆寫 UI） */
    lookupToken: 0,
    /** 背景 API 查詢中的句子（可切到歷史句而不中斷） */
    pendingLookupQuery: null,
    /** 還原「查詢中」畫面用的本地結果快照 */
    pendingLookupLocalResult: null,
    aiJob: null,
    gramHlCycleTimers: [],
    /** 專案模式目前游標序號（瀏覽用；與永久 seq 對應） */
    projectCursorSeq: null,
    /**
     * 選字套用規則的暫存
     * @type {null | { text: string, start: number, end: number }}
     */
    selApply: null,
    /** 點擊選字編輯（與 hover／複製浮層分開） */
    sentenceSelectEdit: false,
    /** 單字解釋編輯中的區間 */
    vocabEditRange: null,
    /**
     * 選字「建立新規則」：儲存後自動套回此片段
     * @type {null | { text: string, start: number, end: number }}
     */
    pendingSelApply: null,
    /** 空專案整首匯入 */
    bulkImport: null,
    /** 專案 modal：null=大項列表 · ""=未分類 · id=該大項 */
    projectsBrowseId: null,
    /**
     * 進入表單前的頁面（AI 填寫／取消時跳回）
     * @type {null | string}
     */
    formReturnView: null,
    /** 規則挑選模式：null=選字套用 · supplementary=圖例「+補充」 */
    rulePickMode: null,
    /** 建立補充用法後自動加入本句 */
    pendingSupplementaryApply: false,
    /**
     * 手動為「句中未定位」規則指定片段
     * @type {null | { ruleId: string, ruleTitle: string }}
     */
    locateTarget: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg, type = "info") {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show toast-${type}`;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function updateRuleCount() {
    const el = $("#app-rule-count");
    if (el) el.textContent = String(RulesService.getAll().length);
  }

  function updateApiStatusDot() {
    const dot = $("#api-status-dot");
    if (!dot) return;
    const modes = Storage.loadLookupModes();
    const ready = Storage.hasApiKey();
    const anyMode = modes.apiGrammar || modes.apiVocab;
    // 手動模式（全關）仍可用；僅「開了 API 卻沒 Key」為未就緒
    dot.classList.toggle("ready", anyMode ? ready : true);
    if (!anyMode) {
      dot.title = "手動模式（未開掃描 · 仍可查詢）";
    } else {
      const label = Storage.formatLookupModesLabel(modes);
      dot.title = ready
        ? `${label} · Key 已設定`
        : `${label} · 尚未設定 Key`;
    }
  }

  function updateLookupModeUI() {
    const modes = Storage.loadLookupModes();
    const desc = $("#lookup-mode-desc");
    if (desc) {
      const bits = [];
      if (modes.apiGrammar) bits.push("<strong>API 文法</strong>");
      if (modes.apiVocab) bits.push("<strong>API 單字</strong>");
      if (!bits.length) {
        const empty =
          "目前：手動模式 · 可直接查詢並選字套用（右側可再開 API 文法／單字）";
        desc.innerHTML = empty;
        desc.title = empty;
      } else {
        const keyReqOn = modes.apiGrammar || modes.apiVocab;
        const line =
          `目前：${bits.join(" · ")}` +
          (keyReqOn ? " · 需 API Key" : "") +
          " · 可選字套用／本句移除";
        desc.innerHTML = line;
        desc.title = line.replace(/<\/?strong>/g, "");
      }
    }
    const apiG = $("#settings-mode-api-grammar");
    const apiV = $("#settings-mode-api-vocab");
    if (apiG) apiG.checked = Boolean(modes.apiGrammar);
    if (apiV) apiV.checked = Boolean(modes.apiVocab);
    const keyReq = $("#settings-api-key-req");
    if (keyReq) keyReq.hidden = !(modes.apiGrammar || modes.apiVocab);
    syncSettingsModesAllBtn(modes);
    updateApiStatusDot();
    updateBulkImportHint();
  }

  /** 全部開啟：API 文法 + API 單字 */
  function areAllLookupModesOn(modes) {
    const m = modes || Storage.loadLookupModes();
    return Boolean(m.apiGrammar && m.apiVocab);
  }

  function syncSettingsModesAllBtn(modes) {
    const btn = $("#btn-settings-modes-all");
    if (!btn) return;
    const allOn = areAllLookupModesOn(modes);
    btn.textContent = allOn ? "全部關閉" : "全部開啟";
    btn.setAttribute("aria-pressed", allOn ? "true" : "false");
    btn.classList.toggle("is-all-on", allOn);
  }

  function onSettingsModesAllClick() {
    const modes = Storage.loadLookupModes();
    const allOn = areAllLookupModesOn(modes);
    let next;
    if (allOn) {
      next = Storage.saveLookupModes({
        apiGrammar: false,
        localGrammar: false,
        apiVocab: false,
      });
      setSettingsStatus("已全部關閉查詢模式", "warn");
      showToast("查詢模式：全部關閉", "info");
    } else {
      next = Storage.saveLookupModes({
        apiGrammar: true,
        localGrammar: false,
        apiVocab: true,
      });
      if (!Storage.hasApiKey()) {
        setSettingsStatus("已全部開啟 API 模式 — 請填入 API Key", "warn");
      } else {
        setSettingsStatus(`模式：${Storage.formatLookupModesLabel(next)}`, "ok");
      }
      showToast("查詢模式：全部開啟（API 文法 · API 單字）", "success");
    }
    updateLookupModeUI();
  }

  function setView(view) {
    state.view = view;
    $$(".nav-btn").forEach((btn) => {
      if (view === "form") {
        btn.classList.remove("active");
        return;
      }
      btn.classList.toggle("active", btn.dataset.view === view);
    });
    $$(".view").forEach((v) => {
      v.classList.toggle("hidden", v.id !== `view-${view}`);
    });
    if (view === "rules") renderRulesList();
    if (view === "vocab") renderVocabBankList();
    if (view === "todos") renderTodos();
    if (view === "history") renderHistory();
    if (view === "settings") fillSettingsForm();
    if (view === "lookup") {
      updateLookupModeUI();
      syncProjectBulkImport();
    }
    updateRuleCount();
    updateApiStatusDot();
    // 切換分頁後頂欄高度可能變（換行），重測 sticky 基準
    requestAnimationFrame(() => syncAppHeaderHeight());
  }

  /** 離開表單時應回到的頁面（預設查詢；避免硬跳規則本） */
  function getFormReturnView() {
    const v = state.formReturnView;
    if (v && v !== "form" && document.getElementById(`view-${v}`)) return v;
    if (state.lastQuery) return "lookup";
    return "rules";
  }

  /* —— Settings —— */
  function maskKey(key) {
    const k = String(key || "");
    if (k.length <= 8) return k ? "••••" : "（未設定）";
    return k.slice(0, 4) + "…" + k.slice(-4);
  }

  function setSettingsStatus(text, kind = "") {
    const box = $("#settings-status");
    const el = $("#settings-status-text");
    if (el) el.textContent = text;
    if (box) {
      box.classList.remove("ok", "warn", "error");
      if (kind) box.classList.add(kind);
    }
  }

  function readApiFieldsFromForm() {
    return {
      apiKey: $("#settings-api-key")?.value || "",
      baseUrl: $("#settings-base-url")?.value || "",
      model: $("#settings-model")?.value || "",
    };
  }

  function renderApiProviderUI(s) {
    const settings = s || Storage.loadSettings();
    const providers = Storage.API_PROVIDERS || [];
    const curId =
      typeof Storage.inferApiProviderId === "function"
        ? Storage.inferApiProviderId(settings)
        : settings.apiProvider || "grok";
    const preset =
      typeof Storage.getApiProvider === "function"
        ? Storage.getApiProvider(curId)
        : providers.find((p) => p.id === curId) || providers[0] || {};
    const box = $("#settings-api-provider");
    if (box) {
      box.innerHTML = providers
        .map((p) => {
          const hasKey = Boolean(settings.apiProfiles?.[p.id]?.apiKey);
          const active = p.id === curId;
          return `<button type="button" class="api-provider-pill${
            active ? " is-active" : ""
          }" data-api-provider="${esc(p.id)}" aria-pressed="${active ? "true" : "false"}">
            ${esc(p.label)}${
              hasKey ? `<span class="api-provider-keydot" title="已保存金鑰"></span>` : ""
            }
          </button>`;
        })
        .join("");
    }
    const hint = $("#settings-provider-hint");
    if (hint) {
      hint.innerHTML =
        `${esc(preset.hint || "")}。切換服務時各家金鑰分開保存在本機。` +
        (preset.signup
          ? ` 申請：<a href="${esc(preset.signup)}" target="_blank" rel="noopener noreferrer">${esc(
              preset.signupLabel || preset.signup
            )}</a>`
          : "");
    }
    const keyHint = $("#settings-api-key-hint");
    if (keyHint && preset.signup) {
      keyHint.innerHTML =
        `金鑰存在本機瀏覽器 localStorage，不會上傳到本專案伺服器。請勿在公用電腦儲存。申請：<a href="${esc(
          preset.signup
        )}" target="_blank" rel="noopener noreferrer">${esc(preset.signupLabel || preset.signup)}</a>`;
    }
    const keyInput = $("#settings-api-key");
    if (keyInput) keyInput.placeholder = preset.keyPlaceholder || "API Key";
    const urlInput = $("#settings-base-url");
    if (urlInput) {
      urlInput.readOnly = Boolean(preset.urlLocked);
      urlInput.placeholder = preset.baseUrl || "https://";
    }
    const urlHint = $("#settings-base-url-hint");
    if (urlHint) {
      urlHint.innerHTML = preset.urlLocked
        ? `此服務使用固定端點 <code>${esc(preset.baseUrl)}</code>（OpenAI 相容）`
        : "請填寫 OpenAI 相容的 Base URL（不含尾端 <code>/chat/completions</code>）。";
    }
    const modelInput = $("#settings-model");
    if (modelInput) modelInput.placeholder = preset.defaultModel || "模型名稱";
    const chips = $("#settings-model-shortcuts");
    const models = Array.isArray(preset.models) ? preset.models : [];
    const curModel = String(settings.model || "").trim();
    if (chips) {
      chips.hidden = !models.length;
      chips.innerHTML = models
        .map(
          (m) =>
            `<button type="button" class="model-chip${
              m.id === curModel ? " is-active" : ""
            }" data-model-id="${esc(m.id)}">${esc(m.label)}</button>`
        )
        .join("");
    }
  }

  function switchApiProvider(id) {
    if (typeof Storage.switchApiProvider !== "function") return;
    const next = Storage.switchApiProvider(id, readApiFieldsFromForm());
    fillSettingsForm();
    updateApiStatusDot();
    const label = (Storage.getApiProvider && Storage.getApiProvider(id)?.label) || id;
    const hasKey = Boolean(next.apiKey);
    showToast(
      hasKey ? `已切換 ${label}（已還原該服務金鑰）` : `已切換 ${label}（此服務尚未填金鑰）`,
      hasKey ? "success" : "info"
    );
  }

  function applyModelShortcut(modelId) {
    const input = $("#settings-model");
    if (!input || !modelId) return;
    input.value = modelId;
    Storage.saveSettings({ ...readApiFieldsFromForm(), model: modelId });
    renderApiProviderUI();
    const s = Storage.loadSettings();
    const modes = Storage.loadLookupModes();
    const prov = Storage.getApiProvider ? Storage.getApiProvider(s.apiProvider) : null;
    setSettingsStatus(
      `已填入模型 ${modelId}` +
        (prov ? ` · ${prov.label}` : "") +
        (s.apiKey ? ` · Key ${maskKey(s.apiKey)}` : "") +
        ` · ${Storage.formatLookupModesLabel(modes)}`,
      s.apiKey ? "ok" : "warn"
    );
  }

  function fillSettingsForm() {
    const s = Storage.loadSettings();
    $("#settings-api-key").value = s.apiKey || "";
    $("#settings-base-url").value = s.baseUrl || Storage.DEFAULT_SETTINGS.baseUrl;
    $("#settings-model").value = s.model || Storage.DEFAULT_SETTINGS.model;
    const input = $("#settings-api-key");
    if (input) input.type = "password";
    const toggle = $("#btn-toggle-key");
    if (toggle) toggle.textContent = "顯示";
    renderApiProviderUI(s);
    syncApiTtsSwitch(s);
    updateLookupModeUI();
    const modes = Storage.loadLookupModes();
    const modeLabel = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    const prov =
      typeof Storage.getApiProvider === "function"
        ? Storage.getApiProvider(s.apiProvider)
        : null;
    const provLabel = prov?.label ? `${prov.label} · ` : "";
    if (s.apiKey) {
      setSettingsStatus(
        `已設定 ${provLabel}API Key（${maskKey(s.apiKey)}）· 模型 ${s.model} · ${modeLabel}`,
        "ok"
      );
    } else if (needApi) {
      setSettingsStatus(
        `尚未設定 ${provLabel}API Key — API 文法／單字與 AI 填寫無法使用`,
        "warn"
      );
    } else {
      setSettingsStatus("手動模式 · 可查詢並選字套用（未開掃描）", "ok");
    }
    updateSettingsStorageUsage();
  }

  function updateSettingsStorageUsage() {
    const el = $("#settings-storage-usage");
    if (!el || typeof Storage.measureLocalStorageUsage !== "function") return;
    const u = Storage.measureLocalStorageUsage();
    const pct = Math.round(u.pct * 100);
    const backend =
      u.backend || (typeof Storage.getProjectsBackend === "function" ? Storage.getProjectsBackend() : "");
    const top = (u.rows || [])
      .slice(0, 3)
      .filter((r) => r.key !== "fvgn_projects_v1" || backend !== "idb")
      .map((r) => `${r.key.replace(/^(.{18}).+$/, "$1…")} ${Storage.formatStorageBytes(r.bytes)}`)
      .join(" · ");
    let line = `localStorage 約 ${u.totalLabel}／${u.quotaLabel}（${pct}%）`;
    if (backend === "idb") {
      line += ` · 專案句子 IndexedDB ${u.idbLabel || "0 B"}（不受 5MB 上限）`;
    } else if (u.app) {
      line += ` · 文法筆記本 ${u.appLabel}`;
    }
    if (u.level === "full") {
      line +=
        backend === "idb"
          ? " · localStorage 已接近上限（規則／設定／其他網站資料）；專案句子已在 IndexedDB。"
          : " · 已接近上限，整批分析容易寫不進去。可匯出後刪舊專案／清空歷史。";
    } else if (u.level === "warn" && backend !== "idb") {
      line += " · 偏高，歌詞專案含切詞快照會很快塞滿。";
    }
    if (top) line += ` 最大：${top}`;
    el.textContent = line;
  }

  function readLookupModesFromForm() {
    return {
      apiGrammar: Boolean($("#settings-mode-api-grammar")?.checked),
      localGrammar: false,
      apiVocab: Boolean($("#settings-mode-api-vocab")?.checked),
    };
  }

  function onLookupModeToggle() {
    const raw = readLookupModesFromForm();
    const modes = Storage.saveLookupModes(raw);
    updateLookupModeUI();
    const label = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (!modes.apiGrammar && !modes.apiVocab) {
      setSettingsStatus("手動模式 · 可查詢並選字套用", "ok");
      showToast("已關閉掃描 · 仍可查詢並手動套用規則", "info");
    } else if (needApi && !Storage.hasApiKey()) {
      setSettingsStatus(`模式：${label} — 請填入 API Key`, "warn");
      showToast(`查詢模式：${label}`, "success");
    } else {
      setSettingsStatus(`模式：${label}`, "ok");
      showToast(`查詢模式：${label}`, "success");
    }
  }

  function saveSettingsForm(e) {
    e?.preventDefault();
    const raw = readLookupModesFromForm();
    const modes = Storage.saveLookupModes(raw);
    const next = Storage.saveSettings({
      ...readApiFieldsFromForm(),
      apiTtsEnabled: Boolean($("#settings-api-tts")?.checked),
      lookupModes: modes,
    });
    updateLookupModeUI();
    renderApiProviderUI(next);
    const modeLabel = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    const provLabel =
      typeof Storage.getApiProvider === "function"
        ? `${Storage.getApiProvider(next.apiProvider).label} · `
        : "";
    if (next.apiKey) {
      setSettingsStatus(
        `已儲存 ${provLabel}（${maskKey(next.apiKey)}）· 模型 ${next.model} · ${modeLabel}`,
        "ok"
      );
      showToast("設定已儲存", "success");
    } else if (needApi) {
      setSettingsStatus("已儲存，但未填 API Key", "warn");
      showToast("已儲存（尚未填 API Key）", "info");
    } else {
      setSettingsStatus(`已儲存 · ${modeLabel || "未啟用模式"}`, "ok");
      showToast("設定已儲存", "success");
    }
  }

  async function testApiConnection() {
    Storage.saveSettings(readApiFieldsFromForm());
    updateApiStatusDot();
    const btn = $("#btn-test-api");
    if (btn) btn.disabled = true;
    setSettingsStatus("測試連線中…", "");
    try {
      const result = await AiService.testConnection();
      setSettingsStatus(`連線成功 · 回覆：${result.sample}`, "ok");
      showToast("API 連線成功", "success");
    } catch (err) {
      setSettingsStatus(err.message || "連線失敗", "error");
      showToast(err.message || "連線失敗", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function clearApiKey() {
    const s = Storage.loadSettings();
    const label =
      typeof Storage.getApiProvider === "function"
        ? Storage.getApiProvider(s.apiProvider).label
        : "目前服務";
    if (!confirm(`確定清除「${label}」的 API Key？其他服務已保存的金鑰會保留。`)) return;
    Storage.clearApiKey();
    $("#settings-api-key").value = "";
    updateApiStatusDot();
    renderApiProviderUI();
    setSettingsStatus(`${label} 的 API Key 已清除`, "warn");
    showToast("已清除 API Key", "info");
  }

  /* —— History —— */
  function formatHistoryTime(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}`;
    } catch {
      return "";
    }
  }

  function renderHistory() {
    const box = $("#history-list");
    const countEl = $("#history-count");
    if (!box) return;
    const filterQ = String($("#history-filter")?.value || "")
      .trim()
      .toLowerCase();
    const all = Storage.loadHistory();
    const list = !filterQ
      ? all
      : all.filter((h) => {
          const blob = [h.query, h.summary, h.translation].join("\n").toLowerCase();
          return blob.includes(filterQ);
        });

    if (countEl) {
      if (!all.length) {
        countEl.textContent = "尚無歷史。完成 API 盤點後會記錄於此。";
      } else if (filterQ) {
        countEl.textContent = `搜尋「${filterQ}」· ${list.length} / ${all.length} 筆 · 列表為儲存時數字 ·「再看一次」才依目前筆記本重分`;
      } else {
        countEl.textContent = `共 ${list.length} 筆（最多 ${Storage.HISTORY_MAX || 40} 筆）· 列表顯示儲存時的已收錄／尚未 ·「再看一次」才重分`;
      }
    }
    if (!all.length) {
      box.innerHTML = `<div class="empty-state"><p>還沒有查詢紀錄。<br/>到「查詢」輸入句子並完成盤點後會出現在這裡。</p></div>`;
      updateLookupNavBtns();
      return;
    }
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><p>沒有符合「${esc(filterQ)}」的歷史。<br/>試試其他關鍵字。</p></div>`;
      return;
    }
    // 列表用儲存時的 owned/missing 快照（A3：不對每筆即時 buildApiHighlight）
    // 「再看一次」才依目前筆記本重分
    box.innerHTML = `
      <ul class="history-list">
        ${list
          .map((h) => {
            const meta = [];
            if (h.ownedCount != null) meta.push(`已收錄 ${h.ownedCount}`);
            if (h.missingCount != null) meta.push(`尚未收錄 ${h.missingCount}`);
            const ruleN = Array.isArray(h.items) ? h.items.length : 0;
            const preview = esc(h.query || "");
            const subLine = h.summary || h.translation || "";
            return `
          <li class="history-item" data-id="${esc(h.id)}">
            <div class="history-main">
              <p class="history-query">${preview}</p>
              <p class="history-meta muted">
                ${esc(formatHistoryTime(h.at))}
                ${meta.length ? ` · ${esc(meta.join(" · "))}` : ""}
                ${
                  meta.length
                    ? ` · <span class="history-snap-hint">儲存時</span>`
                    : ""
                }
                ${
                  ruleN
                    ? ` · <span class="muted">文法 ${ruleN}</span>`
                    : ' · <span class="muted">無文法標記</span>'
                }
                ${subLine ? `<br/>${esc(subLine)}` : ""}
              </p>
            </div>
            <div class="history-actions">
              <button type="button" class="btn btn-sm btn-primary" data-hist-review title="${
                ruleN
                  ? "使用當時盤點快照，依目前筆記本重分已收錄／未收錄"
                  : "還原句子與結果區（當時無文法標記，可再選字套用）"
              }">再看一次</button>
              <button type="button" class="btn btn-sm btn-ghost" data-hist-remove>刪除</button>
            </div>
          </li>`;
          })
          .join("")}
      </ul>`;

    box.querySelectorAll(".history-item").forEach((li) => {
      const id = li.dataset.id;
      const entry = list.find((h) => h.id === id);
      if (!entry) return;
      li.querySelector("[data-hist-review]")?.addEventListener("click", () => {
        reviewHistoryWithCurrentRules(entry);
      });
      li.querySelector("[data-hist-remove]")?.addEventListener("click", () => {
        Storage.removeHistoryEntry(id);
        renderHistory();
        updateLookupNavBtns();
        showToast("已刪除此筆歷史", "info");
      });
    });
    updateLookupNavBtns();
  }

  function clearAllHistory() {
    if (!confirm("確定清空全部查詢歷史？")) return;
    Storage.clearHistory();
    renderHistory();
    updateLookupNavBtns();
    showToast("已清空歷史", "info");
  }

  /* —— 專案模式（與 Mal 相同） —— */

  function isProjectMode() {
    return Boolean(Storage.getActiveProjectId());
  }

  function updateProjectModeUI() {
    const bar = $("#project-mode-bar");
    const navBtn = $("#nav-projects");
    const project = Storage.getActiveProject();
    const inProject = Boolean(project);

    if (bar) bar.classList.toggle("hidden", !inProject);
    if (navBtn) {
      navBtn.classList.toggle("project-active", inProject);
      navBtn.title = inProject
        ? `回到分項「${project.name || "未命名"}」（離開請用查詢頁「離開專案」）`
        : "大項／分項：小說各章、歌詞各首";
    }

    if (inProject) {
      const nameEl = $("#project-mode-name");
      const posEl = $("#project-mode-pos");
      const colBtn = $("#project-mode-collection");
      const sepEl = $("#project-mode-path-sep");
      const col = project.collectionId ? Storage.getCollection(project.collectionId) : null;
      if (colBtn && sepEl) {
        if (col) {
          colBtn.textContent = col.name || "未命名";
          colBtn.classList.remove("hidden");
          sepEl.classList.remove("hidden");
        } else if (project.collectionId) {
          colBtn.classList.add("hidden");
          sepEl.classList.add("hidden");
        } else {
          colBtn.textContent = "未分類";
          colBtn.classList.remove("hidden");
          sepEl.classList.remove("hidden");
        }
      }
      if (nameEl && document.activeElement !== nameEl) {
        nameEl.textContent = project.name || "未命名專案";
      }
      const entries = Storage.getProjectEntriesSorted(project);
      const total = entries.length;
      let curSeq = state.projectCursorSeq;
      const curQ = String($("#lookup-input")?.value || "").trim();
      if (curQ) {
        curSeq = resolveDisplayedProjectSeq(project.id, curQ, curSeq);
      }
      if (posEl) {
        if (total === 0) {
          posEl.textContent = "尚無句子 · 可一次放入歌詞，或查詢後編為第 1 號";
        } else if (curSeq != null && entries.some((e) => e.seq === curSeq)) {
          const idx = entries.findIndex((e) => e.seq === curSeq) + 1;
          posEl.textContent = `第 ${curSeq} 號 · ${idx}/${total} 句`;
        } else {
          posEl.textContent = `共 ${total} 句 · 查新句會接續編號`;
        }
      }
    }

    updateLookupNavBtns();
    syncProjectBulkImport();
  }

  function commitProjectRename() {
    const el = $("#project-mode-name");
    const project = Storage.getActiveProject();
    if (!el || !project) return;
    const next = String(el.textContent || "").replace(/\s+/g, " ").trim();
    if (!next) {
      el.textContent = project.name || "未命名專案";
      showToast("專案名稱不能空白", "error");
      return;
    }
    if (next === String(project.name || "").trim()) {
      el.textContent = project.name || next;
      return;
    }
    const updated = Storage.renameProject(project.id, next);
    el.textContent = updated?.name || next;
    updateProjectModeUI();
    renderProjectsList();
    showToast(`已改名為「${updated?.name || next}」`, "success");
  }

  function bindProjectNameEdit() {
    const el = $("#project-mode-name");
    if (!el || el.dataset.renameBound === "1") return;
    el.dataset.renameBound = "1";
    let snapshot = "";
    el.addEventListener("focus", () => {
      snapshot = String(el.textContent || "");
    });
    el.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        el.textContent = snapshot;
        el.blur();
      }
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = String((e.clipboardData || window.clipboardData)?.getData("text") || "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) document.execCommand("insertText", false, text);
    });
    el.addEventListener("blur", () => commitProjectRename());
  }

  function isEmptyActiveProject() {
    const p = Storage.getActiveProject();
    if (!p) return false;
    return Storage.getProjectEntriesSorted(p).length === 0;
  }

  const SENTENCE_END_MARK = /[。．｡！？!?…⋯‼⁇⁈⁉]/;
  const SENTENCE_END_CLOSER = /[」』）\)］】》〉»"”’]/;
  const LETTER_BEFORE_DOT = /[\u3040-\u30FF\u4E00-\u9FFFー」』）)］】》〉A-Za-zÀ-ÖØ-öø-ÿ\uAC00-\uD7A3]/;

  function isSentenceEndChar(ch, prev, next) {
    if (SENTENCE_END_MARK.test(ch)) return true;
    if (ch === "." && prev && LETTER_BEFORE_DOT.test(prev) && !/\d/.test(next || "")) {
      return true;
    }
    return false;
  }

  function isCommaBreakChar(ch, prev, next) {
    if (ch === "、" || ch === "，" || ch === "､") return true;
    if (ch === "," && !(/\d/.test(prev || "") && /\d/.test(next || ""))) return true;
    return false;
  }

  /** 依指定標點切開一行；標點與緊接的閉括號留在上一句。無該標點則原樣。 */
  function splitLineByBreakPred(line, isBreak) {
    const s = String(line || "");
    if (!s.trim()) return [];
    const parts = [];
    let start = 0;
    let i = 0;
    while (i < s.length) {
      const prev = i > 0 ? s[i - 1] : "";
      const next = i + 1 < s.length ? s[i + 1] : "";
      if (!isBreak(s[i], prev, next)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < s.length) {
        const p = j > 0 ? s[j - 1] : "";
        const n = j + 1 < s.length ? s[j + 1] : "";
        if (!isBreak(s[j], p, n)) break;
        j += 1;
      }
      while (j < s.length && SENTENCE_END_CLOSER.test(s[j])) j += 1;
      const piece = s.slice(start, j).trim();
      if (piece) parts.push(piece);
      while (j < s.length && /[\s\u3000]/.test(s[j])) j += 1;
      start = j;
      i = j;
    }
    const tail = s.slice(start).trim();
    if (tail) parts.push(tail);
    return parts.length > 1 ? parts : [s];
  }

  function breakBulkTextByPred(text, isBreak) {
    return String(text || "")
      .split(/\r?\n/)
      .flatMap((line) => (line.trim() ? splitLineByBreakPred(line, isBreak) : [""]))
      .join("\n");
  }

  function applyBulkTextTransform(transform, noChangeToast, successLabel) {
    if (state.bulkImport?.running) return;
    const ta = $("#project-bulk-input");
    if (!ta) return;
    const before = ta.value;
    if (!before.trim()) {
      showToast("請先貼上歌詞或文本", "error");
      ta.focus();
      return;
    }
    const after = transform(before);
    const same =
      after.replace(/\r\n/g, "\n") === String(before).replace(/\r\n/g, "\n");
    if (same) {
      showToast(noChangeToast, "info");
      return;
    }
    ta.value = after;
    updateBulkImportHint();
    const info = splitBulkLines(after);
    showToast(`已${successLabel}分成 ${info.lines.length} 行，可再改後再分析`, "success");
    ta.focus();
  }

  function applyBulkSentenceBreaks() {
    applyBulkTextTransform(
      (text) => breakBulkTextByPred(text, isSentenceEndChar),
      "沒有可依句號拆開的句子",
      "依句號"
    );
  }

  function applyBulkCommaBreaks() {
    applyBulkTextTransform(
      (text) => breakBulkTextByPred(text, isCommaBreakChar),
      "沒有可依逗號拆開的句子",
      "依逗號"
    );
  }

  function splitBulkLines(text) {
    const rawLines = String(text || "").split(/\r?\n/);
    const nonempty = rawLines.map((s) => s.trim()).filter(Boolean);
    const seen = new Set();
    const lines = [];
    let dupCount = 0;
    for (const line of nonempty) {
      const key = Storage.normalizeQueryKey(line);
      if (!key) continue;
      if (seen.has(key)) dupCount += 1;
      else seen.add(key);
      lines.push(line);
    }
    return {
      lines,
      rawCount: rawLines.length,
      nonemptyCount: nonempty.length,
      skippedEmpty: rawLines.length - nonempty.length,
      dupCount,
    };
  }

  function formatBulkStat(info) {
    if (!info || !info.nonemptyCount) return "尚未貼上內容";
    const bits = [`將匯入 ${info.lines.length} 句`];
    if (info.skippedEmpty) bits.push(`略過空行 ${info.skippedEmpty}`);
    if (info.dupCount) bits.push(`重複保留 ${info.dupCount}（API 只查一次）`);
    return bits.join(" · ");
  }

  function updateBulkImportHint() {
    const modeEl = $("#project-bulk-mode");
    if (modeEl && typeof Storage.formatLookupModesLabel === "function") {
      modeEl.textContent = Storage.formatLookupModesLabel(Storage.loadLookupModes());
    }
    const stat = $("#project-bulk-stat");
    const ta = $("#project-bulk-input");
    if (stat && ta && !state.bulkImport?.running) {
      stat.textContent = formatBulkStat(splitBulkLines(ta.value));
    }
  }

  function isViewingBulkProject() {
    const job = state.bulkImport;
    return Boolean(job?.running && job.projectId && Storage.getActiveProjectId() === job.projectId);
  }

  function syncProjectBulkImport() {
    const panel = $("#project-bulk-import");
    if (!panel) return;
    const running = Boolean(state.bulkImport?.running);
    const viewingJob = isViewingBulkProject();
    const empty = isEmptyActiveProject();
    const compact = viewingJob && !empty;
    const show =
      viewingJob || (empty && state.view === "lookup" && !state.lookupBusy && !running);
    panel.classList.toggle("hidden", !show);
    panel.classList.toggle("is-compact", compact);
    if (show && !running) updateBulkImportHint();
    updateBulkProgressDom();
  }

  function updateBulkProgressDom() {
    const box = $("#project-bulk-progress");
    if (!box) return;
    const job = state.bulkImport;
    if (!job?.running) {
      box.classList.add("hidden");
      document.body.classList.remove("bulk-import-running");
      updateBackgroundLookupBanner();
      return;
    }
    const viewingJob = isViewingBulkProject();
    box.classList.toggle("hidden", !viewingJob);
    const stillCollecting = viewingJob && isEmptyActiveProject();
    document.body.classList.toggle("bulk-import-running", stillCollecting);
    const title = $("#project-bulk-progress-title");
    const line = $("#project-bulk-progress-line");
    const fill = $("#project-bulk-progress-fill");
    const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
    if (title) {
      title.textContent = `${stillCollecting ? "分析中" : "背景分析"} ${job.done}／${job.total}${
        job.failed ? ` · 失敗 ${job.failed}` : ""
      }`;
    }
    if (line) {
      const now = job.current ? `正在處理「${truncateQueryPreview(job.current, 40)}」` : "";
      line.textContent = stillCollecting
        ? now
        : [now, "可開「專案」看別本；分析不會中斷"].filter(Boolean).join(" · ");
    }
    if (fill) fill.style.width = `${pct}%`;
    updateBackgroundLookupBanner();
  }

  function emptyLocalResult(query) {
    return {
      form: query,
      mode: "sentence",
      matches: [],
      localDisabled: true,
      analysis: null,
    };
  }

  async function persistBulkLine(query, inventory, localResult, projectId) {
    const inv =
      inventory && typeof inventory === "object"
        ? inventory
        : { summary: "", translation: "", items: [], vocab: [] };
    let apiHl = { ownedHits: [], missingItems: [], spans: [], legend: [] };
    try {
      apiHl = buildApiHighlight(query, inv) || apiHl;
    } catch (err) {
      console.warn("[persistBulkLine highlight]", query, err);
    }
    try {
      persistLookupPayload(query, inv, apiHl, localResult || emptyLocalResult(query), {
        keepCursor: true,
        projectId,
        forceNew: true,
      });
    } catch (err) {
      console.warn("[persistBulkLine]", query, err);
      try {
        if (typeof Storage.upsertProjectEntry === "function") {
          Storage.upsertProjectEntry(projectId, {
            query,
            summary: `分析失敗：${err.message || "無法寫入"}`,
            translation: "",
            items: [],
            vocab: [],
            forceNew: true,
          });
        }
      } catch (err2) {
        console.warn("[persistBulkLine fallback]", err2);
      }
    }
    try {
      if (typeof Storage.flushProjects === "function") {
        await Storage.flushProjects();
      }
    } catch (err) {
      console.warn("[persistBulkLine flush]", query, err);
    }
    return apiHl;
  }

  function cloneLookupJson(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function isFailedLookupInventory(inventory) {
    if (!inventory) return true;
    if (inventory.source === "failed" || inventory.mode === "failed") return true;
    return /分析失敗/.test(String(inventory.summary || ""));
  }

  function inventoryFromStoredSnapshot(entry) {
    if (!entry) return null;
    return {
      summary: String(entry.summary || ""),
      translation: String(entry.translation || ""),
      items: cloneLookupJson(entry.items) || [],
      vocab: cloneLookupJson(entry.vocab) || [],
      mode: "cached",
      source: "cached",
    };
  }

  function rememberBulkPacked(cache, line, packed) {
    const key = Storage.normalizeQueryKey(line);
    if (!key || !packed || isFailedLookupInventory(packed.inventory) || cache.has(key)) return;
    cache.set(key, cloneLookupJson(packed));
  }

  function reuseBulkPacked(cache, line, { needApi, projectId } = {}) {
    const key = Storage.normalizeQueryKey(line);
    if (!key) return null;
    if (cache.has(key)) return cloneLookupJson(cache.get(key));
    if (!needApi) return null;
    const stored =
      typeof Storage.findReusableSnapshotByQuery === "function"
        ? Storage.findReusableSnapshotByQuery(line, { projectId })
        : null;
    if (!stored) return null;
    const packed = {
      inventory: inventoryFromStoredSnapshot(stored),
      localResult: emptyLocalResult(line),
    };
    cache.set(key, cloneLookupJson(packed));
    return packed;
  }

  async function runProjectBulkImport() {
    if (state.bulkImport?.running || state.lookupBusy) {
      showToast("已有查詢進行中", "info");
      return;
    }
    if (!isEmptyActiveProject()) {
      showToast("專案已有句子，請用上方查詢列逐句新增", "info");
      syncProjectBulkImport();
      return;
    }
    const info = splitBulkLines($("#project-bulk-input")?.value || "");
    if (!info.lines.length) {
      showToast("請先貼上歌詞或文本", "error");
      $("#project-bulk-input")?.focus();
      return;
    }
    const modes = Storage.loadLookupModes();
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (needApi && !Storage.hasApiKey()) {
      showToast("此模式需要 API Key，請先到「設定」填入", "error");
      setView("settings");
      return;
    }

    const startPid = Storage.getActiveProjectId();
    const startName = Storage.getProject(startPid)?.name || "專案";
    const job = {
      running: true,
      cancel: false,
      token: ++state.lookupToken,
      projectId: startPid,
      projectName: startName,
      total: info.lines.length,
      done: 0,
      failed: 0,
      dupCount: info.dupCount,
      reused: 0,
      current: "",
    };
    state.bulkImport = job;
    state.lookupBusy = true;
    updateBulkProgressDom();
    syncProjectBulkImport();

    let firstQuery = null;
    const lookupCache = new Map();
    try {
      for (const line of info.lines) {
        if (job.cancel || !Storage.getProject(startPid)) break;
        job.current = line;
        updateBulkProgressDom();
        let reusedThis = false;
        try {
          let packed = reuseBulkPacked(lookupCache, line, {
            needApi,
            projectId: startPid,
          });
          reusedThis = Boolean(packed);
          if (!packed) {
            packed = await fetchLookupInventory(line);
          }
          if (job.cancel || !Storage.getProject(startPid)) break;
          await persistBulkLine(line, packed.inventory, packed.localResult, startPid);
          if (!reusedThis) rememberBulkPacked(lookupCache, line, packed);
          if (reusedThis) job.reused += 1;
          if (!firstQuery) firstQuery = line;
        } catch (err) {
          if (job.cancel || !Storage.getProject(startPid)) break;
          job.failed += 1;
          await persistBulkLine(
            line,
            {
              summary: `分析失敗：${err.message || "未知錯誤"}`,
              translation: "",
              items: [],
              vocab: [],
              mode: "failed",
              source: "failed",
            },
            null,
            startPid
          );
          if (!firstQuery) firstQuery = line;
        }
        job.done += 1;
        try {
          if (firstQuery && job.done === 1 && Storage.getActiveProjectId() === startPid) {
            const first = Storage.findProjectEntryByQuery(startPid, firstQuery);
            if (first) {
              reviewProjectEntry(first, { silent: true });
              showToast(
                `第 ${first.seq} 句已可看 · 其餘 ${job.total - 1} 句在背景繼續；可先開其他專案`,
                "success"
              );
            }
          }
          if (Storage.getActiveProjectId() === startPid) updateProjectModeUI();
          if (
            !$("#project-entries-modal")?.classList.contains("hidden") &&
            Storage.getActiveProjectId() === startPid
          ) {
            renderProjectEntriesList(startPid);
          }
        } catch (err) {
          console.warn("[bulk ui]", err);
        }
        if (needApi && !job.cancel && !reusedThis) {
          await new Promise((r) => setTimeout(r, 280));
        }
      }
    } finally {
      try {
        if (typeof Storage.flushProjects === "function") {
          await Storage.flushProjects();
        }
      } catch (err) {
        console.warn("[bulk flush]", err);
      }
      state.lookupBusy = false;
      const cancelled = job.cancel;
      const done = job.done;
      const failed = job.failed;
      const dupCount = job.dupCount;
      const reused = job.reused;
      state.bulkImport = null;
      document.body.classList.remove("bulk-import-running");
      updateBulkProgressDom();
      updateProjectModeUI();

      const viewing = Storage.getActiveProjectId() === startPid;
      const entries = viewing ? Storage.getProjectEntriesSorted(startPid) : [];
      if (viewing && entries.length && firstQuery && !isViewingLookupQuery(firstQuery) && !state.lastQuery) {
        const first =
          Storage.findProjectEntryByQuery(startPid, firstQuery) || entries[0];
        reviewProjectEntry(first, { silent: true });
      }
      const ta = $("#project-bulk-input");
      if (ta) ta.value = "";
      syncProjectBulkImport();

      const bits = [`「${startName}」已匯入 ${done} 句`];
      if (dupCount) bits.push(`重複保留 ${dupCount}`);
      if (reused) bits.push(`API 沿用 ${reused}`);
      if (failed) bits.push(`失敗 ${failed}`);
      if (cancelled && done < info.lines.length) bits.push("已取消其餘");
      showToast(bits.join(" · "), failed ? "info" : "success");
    }
  }

  function cancelProjectBulkImport() {
    if (!state.bulkImport?.running) return;
    state.bulkImport.cancel = true;
    const title = $("#project-bulk-progress-title");
    if (title) title.textContent = "正在取消…";
  }

  function normalizeLookupKey(q) {
    return String(q || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function isViewingLookupQuery(query) {
    return normalizeLookupKey($("#lookup-input")?.value) === normalizeLookupKey(query);
  }

  function truncateQueryPreview(q, max = 36) {
    const s = String(q || "").trim().replace(/\s+/g, " ");
    if (!s) return "";
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }

  function ensureLookupBgBanner() {
    let el = $("#lookup-bg-banner");
    if (el) return el;
    const form = $("#lookup-form");
    const result = $("#lookup-result");
    if (!form && !result) return null;
    el = document.createElement("div");
    el.id = "lookup-bg-banner";
    el.className = "lookup-bg-banner hidden";
    el.setAttribute("role", "status");
    if (form) form.insertAdjacentElement("afterend", el);
    else result.insertAdjacentElement("beforebegin", el);
    return el;
  }

  /** API 查詢中切到已查過句子時顯示；完成後自動隱藏 */
  function updateBackgroundLookupBanner() {
    const el = ensureLookupBgBanner();
    if (!el) return;
    const job = state.bulkImport;
    if (job?.running && !isViewingBulkProject()) {
      const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
      el.classList.remove("hidden");
      el.innerHTML = `
        <div class="lookup-bg-banner-main">
          <strong>整批分析進行中</strong>
          <span>專案「${esc(job.projectName || "未命名")}」${job.done}／${job.total}${
            job.failed ? ` · 失敗 ${job.failed}` : ""
          }（${pct}%）· 不中斷目前瀏覽</span>
        </div>
        <div class="lookup-bg-banner-actions">
          <button type="button" class="btn btn-sm btn-secondary" id="btn-return-bulk-project">
            回該專案
          </button>
          <button type="button" class="btn btn-sm btn-ghost" id="btn-cancel-bulk-away">
            取消其餘
          </button>
        </div>`;
      el.querySelector("#btn-return-bulk-project")?.addEventListener("click", () => {
        if (job.projectId) enterProject(job.projectId);
      });
      el.querySelector("#btn-cancel-bulk-away")?.addEventListener("click", () => {
        cancelProjectBulkImport();
        updateBackgroundLookupBanner();
      });
      return;
    }
    const pending = state.pendingLookupQuery;
    if (!state.lookupBusy || !pending || job?.running) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    if (isViewingLookupQuery(pending)) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="lookup-bg-banner-main">
        <strong>API 背景查詢中</strong>
        <span>「${esc(truncateQueryPreview(pending))}」完成後會自動存入${
          Storage.getActiveProjectId() ? "專案" : "歷史"
        }，不中斷目前瀏覽。</span>
      </div>
      <button type="button" class="btn btn-sm btn-secondary" id="btn-return-pending-lookup">
        回到查詢中
      </button>`;
    el.querySelector("#btn-return-pending-lookup")?.addEventListener("click", () => {
      returnToPendingLookup();
    });
  }

  function returnToPendingLookup() {
    const pending = state.pendingLookupQuery;
    if (!pending || !state.lookupBusy) {
      updateBackgroundLookupBanner();
      return;
    }
    if ($("#lookup-input")) $("#lookup-input").value = pending;
    state.lastQuery = pending;
    const localResult =
      state.pendingLookupLocalResult || {
        form: pending,
        mode: "sentence",
        matches: [],
        localDisabled: true,
        analysis: null,
      };
    state.lastSearch = localResult;
    renderHybridLookup(pending, localResult, null, { apiLoading: true });
    updateBackgroundLookupBanner();
    updateLookupNavBtns();
    if (isProjectMode()) updateProjectModeUI();
  }

  function clearPendingLookup(token) {
    if (token != null && token !== state.lookupToken) return;
    state.lookupBusy = false;
    state.pendingLookupQuery = null;
    state.pendingLookupLocalResult = null;
    updateBackgroundLookupBanner();
  }

  function resolveDisplayedProjectSeq(projectId, query, preferredSeq) {
    const norm = Storage.normalizeQueryKey(query);
    if (preferredSeq != null && projectId) {
      const cur = Storage.findProjectEntryBySeq(projectId, preferredSeq);
      if (cur && (!norm || Storage.normalizeQueryKey(cur.query) === norm)) {
        return cur.seq;
      }
    }
    if (!norm || !projectId) return preferredSeq;
    return Storage.findProjectEntryByQuery(projectId, query)?.seq ?? preferredSeq;
  }

  function applyPersistEntryTarget(payload, opts = {}) {
    if (opts.forceNew) {
      payload.forceNew = true;
      return;
    }
    if (opts.entryId) payload.id = opts.entryId;
    if (opts.entrySeq != null) payload.seq = opts.entrySeq;
    if (payload.id || payload.seq != null) return;
    const pid = opts.projectId || Storage.getActiveProjectId();
    if (!pid || state.projectCursorSeq == null) return;
    const cur = Storage.findProjectEntryBySeq(pid, state.projectCursorSeq);
    if (
      cur &&
      Storage.normalizeQueryKey(cur.query) === Storage.normalizeQueryKey(payload.query)
    ) {
      payload.id = cur.id;
      payload.seq = cur.seq;
    }
  }

  function persistLookupPayload(query, inventory, apiHl, localResult, opts = {}) {
    keepExistingTranslation(query, inventory, opts);
    prepareInventoryVocab(inventory, query);
    rememberInventoryVocab(inventory, { preferIncoming: false });
    const payload = {
      query,
      summary: inventory.summary || "",
      translation: inventory.translation || "",
      replaceTranslation: Boolean(opts.replaceTranslation),
      ownedCount: (apiHl.ownedHits || []).length,
      missingCount: (apiHl.missingItems || []).length,
      localCount: (localResult?.matches || []).length,
      items: inventory.items || [],
      vocab: inventory.vocab || [],
    };
    applyPersistEntryTarget(payload, opts);
    const activePid = opts.projectId || Storage.getActiveProjectId();
    if (activePid) {
      const before = payload.forceNew
        ? null
        : payload.id
          ? Storage.getProject(activePid)?.entries?.find((e) => e.id === payload.id)
          : Storage.findProjectEntryByQuery(activePid, query);
      const after = Storage.upsertProjectEntry(activePid, payload);
      const viewing = Storage.getActiveProjectId() === activePid;
      if (after?.seq != null && !opts.keepCursor && viewing) state.projectCursorSeq = after.seq;
      if (!opts.keepCursor && viewing) updateProjectModeUI();
      else updateLookupNavBtns();
      return { payload, before, after, activePid };
    }
    Storage.addHistoryEntry(payload);
    updateLookupNavBtns();
    return { payload, before: null, after: null, activePid: null };
  }

  /**
   * 一般模式：僅 → 再看歷史上一句
   * 專案模式：← 上一號 / 序號 / → 下一號
   */
  function updateLookupNavBtns() {
    const prevBtn = $("#btn-lookup-seq-prev");
    const nextBtn = $("#btn-lookup-seq-next");
    const label = $("#lookup-seq-label");
    if (!nextBtn) return;

    if (isProjectMode()) {
      const project = Storage.getActiveProject();
      const entries = Storage.getProjectEntriesSorted(project);
      const total = entries.length;

      if (prevBtn) prevBtn.hidden = false;
      if (label) {
        label.hidden = false;
        let curSeq = state.projectCursorSeq;
        const curQ = String($("#lookup-input")?.value || "").trim();
        if (curQ) {
          curSeq = resolveDisplayedProjectSeq(project?.id, curQ, curSeq);
        }
        if (total === 0) {
          label.textContent = "—";
        } else if (curSeq != null && entries.some((e) => e.seq === curSeq)) {
          label.textContent = `${curSeq}/${entries[entries.length - 1].seq}`;
        } else {
          label.textContent = `·/${entries[entries.length - 1].seq}`;
        }
      }

      const curIdx = resolveProjectCursorIndex(entries);
      if (prevBtn) {
        prevBtn.disabled = total === 0 || curIdx === 0;
        prevBtn.title = "上一號句子（A / ←）";
        prevBtn.setAttribute("aria-label", "上一號句子");
      }
      nextBtn.disabled = total === 0 || (curIdx >= 0 && curIdx >= total - 1);
      nextBtn.title = "下一號句子（D / →）";
      nextBtn.setAttribute("aria-label", "下一號句子");
      return;
    }

    if (prevBtn) prevBtn.hidden = true;
    if (label) {
      label.hidden = true;
      label.textContent = "";
    }
    const list = Storage.loadHistory();
    const has = list.length > 0;
    nextBtn.disabled = !has;
    nextBtn.title = has ? "再看歷史中的上一句（D / →）" : "尚無查詢歷史";
    nextBtn.setAttribute("aria-label", has ? "再看歷史上一句" : "尚無查詢歷史");
  }

  function resolveProjectCursorIndex(entries) {
    if (!entries?.length) return -1;
    // 副歌／重複句：必須用游標序號。若改找「輸入框同句的第一筆」，
    // 下一句會從第一次出現處起算，翻頁就會跳回前前頁打轉。
    if (state.projectCursorSeq != null) {
      const byCursor = entries.findIndex((e) => e.seq === state.projectCursorSeq);
      if (byCursor >= 0) return byCursor;
    }
    const curQ = String($("#lookup-input")?.value || "").trim();
    if (curQ) {
      const hit = entries.find(
        (e) => Storage.normalizeQueryKey(e.query) === Storage.normalizeQueryKey(curQ)
      );
      if (hit) return entries.findIndex((e) => e.seq === hit.seq);
    }
    return -1;
  }

  function recallPreviousHistorySentence() {
    const list = Storage.loadHistory();
    if (!list.length) {
      showToast("尚無查詢歷史", "info");
      updateLookupNavBtns();
      return;
    }
    const cur = String($("#lookup-input")?.value || "")
      .trim()
      .replace(/\s+/g, " ");
    let entry = list[0];
    if (cur && list.length > 1) {
      const firstNorm = String(list[0].query || "")
        .trim()
        .replace(/\s+/g, " ");
      if (cur === firstNorm) {
        entry = list[1];
      }
    }
    if (!entry?.query) {
      showToast("找不到上一句歷史", "info");
      return;
    }
    reviewHistoryWithCurrentRules(entry);
    updateLookupNavBtns();
  }

  /** 專案模式：上一號 / 下一號 */
  function navigateProjectSentence(dir) {
    const project = Storage.getActiveProject();
    if (!project) {
      showToast("目前不在專案中", "info");
      return;
    }
    const entries = Storage.getProjectEntriesSorted(project);
    if (!entries.length) {
      showToast("此專案尚無句子", "info");
      updateLookupNavBtns();
      return;
    }
    let idx = resolveProjectCursorIndex(entries);
    if (idx < 0) {
      idx = dir > 0 ? -1 : entries.length;
    }
    const nextIdx = idx + dir;
    if (nextIdx < 0) {
      showToast("已是第一句", "info");
      return;
    }
    if (nextIdx >= entries.length) {
      showToast("已是最後一句", "info");
      return;
    }
    reviewProjectEntry(entries[nextIdx], { silent: false });
  }

  function onLookupSeqPrev() {
    if (isProjectMode()) navigateProjectSentence(-1);
  }

  function onLookupSeqNext() {
    if (isProjectMode()) navigateProjectSentence(1);
    else recallPreviousHistorySentence();
  }

  /** 是否在可編輯欄位中（方向鍵應留給游標移動） */
  function isEditableKeyTarget(el) {
    if (!el || el === document.body) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    return Boolean(el.closest && el.closest("input, textarea, select, [contenteditable='true']"));
  }

  let touchSession = false;

  function isCoarsePointer() {
    if (touchSession) return true;
    try {
      return (
        window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(hover: none)").matches
      );
    } catch {
      return "ontouchstart" in window;
    }
  }

  function visualViewportBox() {
    const vv = window.visualViewport;
    if (vv) {
      return {
        left: vv.offsetLeft,
        top: vv.offsetTop,
        width: vv.width,
        height: vv.height,
        right: vv.offsetLeft + vv.width,
        bottom: vv.offsetTop + vv.height,
      };
    }
    return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
  }

  function eventClientPoint(e) {
    const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    if (t) return { x: t.clientX, y: t.clientY };
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      return { x: e.clientX, y: e.clientY };
    }
    return { x: NaN, y: NaN };
  }

  function placeFixedPop(pop, clientX, clientY, opts = {}) {
    if (!pop) return;
    const pad = opts.pad ?? 8;
    const gap = opts.gap ?? 12;
    const vv = visualViewportBox();
    const rect = pop.getBoundingClientRect();
    let left = clientX - rect.width / 2;
    let top = clientY + gap;
    left = Math.max(vv.left + pad, Math.min(left, vv.right - rect.width - pad));
    if (top + rect.height > vv.bottom - pad) top = clientY - rect.height - gap;
    top = Math.max(vv.top + pad, Math.min(top, vv.bottom - rect.height - pad));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function placePopNearAnchor(pop, anchor) {
    if (!pop || !anchor) return;
    const pad = 8;
    const vv = visualViewportBox();
    const rect = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + pad;
    left = Math.max(vv.left + pad, Math.min(left, vv.right - pr.width - pad));
    if (top + pr.height > vv.bottom - pad && rect.top - pr.height - pad >= vv.top) {
      top = rect.top - pr.height - pad;
    }
    top = Math.max(vv.top + pad, Math.min(top, vv.bottom - pr.height - pad));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function bindPadChrome() {
    if (bindPadChrome.done) return;
    bindPadChrome.done = true;
    window.addEventListener(
      "touchstart",
      () => {
        touchSession = true;
      },
      { passive: true }
    );
    const vv = window.visualViewport;
    if (!vv) return;
    let ticking = false;
    const keepFocusVisible = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const el = document.activeElement;
        if (!el || !isEditableKeyTarget(el)) return;
        try {
          el.scrollIntoView({ block: "center", inline: "nearest" });
        } catch {
          el.scrollIntoView();
        }
      });
    };
    vv.addEventListener("resize", keepFocusVisible);
    vv.addEventListener("scroll", keepFocusVisible);
  }

  /**
   * 查詢頁方向鍵導航：← / A 上一句 · → / D 下一句
   * @returns {boolean} 是否已處理
   */
  function handleLookupArrowNav(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if (state.view !== "lookup") return false;
    // 查詢進行中仍可切到已查過句子（背景 API 不中斷）
    if (isEditableKeyTarget(e.target)) return false;
    if (!$("#vocab-edit-modal")?.classList.contains("hidden")) return false;
    if (!$("#rule-pick-modal")?.classList.contains("hidden")) return false;
    if (!$("#projects-modal")?.classList.contains("hidden")) return false;
    if (!$("#project-entries-modal")?.classList.contains("hidden")) return false;
    if (!$("#sel-apply-pop")?.classList.contains("hidden")) return false;
    if (state.locateTarget) return false;

    const code = String(e.code || "");
    if (e.key === "ArrowLeft" || code === "KeyA") {
      e.preventDefault();
      onLookupSeqPrev();
      return true;
    }
    if (e.key === "ArrowRight" || code === "KeyD") {
      e.preventDefault();
      onLookupSeqNext();
      return true;
    }
    return false;
  }

  function isAppHotkeyBlocked(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
    if (e.isComposing || e.keyCode === 229) return true;
    if (isEditableKeyTarget(e.target)) return true;
    return false;
  }

  function isBlockingOverlayOpen() {
    if (!$("#vocab-edit-modal")?.classList.contains("hidden")) return true;
    if (!$("#rule-pick-modal")?.classList.contains("hidden")) return true;
    if (!$("#projects-modal")?.classList.contains("hidden")) return true;
    if (!$("#project-entries-modal")?.classList.contains("hidden")) return true;
    if (!$("#sel-apply-pop")?.classList.contains("hidden")) return true;
    if (state.locateTarget) return true;
    return false;
  }

  function dismissTransientUi() {
    if (!$("#vocab-edit-modal")?.classList.contains("hidden")) closeVocabEditModal();
    if (!$("#rule-pick-modal")?.classList.contains("hidden")) closeRulePickModal();
    if (!$("#sel-apply-pop")?.classList.contains("hidden")) {
      hideSelApplyPop();
      state.selApply = null;
    }
    if (state.locateTarget) cancelLocateMode();
    if (!$("#project-entries-modal")?.classList.contains("hidden")) closeProjectEntriesModal();
    if (!$("#projects-modal")?.classList.contains("hidden")) closeProjectsModal();
  }

  function toggleLookupModeHotkey(which) {
    const id = which === "apiVocab" ? "settings-mode-api-vocab" : "settings-mode-api-grammar";
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !el.checked;
    onLookupModeToggle(which);
  }

  /** WASD／ZXCVBNM 全域快捷鍵（輸入中不攔截） */
  function handleAppHotkeys(e) {
    if (isAppHotkeyBlocked(e)) return false;
    const code = String(e.code || "");

    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      code === "KeyA" ||
      code === "KeyD"
    ) {
      return handleLookupArrowNav(e);
    }

    if (e.repeat) return false;

    if (code === "KeyW") {
      if (isBlockingOverlayOpen()) return false;
      e.preventDefault();
      toggleLookupModeHotkey("apiGrammar");
      return true;
    }
    if (code === "KeyS") {
      if (isBlockingOverlayOpen()) return false;
      e.preventDefault();
      toggleLookupModeHotkey("apiVocab");
      return true;
    }

    const viewByCode = {
      KeyZ: "lookup",
      KeyX: "history",
      KeyC: "projects",
      KeyV: "rules",
      KeyB: "vocab",
      KeyN: "todos",
      KeyM: "settings",
    };
    const dest = viewByCode[code];
    if (!dest) return false;
    e.preventDefault();
    if (dest === "projects") {
      if (!$("#vocab-edit-modal")?.classList.contains("hidden")) closeVocabEditModal();
      if (!$("#rule-pick-modal")?.classList.contains("hidden")) closeRulePickModal();
      if (!$("#sel-apply-pop")?.classList.contains("hidden")) {
        hideSelApplyPop();
        state.selApply = null;
      }
      if (state.locateTarget) cancelLocateMode();
      if (!$("#project-entries-modal")?.classList.contains("hidden")) closeProjectEntriesModal();
      onNavProjects();
      return true;
    }
    dismissTransientUi();
    setView(dest);
    return true;
  }

  /** 頂部「專案」：已在專案中 → 回查詢頁；否則開列表 */
  function onNavProjects() {
    const project = Storage.getActiveProject();
    if (project) {
      closeProjectsModal();
      setView("lookup");
      updateProjectModeUI();
      const box = $("#lookup-result");
      const empty = !box || !box.innerHTML.trim();
      if (empty) {
        const entries = Storage.getProjectEntriesSorted(project);
        if (entries.length) {
          let entry =
            state.projectCursorSeq != null
              ? entries.find((e) => e.seq === state.projectCursorSeq)
              : null;
          if (!entry) entry = entries[0];
          reviewProjectEntry(entry, { silent: true });
        }
      }
      return;
    }
    openProjectsModal();
  }

  function openProjectsModal(opts = {}) {
    const modal = $("#projects-modal");
    if (!modal) return;
    if (Object.prototype.hasOwnProperty.call(opts, "browseId")) {
      state.projectsBrowseId = opts.browseId;
    } else {
      state.projectsBrowseId = null;
    }
    modal.classList.remove("hidden");
    renderProjectsList();
    const input = $("#project-new-name");
    if (input) {
      input.value = "";
      if (!isCoarsePointer()) setTimeout(() => input.focus(), 50);
    }
  }

  function closeProjectsModal() {
    $("#projects-modal")?.classList.add("hidden");
  }

  function isBrowsingUngrouped() {
    return state.projectsBrowseId === "";
  }

  function browsingCollection() {
    if (state.projectsBrowseId == null || state.projectsBrowseId === "") return null;
    return Storage.getCollection(state.projectsBrowseId);
  }

  function syncProjectsModalChrome() {
    const atRoot = state.projectsBrowseId == null;
    const ungrouped = isBrowsingUngrouped();
    const col = browsingCollection();
    const title = $("#projects-modal-title");
    const sub = $("#projects-modal-sub");
    const crumb = $("#projects-modal-crumb");
    const crumbCur = $("#projects-crumb-current");
    const input = $("#project-new-name");
    const label = $("#project-new-name-label");
    const createBtn = $("#btn-project-create");

    if (title) title.textContent = atRoot ? "專案" : ungrouped ? "未分類" : col?.name || "分項";
    if (sub) {
      sub.textContent = atRoot
        ? "先選大項（如歌詞、小說），再進分項。句子只存在分項裡。"
        : "分項是現在的專案：各章／各首歌。進入後查詢會依序編號。";
    }
    if (crumb) crumb.classList.toggle("hidden", atRoot);
    if (crumbCur) {
      const name = ungrouped ? "未分類" : col?.name || "—";
      if (document.activeElement !== crumbCur) crumbCur.textContent = name;
      crumbCur.classList.toggle("is-editable", Boolean(col));
      crumbCur.contentEditable = col ? "true" : "false";
      crumbCur.title = col ? "點此改名" : "";
    }
    if (input) {
      input.placeholder = atRoot
        ? "新大項名稱，例如：歌詞、小說"
        : "新分項名稱，例如：第一幕、某首歌";
    }
    if (label) label.textContent = atRoot ? "新大項名稱" : "新分項名稱";
    if (createBtn) createBtn.textContent = atRoot ? "建立大項" : "建立分項";
  }

  function collectionMoveOptionsHtml(selectedId) {
    const cur = String(selectedId || "");
    const cols = Storage.listCollections();
    const opts = [`<option value=""${cur ? "" : " selected"}>未分類</option>`];
    for (const c of cols) {
      opts.push(
        `<option value="${esc(c.id)}"${c.id === cur ? " selected" : ""}>${esc(c.name)}</option>`
      );
    }
    return opts.join("");
  }

  function openProjectEntriesModal() {
    const project = Storage.getActiveProject();
    if (!project) {
      showToast("請先進入專案", "info");
      return;
    }
    const modal = $("#project-entries-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    const filter = $("#project-entries-filter");
    if (filter) filter.value = "";
    renderProjectEntriesList(project.id);
    setTimeout(() => filter?.focus(), 40);
  }

  function closeProjectEntriesModal() {
    $("#project-entries-modal")?.classList.add("hidden");
  }

  function renderProjectsList() {
    const box = $("#projects-list");
    if (!box) return;
    syncProjectsModalChrome();
    if (state.projectsBrowseId == null) {
      renderCollectionList(box);
      return;
    }
    renderProjectItems(box, state.projectsBrowseId);
  }

  function renderCollectionList(box) {
    const cols = Storage.listCollections();
    const ungroupedN = Storage.countUngroupedProjects();
    const active = Storage.getActiveProject();
    const items = [];

    for (const c of cols) {
      const sum = Storage.summarizeCollection(c.id);
      const current = active?.collectionId === c.id;
      items.push({
        kind: "collection",
        id: c.id,
        name: c.name,
        current,
        meta: [
          `${sum.projectCount} 分項`,
          `${sum.sentenceCount} 句`,
          sum.lastProjectName ? `上次：${sum.lastProjectName}` : "",
          c.updatedAt ? `更新 ${formatHistoryTime(c.updatedAt)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
    if (ungroupedN) {
      const sum = Storage.summarizeCollection("");
      items.push({
        kind: "ungrouped",
        id: "",
        name: "未分類",
        current: Boolean(active && !active.collectionId),
        meta: [`${sum.projectCount} 分項`, `${sum.sentenceCount} 句`].join(" · "),
      });
    }

    if (!items.length) {
      box.innerHTML = `<p class="projects-empty">尚無大項。建立「歌詞」「小說」這類容器，再在裡面加分項（各章／各首歌）。</p>`;
      return;
    }

    box.innerHTML = `<ul class="projects-list">${items
      .map(
        (it) => `
          <li class="project-item is-folder${it.current ? " is-active" : ""}" data-kind="${
            it.kind
          }" data-id="${esc(it.id)}">
            <div class="project-item-main">
              <p class="project-item-name">${esc(it.name)}${it.current ? " · 使用中" : ""}</p>
              <p class="project-item-meta">${esc(it.meta)}</p>
            </div>
            <div class="project-item-actions">
              <button type="button" class="btn btn-sm btn-primary" data-col-open>打開</button>
              ${
                it.kind === "collection"
                  ? `<button type="button" class="btn btn-sm btn-danger-ghost" data-col-delete>刪除</button>`
                  : ""
              }
            </div>
          </li>`
      )
      .join("")}</ul>`;

    box.querySelectorAll(".project-item").forEach((li) => {
      const id = li.dataset.id;
      const open = () => {
        state.projectsBrowseId = li.dataset.kind === "ungrouped" ? "" : id;
        renderProjectsList();
        $("#project-new-name")?.focus();
      };
      li.querySelector("[data-col-open]")?.addEventListener("click", open);
      li.querySelector(".project-item-main")?.addEventListener("click", open);
      li.querySelector("[data-col-delete]")?.addEventListener("click", () => {
        deleteCollectionWithConfirm(id);
      });
    });
  }

  function renderProjectItems(box, collectionId) {
    const list = Storage.listProjectsByCollection(collectionId);
    const activeId = Storage.getActiveProjectId();
    if (!list.length) {
      box.innerHTML = `<p class="projects-empty">尚無分項。輸入名稱後按「建立分項」，再一次放入文本。</p>`;
      return;
    }
    box.innerHTML = `<ul class="projects-list">${list
      .map((p) => {
        const n = (p.entries || []).length;
        const active = p.id === activeId;
        return `
          <li class="project-item${active ? " is-active" : ""}" data-id="${esc(p.id)}">
            <div class="project-item-main">
              <p class="project-item-name">${esc(p.name)}${active ? " · 使用中" : ""}</p>
              <p class="project-item-meta">
                ${n} 句
                ${p.updatedAt ? ` · 更新 ${esc(formatHistoryTime(p.updatedAt))}` : ""}
              </p>
            </div>
            <div class="project-item-actions">
              <label class="sr-only" for="proj-move-${esc(p.id)}">搬到大項</label>
              <select
                class="project-item-move"
                id="proj-move-${esc(p.id)}"
                data-proj-move
                title="搬到其他大項"
              >${collectionMoveOptionsHtml(p.collectionId)}</select>
              <button type="button" class="btn btn-sm btn-primary" data-proj-enter>
                ${active ? "回到查詢" : "進入"}
              </button>
              <button type="button" class="btn btn-sm btn-danger-ghost" data-proj-delete>
                刪除
              </button>
            </div>
          </li>`;
      })
      .join("")}</ul>`;

    box.querySelectorAll(".project-item").forEach((li) => {
      const id = li.dataset.id;
      li.querySelector("[data-proj-enter]")?.addEventListener("click", () => {
        enterProject(id);
      });
      li.querySelector("[data-proj-move]")?.addEventListener("change", (e) => {
        const next = e.target.value;
        const moved = Storage.moveProject(id, next);
        if (!moved) {
          showToast("無法搬移", "error");
          renderProjectsList();
          return;
        }
        const dest = next ? Storage.getCollection(next)?.name : "未分類";
        showToast(`已搬到「${dest || "未分類"}」`, "success");
        updateProjectModeUI();
        renderProjectsList();
      });
      li.querySelector("[data-proj-delete]")?.addEventListener("click", () => {
        const p = Storage.getProject(id);
        if (!p) return;
        if (
          !confirm(
            `確定刪除分項「${p.name}」？\n內含 ${(p.entries || []).length} 句將一併清除（無法復原）。`
          )
        ) {
          return;
        }
        if (state.bulkImport?.running && state.bulkImport.projectId === id) {
          cancelProjectBulkImport();
        }
        Storage.deleteProject(id);
        if (!Storage.getActiveProjectId()) {
          state.projectCursorSeq = null;
        }
        updateProjectModeUI();
        renderProjectsList();
        showToast("已刪除分項", "info");
      });
    });
  }

  function deleteCollectionWithConfirm(id) {
    const c = Storage.getCollection(id);
    if (!c) return;
    const sum = Storage.summarizeCollection(id);
    if (!confirm(`確定刪除大項「${c.name}」？\n內含 ${sum.projectCount} 個分項、${sum.sentenceCount} 句。`)) {
      return;
    }
    const wipeKids = confirm(
      `這 ${sum.projectCount} 個分項要怎麼處理？\n\n確定＝連同分項與句子全部刪除\n取消＝只刪大項，分項回到「未分類」`
    );
    if (wipeKids) {
      const kids = Storage.listProjectsByCollection(id);
      for (const p of kids) {
        if (state.bulkImport?.running && state.bulkImport.projectId === p.id) {
          cancelProjectBulkImport();
        }
      }
    }
    Storage.deleteCollection(id, { deleteChildren: wipeKids });
    if (!Storage.getActiveProjectId()) state.projectCursorSeq = null;
    if (state.projectsBrowseId === id) state.projectsBrowseId = null;
    updateProjectModeUI();
    renderProjectsList();
    showToast(wipeKids ? `已刪除大項「${c.name}」與全部分項` : `已刪除大項「${c.name}」· 分項回到未分類`, "info");
  }

  function filterProjectEntries(entries, rawQ) {
    const q = String(rawQ || "").trim();
    if (!q) return entries.slice();
    const qLower = q.toLowerCase();
    const seqMatch = q.match(/^(?:#|第\s*)?(\d+)\s*(?:號|句)?$/);
    if (seqMatch) {
      const n = Number(seqMatch[1]);
      return entries.filter((e) => Number(e.seq) === n);
    }
    const rangeMatch = q.match(/^(\d+)\s*[-~～—–]\s*(\d+)$/);
    if (rangeMatch) {
      let a = Number(rangeMatch[1]);
      let b = Number(rangeMatch[2]);
      if (a > b) [a, b] = [b, a];
      return entries.filter((e) => {
        const s = Number(e.seq);
        return s >= a && s <= b;
      });
    }
    return entries.filter((e) => {
      const blob = [e.query, e.summary, e.translation, String(e.seq), `#${e.seq}`, `第${e.seq}`]
        .join("\n")
        .toLowerCase();
      return blob.includes(qLower);
    });
  }

  function highlightFilterMatch(text, rawQ) {
    const src = String(text || "");
    const q = String(rawQ || "").trim();
    if (!q || !src) return esc(src);
    if (/^(?:#|第\s*)?\d+\s*(?:號|句)?$/.test(q) || /^\d+\s*[-~～—–]\s*\d+$/.test(q)) {
      return esc(src);
    }
    const lower = src.toLowerCase();
    const ql = q.toLowerCase();
    const idx = lower.indexOf(ql);
    if (idx < 0) return esc(src);
    const before = src.slice(0, idx);
    const mid = src.slice(idx, idx + q.length);
    const after = src.slice(idx + q.length);
    return `${esc(before)}<mark class="pe-hl">${esc(mid)}</mark>${esc(after)}`;
  }

  function renderProjectEntriesList(projectId) {
    const box = $("#project-entries-list");
    const sub = $("#project-entries-modal-sub");
    const stat = $("#project-entries-filter-stat");
    const project = Storage.getProject(projectId);
    if (!box || !project) return;
    const all = Storage.getProjectEntriesSorted(project);
    const filterQ = String($("#project-entries-filter")?.value || "");
    const entries = filterProjectEntries(all, filterQ);

    if (sub) {
      const col = project.collectionId ? Storage.getCollection(project.collectionId) : null;
      const path = col ? `${col.name} › ${project.name}` : project.name;
      sub.textContent = `「${path}」· 共 ${all.length} 句 · 序號永久固定，刪除後不重編`;
    }
    if (stat) {
      if (!all.length) {
        stat.textContent = "";
      } else if (filterQ.trim()) {
        stat.textContent = `${entries.length} / ${all.length}`;
      } else {
        stat.textContent = `${all.length} 句`;
      }
    }

    if (!all.length) {
      box.innerHTML = `<div class="project-entries-empty">
        <p class="project-entries-empty-title">尚無句子</p>
        <p>在查詢頁送出後會依序編為第 1、2、3… 號。</p>
      </div>`;
      return;
    }
    if (!entries.length) {
      box.innerHTML = `<div class="project-entries-empty">
        <p class="project-entries-empty-title">沒有符合的句子</p>
        <p>試試其他關鍵字，或輸入序號如 <code>3</code>、<code>#12</code>、區間 <code>2-5</code>。</p>
      </div>`;
      return;
    }

    const activeSeq = state.projectCursorSeq;
    box.innerHTML = `<ul class="project-entries-list" role="list">${entries
      .map((e) => {
        const ruleN = Array.isArray(e.items) ? e.items.length : 0;
        const isCurrent = activeSeq != null && Number(e.seq) === Number(activeSeq);
        const qFull = String(e.query || "");
        const qShow = qFull.length > 160 ? qFull.slice(0, 160) + "…" : qFull;
        const tr = String(e.translation || "").trim();
        const sum = String(e.summary || "").trim();
        return `
          <li class="project-entry-item${isCurrent ? " is-current" : ""}" data-id="${esc(
            e.id
          )}" data-seq="${e.seq}">
            <div class="project-entry-seq-col" aria-hidden="true">
              <span class="project-entry-seq">#${e.seq}</span>
            </div>
            <div class="project-entry-main">
              <p class="project-entry-query">${highlightFilterMatch(qShow, filterQ)}</p>
              ${
                tr
                  ? `<p class="project-entry-trans">${highlightFilterMatch(
                      tr.length > 100 ? tr.slice(0, 100) + "…" : tr,
                      filterQ
                    )}</p>`
                  : ""
              }
              <div class="project-entry-meta-row">
                <span class="pe-chip">${esc(formatHistoryTime(e.at) || "—")}</span>
                ${
                  ruleN
                    ? `<span class="pe-chip pe-chip-ok">文法 ${ruleN}</span>`
                    : `<span class="pe-chip">無文法標記</span>`
                }
                ${
                  e.ownedCount != null || e.missingCount != null
                    ? `<span class="pe-chip">已收錄 ${e.ownedCount ?? "—"} · 尚未 ${
                        e.missingCount ?? "—"
                      }</span>`
                    : ""
                }
                ${isCurrent ? `<span class="pe-chip pe-chip-now">目前句子</span>` : ""}
              </div>
              ${
                sum
                  ? `<p class="project-entry-summary">${highlightFilterMatch(
                      sum.length > 100 ? sum.slice(0, 100) + "…" : sum,
                      filterQ
                    )}</p>`
                  : ""
              }
            </div>
            <div class="project-entry-actions">
              <button type="button" class="btn btn-sm btn-primary" data-pe-review title="${
                ruleN
                  ? "還原盤點快照"
                  : "還原句子與結果區（當時無文法標記）"
              }">再看</button>
              <button type="button" class="btn btn-sm btn-danger-ghost" data-pe-delete>刪除</button>
            </div>
          </li>`;
      })
      .join("")}</ul>`;

    box.querySelectorAll(".project-entry-item").forEach((li) => {
      const entryId = li.dataset.id;
      const entry = entries.find((x) => x.id === entryId);
      if (!entry) return;
      li.querySelector("[data-pe-review]")?.addEventListener("click", () => {
        closeProjectEntriesModal();
        reviewProjectEntry(entry);
      });
      li.querySelector("[data-pe-delete]")?.addEventListener("click", () => {
        if (!confirm(`確定刪除第 ${entry.seq} 號句子？\n（其餘句子序號不變）`)) return;
        Storage.removeProjectEntry(projectId, entryId);
        if (state.projectCursorSeq === entry.seq) state.projectCursorSeq = null;
        renderProjectEntriesList(projectId);
        if (isEmptyActiveProject()) {
          state.lastQuery = "";
          state.lastInventory = null;
          state.lastSearch = null;
          if ($("#lookup-input")) $("#lookup-input").value = "";
          const resultBox = $("#lookup-result");
          if (resultBox) resultBox.innerHTML = "";
        }
        updateProjectModeUI();
        showToast(`已刪除第 ${entry.seq} 號`, "info");
      });
    });
  }

  function enterProject(id) {
    const p = Storage.getProject(id);
    if (!p) {
      showToast("找不到專案", "error");
      return;
    }
    Storage.setActiveProjectId(id);
    if (p.collectionId) Storage.rememberCollectionLastProject(p.collectionId, id);
    state.projectCursorSeq = null;
    closeProjectsModal();
    setView("lookup");
    updateProjectModeUI();
    syncProjectBulkImport();
    updateBackgroundLookupBanner();
    const entries = Storage.getProjectEntriesSorted(p);
    if (entries.length) {
      reviewProjectEntry(entries[0], { silent: true });
      showToast(`已進入專案「${p.name}」· ${entries.length} 句`, "success");
    } else {
      const input = $("#lookup-input");
      if (input) input.value = "";
      const box = $("#lookup-result");
      if (box) box.innerHTML = "";
      state.lastQuery = "";
      state.lastInventory = null;
      state.lastSearch = null;
      syncProjectBulkImport();
      showToast(`已進入專案「${p.name}」· 可貼上整首一次匯入`, "success");
    }
  }

  function leaveProject() {
    if (!Storage.getActiveProjectId()) {
      showToast("目前不在專案中", "info");
      return;
    }
    Storage.setActiveProjectId(null);
    state.projectCursorSeq = null;
    updateProjectModeUI();
    $("#project-bulk-import")?.classList.add("hidden");
    syncProjectBulkImport();
    updateBackgroundLookupBanner();
    showToast(
      state.bulkImport?.running
        ? "已離開專案 · 整批分析仍在背景進行"
        : "已離開專案（一般查詢模式）",
      "info"
    );
  }

  function createProjectFromModal() {
    const input = $("#project-new-name");
    const name = String(input?.value || "").trim();
    if (!name) {
      showToast(state.projectsBrowseId == null ? "請輸入大項名稱" : "請輸入分項名稱", "error");
      input?.focus();
      return;
    }
    if (state.projectsBrowseId == null) {
      const c = Storage.createCollection(name);
      if (input) input.value = "";
      state.projectsBrowseId = c.id;
      renderProjectsList();
      showToast(`已建立大項「${c.name}」· 可再加分項`, "success");
      input?.focus();
      return;
    }
    const p = Storage.createProject(name, { collectionId: state.projectsBrowseId || "" });
    if (input) input.value = "";
    renderProjectsList();
    showToast(`已建立分項「${p.name}」`, "success");
  }

  function commitCollectionRenameFromCrumb() {
    const el = $("#projects-crumb-current");
    const col = browsingCollection();
    if (!el || !col) return;
    const next = String(el.textContent || "").replace(/\s+/g, " ").trim();
    if (!next) {
      el.textContent = col.name || "未命名";
      showToast("大項名稱不能空白", "error");
      return;
    }
    if (next === String(col.name || "").trim()) {
      el.textContent = col.name || next;
      return;
    }
    const updated = Storage.renameCollection(col.id, next);
    el.textContent = updated?.name || next;
    updateProjectModeUI();
    renderProjectsList();
    showToast(`已改名為「${updated?.name || next}」`, "success");
  }

  function bindCollectionCrumbRename() {
    const el = $("#projects-crumb-current");
    if (!el || el.dataset.renameBound === "1") return;
    el.dataset.renameBound = "1";
    let snapshot = "";
    el.addEventListener("focus", () => {
      snapshot = String(el.textContent || "");
    });
    el.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        el.textContent = snapshot;
        el.blur();
      }
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = String((e.clipboardData || window.clipboardData)?.getData("text") || "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) document.execCommand("insertText", false, text);
    });
    el.addEventListener("blur", () => commitCollectionRenameFromCrumb());
  }

  /** 從專案句子：依現在規則重看（不呼叫 API、不寫一般歷史） */
  function reviewProjectEntry(entry, opts = {}) {
    if (!entry?.query) return;
    if (entry.seq != null) state.projectCursorSeq = entry.seq;
    // 允許 items 為空：完整還原句子與結果區
    const items = Array.isArray(entry.items) ? entry.items : [];
    const vocab = Array.isArray(entry.vocab) ? entry.vocab : [];
    setView("lookup");
    if ($("#lookup-input")) $("#lookup-input").value = entry.query;
    // 回看以快照為準，不重跑本地掃描（避免空盤點被新命中蓋過）
    const localResult = {
      form: entry.query,
      mode: "sentence",
      matches: [],
      localDisabled: true,
      analysis: null,
    };
    state.lastQuery = entry.query;
    state.lastSearch = localResult;
    const inv = {
      summary: entry.summary || "",
      translation: entry.translation || "",
      items,
      vocab,
    };
    state.lastInventory = inv;
    // A1：render 內只算一次 highlight，回傳供寫回／toast
    const apiHl =
      renderHybridLookup(entry.query, localResult, inv, { fromHistory: true }) ||
      buildApiHighlight(entry.query, inv);
    const pid = Storage.getActiveProjectId();
    if (pid) {
      Storage.upsertProjectEntry(pid, {
        id: entry.id,
        seq: entry.seq,
        query: entry.query,
        summary: entry.summary || "",
        translation: entry.translation || "",
        ownedCount: (apiHl.ownedHits || []).length,
        missingCount: (apiHl.missingItems || []).length,
        items,
        vocab,
      });
    }
    updateProjectModeUI();
    updateBackgroundLookupBanner();
    if (!opts.silent) {
      if (items.length) {
        showToast(
          `第 ${entry.seq} 句 · 已收錄 ${(apiHl.ownedHits || []).length} · 尚未 ${(apiHl.missingItems || []).length}`,
          "success"
        );
      } else {
        showToast(`第 ${entry.seq} 句 · 已還原（當時無文法標記）`, "info");
      }
    }
  }

  function reviewHistoryWithCurrentRules(entry) {
    if (!entry?.query) return;
    const items = Array.isArray(entry.items) ? entry.items : [];
    const vocab = Array.isArray(entry.vocab) ? entry.vocab : [];
    setView("lookup");
    if ($("#lookup-input")) $("#lookup-input").value = entry.query;
    const localResult = {
      form: entry.query,
      mode: "sentence",
      matches: [],
      localDisabled: true,
      analysis: null,
    };
    state.lastQuery = entry.query;
    state.lastSearch = localResult;
    const inv = {
      summary: entry.summary || "",
      translation: entry.translation || "",
      items,
      vocab,
    };
    state.lastInventory = inv;
    const prevOwned = entry.ownedCount;
    const prevMissing = entry.missingCount;
    const apiHl =
      renderHybridLookup(entry.query, localResult, inv, { fromHistory: true }) ||
      buildApiHighlight(entry.query, inv);
    const owned = (apiHl.ownedHits || []).length;
    const missing = (apiHl.missingItems || []).length;
    Storage.addHistoryEntry({
      query: entry.query,
      summary: entry.summary || "",
      translation: entry.translation || "",
      ownedCount: owned,
      missingCount: missing,
      localCount: 0,
      items,
      vocab,
    });
    if (items.length) {
      let msg = `已依目前筆記本重看：已收錄 ${owned} · 尚未 ${missing}`;
      if (
        prevOwned != null &&
        prevMissing != null &&
        (prevOwned !== owned || prevMissing !== missing)
      ) {
        msg += `（先前 ${prevOwned}/${prevMissing}）`;
      }
      showToast(msg, "success");
    } else {
      showToast("已還原句子（當時無文法標記，可選字套用）", "info");
    }
    updateLookupNavBtns();
    updateBackgroundLookupBanner();
  }

  /* —— Form —— */
  function fillCategorySelect(selected) {
    const sel = $("#form-category");
    if (!sel) return;
    const cats = RulesService.CATEGORIES || [];
    if (cats.length) {
      sel.innerHTML = cats
        .map(
          (c) =>
            `<option value="${esc(c.key)}"${c.key === (selected || "") ? " selected" : ""}>${esc(
              c.label
            )}</option>`
        )
        .join("");
      if (selected && !cats.some((c) => c.key === selected)) {
        const opt = document.createElement("option");
        opt.value = selected;
        opt.textContent = selected;
        opt.selected = true;
        sel.appendChild(opt);
      }
    } else if (selected != null) {
      sel.value = selected || "";
    }
  }

  function emptyDraft() {
    return {
      title: "",
      category: "",
      explanation: "",
      has_persons: false,
      keywords: [],
      endings: RulesService.emptyEndings(),
    };
  }

  function togglePersonsUI() {
    const on = Boolean($("#form-has-persons")?.checked);
    const persons = $("#form-persons-block");
    if (persons) persons.classList.toggle("hidden", !on);
  }

  function openForm(rule = null, draft = null) {
    if (state.aiBusy && state.aiJob?.status === "running") {
      const go = confirm(
        `AI 正在為「${state.aiJob.title}」填寫中。\n` +
          `開新表單可能造成混淆。仍要開啟嗎？\n（背景 AI 結果仍會寫回原草稿）`
      );
      if (!go) {
        setAiJobBar("running", `AI 填寫中：${state.aiJob.title}`);
        return;
      }
    }

    // 記住進入表單前的頁面（AI 填寫中／取消時跳回）
    if (state.view && state.view !== "form") {
      state.formReturnView = state.view;
    }

    state.formSource = draft?.source || (rule ? "edit" : "manual");
    state.editingId = rule?.id || null;
    state.todoSourceId = draft?.todoId || null;
    state.draft = rule || draft || emptyDraft();

    const data = state.draft;
    fillCategorySelect(data?.category || "");
    $("#form-heading").textContent = state.editingId ? "編輯規則" : "新增規則";
    $("#form-sub").textContent =
      draft?.banner
        ? "由查詢／待辦／盤點帶入草稿"
        : "規則名請用「極短中文用法名（法語）」，如 否定（ne…pas）；動詞變位勾選六人稱";

    const banner = $("#form-prefill-banner");
    if (draft?.banner) {
      banner.classList.remove("hidden");
      banner.className = "result-banner info";
      banner.innerHTML = draft.banner;
    } else {
      banner.classList.add("hidden");
      banner.innerHTML = "";
    }

    const endings = data.endings || RulesService.emptyEndings();
    const hasPersons =
      typeof data.has_persons === "boolean"
        ? data.has_persons
        : RulesService.ruleHasPersons(data);

    $("#form-title").value = data.title || "";
    $("#form-explanation").value = data.explanation || "";
    $("#form-has-persons").checked = hasPersons;
    $("#form-keywords").value = Array.isArray(data.keywords)
      ? data.keywords.join(", ")
      : data.keywords || "";
    $("#form-ending-je").value = endings.je || "";
    $("#form-ending-tu").value = endings.tu || "";
    $("#form-ending-il").value = endings.il || "";
    $("#form-ending-nous").value = endings.nous || "";
    $("#form-ending-vous").value = endings.vous || "";
    $("#form-ending-ils").value = endings.ils || "";
    togglePersonsUI();
    setView("form");
    $("#form-title")?.focus();
  }

  function readForm() {
    const hasPersons = Boolean($("#form-has-persons")?.checked);
    const existing =
      (state.editingId && RulesService.getById(state.editingId)) || state.draft || {};
    const keywords = existing.keywords || [];
    return {
      title: ($("#form-title")?.value || "").trim(),
      category: $("#form-category")?.value || "",
      explanation: ($("#form-explanation")?.value || "").trim(),
      has_persons: hasPersons,
      keywords,
      endings: hasPersons
        ? {
            je: $("#form-ending-je").value,
            tu: $("#form-ending-tu").value,
            il: $("#form-ending-il").value,
            nous: $("#form-ending-nous").value,
            vous: $("#form-ending-vous").value,
            ils: $("#form-ending-ils").value,
          }
        : RulesService.emptyEndings(),
    };
  }

  function todoKey(title) {
    return RulesService.normalizeToken
      ? RulesService.normalizeToken(title)
      : String(title || "")
          .trim()
          .toLowerCase();
  }

  function clearTodosAfterRuleSaved(ruleTitle) {
    let todos = Storage.loadTodos();
    const before = todos.length;
    const sourceId = state.todoSourceId;
    const key = todoKey(ruleTitle);

    todos = todos.filter((t) => {
      if (sourceId && t.id === sourceId) return false;
      if (key && todoKey(t.title || t.form || "") === key) return false;
      if (key && ruleTitle) {
        const a = RulesService.parseBilingualTitle(t.title || t.form || "");
        const b = RulesService.parseBilingualTitle(ruleTitle);
        if (a.zh && b.zh && todoKey(a.zh) === todoKey(b.zh)) return false;
        if (a.fr && b.fr && todoKey(a.fr) === todoKey(b.fr)) return false;
      }
      return true;
    });

    state.todoSourceId = null;
    if (todos.length !== before) {
      Storage.saveTodos(todos);
      return before - todos.length;
    }
    return 0;
  }

  function saveForm(e) {
    e?.preventDefault();
    const input = readForm();
    if (!input.title) {
      showToast("請填寫規則名稱", "error");
      $("#form-title")?.focus();
      return;
    }
    try {
      const wasEdit = Boolean(state.editingId);
      const pending = state.pendingSelApply;
      const pendingSupp = state.pendingSupplementaryApply;
      if (!wasEdit && pendingSupp) {
        input.category = RulesService.SUPPLEMENTARY_CATEGORY || "補充用法";
      }
      let saved;
      if (state.editingId) {
        saved = RulesService.update(state.editingId, input);
      } else {
        saved = RulesService.create(input);
      }
      const cleared = clearTodosAfterRuleSaved(input.title);
      state.editingId = null;
      state.draft = null;
      state.todoSourceId = null;
      state.pendingSelApply = null;
      state.pendingSupplementaryApply = false;
      if (state.aiJob && state.aiJob.status !== "running") {
        setAiJobBar("hidden");
        state.aiJob = null;
      }
      updateRuleCount();

      if (!wasEdit && pending && saved && state.lastInventory) {
        setView("lookup");
        addRuleToCurrentResult(saved, pending.text, pending.start, pending.end);
        const extra = cleared ? ` · 已清 ${cleared} 筆待辦` : "";
        showToast(`規則已建立並套用到「${pending.text}」${extra}`, "success");
        return;
      }

      if (!wasEdit && pendingSupp && saved && state.lastQuery) {
        setView("lookup");
        addSupplementaryRuleToCurrent(saved);
        const extra = cleared ? ` · 已清 ${cleared} 筆待辦` : "";
        showToast(`補充用法已建立並加入本句${extra}`, "success");
        return;
      }

      if (state.lastQuery) {
        setView("lookup");
        renderHybridLookup(state.lastQuery, state.lastSearch, state.lastInventory);
        showToast(
          wasEdit
            ? cleared
              ? `規則已更新 · 已清 ${cleared} 筆待辦`
              : "規則已更新"
            : cleared
              ? `規則已建立 · 已清 ${cleared} 筆待辦`
              : "規則已建立",
          "success"
        );
      } else {
        setView("rules");
        showToast(
          wasEdit
            ? cleared
              ? `規則已更新，並清除 ${cleared} 筆待辦`
              : "規則已更新"
            : cleared
              ? `規則已新增，並清除 ${cleared} 筆待辦`
              : "規則已建立",
          "success"
        );
      }
    } catch (err) {
      showToast(err.message || "儲存失敗", "error");
    }
  }

  /** 選字套用／+補充：建立新規則表單 */
  function openCreateRuleFromSelection() {
    // 圖例「+補充」→ 建立補充用法
    if (state.rulePickMode === "supplementary") {
      if (!state.lastQuery) {
        showToast("請先完成一次查詢", "info");
        return;
      }
      ensureLookupInventoryShell();
      state.pendingSupplementaryApply = true;
      state.pendingSelApply = null;
      closeRulePickModal();
      openForm(null, {
        title: "",
        explanation: "",
        category: RulesService.SUPPLEMENTARY_CATEGORY || "補充用法",
        source: "from-supplementary",
        banner: `<strong>建立補充用法</strong> — 分類已設為「補充用法」。儲存後會<strong>加入本句</strong>（琥珀標、不句中上色）。`,
      });
      return;
    }

    const cap = state.selApply;
    const text = String(cap?.text || "").trim();
    if (!text) {
      showToast("請先在句子中選取文字", "info");
      return;
    }
    if (!state.lastInventory && !state.lastQuery) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    // 法語有時僅本地結果、尚無 inventory：先建空 inventory 以便套用
    if (!state.lastInventory && state.lastQuery) {
      state.lastInventory = {
        summary: "",
        translation: "",
        items: [],
        vocab: [],
      };
    }
    state.pendingSelApply = {
      text,
      start: Number.isFinite(cap.start) ? cap.start : -1,
      end: Number.isFinite(cap.end) ? cap.end : -1,
    };
    closeRulePickModal();
    hideSelApplyPop();
    state.selApply = null;
    window.getSelection()?.removeAllRanges();
    openForm(null, {
      title: text,
      explanation: "",
      category: "",
      source: "from-selection",
      banner: `<strong>由選字建立</strong> — 已將選取「${esc(
        text
      )}」寫入規則名（可改成「極短中文用法名（法語）」如 否定（ne…pas））。儲存後會<strong>自動套用到該片段</strong>。`,
    });
  }

  /* —— AI job bar —— */
  function uidJob() {
    return "ai_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function setAiJobBar(status, message, opts = {}) {
    const bar = $("#ai-job-bar");
    const text = $("#ai-job-bar-text");
    const dismiss = $("#btn-ai-job-dismiss");
    if (!bar || !text) return;
    if (status === "hidden") {
      bar.classList.add("hidden");
      bar.classList.remove("is-running", "is-done", "is-error");
      return;
    }
    bar.classList.remove("hidden", "is-running", "is-done", "is-error");
    if (status === "running") bar.classList.add("is-running");
    if (status === "done") bar.classList.add("is-done");
    if (status === "error") bar.classList.add("is-error");
    text.textContent = message || "";
    if (dismiss) dismiss.hidden = status === "running";
    const formBtn = $("#btn-ai-job-form");
    if (formBtn) formBtn.textContent = opts.formBtnLabel || "回表單";
  }

  function returnToAiForm() {
    if (state.aiJob) {
      state.editingId = state.aiJob.editingId;
      state.todoSourceId = state.aiJob.todoSourceId;
    }
    setView("form");
    if (state.aiJob?.status === "done" || state.aiJob?.status === "error") {
      setAiJobBar("hidden");
      state.aiJob = null;
    }
    $("#form-explanation")?.focus();
  }

  function dismissAiJobBar() {
    setAiJobBar("hidden");
    if (!state.aiBusy) state.aiJob = null;
  }

  /** 補充用法表單：AI 只補說明，不可改分類 */
  function resolveAiKeepCategory(current) {
    const supp = RulesService.SUPPLEMENTARY_CATEGORY || "補充用法";
    const cat = String(current?.category || "").trim();
    if (cat === supp) return supp;
    if (state.formSource === "from-supplementary") return supp;
    if (state.pendingSupplementaryApply) return supp;
    if (state.editingId) {
      const existing = RulesService.getById(state.editingId);
      if (existing && RulesService.isSupplementaryUsage(existing)) return supp;
    }
    return "";
  }

  async function runAiComplete() {
    if (state.aiBusy) {
      showToast("AI 仍在填寫中，可先到歷史或筆記本查看", "info");
      return;
    }
    const title = ($("#form-title")?.value || "").trim();
    if (!title) {
      showToast("請先填寫規則名", "error");
      $("#form-title")?.focus();
      return;
    }
    if (!Storage.hasApiKey()) {
      showToast("請先到「設定」填入 API Key", "error");
      setView("settings");
      return;
    }
    const current = readForm();
    if (
      ((current.explanation || "").trim() ||
        Object.values(current.endings || {}).some((v) => String(v || "").trim())) &&
      !confirm("目前說明／人稱已有內容，要用 AI 結果覆寫嗎？")
    ) {
      return;
    }

    const keepCategory = resolveAiKeepCategory(current);
    const jobId = uidJob();
    const job = {
      id: jobId,
      title,
      editingId: state.editingId,
      todoSourceId: state.todoSourceId,
      keepCategory,
      pendingSelApply: state.pendingSelApply,
      pendingSupplementaryApply: state.pendingSupplementaryApply,
      status: "running",
    };
    state.aiJob = job;
    state.aiBusy = true;

    const btn = $("#btn-ai-complete");
    if (btn) {
      btn.disabled = true;
      btn.classList.add("loading");
    }
    const banner = $("#form-prefill-banner");
    if (banner) {
      banner.classList.remove("hidden");
      banner.className = "result-banner info";
      banner.innerHTML = `<strong>AI 查詢中</strong> — 依「${esc(
        title
      )}」產生內容…可先離開此頁查看歷史或筆記本。`;
    }

    setAiJobBar("running", `AI 填寫中：${title} — 可先瀏覽其他頁，完成後回表單核對`);
    // 跳回進入表單前的頁面（不再固定規則本）
    setView(getFormReturnView());
    showToast("AI 填寫中，完成後可點狀態列「回表單」核對", "info");

    try {
      const draft = await AiService.completeRuleFromTitle(title, { keepCategory });
      const stillSameJob = state.aiJob && state.aiJob.id === jobId;
      if (stillSameJob) {
        state.aiJob.status = "done";
        state.editingId = job.editingId;
        state.todoSourceId = job.todoSourceId;
        if (job.pendingSelApply) state.pendingSelApply = job.pendingSelApply;
        if (job.pendingSupplementaryApply) {
          state.pendingSupplementaryApply = job.pendingSupplementaryApply;
        }
        if (draft.title) $("#form-title").value = draft.title;
        $("#form-explanation").value = draft.explanation || "";
        if (keepCategory) {
          draft.category = keepCategory;
          fillCategorySelect(keepCategory);
        } else if (draft.category) {
          fillCategorySelect(draft.category);
        }
        const hasPersons =
          draft.has_persons !== false &&
          (draft.has_persons === true ||
            Object.values(draft.endings || {}).some((v) => String(v || "").trim()));
        $("#form-has-persons").checked = hasPersons;
        togglePersonsUI();
        const e = draft.endings || {};
        $("#form-ending-je").value = e.je || "";
        $("#form-ending-tu").value = e.tu || "";
        $("#form-ending-il").value = e.il || "";
        $("#form-ending-nous").value = e.nous || "";
        $("#form-ending-vous").value = e.vous || "";
        $("#form-ending-ils").value = e.ils || "";
        state.draft = { ...(state.draft || {}), ...draft };
        if (banner) {
          banner.className = "result-banner success";
          banner.innerHTML = `<strong>AI 已填寫</strong> — 請核對說明與人稱後再儲存。`;
        }
        setAiJobBar("done", `AI 已填好「${draft.title || title}」— 點「回表單」核對`, {
          formBtnLabel: "回表單核對",
        });
        showToast("AI 已填好，可回表單核對", "success");
      }
    } catch (err) {
      const stillSameJob = state.aiJob && state.aiJob.id === jobId;
      if (stillSameJob) {
        state.aiJob.status = "error";
        if (banner) {
          banner.className = "result-banner error";
          banner.innerHTML = `<strong>AI 失敗</strong> — ${esc(err.message || "未知錯誤")}`;
        }
        setAiJobBar("error", `AI 失敗：${err.message || "未知錯誤"}`, { formBtnLabel: "回表單" });
      }
      showToast(err.message || "AI 填寫失敗", "error");
    } finally {
      state.aiBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("loading");
      }
    }
  }

  /* —— Rule cards —— */
  function renderPersonTable(rule, highlightForm = "", hitPersons = []) {
    if (!RulesService.ruleHasPersons(rule)) return "";
    const hitKeys = new Set((hitPersons || []).map((h) => h.key));
    const endings = rule.endings || {};
    const any = RulesService.PERSONS.some(({ key }) => String(endings[key] || "").trim());
    if (!any) return "";
    return `
      <div class="person-table" role="table" aria-label="六人稱">
        ${RulesService.PERSONS.map(({ key, label }) => {
          const val = (endings[key] || "").trim();
          const isHit =
            hitKeys.has(key) ||
            (highlightForm && val && RulesService.matchEndingCell(highlightForm, val));
          return `
            <div class="person-table-cell person-${esc(key)}${isHit ? " hit" : ""}" role="cell">
              <span class="person-key">${esc(label)}</span>
              <span class="person-val${val ? "" : " empty"}">${val ? esc(val) : "—"}</span>
            </div>`;
        }).join("")}
      </div>`;
  }

  /**
   * @param {object} rule
   * @param {{ highlightForm?: string, hitPersons?: any[], badge?: string|null, compact?: boolean,
   *   colorIndex?: number|null, matchedWords?: string[], extra?: string,
   *   mode?: 'notebook'|'lookup', hasSpan?: boolean|null }} opts
   *   hasSpan：lookup 模式用；false=未定位顯示「手動定位」，true=「重新定位」
   */
  function ruleCardHtml(rule, opts = {}) {
    const {
      highlightForm = "",
      hitPersons = [],
      badge = null,
      compact = false,
      colorIndex = null,
      extra = "",
      mode = "notebook",
      hasSpan = null,
    } = opts;

    const isSupp =
      colorIndex === "usage" ||
      (typeof RulesService.isSupplementaryUsage === "function" &&
        RulesService.isSupplementaryUsage(rule));
    const catBadge = rule.category
      ? `<span class="badge ${isSupp ? "badge-usage" : "badge-category"}">${esc(
          rule.category
        )}</span>`
      : "";
    const personBadge =
      typeof RulesService.ruleHasPersons === "function" && RulesService.ruleHasPersons(rule)
        ? `<span class="badge badge-conj">六人稱</span>`
        : "";
    const tintClass = isSupp
      ? " rule-card-usage"
      : colorIndex != null && colorIndex !== "usage"
        ? ` rule-card-tint-${Number(colorIndex) % 8}`
        : "";
    const colorEdge = isSupp
      ? `<span class="rule-card-color-edge gram-hl-usage" aria-hidden="true" title="補充用法（不句中上色）"></span>`
      : colorIndex != null && colorIndex !== "usage"
        ? `<span class="rule-card-color-edge gram-hl-${Number(colorIndex) % 8}" aria-hidden="true"></span>`
        : "";
    const isLookup = mode === "lookup";
    const effectiveHasSpan = isSupp ? null : hasSpan;
    const locateBtn =
      isLookup && effectiveHasSpan !== null
        ? effectiveHasSpan === false
          ? `<button type="button" class="btn btn-sm btn-primary" data-locate-rule="${esc(
              rule.id
            )}" title="在句中選取片段，為此規則上色">手動定位</button>`
          : `<button type="button" class="btn btn-sm btn-secondary" data-locate-rule="${esc(
              rule.id
            )}" title="重新指定句中片段（可疊加位置）">重新定位</button>`
        : "";

    const unlocatedBadge =
      isLookup && effectiveHasSpan === false
        ? `<span class="badge badge-api-fallback">句中未定位</span>`
        : "";
    const badgesHtml = [catBadge, personBadge, unlocatedBadge].filter(Boolean).join("");

    if (compact) {
      return `
        <article class="rule-card compact${tintClass}" data-id="${esc(rule.id)}" id="rule-${esc(rule.id)}">
          ${colorEdge}
          <div class="rule-card-top">
            <h4>${esc(rule.title)}</h4>
            ${badgesHtml ? `<span class="rule-card-badges">${badgesHtml}</span>` : ""}
          </div>
          <div class="rule-card-actions">
            <button type="button" class="btn btn-sm btn-ghost" data-edit="${esc(rule.id)}">編輯</button>
            ${locateBtn}
            ${
              isLookup
                ? `<button type="button" class="btn btn-sm btn-danger-ghost" data-detach-rule="${esc(
                    rule.id
                  )}" title="從本句結果移除，不刪除筆記本規則">本句移除</button>`
                : ""
            }
          </div>
        </article>`;
    }

    const actions = isLookup
      ? `<button type="button" class="btn btn-sm btn-secondary" data-edit="${esc(rule.id)}">編輯</button>
          ${locateBtn}
          <button type="button" class="btn btn-sm btn-danger-ghost" data-detach-rule="${esc(
            rule.id
          )}" title="從本句結果移除高亮與規則卡，不刪除筆記本中的規則">本句移除</button>`
      : `<button type="button" class="btn btn-sm btn-secondary" data-edit="${esc(rule.id)}">編輯</button>
          <button type="button" class="btn btn-sm btn-danger-ghost" data-delete="${esc(rule.id)}">刪除</button>`;

    return `
      <article class="rule-card${tintClass}" data-id="${esc(rule.id)}" id="rule-${esc(rule.id)}">
        ${colorEdge}
        <div class="rule-card-top">
          <h3>${esc(rule.title)}</h3>
          ${badgesHtml ? `<span class="rule-card-badges">${badgesHtml}</span>` : ""}
        </div>
        ${rule.explanation ? `<div class="field-block"><h4>詳細說明</h4><p>${esc(rule.explanation)}</p></div>` : ""}
        ${
          RulesService.ruleHasPersons(rule)
            ? `<div class="field-block"><h4>人稱對照</h4>${renderPersonTable(rule, highlightForm, hitPersons)}</div>`
            : ""
        }
        ${extra}
        <div class="rule-card-actions">
          ${actions}
        </div>
      </article>`;
  }

  function bindRuleCardActions(root) {
    $$("[data-edit]", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        const rule = RulesService.getById(btn.dataset.edit);
        if (rule) openForm(rule);
      });
    });
    $$("[data-delete]", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.delete;
        const rule = RulesService.getById(id);
        if (!rule) return;
        if (!confirm(`刪除規則「${rule.title}」？`)) return;
        RulesService.remove(id);
        showToast("已刪除規則", "success");
        updateRuleCount();
        if (state.view === "rules") renderRulesList();
        if (state.lastQuery) {
          renderHybridLookup(state.lastQuery, state.lastSearch, state.lastInventory);
        }
      });
    });
  }

  function renderRulesList() {
    const q = $("#rules-filter")?.value || "";
    const list = RulesService.filterList(q);
    const box = $("#rules-list");
    const count = $("#rules-count");
    if (count) count.textContent = `${list.length} 筆規則`;
    if (!box) return;
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><p>尚無規則，點「新增規則」或到設定「重設種子」。</p></div>`;
      return;
    }
    box.innerHTML = `<div class="match-list">${list
      .map((r) => ruleCardHtml(r, { badge: "本地" }))
      .join("")}</div>`;
    bindRuleCardActions(box);
  }

  /* —— Todos —— */
  function addTodosFromItems(items, sourceQuery, opts = {}) {
    const todos = Storage.loadTodos();
    let added = 0;
    let skipped = 0;
    const fromApi = Boolean(opts.fromApi);
    for (const it of items) {
      const title = (it.name || it.title || it.form || "").trim();
      if (!title) continue;
      const key = todoKey(title);
      if (todos.some((t) => !t.done && todoKey(t.title || t.form || "") === key)) {
        skipped++;
        continue;
      }
      if (it.name || it.nameFr) {
        const match = RulesService.findMatchingRule(it);
        if (match.owned) {
          skipped++;
          continue;
        }
      }
      todos.unshift({
        id:
          crypto.randomUUID?.() ||
          "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
        title,
        form: it.form || title,
        // API 盤點新規則：待辦只記名稱，不帶分類／說明預填
        category: fromApi ? "" : it.category || "",
        span: fromApi ? "" : it.span || "",
        sourceQuery: sourceQuery || "",
        note: fromApi ? "" : it.note || "",
        fromApi,
        done: false,
        created_at: new Date().toISOString(),
      });
      added++;
    }
    Storage.saveTodos(todos);
    return { added, skipped };
  }

  /** API 盤點「新規則」草稿：只填規則名，其餘空白 */
  function draftNameOnly(title, extras = {}) {
    return {
      title: String(title || "").trim(),
      category: "",
      explanation: "",
      has_persons: false,
      keywords: [],
      endings: RulesService.emptyEndings(),
      ...extras,
    };
  }

  function renderTodos() {
    const allTodos = Storage.loadTodos();
    const todos = allTodos.filter((t) => !t.done);
    if (todos.length !== allTodos.length) Storage.saveTodos(todos);
    const box = $("#todos-list");
    if (!box) return;
    if (!todos.length) {
      box.innerHTML = `<div class="empty-state"><p>待辦清單是空的。<br/>查無規則或 API「尚未收錄」可加入。</p></div>`;
      return;
    }
    box.innerHTML = `
      <ul class="todo-list">
        ${todos
          .map(
            (t) => `
          <li class="todo-item" data-id="${esc(t.id)}">
            <label>
              <input type="checkbox" data-toggle title="完成並移出清單" />
              <span>
                <strong>${esc(t.title || t.form || "")}</strong>
                ${t.category ? `<span class="tag">${esc(t.category)}</span>` : ""}
                ${
                  t.sourceQuery
                    ? `<div class="muted" style="font-size:0.82rem">來自：${esc(t.sourceQuery)}</div>`
                    : t.note
                      ? `<div class="muted" style="font-size:0.82rem">${esc(t.note)}</div>`
                      : ""
                }
              </span>
            </label>
            <div class="todo-actions">
              <button type="button" class="btn btn-sm btn-primary" data-create>建立規則</button>
              <button type="button" class="btn btn-sm btn-ghost" data-remove>刪除</button>
            </div>
          </li>`
          )
          .join("")}
      </ul>`;

    box.querySelectorAll(".todo-item").forEach((li) => {
      const id = li.dataset.id;
      li.querySelector("[data-toggle]")?.addEventListener("change", (e) => {
        if (!e.target.checked) return;
        Storage.saveTodos(Storage.loadTodos().filter((t) => t.id !== id));
        renderTodos();
        showToast("已完成並移出待辦", "success");
      });
      li.querySelector("[data-remove]")?.addEventListener("click", () => {
        Storage.saveTodos(Storage.loadTodos().filter((t) => t.id !== id));
        renderTodos();
        showToast("已刪除待辦", "info");
      });
      li.querySelector("[data-create]")?.addEventListener("click", () => {
        const item = Storage.loadTodos().find((t) => t.id === id);
        if (!item) return;
        const form = item.form || item.title || "";
        // 來自 API 盤點的待辦：只預填規則名
        if (item.fromApi) {
          openForm(
            null,
            draftNameOnly(item.title || form, {
              todoId: item.id,
              banner: `<strong>由待辦建立</strong> — ${esc(
                item.title || form
              )}（儲存後會自動移出待辦；其餘欄位請自行填寫）`,
              source: "from-todo",
            })
          );
          return;
        }
        const analysis = form ? Analyzer.analyze(form) : null;
        const draft = analysis
          ? { ...Analyzer.draftFromAnalysis(form, analysis), title: item.title || form }
          : { title: item.title || form };
        openForm(null, {
          ...draft,
          todoId: item.id,
          category: item.category || draft.category || "",
          banner: `<strong>由待辦建立</strong> — ${esc(item.title || form)}（儲存後會自動移出待辦）`,
          source: "from-todo",
        });
      });
    });
  }

  /* —— Lookup: 單詞本地 · 整句 API —— */

  function normVocabKey(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/[’‘‛′`]/g, "'");
  }

  function sliceMatchesVocab(slice, w) {
    const sl = normVocabKey(slice);
    if (!sl) return false;
    const surf = normVocabKey(w.surface);
    const lem = normVocabKey(w.lemma);
    return (surf && sl === surf) || (lem && sl === lem);
  }

  /**
   * 將 API vocab 對到原文區間。
   * - 不信任未經驗證的 a/b（與 surface 不符則丟棄）
   * - 純單詞查詢：整段查詢字串對到最吻合的一筆詞彙，避免錯位
   */
  function locateVocabInText(text, vocabList) {
    const src = String(text || "");
    const list = Array.isArray(vocabList) ? vocabList : [];
    if (!src || !list.length) return [];

    const candidates = list
      .map((w) => ({
        surface: String(w.surface || "").trim(),
        lemma: String(w.lemma || "").trim(),
        gloss: String(w.gloss || "").trim(),
        pos: String(w.pos || "").trim(),
        gender: String(w.gender || "").trim(),
        verbGroup: String(w.verbGroup || w.vg || "").trim(),
        phonetic: String(w.phonetic || w.ipa || w.ip || "").trim(),
        start: w.start,
        end: w.end,
      }))
      .filter((w) => w.surface || w.lemma);

    const trimStart = src.search(/\S/);
    const trimEnd = src.search(/\s*$/);
    const qCore =
      trimStart >= 0 ? src.slice(trimStart, trimEnd === -1 ? src.length : trimEnd) : src.trim();
    const qNorm = normVocabKey(qCore);
    const isSingleWord =
      qCore.length > 0 &&
      !/\s/.test(qCore) &&
      !(RulesService.isMultiWordQuery && RulesService.isMultiWordQuery(src));

    function hitFrom(w, start, end) {
      return {
        start,
        end,
        lemma: w.lemma || src.slice(start, end),
        gloss: w.gloss,
        pos: w.pos,
        gender: w.gender || "",
        verbGroup: w.verbGroup || "",
        phonetic: w.phonetic || "",
        surface: src.slice(start, end),
      };
    }

    // —— 純單詞：整段對到「最吻合」的一筆（避免 a/b 錯位、多詞彙搶位）——
    if (isSingleWord && qNorm) {
      let best = null;
      let bestScore = -1;
      for (const w of candidates) {
        const surf = normVocabKey(w.surface);
        const lem = normVocabKey(w.lemma);
        let sc = 0;
        if (surf && surf === qNorm) sc = 100;
        else if (lem && lem === qNorm) sc = 90;
        else if (surf && (qNorm.startsWith(surf) || surf.startsWith(qNorm)) && Math.min(surf.length, qNorm.length) >= 3)
          sc = 50;
        else if (lem && qNorm.length >= 3 && (lem.startsWith(qNorm.slice(0, 3)) || qNorm.startsWith(lem.slice(0, 3))))
          sc = 30;
        if (sc > bestScore) {
          bestScore = sc;
          best = w;
        }
      }
      // 僅一筆詞彙且查詢是單詞 → 視為在描述本詞
      if (!best && candidates.length === 1) {
        best = candidates[0];
        bestScore = 40;
      }
      if (best && bestScore >= 30) {
        const start = trimStart >= 0 ? trimStart : 0;
        const end = start + qCore.length;
        return [hitFrom(best, start, end)];
      }
    }

    // —— 整句／多詞：驗證 a/b，否則用 surface 搜尋 ——
    const occupied = [];
    const hits = [];
    const ordered = candidates.slice().sort((a, b) => {
      const la = (a.surface || a.lemma || "").length;
      const lb = (b.surface || b.lemma || "").length;
      return lb - la;
    });

    function clashes(start, end) {
      return occupied.some((o) => !(end <= o.start || start >= o.end));
    }

    function findSurfaceInSrc(needle) {
      if (!needle) return null;
      const srcLower = src.toLowerCase();
      const nLower = needle.toLowerCase();
      let from = 0;
      while (from < src.length) {
        const idx = srcLower.indexOf(nLower, from);
        if (idx < 0) return null;
        const e = idx + needle.length;
        if (!clashes(idx, e)) return { start: idx, end: e };
        from = idx + Math.max(1, needle.length);
      }
      return null;
    }

    for (const w of ordered) {
      let start = Number(w.start);
      let end = Number(w.end);
      let placed = false;
      const rangeOk =
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= 0 &&
        end > start &&
        end <= src.length;

      if (rangeOk && !clashes(start, end)) {
        const slice = src.slice(start, end);
        // 必須與 surface／lemma 一致，否則 API 座標作廢
        if (sliceMatchesVocab(slice, w)) {
          placed = true;
        }
      }

      if (!placed) {
        const needles = [w.surface, w.lemma].filter(Boolean);
        // 較長 needle 優先
        needles.sort((a, b) => b.length - a.length);
        for (const n of needles) {
          // 過短易誤撞（a、es、er…）
          if (n.length < 2 && ordered.length > 1) continue;
          const loc = findSurfaceInSrc(n);
          if (loc) {
            start = loc.start;
            end = loc.end;
            placed = true;
            break;
          }
        }
      }

      if (!placed) continue;
      occupied.push({ start, end });
      hits.push(hitFrom(w, start, end));
    }

    hits.sort((a, b) => a.start - b.start || b.end - a.end - (a.end - a.start));
    return hits;
  }

  function grammarMarkOpenHtml(s) {
    const tipOf = (h) =>
      h.needle ? `${h.ruleTitle} ← ${h.needle}` : h.ruleTitle || h.apiName || "";
    const stack = [
      {
        color: s.color,
        ruleId: s.ruleId,
        ruleTitle: s.ruleTitle,
        needle: s.needle,
        missing: s.missing,
      },
      ...(s.coHits || []),
    ].filter((h) => h && h.color !== "usage");
    const owned = stack.filter(
      (h) => !h.missing && h.color !== "missing" && Number.isFinite(Number(h.color))
    );
    const use = owned.length ? owned : stack;
    const first = use[0] || s;
    const multi = use.length > 1 && use.every((h) => Number.isFinite(Number(h.color)));
    const tip = multi
      ? use.map((h, i) => `${i + 1}. ${tipOf(h)}`).join(" ｜ ") + "（顏色輪播）"
      : first.missing || first.color === "missing"
        ? `尚未建立：${tipOf(first)}`
        : tipOf(first);
    const cls =
      first.missing || first.color === "missing"
        ? "gram-hl gram-hl-missing"
        : `gram-hl gram-hl-${first.color ?? 0}${multi ? " gram-hl-cycle" : ""}`;
    const colorsAttr = multi ? ` data-cycle-colors="${use.map((h) => h.color).join(",")}"` : "";
    const titlesAttr = multi
      ? ` data-cycle-titles="${esc(use.map((h) => tipOf(h)).join("\n"))}"`
      : "";
    const scrollAttr =
      !first.missing && first.color !== "missing" && first.ruleId
        ? ` data-scroll-rule="${esc(first.ruleId)}"`
        : "";
    const cycleIds = multi
      ? ` data-cycle-rule-ids="${use.map((h) => h.ruleId || "").join(",")}"`
      : "";
    return `<mark class="${cls}" title="${esc(tip)}"${colorsAttr}${titlesAttr}${scrollAttr}${cycleIds}>`;
  }

  function genderLabel(gender) {
    const g = String(gender || "").trim();
    if (!g) return "";
    if (g === "陽性" || g === "m" || /^masc/i.test(g)) return "陽性";
    if (g === "陰性" || g === "f" || /^f[eé]m/i.test(g)) return "陰性";
    if (g === "陽性／陰性" || g === "mf" || g === "m/f") return "陽性／陰性";
    return g;
  }

  function genderAbbrev(gender) {
    const g = genderLabel(gender);
    if (g === "陽性") return "m.";
    if (g === "陰性") return "f.";
    if (g === "陽性／陰性") return "m./f.";
    return "";
  }

  /** 動詞組別顯示：第1組／第一組（-er）… */
  function verbGroupInfo(codeOrRaw, lemma, pos) {
    const isVerb =
      !pos ||
      pos === "動詞" ||
      /動詞|verb/i.test(String(pos || ""));
    if (!isVerb && !codeOrRaw) return null;

    let code = String(codeOrRaw || "")
      .trim()
      .replace(/^groupe\s*/i, "");
    if (code === "1" || code === "2" || code === "3") {
      /* ok */
    } else if (typeof Analyzer !== "undefined" && Analyzer.verbGroupForLemma && lemma) {
      const info = Analyzer.verbGroupForLemma(lemma);
      if (info) return info;
      return null;
    } else {
      return null;
    }
    if (typeof Analyzer !== "undefined" && Analyzer.verbGroupForLemma) {
      // 優先用 API 的 1/2/3，再套 label
      const labels = {
        "1": { code: "1", label: "第一組（-er）", short: "第1組" },
        "2": { code: "2", label: "第二組（-ir）", short: "第2組" },
        "3": { code: "3", label: "第三組／不規則", short: "第3組" },
      };
      if (labels[code]) return labels[code];
    }
    return code
      ? {
          code,
          label: code === "1" ? "第一組（-er）" : code === "2" ? "第二組（-ir）" : "第三組／不規則",
          short: `第${code}組`,
        }
      : null;
  }

  function resolveVocabVerbGroup(w) {
    const pos = String(w?.pos || "").trim();
    const lemma = String(w?.lemma || w?.surface || "").trim();
    const raw = w?.verbGroup || w?.vg || "";
    if (pos && pos !== "動詞" && !/動詞|verb/i.test(pos)) return null;
    // 無詞性但有不定詞時：若能推估組別也顯示
    return verbGroupInfo(raw, lemma, pos || "動詞");
  }

  function formatPhoneticDisplay(raw) {
    let s = String(raw || "").trim();
    if (!s) return "";
    s = s.replace(/^[\[\(（【]+/, "").replace(/[\]\)）】]+$/, "");
    if (!s.startsWith("/")) s = "/" + s;
    if (!s.endsWith("/")) s = s + "/";
    if (s === "//" || s.length < 3) return "";
    return s;
  }

  /** 單字庫詞性 → 底線色類（動詞淺藍／名詞淺綠／形容詞黃／副詞紅／其他紫） */
  function posUnderlineKind(pos) {
    const p = String(pos || "");
    if (/助動詞|助詞|語尾/.test(p)) return "other";
    if (/形容詞|形容動詞|adjective|\badj\b/i.test(p)) return "adj";
    if (/副詞|adverb/i.test(p)) return "adv";
    if (/動詞|verb/i.test(p)) return "verb";
    if (/名詞|noun/i.test(p)) return "noun";
    return "other";
  }

  const POS_UL_KINDS = ["verb", "noun", "adj", "adv", "other"];
  const POS_UL_LABELS = {
    verb: "動詞",
    noun: "名詞",
    adj: "形容詞",
    adv: "副詞",
    other: "其他",
  };
  const POS_UL_STORAGE_KEY = "fvgn_pos_underline_hidden";

  function loadPosUnderlineHidden() {
    try {
      const raw = JSON.parse(localStorage.getItem(POS_UL_STORAGE_KEY) || "{}");
      const out = {};
      for (const k of POS_UL_KINDS) out[k] = Boolean(raw?.[k]);
      return out;
    } catch {
      return { verb: false, noun: false, adj: false, adv: false, other: false };
    }
  }

  function posHideToken(hidden) {
    return POS_UL_KINDS.filter((k) => hidden[k]).join(" ");
  }

  function sentenceBoardPosHideAttr() {
    const v = posHideToken(loadPosUnderlineHidden());
    return v ? ` data-pos-hide="${esc(v)}"` : "";
  }

  function applyPosUnderlineVisibility() {
    const hidden = loadPosUnderlineHidden();
    const board = $("#sentence-board");
    if (board) {
      const v = posHideToken(hidden);
      if (v) board.setAttribute("data-pos-hide", v);
      else board.removeAttribute("data-pos-hide");
    }
    const allOn = POS_UL_KINDS.every((k) => !hidden[k]);
    const allOff = POS_UL_KINDS.every((k) => hidden[k]);
    document.querySelectorAll("[data-pos-toggle]").forEach((btn) => {
      const k = btn.dataset.posToggle;
      if (k === "all") {
        btn.classList.toggle("is-off", allOff);
        btn.classList.toggle("is-mixed", !allOn && !allOff);
        btn.setAttribute("aria-pressed", allOn ? "true" : "false");
        btn.title = allOn ? "關閉全部底線" : "開啟全部底線";
        return;
      }
      const on = !hidden[k];
      btn.classList.toggle("is-off", !on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const label = POS_UL_LABELS[k] || "";
      btn.title = `${on ? "隱藏" : "顯示"}${label}底線`;
    });
  }

  function togglePosUnderline(kind) {
    const hidden = loadPosUnderlineHidden();
    if (kind === "all") {
      const allOn = POS_UL_KINDS.every((k) => !hidden[k]);
      const next = {};
      for (const k of POS_UL_KINDS) next[k] = allOn;
      localStorage.setItem(POS_UL_STORAGE_KEY, JSON.stringify(next));
      applyPosUnderlineVisibility();
      return;
    }
    if (!POS_UL_KINDS.includes(kind)) return;
    hidden[kind] = !hidden[kind];
    localStorage.setItem(POS_UL_STORAGE_KEY, JSON.stringify(hidden));
    applyPosUnderlineVisibility();
  }

  function posUnderlineLegendHtml() {
    const hidden = loadPosUnderlineHidden();
    const allOn = POS_UL_KINDS.every((k) => !hidden[k]);
    const allOff = POS_UL_KINDS.every((k) => hidden[k]);
    const allBtn = `<button type="button" class="pos-line-toggle pos-line-toggle-all${
      allOff ? " is-off" : ""
    }${!allOn && !allOff ? " is-mixed" : ""}" data-pos-toggle="all" aria-pressed="${
      allOn ? "true" : "false"
    }" title="${allOn ? "關閉全部底線" : "開啟全部底線"}">全部</button>`;
    const items = POS_UL_KINDS.map((k) => {
      const on = !hidden[k];
      return `<button type="button" class="pos-line-toggle${
        on ? "" : " is-off"
      }" data-pos-toggle="${k}" aria-pressed="${on ? "true" : "false"}" title="${
        on ? "隱藏" : "顯示"
      }${POS_UL_LABELS[k]}底線"><span class="pos-line" data-pos-kind="${k}">${
        POS_UL_LABELS[k]
      }</span></button>`;
    }).join("");
    return `<span class="pos-line-legend" role="group" aria-label="詞性底線，點擊顯示或隱藏">${allBtn}${items}</span>`;
  }

  function wordTipOpenHtml(v) {
    const g = genderLabel(v.gender);
    const gAbbr = genderAbbrev(v.gender);
    const vg = resolveVocabVerbGroup(v);
    const ipa = formatPhoneticDisplay(v.phonetic);
    const lemmaShow = v.lemma
      ? gAbbr
        ? `${v.lemma} (${gAbbr})`
        : v.lemma
      : "";
    const fallbackTitle = [
      lemmaShow ? `原形 ${lemmaShow}` : "",
      ipa ? `音標 ${ipa}` : "",
      g ? `性別 ${g}` : "",
      vg ? `動詞 ${vg.short}` : "",
      v.gloss ? `意思 ${v.gloss}` : "",
      v.pos ? `（${v.pos}）` : "",
      v.lemma ? "點擊複製並朗讀原形" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return `<span class="word-tip" tabindex="0" data-lemma="${esc(v.lemma)}" data-gloss="${esc(
      v.gloss
    )}" data-pos="${esc(v.pos)}" data-pos-kind="${esc(posUnderlineKind(v.pos))}" data-gender="${esc(
      g
    )}" data-verb-group="${esc(vg?.code || "")}" data-verb-group-label="${esc(
      vg?.label || ""
    )}" data-phonetic="${esc(ipa)}" data-surface="${esc(v.surface)}" title="${esc(fallbackTitle)}">`;
  }

  function buildAnnotatedSentenceHtml(query, usedGrammar, vocabLocs) {
    const src = String(query || "");
    const n = src.length;
    if (!n) return "";
    const cuts = new Set([0, n]);
    for (const g of usedGrammar || []) {
      cuts.add(g.start);
      cuts.add(g.end);
    }
    for (const v of vocabLocs || []) {
      cuts.add(v.start);
      cuts.add(v.end);
    }
    const points = [...cuts].filter((p) => p >= 0 && p <= n).sort((a, b) => a - b);
    const atoms = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (a >= b) continue;
      const g = (usedGrammar || []).find((x) => x.start <= a && x.end >= b) || null;
      // 多個詞彙區間重疊時取最短包住本段的（避免錯掛到大區間／別詞）
      const vCands = (vocabLocs || []).filter((x) => x.start <= a && x.end >= b);
      const v =
        vCands.sort(
          (x, y) => x.end - x.start - (y.end - y.start) || y.start - x.start
        )[0] || null;
      atoms.push({ g, v, text: src.slice(a, b) });
    }
    let html = "";
    let openG = null;
    let openV = null;
    const closeV = () => {
      if (openV) {
        html += "</span>";
        openV = null;
      }
    };
    const closeG = () => {
      closeV();
      if (openG) {
        html += "</mark>";
        openG = null;
      }
    };
    for (const at of atoms) {
      if (at.g !== openG) {
        closeG();
        if (at.g) {
          html += grammarMarkOpenHtml(at.g);
          openG = at.g;
        }
      }
      if (at.v !== openV) {
        closeV();
        if (at.v) {
          html += wordTipOpenHtml(at.v);
          openV = at.v;
        }
      }
      html += esc(at.text);
    }
    closeG();
    return html;
  }

  let wordTipHideTimer = 0;
  let wordTipSelectArmed = false;
  let wordTipAnchor = null;
  let sentenceGesture = { moved: false, x: 0, y: 0 };
  let suppressWordTipClick = false;

  function cancelWordTipHide() {
    if (wordTipHideTimer) {
      clearTimeout(wordTipHideTimer);
      wordTipHideTimer = 0;
    }
  }

  function wordTipPointerOver() {
    const pop = document.getElementById("word-tip-pop");
    if (pop && !pop.classList.contains("hidden") && pop.matches(":hover")) return true;
    return Boolean(document.querySelector(".word-tip:hover"));
  }

  function wordTipHasSelection() {
    const pop = document.getElementById("word-tip-pop");
    if (!pop || pop.classList.contains("hidden")) return false;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    try {
      return sel.getRangeAt(0).intersectsNode(pop);
    } catch {
      return pop.contains(sel.anchorNode) || pop.contains(sel.focusNode);
    }
  }

  function wordTipShouldStay() {
    return wordTipPointerOver() || wordTipHasSelection();
  }

  function onWordTipSelectMouseUp() {
    wordTipSelectArmed = false;
    document.removeEventListener("mouseup", onWordTipSelectMouseUp);
    if (!wordTipShouldStay()) hideWordTipPop();
  }

  /** 框選文字拖出解釋欄時不要立刻關；放開後若已離開再關 */
  function requestHideWordTipPop(e) {
    if (e && e.buttons) {
      if (!wordTipSelectArmed) {
        wordTipSelectArmed = true;
        document.addEventListener("mouseup", onWordTipSelectMouseUp);
      }
      return;
    }
    cancelWordTipHide();
    wordTipHideTimer = window.setTimeout(() => {
      wordTipHideTimer = 0;
      if (!wordTipShouldStay()) hideWordTipPop();
    }, 180);
  }

  function bindWordTipOutsideDismiss() {
    if (bindWordTipOutsideDismiss.done) return;
    bindWordTipOutsideDismiss.done = true;
    document.addEventListener("pointerdown", (e) => {
      const pop = document.getElementById("word-tip-pop");
      if (!pop || pop.classList.contains("hidden")) return;
      if (pop.contains(e.target)) return;
      if (e.target.closest && e.target.closest(".word-tip")) return;
      hideWordTipPop();
    });
  }

  function appendWordTipCopyAction(pop, data) {
    if (!pop || !isCoarsePointer()) return;
    const lemma = String(data?.lemma || "").trim();
    if (!lemma) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm word-tip-copy-btn";
    btn.textContent = "複製並朗讀";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const speak = String(data.reading || data.surface || lemma).trim() || lemma;
      copyLemmaToClipboard(lemma, { speak });
    });
    pop.appendChild(btn);
  }

  function ensureWordTipPop() {
    let el = document.getElementById("word-tip-pop");
    if (el) return el;
    el = document.createElement("div");
    el.id = "word-tip-pop";
    el.className = "word-tip-pop hidden";
    el.setAttribute("role", "tooltip");
    el.addEventListener("mouseenter", () => {
      if (!isCoarsePointer()) cancelWordTipHide();
    });
    el.addEventListener("mouseleave", (e) => {
      if (!isCoarsePointer()) requestHideWordTipPop(e);
    });
    document.body.appendChild(el);
    bindWordTipOutsideDismiss();
    return el;
  }

  function hideWordTipPop() {
    cancelWordTipHide();
    wordTipAnchor = null;
    if (wordTipSelectArmed) {
      wordTipSelectArmed = false;
      document.removeEventListener("mouseup", onWordTipSelectMouseUp);
    }
    const el = document.getElementById("word-tip-pop");
    if (el) {
      el.classList.add("hidden");
      el.innerHTML = "";
    }
  }

  function showWordTipPop(anchor, data) {
    if (isSentenceSelectEdit()) return;
    cancelWordTipHide();
    const pop = ensureWordTipPop();
    const g = genderLabel(data.gender);
    const gAbbr = genderAbbrev(data.gender);
    const vg =
      data.verbGroupLabel || data.verbGroup
        ? verbGroupInfo(data.verbGroup, data.lemma, data.pos)
        : resolveVocabVerbGroup(data);
    const lemmaText = data.lemma
      ? gAbbr
        ? `${esc(data.lemma)} <span class="word-tip-gender">(${esc(gAbbr)})</span>`
        : esc(data.lemma)
      : "—";
    const showVg =
      vg &&
      (data.verbGroup ||
        data.pos === "動詞" ||
        /動詞|verb/i.test(String(data.pos || "")) ||
        (typeof Analyzer !== "undefined" &&
          Analyzer.isIrregularInfinitive &&
          Analyzer.isIrregularInfinitive(data.lemma)) ||
        /(?:er|ir|re|oir)$/i.test(String(data.lemma || "")));
    const vgLine = showVg
      ? `<div class="word-tip-row"><span class="word-tip-k">動詞類</span><span class="word-tip-v word-tip-verb-group">${esc(
          vg.short
        )} <span class="word-tip-gender">· ${esc(vg.label)}</span></span></div>`
      : "";
    const ipa = formatPhoneticDisplay(data.phonetic);
    const ipaLine = ipa
      ? `<div class="word-tip-row"><span class="word-tip-k">音標</span><span class="word-tip-v word-tip-ipa" title="句中形式讀音">${esc(
          ipa
        )}</span></div>`
      : "";
    pop.innerHTML = `
      <div class="word-tip-row word-tip-surface">${esc(data.surface || "—")}</div>
      <div class="word-tip-row"><span class="word-tip-k">原形</span><span class="word-tip-v">${lemmaText}</span></div>
      ${ipaLine}
      ${
        g
          ? `<div class="word-tip-row"><span class="word-tip-k">性別</span><span class="word-tip-v word-tip-gender-label">${esc(
              g
            )}${gAbbr ? ` <span class="word-tip-gender">(${esc(gAbbr)})</span>` : ""}</span></div>`
          : ""
      }
      ${vgLine}
      <div class="word-tip-row"><span class="word-tip-k">意思</span><span class="word-tip-v">${esc(
        data.gloss || "—"
      )}</span></div>
      ${
        data.pos
          ? `<div class="word-tip-row"><span class="word-tip-k">詞性</span><span class="word-tip-v">${esc(
              data.pos
            )}</span></div>`
          : ""
      }`;
    pop.innerHTML = wrapWordTipPopHtml(pop.innerHTML);
    finalizeWordTipPop(pop, anchor, data);
  }

  const LOOKUP_TTS_LANG = "fr-FR";
  const TTS_API_LANG = "fr";
  let ttsVoices = [];
  let ttsAudio = null;
  let ttsToken = 0;
  const ttsCache = new Map();
  const TTS_CACHE_MAX = 40;
  let apiTtsWarned = false;

  function refreshTtsVoices() {
    if (!window.speechSynthesis) return;
    ttsVoices = speechSynthesis.getVoices() || [];
  }

  function pickTtsVoice(lang) {
    if (!window.speechSynthesis) return null;
    const want = String(lang || LOOKUP_TTS_LANG).toLowerCase().replace(/_/g, "-");
    const prefix = want.slice(0, 2);
    const list = ttsVoices.length ? ttsVoices : speechSynthesis.getVoices() || [];
    return (
      list.find((v) => String(v.lang || "").toLowerCase().replace(/_/g, "-") === want) ||
      list.find((v) => String(v.lang || "").toLowerCase().startsWith(prefix)) ||
      null
    );
  }

  function stopLookupSpeech() {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    if (ttsAudio) {
      try {
        ttsAudio.pause();
      } catch {
        /* ignore */
      }
      ttsAudio = null;
    }
  }

  function speakViaBrowser(text, lang = LOOKUP_TTS_LANG) {
    if (!window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.92;
      const voice = pickTtsVoice(lang);
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    } catch (err) {
      console.warn("[tts]", err);
    }
  }

  function normalizeTtsBaseUrl(url) {
    let base = String(url || "").trim().replace(/\/+$/, "");
    if (/^https?:\/\/api\.x\.ai$/i.test(base)) base = "https://api.x.ai/v1";
    return base;
  }

  function pcmToWavBlob(pcmBytes, sampleRate = 24000) {
    const pcm = pcmBytes instanceof Uint8Array ? pcmBytes : new Uint8Array(pcmBytes);
    const header = new ArrayBuffer(44);
    const v = new DataView(header);
    const str = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, "RIFF");
    v.setUint32(4, 36 + pcm.length, true);
    str(8, "WAVE");
    str(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, "data");
    v.setUint32(40, pcm.length, true);
    const out = new Uint8Array(44 + pcm.length);
    out.set(new Uint8Array(header), 0);
    out.set(pcm, 44);
    return new Blob([out], { type: "audio/wav" });
  }

  function grokTtsCandidate(s, profiles) {
    const grokProv =
      typeof Storage.getApiProvider === "function" ? Storage.getApiProvider("grok") : null;
    const grok = profiles.grok && typeof profiles.grok === "object" ? profiles.grok : {};
    const pid = String(s.apiProvider || "").trim();
    let apiKey = String(grok.apiKey || "").trim();
    let baseUrl = normalizeTtsBaseUrl(grok.baseUrl || grokProv?.baseUrl || "https://api.x.ai/v1");
    if (pid === "grok" || /x\.ai/i.test(String(s.baseUrl || ""))) {
      if (!apiKey) apiKey = String(s.apiKey || "").trim();
      if (s.baseUrl) baseUrl = normalizeTtsBaseUrl(s.baseUrl);
    }
    if (!apiKey) return null;
    return { kind: "grok", id: "grok", label: "Grok", apiKey, baseUrl };
  }

  function googleTtsCandidate(s, profiles) {
    const pid = String(s.apiProvider || "").trim();
    const google = profiles.google && typeof profiles.google === "object" ? profiles.google : {};
    const apiKey = String(
      google.apiKey || (pid === "google" || /generativelanguage\.googleapis/.test(String(s.baseUrl || ""))
        ? s.apiKey
        : "")
    ).trim();
    if (!apiKey) return null;
    return { kind: "google", id: "google", label: "Google", apiKey };
  }

  function customTtsCandidate(s, profiles) {
    const pid = String(s.apiProvider || "").trim();
    const custom = profiles.custom && typeof profiles.custom === "object" ? profiles.custom : {};
    const apiKey = String(pid === "custom" ? s.apiKey || custom.apiKey : custom.apiKey || "").trim();
    const baseUrl = normalizeTtsBaseUrl(pid === "custom" ? s.baseUrl || custom.baseUrl : custom.baseUrl);
    if (!apiKey || !baseUrl) return null;
    return { kind: "openai", id: "custom", label: "自訂", apiKey, baseUrl };
  }

  function currentTtsCandidate(s, profiles) {
    const pid = String(s.apiProvider || "").trim();
    const url = String(s.baseUrl || "").toLowerCase();
    if (pid === "google" || /generativelanguage\.googleapis/.test(url)) return googleTtsCandidate(s, profiles);
    if (pid === "deepseek" || /deepseek\.com/.test(url)) return null;
    if (pid === "custom") return customTtsCandidate(s, profiles);
    return grokTtsCandidate(s, profiles);
  }

  function resolveTtsProvider() {
    const s = Storage.loadSettings();
    const profiles = s.apiProfiles && typeof s.apiProfiles === "object" ? s.apiProfiles : {};
    const current = currentTtsCandidate(s, profiles);
    if (current && current.apiKey) return { ...current, fallback: false };
    const alts = [
      grokTtsCandidate(s, profiles),
      googleTtsCandidate(s, profiles),
      customTtsCandidate(s, profiles),
    ].filter((p) => p && p.apiKey && (!current || p.id !== current.id));
    if (alts[0]) return { ...alts[0], fallback: true };
    if (current) return { ...current, fallback: false };
    return { kind: "none", id: String(s.apiProvider || ""), label: "目前服務", apiKey: "" };
  }

  function putTtsCache(key, url) {
    if (ttsCache.has(key)) {
      const old = ttsCache.get(key);
      if (old && old !== url) URL.revokeObjectURL(old);
      ttsCache.delete(key);
    }
    ttsCache.set(key, url);
    while (ttsCache.size > TTS_CACHE_MAX) {
      const first = ttsCache.keys().next().value;
      const u = ttsCache.get(first);
      if (u) URL.revokeObjectURL(u);
      ttsCache.delete(first);
    }
  }

  async function fetchGrokTts(p, text) {
    const res = await fetch(`${p.baseUrl}/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify({
        text,
        voice_id: "eve",
        language: TTS_API_LANG,
        output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 128000 },
      }),
    });
    if (!res.ok) {
      const detail = String(await res.text().catch(() => "")).slice(0, 180);
      throw new Error(`Grok TTS HTTP ${res.status}${detail ? `：${detail}` : ""}`);
    }
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 32) throw new Error("TTS 回傳空白音訊");
    return URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
  }

  async function fetchGoogleTts(p, text) {
    const models = ["gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"];
    let lastErr = null;
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
        p.apiKey
      )}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              languageCode: LOOKUP_TTS_LANG,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
          },
        }),
      });
      if (res.status === 404) {
        lastErr = new Error(`找不到 Gemini TTS 模型 ${model}`);
        continue;
      }
      if (!res.ok) {
        const detail = String(await res.text().catch(() => "")).slice(0, 180);
        throw new Error(`Google TTS HTTP ${res.status}${detail ? `：${detail}` : ""}`);
      }
      const json = await res.json();
      const part = json?.candidates?.[0]?.content?.parts?.find((x) => x?.inlineData?.data);
      const b64 = part?.inlineData?.data;
      if (!b64) throw new Error("Google TTS 未回傳音訊");
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const mime = String(part.inlineData.mimeType || "");
      const rateMatch = mime.match(/rate=(\d+)/i);
      const rate = rateMatch ? Number(rateMatch[1]) : 24000;
      if (/mpeg|mp3/i.test(mime)) {
        return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      }
      return URL.createObjectURL(pcmToWavBlob(bytes, rate || 24000));
    }
    throw lastErr || new Error("Google TTS 失敗");
  }

  async function fetchOpenAiTts(p, text) {
    if (!p.baseUrl) throw new Error("自訂端點未填 Base URL");
    const res = await fetch(`${p.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: "alloy",
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const detail = String(await res.text().catch(() => "")).slice(0, 180);
      throw new Error(`自訂 TTS HTTP ${res.status}${detail ? `：${detail}` : ""}`);
    }
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 32) throw new Error("TTS 回傳空白音訊");
    return URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
  }

  async function speakViaApi(text) {
    const p = resolveTtsProvider();
    if (p.kind === "none" || !p.apiKey) throw new Error(p.kind === "none" ? "NO_TTS_PROVIDER" : "NO_TTS_KEY");
    if (p.fallback && !apiTtsWarned) {
      apiTtsWarned = true;
      showToast(`目前服務沒有語音，改用 ${p.label}`, "info");
    }
    const cacheKey = `${p.kind}|${text}|${LOOKUP_TTS_LANG}`;
    let objectUrl = ttsCache.get(cacheKey);
    const myToken = ++ttsToken;
    if (!objectUrl) {
      if (p.kind === "google") objectUrl = await fetchGoogleTts(p, text);
      else if (p.kind === "openai") objectUrl = await fetchOpenAiTts(p, text);
      else objectUrl = await fetchGrokTts(p, text);
      putTtsCache(cacheKey, objectUrl);
    }
    if (myToken !== ttsToken) return;
    stopLookupSpeech();
    const audio = new Audio(objectUrl);
    ttsAudio = audio;
    await audio.play();
  }

  function speakLookupText(text, lang = LOOKUP_TTS_LANG) {
    const t = String(text || "").trim();
    if (!t) return;
    const useApi = Boolean(Storage.loadSettings().apiTtsEnabled);
    if (!useApi) {
      stopLookupSpeech();
      speakViaBrowser(t, lang);
      return;
    }
    speakViaApi(t).catch((err) => {
      console.warn("[tts-api]", err);
      const code = err && err.message;
      if (!apiTtsWarned && (code === "NO_TTS_KEY" || code === "NO_TTS_PROVIDER")) {
        apiTtsWarned = true;
        showToast("沒有可用的語音 API Key（Grok／Google／自訂），已改用系統語音", "warn");
      } else if (code !== "NO_TTS_KEY" && code !== "NO_TTS_PROVIDER") {
        showToast("API 語音失敗，改用系統語音", "warn");
      }
      speakViaBrowser(t, lang);
    });
  }

  function syncApiTtsSwitch(settings) {
    const el = $("#settings-api-tts");
    if (el) el.checked = Boolean((settings || Storage.loadSettings()).apiTtsEnabled);
  }

  function onApiTtsToggle() {
    const on = Boolean($("#settings-api-tts")?.checked);
    Storage.saveSettings({ apiTtsEnabled: on });
    apiTtsWarned = false;
    if (!on) {
      showToast("朗讀改用系統語音", "info");
      return;
    }
    const p = resolveTtsProvider();
    if (p.kind === "none" || !p.apiKey) {
      showToast("沒有可用的語音 API Key（Grok／Google／自訂），朗讀仍用系統語音", "warn");
    } else if (p.fallback) {
      showToast(`目前服務沒有語音，改用 ${p.label} 朗讀`, "info");
    } else {
      showToast(`朗讀改用 ${p.label} API 語音`, "info");
    }
  }

  if (typeof window !== "undefined" && window.speechSynthesis) {
    refreshTtsVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshTtsVoices);
  }

  function isSentenceSelectEdit() {
    return Boolean(state.sentenceSelectEdit);
  }

  function syncSentenceSelectEditUi() {
    const on = isSentenceSelectEdit();
    $("#sentence-board")?.classList.toggle("is-select-edit", on);
    document.querySelectorAll("[data-sentence-select-edit]").forEach((btn) => {
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setSentenceSelectEdit(on) {
    const next = Boolean(on);
    const changed = next !== isSentenceSelectEdit();
    state.sentenceSelectEdit = next;
    hideWordTipPop();
    syncSentenceSelectEditUi();
    if (!changed) return;
    if (next) {
      showToast("選字編輯：點句中的字來套用規則或編輯單字", "info");
    } else {
      showToast("已關閉選字編輯，點字可再看音標／性別", "info");
    }
  }

  function toggleSentenceSelectEdit() {
    setSentenceSelectEdit(!isSentenceSelectEdit());
  }

  function wrapWordTipPopHtml(bodyHtml) {
    const on = isSentenceSelectEdit();
    return `<div class="word-tip-pop-inner">
      <div class="word-tip-pop-body">${bodyHtml}</div>
      <button type="button" class="word-tip-edit-mode-btn${on ? " is-on" : ""}" data-sentence-select-edit aria-pressed="${
        on ? "true" : "false"
      }" title="開啟選字編輯：改以點擊選字，套用規則或編輯單字">選字編輯</button>
    </div>`;
  }

  function finalizeWordTipPop(pop, anchor, data) {
    pop.classList.remove("hidden");
    wordTipAnchor = anchor;
    const body = pop.querySelector(".word-tip-pop-body") || pop;
    appendWordTipCopyAction(body, data);
    requestAnimationFrame(() => placePopNearAnchor(pop, anchor));
  }

  function applySentenceTokenSelection(el, clientX, clientY) {
    if (!el) return false;
    const range = getMarkRangeInQuery(el);
    if (!range?.text) return false;
    hideWordTipPop();
    state.selApply = range;
    try {
      const r = document.createRange();
      r.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {
      /* ignore */
    }
    const inv = state.lastInventory;
    let note = "點選片段 · 可套用規則或編輯單字";
    if (inv?.items && range.start >= 0) {
      const n = inv.items.filter((it) => {
        if (Number.isFinite(Number(it.start)) && Number.isFinite(Number(it.end))) {
          return !(range.end <= Number(it.start) || range.start >= Number(it.end));
        }
        return String(it.span || "").trim() === range.text;
      }).length;
      if (n > 0) note = `此片段已有 ${n} 則 · 可再疊加`;
    }
    showSelApplyPop(clientX, clientY, range.text, { note });
    return true;
  }

  function markSentenceGestureStart(e) {
    const p = eventClientPoint(e);
    sentenceGesture = { moved: false, x: p.x, y: p.y };
  }

  function markSentenceGestureMove(e) {
    const p = eventClientPoint(e);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    if (!Number.isFinite(sentenceGesture.x)) return;
    if (Math.hypot(p.x - sentenceGesture.x, p.y - sentenceGesture.y) > 12) {
      sentenceGesture.moved = true;
    }
  }

  function shouldRevealSelApplyFromGesture() {
    return sentenceGesture.moved;
  }

  function sentenceSelectEditButtonHtml() {
    const on = isSentenceSelectEdit();
    return `<button type="button" class="btn-sentence-select-edit${on ? " is-on" : ""}" data-sentence-select-edit title="選字編輯：點擊句中的字來套用規則或編輯單字" aria-label="選字編輯" aria-pressed="${
      on ? "true" : "false"
    }">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
      </svg>
    </button>`;
  }

  function sentenceSpeakButtonHtml() {
    return `<button type="button" class="btn-sentence-speak" data-speak-sentence title="朗讀整句" aria-label="朗讀整句">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 8.04v7.93A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      </svg>
    </button>`;
  }

  function sentenceTextBlockHtml(innerHtml) {
    return `<div class="sentence-text-row">
      <p class="sentence-text" id="sentence-text">${innerHtml}</p>
      <div class="sentence-text-actions">
        ${sentenceSelectEditButtonHtml()}
        ${sentenceSpeakButtonHtml()}
      </div>
    </div>`;
  }

  function speakCurrentSentence() {
    const t = String(state.lastQuery || $("#sentence-text")?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) {
      showToast("沒有可朗讀的句子", "info");
      return;
    }
    speakLookupText(t);
  }

  function fallbackCopyText(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function copyLemmaToClipboard(lemma, opts = {}) {
    const t = String(lemma || "").trim();
    if (!t) return;
    const spoken = String(opts.speak || t).trim() || t;
    speakLookupText(spoken, opts.lang || LOOKUP_TTS_LANG);
    const ok = () => showToast(`已複製原形「${t}」並朗讀`, "success");
    const fail = () => showToast("無法複製到剪貼簿", "error");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(t).then(ok).catch(() => {
        if (fallbackCopyText(t)) ok();
        else fail();
      });
      return;
    }
    if (fallbackCopyText(t)) ok();
    else fail();
  }

  function bindWordTipHovers(root = document) {
    (root || document).querySelectorAll(".word-tip").forEach((el) => {
      const data = {
        lemma: el.dataset.lemma || "",
        gloss: el.dataset.gloss || "",
        pos: el.dataset.pos || "",
        gender: el.dataset.gender || "",
        verbGroup: el.dataset.verbGroup || "",
        verbGroupLabel: el.dataset.verbGroupLabel || "",
        phonetic: el.dataset.phonetic || "",
        surface: el.dataset.surface || el.textContent || "",
      };
      let pressX = 0;
      let pressY = 0;
      const coarse = isCoarsePointer();
      if (!coarse) {
        el.addEventListener("mouseenter", () => {
          if (isSentenceSelectEdit()) return;
          showWordTipPop(el, data);
        });
        el.addEventListener("mouseleave", (e) => requestHideWordTipPop(e));
        el.addEventListener("focus", () => {
          if (isSentenceSelectEdit()) return;
          showWordTipPop(el, data);
        });
        el.addEventListener("blur", () => requestHideWordTipPop());
      }
      el.addEventListener("pointerdown", (e) => {
        pressX = e.clientX;
        pressY = e.clientY;
      });
      el.addEventListener("click", (e) => {
        if (e.detail > 1) return;
        if (state.locateTarget) return;
        if (suppressWordTipClick) {
          suppressWordTipClick = false;
          return;
        }
        if (sentenceGesture.moved) return;
        if (selectionIsNonEmptyInSentence() && !isSentenceSelectEdit()) return;
        if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > 8) return;
        e.preventDefault();
        e.stopPropagation();
        if (isSentenceSelectEdit()) {
          applySentenceTokenSelection(el, e.clientX, e.clientY);
          return;
        }
        if (coarse) {
          if (wordTipAnchor === el) hideWordTipPop();
          else showWordTipPop(el, data);
          return;
        }
        const lemma = String(el.dataset.lemma || "").trim();
        if (!lemma) return;
        const speak =
          String(el.dataset.surface || data.surface || "").trim() || lemma;
        copyLemmaToClipboard(lemma, { speak });
      });
    });
  }

  function stopGramHlCycles() {
    for (const id of state.gramHlCycleTimers || []) clearInterval(id);
    state.gramHlCycleTimers = [];
    hideWordTipPop();
  }

  function startGramHlCycles(root = document) {
    stopGramHlCycles();
    const marks = (root || document).querySelectorAll("mark.gram-hl-cycle[data-cycle-colors]");
    if (!marks.length) return;
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    marks.forEach((mark) => {
      const colors = String(mark.dataset.cycleColors || "")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n));
      const titles = String(mark.dataset.cycleTitles || "")
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
      if (colors.length < 2) return;
      let i = 0;
      const id = setInterval(() => {
        i = (i + 1) % colors.length;
        mark.className = `gram-hl gram-hl-cycle gram-hl-${colors[i]}`;
        const sole = titles[i] || "";
        const all = titles.map((t, idx) => `${idx + 1}. ${t}`).join(" ｜ ");
        mark.title = sole ? `${sole}（${i + 1}/${colors.length} · ${all}）` : mark.title;
      }, 1100);
      state.gramHlCycleTimers.push(id);
    });
  }

  /**
   * 本地命中 → inventory items（寫入歷史／專案；manualRuleId 保證已收錄）
   */
  function localMatchesToInventoryItems(localResult, query) {
    const src = String(query || "");
    const matches = Array.isArray(localResult?.matches) ? localResult.matches : [];
    const spans = Array.isArray(localResult?.spans) ? localResult.spans : [];
    const items = [];
    const seen = new Set();
    for (const m of matches) {
      const rule = m?.rule;
      if (!rule?.id) continue;
      const ruleSpans = spans.filter((s) => s.ruleId === rule.id);
      if (ruleSpans.length) {
        for (const sp of ruleSpans) {
          const start = Number(sp.start);
          const end = Number(sp.end);
          const key = `${rule.id}:${start}:${end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({
            name: rule.title,
            nameZh: "",
            nameFr: "",
            category: rule.category || "其他",
            span:
              sp.text ||
              (Number.isFinite(start) && Number.isFinite(end) ? src.slice(start, end) : ""),
            start: Number.isFinite(start) ? start : undefined,
            end: Number.isFinite(end) ? end : undefined,
            confidence: "high",
            source: "local",
            manualRuleId: rule.id,
          });
        }
      } else {
        const key = `${rule.id}:none`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          name: rule.title,
          category: rule.category || "其他",
          span: String(localResult.form || "").trim(),
          confidence: "high",
          source: "local",
          manualRuleId: rule.id,
        });
      }
    }
    return items;
  }

  /**
   * 把 RulesService.search / searchSentence 結果轉成與 buildApiHighlight 相容的上色資料
   */
  function localHighlightFromSearch(localResult, query) {
    const src = String(query || "");
    const matches = Array.isArray(localResult?.matches) ? localResult.matches : [];
    if (!localResult || (!matches.length && !(localResult.spans || []).length)) {
      return { spans: [], legend: [], ownedHits: [], missingItems: [] };
    }
    const titleById = new Map();
    for (const m of matches) {
      if (m?.rule?.id) titleById.set(m.rule.id, m.rule.title || "");
    }
    const spans = (localResult.spans || [])
      .map((sp) => {
        const start = Number(sp.start);
        const end = Number(sp.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
        if (start < 0 || end > src.length) return null;
        const ruleId = sp.ruleId || "";
        return {
          start,
          end,
          text: sp.text || src.slice(start, end),
          ruleId,
          ruleTitle: titleById.get(ruleId) || "",
          color: sp.colorIndex ?? 0,
          needle: sp.text || sp.form || src.slice(start, end),
          source: "local",
        };
      })
      .filter(Boolean);

    const legendFromLocal = Array.isArray(localResult.legend) ? localResult.legend : [];
    const legend =
      legendFromLocal.length > 0
        ? legendFromLocal.map((h) => ({
            owned: true,
            ruleId: h.ruleId,
            ruleTitle: h.title || titleById.get(h.ruleId) || "",
            name: h.title || titleById.get(h.ruleId) || "",
            color: h.colorIndex ?? 0,
            hasSpan: spans.some((s) => s.ruleId === h.ruleId),
            supplementary: false,
          }))
        : matches.map((m, i) => ({
            owned: true,
            ruleId: m.rule?.id,
            ruleTitle: m.rule?.title || "",
            name: m.rule?.title || "",
            color: m.colorIndex ?? i % 8,
            hasSpan: spans.some((s) => s.ruleId === m.rule?.id),
            supplementary: false,
          }));

    const ownedHits = matches.map((m, i) => {
      const color = m.colorIndex ?? i % 8;
      const notes = [];
      if (m.matchType) notes.push(m.matchType === "form" ? "完整形" : m.matchType === "ending" ? "詞尾" : m.matchType);
      if (m.hitPersons?.length) {
        const persons = m.hitPersons
          .map((p) => p.label || p.key)
          .filter(Boolean)
          .slice(0, 4);
        if (persons.length) notes.push(persons.join("、"));
      }
      const spanTexts = spans
        .filter((s) => s.ruleId === m.rule?.id)
        .map((s) => s.text)
        .filter(Boolean);
      if (spanTexts.length) notes.push(`「${[...new Set(spanTexts)].slice(0, 3).join("」「")}」`);
      return {
        rule: m.rule,
        score: m.score || 10,
        notes: notes.length ? [`本地：${notes.join(" · ")}`] : ["本地規則命中"],
        colorIndex: color,
        order: i + 1,
        hasSpan: spans.some((s) => s.ruleId === m.rule?.id),
        supplementary: false,
        source: "local",
      };
    });

    return { spans, legend, ownedHits, missingItems: [] };
  }

  function apiSentenceBoardHtml(query, spans, apiLegend, vocabList, boardOpts = {}) {
    const sorted = (spans || []).slice().sort((a, b) => {
      const lenA = (a.end || 0) - (a.start || 0);
      const lenB = (b.end || 0) - (b.start || 0);
      if (lenB !== lenA) return lenB - lenA;
      if (a.start !== b.start) return a.start - b.start;
      const am = a.missing || a.color === "missing" ? 1 : 0;
      const bm = b.missing || b.color === "missing" ? 1 : 0;
      return am - bm;
    });
    const used = [];
    for (const s of sorted) {
      if (s.start >= query.length || s.end > query.length || s.start >= s.end) continue;
      const hit = {
        color: s.color ?? 0,
        ruleId: s.ruleId || "",
        ruleTitle: s.ruleTitle || "",
        needle: s.needle || "",
        missing: Boolean(s.missing || s.color === "missing"),
        invIdx: s.invIdx,
      };
      const host = used.find((u) => !(s.end <= u.start || s.start >= u.end));
      if (host) {
        const exists =
          host.ruleId === hit.ruleId || (host.coHits || []).some((c) => c.ruleId === hit.ruleId);
        if (!exists) {
          if (!host.coHits) host.coHits = [];
          host.coHits.push(hit);
        }
        continue;
      }
      used.push({ start: s.start, end: s.end, ...hit, coHits: [] });
    }
    used.sort((a, b) => a.start - b.start);
    const vocabLocs = locateVocabInText(query, vocabList);
    const html =
      used.length || vocabLocs.length
        ? buildAnnotatedSentenceHtml(query, used, vocabLocs)
        : esc(query);

    // 圖例：已收錄色點 + 未收錄紅標；補充用法不進圖例，改用右側「+補充」
    const legend = (apiLegend || [])
      .filter((h) => !h.supplementary && h.color !== "usage")
      .map((h) => {
        const sw =
          h.color === "missing" || h.owned === false
            ? "gram-hl gram-hl-missing"
            : `gram-hl gram-hl-${h.color}`;
        const badge = h.owned
          ? ""
          : `<span class="badge badge-missing-hl">未建立</span>`;
        const btn = h.owned
          ? `<button type="button" class="legend-link" data-scroll-rule="${esc(h.ruleId)}">${esc(
              h.ruleTitle || h.name
            )}</button>`
          : `<button type="button" class="legend-link legend-link-missing" data-create-inv-idx="${h.invIdx}">${esc(
              h.name
            )}</button>`;
        return `
        <li class="legend-item">
          <span class="legend-swatch ${sw}"></span>${btn}${badge}${
            h.owned && !h.hasSpan ? `<span class="legend-count">（句中未定位）</span>` : ""
          }
        </li>`;
      })
      .join("");

    const hasCycle = used.some((u) => (u.coHits || []).length > 0);
    const hasVocab = vocabLocs.length > 0;
    const labelMain =
      boardOpts.label ||
      (boardOpts.local
        ? "查詢內容 · 本地規則標記"
        : "查詢內容 · API 已收錄標記");
    const emptyNote = boardOpts.local
      ? `尚無本地規則可在句中標記。${
          hasVocab ? "滑過底線詞可看原形、性別與意思。" : ""
        } 可選字手動套用或按 +補充。`
      : `尚無可在句中標記的文法（未收錄見下方）。${
          hasVocab ? "滑過底線詞可看原形、性別與意思。" : ""
        } 也可選字手動套用或按 +補充。`;
    return `
      <div class="sentence-board" id="sentence-board"${sentenceBoardPosHideAttr()}>
        <div id="locate-mode-bar" class="locate-mode-bar hidden" role="status"></div>
        <p class="sentence-label">
          <span class="sentence-label-main">${esc(labelMain)}</span>
          ${hasCycle ? `<span class="sentence-cycle-hint">共置輪播</span>` : ""}
          ${hasVocab ? `<span class="sentence-cycle-hint">滑過看原形／音標／性別</span>` : ""}
          ${hasVocab ? posUnderlineLegendHtml() : ""}
        </p>
        ${sentenceTextBlockHtml(html || esc(query))}
        <p class="sentence-edit-hint">選取文字或<strong>點已上色片段</strong>可套用／疊加規則；下方規則卡可<strong>本句移除</strong>或<strong>手動定位</strong>。右側<strong>+補充</strong>可加入不句中上色的補充用法。</p>
        ${
          !used.length
            ? `<p class="panel-note" style="margin:0.5rem 0 0">${emptyNote}</p>`
            : ""
        }
        <ul class="sentence-legend" aria-label="句中規則與補充">
          ${legend}
          <li class="legend-item legend-item-add">
            <button type="button" class="btn-legend-add" data-add-supplementary title="加入補充用法（不句中上色）">+補充</button>
          </li>
        </ul>
        ${boardOpts.inventory ? sentenceTranslationHtml(boardOpts.inventory) : ""}
      </div>`;
  }

  /** 解析 inventory 項目對應的本地規則（支援手動指定 manualRuleId） */
  function resolveInventoryRule(it) {
    if (it?.manualRuleId) {
      const r = RulesService.getById(it.manualRuleId);
      if (r) return { owned: true, rule: r, score: 100, manual: true };
    }
    // 確保把 span／nameFr 傳入，供嚴格比對（句中形＋標題）
    const payload =
      it && typeof it === "object"
        ? {
            name: it.name || it.title || "",
            nameFr: it.nameFr || it.nameKo || it.fr || "",
            nameZh: it.nameZh || it.zh || "",
            span: it.span || "",
            category: it.category || "",
          }
        : it;
    const match = RulesService.findMatchingRule(payload);
    return { ...match, manual: false };
  }

  /** 在原文中定位項目；手動指定 start/end 時優先使用 */
  function locateInventoryItemInText(src, it) {
    const text = String(src || "");
    const start = Number(it?.start);
    const end = Number(it?.end);
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start &&
      end <= text.length
    ) {
      return [
        {
          start,
          end,
          text: text.slice(start, end),
          needle: String(it.span || text.slice(start, end)),
        },
      ];
    }
    if (RulesService.locateApiItemInText) {
      return RulesService.locateApiItemInText(text, it);
    }
    return [];
  }

  function buildApiHighlight(query, inventory) {
    const src = String(query || "");
    const items = inventory?.items || [];
    const spans = [];
    const legend = [];
    const ownedHits = [];
    const missingItems = [];
    let colorIdx = 0;
    const colorByRule = new Map();
    const ownedSeen = new Set();

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const match = resolveInventoryRule(it);
      const owned = Boolean(match.owned && match.rule);

      if (!owned) {
        missingItems.push({ it, invIdx: i });
        const isSuppMiss =
          typeof RulesService.isSupplementaryUsage === "function" &&
          RulesService.isSupplementaryUsage(it);
        if (!isSuppMiss) {
          const foundMiss = locateInventoryItemInText(src, it);
          const prevMiss = legend.find((h) => !h.owned && h.name === it.name);
          if (prevMiss) {
            if (foundMiss.length) prevMiss.hasSpan = true;
          } else {
            legend.push({
              invIdx: i,
              name: it.name,
              owned: false,
              ruleId: "",
              ruleTitle: it.name,
              color: "missing",
              hasSpan: foundMiss.length > 0,
              supplementary: false,
            });
          }
          for (const loc of foundMiss) {
            spans.push({
              start: loc.start,
              end: loc.end,
              text: loc.text,
              ruleId: `missing-${i}`,
              ruleTitle: it.name,
              missing: true,
              color: "missing",
              apiName: it.name,
              invIdx: i,
              needle: loc.needle || it.span || it.nameFr || "",
            });
          }
        }
        continue;
      }

      const rule = match.rule;
      const isSupp =
        typeof RulesService.isSupplementaryUsage === "function" &&
        RulesService.isSupplementaryUsage(rule);
      let color;
      if (isSupp) {
        color = "usage";
      } else {
        if (!colorByRule.has(rule.id)) {
          colorByRule.set(rule.id, colorIdx % 8);
          colorIdx += 1;
        }
        color = colorByRule.get(rule.id);
      }
      const found = isSupp ? [] : locateInventoryItemInText(src, it);

      const prevLeg = legend.find((h) => h.ruleId === rule.id);
      if (prevLeg) {
        if (found.length) prevLeg.hasSpan = true;
      } else {
        legend.push({
          invIdx: i,
          name: it.name,
          owned: true,
          ruleId: rule.id,
          ruleTitle: rule.title,
          color,
          hasSpan: found.length > 0,
          supplementary: isSupp,
        });
      }

      if (!ownedSeen.has(rule.id)) {
        ownedSeen.add(rule.id);
        const noteSrc =
          it.source === "manual"
            ? "手動"
            : it.source === "local"
              ? "本地"
              : match.manual
                ? "手動"
                : "API";
        ownedHits.push({
          rule,
          score: 10,
          notes: [`${noteSrc}：${it.name}${it.span ? ` · 「${it.span}」` : ""}`],
          colorIndex: isSupp ? "usage" : color,
          order: ownedHits.length + 1,
          hasSpan: isSupp ? null : found.length > 0,
          supplementary: isSupp,
        });
      } else {
        const hit = ownedHits.find((h) => h.rule.id === rule.id);
        if (hit) {
          if (found.length && !isSupp) hit.hasSpan = true;
          if (it.span && !hit.notes.some((n) => n.includes(`「${it.span}」`))) {
            hit.notes.push(`片段：「${it.span}」`);
          }
        }
      }

      if (isSupp) continue;

      for (const loc of found) {
        spans.push({
          start: loc.start,
          end: loc.end,
          text: loc.text,
          ruleId: rule.id,
          ruleTitle: rule.title,
          missing: false,
          color,
          apiName: it.name,
          invIdx: i,
          needle: loc.needle || it.span || it.nameFr || "",
        });
      }
    }

    const firstPos = new Map();
    for (const s of spans) {
      if (s.missing || s.color === "missing" || s.color === "usage") continue;
      const prev = firstPos.get(s.ruleId);
      if (prev == null || s.start < prev) firstPos.set(s.ruleId, s.start);
    }
    legend.sort((a, b) => {
      if (Boolean(a.supplementary) !== Boolean(b.supplementary)) {
        return a.supplementary ? 1 : -1;
      }
      const aOwned = Boolean(a.owned);
      const bOwned = Boolean(b.owned);
      if (aOwned !== bOwned) return aOwned ? -1 : 1;
      if (Boolean(a.hasSpan) !== Boolean(b.hasSpan)) return a.hasSpan ? -1 : 1;
      const pa = a.ruleId && firstPos.has(a.ruleId) ? firstPos.get(a.ruleId) : 1e9;
      const pb = b.ruleId && firstPos.has(b.ruleId) ? firstPos.get(b.ruleId) : 1e9;
      if (pa !== pb) return pa - pb;
      return a.invIdx - b.invIdx;
    });
    const recolor = new Map();
    let ci = 0;
    for (const h of legend) {
      if (!h.owned || !h.ruleId) continue;
      if (h.supplementary || h.color === "usage") {
        h.color = "usage";
        continue;
      }
      if (!recolor.has(h.ruleId)) {
        recolor.set(h.ruleId, ci % 8);
        ci += 1;
      }
      h.color = recolor.get(h.ruleId);
    }
    for (const s of spans) {
      if (s.missing || s.color === "missing" || s.color === "usage") continue;
      if (recolor.has(s.ruleId)) s.color = recolor.get(s.ruleId);
    }
    ownedHits.forEach((h) => {
      if (h.supplementary) {
        h.colorIndex = "usage";
        return;
      }
      if (recolor.has(h.rule.id)) h.colorIndex = recolor.get(h.rule.id);
    });
    ownedHits.sort((a, b) => {
      if (Boolean(a.supplementary) !== Boolean(b.supplementary)) {
        return a.supplementary ? 1 : -1;
      }
      const ca = typeof a.colorIndex === "number" ? a.colorIndex : 999;
      const cb = typeof b.colorIndex === "number" ? b.colorIndex : 999;
      return ca - cb;
    });
    ownedHits.forEach((h, i) => {
      h.order = i + 1;
    });

    return { spans, legend, colorByRule: recolor, ownedHits, missingItems };
  }

  /** 整句翻譯區塊（可手動貼上／修改） */
  function sentenceTranslationHtml(inventory, opts = {}) {
    const t = String(inventory?.translation || "").trim();
    const editing = Boolean(opts.editing);
    if (editing) {
      return `
      <div class="inv-sentence-translation is-editing" id="inv-translation-block">
        <span class="inv-label">翻譯</span>
        <div class="inv-translation-body">
          <textarea
            id="inv-translation-input"
            class="inv-translation-input"
            rows="2"
            placeholder="貼上或輸入整句繁中翻譯…"
            spellcheck="true"
          >${esc(t)}</textarea>
          <div class="inv-translation-actions">
            <button type="button" class="btn btn-sm btn-primary" data-save-translation>儲存</button>
            <button type="button" class="btn btn-sm btn-ghost" data-cancel-translation>取消</button>
          </div>
        </div>
      </div>`;
    }
    return `
      <div class="inv-sentence-translation" id="inv-translation-block">
        <span class="inv-label">翻譯</span>
        <p class="inv-sentence-text${t ? "" : " is-empty"}">${
          t ? esc(t) : "尚無翻譯 · 可手動貼上或編輯"
        }</p>
        <button type="button" class="btn btn-sm btn-secondary inv-translation-edit" data-edit-translation title="編輯翻譯">
          ${t ? "編輯" : "貼上／編輯"}
        </button>
      </div>`;
  }

  function bindTranslationEditors(root = document) {
    const scope = root || document;
    scope.querySelector("[data-edit-translation]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      beginEditSentenceTranslation();
    });
    scope.querySelector("[data-save-translation]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      saveSentenceTranslation();
    });
    scope.querySelector("[data-cancel-translation]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelEditSentenceTranslation();
    });
  }

  function beginEditSentenceTranslation() {
    if (!state.lastInventory && state.lastQuery) {
      state.lastInventory = {
        summary: "",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
      };
    }
    if (!state.lastInventory) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    const block = $("#inv-translation-block");
    if (!block) return;
    block.outerHTML = sentenceTranslationHtml(state.lastInventory, { editing: true });
    bindTranslationEditors(document);
    const ta = $("#inv-translation-input");
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  function saveSentenceTranslation() {
    if (!state.lastInventory) {
      showToast("沒有可寫入的查詢結果", "error");
      return;
    }
    const v = String($("#inv-translation-input")?.value || "").trim();
    state.lastInventory.translation = v;
    if (typeof refreshLookupFromInventory === "function") {
      refreshLookupFromInventory({ replaceTranslation: true });
    } else {
      const block = $("#inv-translation-block");
      if (block) {
        block.outerHTML = sentenceTranslationHtml(state.lastInventory);
        bindTranslationEditors(document);
      }
      if (typeof persistCurrentInventory === "function") {
        persistCurrentInventory({ silent: true, replaceTranslation: true });
      }
    }
    showToast(v ? "已更新翻譯" : "已清除翻譯", "success");
  }

  function cancelEditSentenceTranslation() {
    const block = $("#inv-translation-block");
    if (!block) return;
    block.outerHTML = sentenceTranslationHtml(state.lastInventory || {});
    bindTranslationEditors(document);
  }

  function missingInventoryHtml(inventory, missingItems) {
    if (!inventory) return "";
    const list = missingItems || [];
    const summary = inventory.summary
      ? `<p class="panel-note">${esc(inventory.summary)}</p>`
      : "";
    const onlyVocab =
      !list.length &&
      Array.isArray(inventory.vocab) &&
      inventory.vocab.length > 0 &&
      !(inventory.items || []).length;

    if (!list.length) {
      // 純單字／僅詞彙模式：不顯示「全部已有筆記」（易誤以為 API 沒做事）
      if (
        onlyVocab ||
        inventory.mode === "local-bank" ||
        inventory.source === "local-bank" ||
        inventory.mode === "vocab-only"
      ) {
        if (!summary) return "";
        return `
        <section class="panel panel-suggest" id="api-inventory-slot">
          <div class="panel-head">
            <h3>摘要</h3>
            <span class="badge">詞彙查詢</span>
          </div>
          ${summary}
        </section>`;
      }
      return `
        <section class="panel panel-suggest" id="api-inventory-slot">
          <div class="panel-head">
            <h3>API 盤點 · 尚未收錄</h3>
            <span class="badge badge-owned">全部已有筆記</span>
          </div>
          ${summary}
          <p class="panel-note">本次 API 盤點到的文法，筆記本裡都已有對應規則。</p>
        </section>`;
    }

    const rows = list
      .map(({ it, invIdx }) => {
        const conf =
          it.confidence === "low" ? " · 需確認" : it.confidence === "high" ? "" : "";
        return `
          <li class="inventory-item missing" data-inv-idx="${invIdx}">
            <div class="inventory-meta">
              <strong>${esc(it.name)}</strong>
              <span class="inv-note">
                <span class="badge badge-missing">尚未收錄</span>
                ${it.category ? ` · ${esc(it.category)}` : ""}
                ${it.span ? ` · <code>${esc(it.span)}</code>` : ""}
                ${conf}
              </span>
            </div>
            <div class="action-row">
              <button type="button" class="btn btn-sm btn-primary" data-add-todo-idx="${invIdx}">加入待辦</button>
              <button type="button" class="btn btn-sm btn-secondary" data-create-inv-idx="${invIdx}">建立規則</button>
              <button type="button" class="btn btn-sm btn-ghost" data-dismiss-inv-idx="${invIdx}" title="從本句結果移除（不刪筆記本）">本句忽略</button>
            </div>
          </li>`;
      })
      .join("");

    return `
      <section class="panel panel-suggest" id="api-inventory-slot">
        <div class="panel-head">
          <h3>API 盤點 · 尚未收錄</h3>
          <span class="badge badge-api-fallback">${list.length} 項</span>
        </div>
        ${summary}
        <div class="action-row" style="margin-bottom:0.65rem">
          <button type="button" class="btn btn-primary" id="btn-add-all-missing">將 ${list.length} 項全部加入待辦</button>
        </div>
        <ul class="inventory-list">${rows}</ul>
      </section>`;
  }

  function localMatchesSection(result) {
    const matches = result?.matches || [];
    if (!matches.length) return "";
    return `
      <section class="panel">
        <div class="panel-head">
          <h3>本地規則命中</h3>
          <span class="badge badge-local">${matches.length} 筆</span>
        </div>
        <div class="match-list">
          ${matches
            .map((m) => {
              const rid = m.rule?.id;
              const hasSpan =
                (Array.isArray(m.spans) && m.spans.length > 0) ||
                (Array.isArray(result.spans) &&
                  result.spans.some((s) => s.ruleId === rid));
              return ruleCardHtml(m.rule, {
                highlightForm: result.form,
                hitPersons: m.hitPersons,
                badge: "本句已套用",
                colorIndex: m.colorIndex ?? 0,
                mode: "lookup",
                hasSpan: Boolean(hasSpan),
              });
            })
            .join("")}
        </div>
        ${
          result.partial?.length
            ? `<details class="related-block"><summary>其他可能相關（${result.partial.length}）</summary>
                <div class="match-list compact">${result.partial
                  .map((m) =>
                    ruleCardHtml(m.rule, {
                      compact: true,
                      badge: "相關",
                      mode: "lookup",
                      hasSpan: false,
                    })
                  )
                  .join("")}</div>
              </details>`
            : ""
        }
      </section>`;
  }

  function noLocalMatchActions(query, analysis) {
    const p = analysis?.primary || {};
    const confLabel =
      analysis?.confidence === "high"
        ? "高信心"
        : analysis?.confidence === "medium"
          ? "中等信心"
          : analysis
            ? "低信心"
            : "";
    const suggestions = analysis ? Analyzer.buildSuggestions(query, analysis) : null;
    const isIrreg = !!(
      analysis?.irregular ||
      p.irregular ||
      (typeof Analyzer.isIrregularForm === "function" && Analyzer.isIrregularForm(query))
    );

    return `
      <div class="result-banner warn">
        <strong>尚未對應規則</strong>
        <span>${
          isIrreg
            ? "此為不規則動詞，須另立專屬規則（完整形六格），不可套用第一組通則詞尾"
            : "可建立規則，或選字套用已有規則"
        }</span>
      </div>
      ${
        isIrreg
          ? `<div class="result-banner info">
        <strong>不規則動詞 · 另立規則</strong>
        <span>建議標題如「${esc(p.infinitive || "?")} ${esc(
              Analyzer.tenseZh?.(p.tense) || p.tense || ""
            )}（${esc(p.infinitive || "")} ${esc(p.tense || "")}）」，六格填 suis／peux 等完整形。</span>
      </div>`
          : ""
      }
      ${
        analysis
          ? `<section class="panel panel-analysis">
        <div class="panel-head">
          <h3>基礎分析（離線）</h3>
          ${confLabel ? `<span class="badge badge-api-fallback">${esc(confLabel)}</span>` : ""}
          ${isIrreg ? `<span class="badge badge-missing">不規則 · 另立規則</span>` : ""}
        </div>
        <dl class="kv-grid">
          <div><dt>形式</dt><dd><code>${esc(query)}</code></dd></div>
          <div><dt>原形</dt><dd>${esc(p.infinitive || "?")}</dd></div>
          <div><dt>時態</dt><dd>${esc(p.tense || "?")}</dd></div>
          <div><dt>人稱</dt><dd>${esc(p.person || "?")}</dd></div>
        </dl>
        ${suggestions ? `<p class="panel-note">${esc(suggestions.summary)}</p>` : ""}
        ${
          suggestions?.checklist?.length
            ? `<ul class="panel-note" style="margin:0.5rem 0 0;padding-left:1.2rem">${suggestions.checklist
                .map((c) => `<li>${esc(c)}</li>`)
                .join("")}</ul>`
            : ""
        }
      </section>`
          : ""
      }
      <section class="panel panel-action">
        <h3>下一步</h3>
        <div class="action-row">
          <button type="button" class="btn btn-primary" id="btn-create-from-lookup">${
            isIrreg ? "建立不規則動詞專屬規則" : "立即建立規則"
          }</button>
          <button type="button" class="btn btn-secondary" id="btn-add-todo">先加入待辦清單</button>
        </div>
      </section>`;
  }

  function bindLookupResultEvents(query, inventory, analysis) {
    const root = $("#lookup-result");
    if (!root) return;

    bindRuleCardActions(root);

    function goToRuleId(id) {
      if (!id) return;
      const card =
        root.querySelector(`.rule-card[data-id="${CSS.escape(id)}"]`) ||
        root.querySelector(`#rule-${CSS.escape(id)}`) ||
        document.getElementById("rule-" + id);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("rule-card-flash");
        setTimeout(() => card.classList.remove("rule-card-flash"), 1200);
        return;
      }
      setView("rules");
      const filter = $("#rules-filter");
      if (filter) filter.value = "";
      renderRulesList();
      requestAnimationFrame(() => {
        const el = document.getElementById("rule-" + id);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("rule-card-flash");
          setTimeout(() => el.classList.remove("rule-card-flash"), 1400);
          showToast("已定位規則卡", "success");
        }
      });
    }

    // 圖例／連結跳轉規則；句中 mark 另由 onGrammarMarkClick（可再套用）
    root.querySelectorAll("[data-scroll-rule]").forEach((el) => {
      if (el.matches && el.matches("mark.gram-hl")) return;
      el.addEventListener("click", () => goToRuleId(el.dataset.scrollRule));
    });
    root.querySelectorAll("[data-add-supplementary]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSupplementaryPickModal();
      });
    });

    $("#btn-create-from-lookup")?.addEventListener("click", () => {
      const draft = analysis
        ? Analyzer.draftFromAnalysis(query, analysis)
        : { title: query.slice(0, 40), explanation: `來自查詢：${query}`, has_persons: false };
      const irregNote =
        draft.irregular || analysis?.irregular
          ? " — <strong>不規則動詞須另立專屬規則</strong>（六格用完整形，勿只填通則詞尾）"
          : "";
      openForm(null, {
        ...draft,
        banner: `<strong>由查詢建立</strong> — ${esc(query)}${irregNote}`,
        source: "from-lookup",
      });
    });

    $("#btn-add-todo")?.addEventListener("click", () => {
      const p = analysis?.primary || {};
      const isIrreg = !!(analysis?.irregular || p.irregular);
      const todoName =
        isIrreg && p.infinitive
          ? `${p.infinitive} ${Analyzer.tenseZh?.(p.tense) || p.tense || ""}（${p.infinitive} ${
              p.tense || ""
            }）`.trim()
          : query.slice(0, 80);
      const { added } = addTodosFromItems(
        [
          {
            name: todoName.slice(0, 80),
            form: query,
            note: isIrreg
              ? `不規則動詞 ${p.infinitive || "?"} · 須另立專屬規則`
              : p.infinitive
                ? `推估：${p.infinitive}`
                : "本地查無規則",
            category: isIrreg ? "變位" : "其他",
          },
        ],
        query
      );
      showToast(added ? "已加入待辦" : "待辦中已有相同項目", added ? "success" : "info");
    });

    $("#btn-add-all-missing")?.addEventListener("click", () => {
      if (!inventory?.items) return;
      const missing = inventory.items.filter((it) => !resolveInventoryRule(it).owned);
      const { added, skipped } = addTodosFromItems(missing, query, { fromApi: true });
      showToast(
        added ? `已加入 ${added} 項待辦${skipped ? `（略過 ${skipped}）` : ""}` : "沒有新的待辦可加",
        added ? "success" : "info"
      );
    });

    root.querySelectorAll("[data-add-todo-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const it = inventory?.items?.[Number(btn.dataset.addTodoIdx)];
        if (!it) return;
        const { added } = addTodosFromItems([it], query, { fromApi: true });
        showToast(added ? "已加入待辦" : "待辦中已有或已收錄", added ? "success" : "info");
      });
    });

    root.querySelectorAll("[data-create-inv-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const it = inventory?.items?.[Number(btn.dataset.createInvIdx)];
        if (!it) return;
        openForm(
          null,
          draftNameOnly(it.name, {
            banner: `<strong>由 API 盤點建立</strong> — ${esc(
              it.name
            )}（僅帶入名稱，其餘請自行填寫或用 AI 自動填寫）`,
            source: "from-api",
          })
        );
      });
    });

    root.querySelectorAll("[data-dismiss-inv-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dismissInventoryItemAt(btn.dataset.dismissInvIdx);
      });
    });

    root.querySelectorAll("[data-detach-rule]").forEach((btn) => {
      btn.addEventListener("click", () => {
        detachRuleFromCurrentResult(btn.dataset.detachRule);
      });
    });

    root.querySelectorAll("[data-locate-rule]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        enterLocateMode(btn.dataset.locateRule);
      });
    });

    // 已上色片段：點一下 → 再套用／查看
    root.querySelectorAll("mark.gram-hl").forEach((mark) => {
      mark.addEventListener("click", (e) => onGrammarMarkClick(e, mark));
    });

    // 選字套用：掛在 sentence-board（句首邊距拖選也吃得到）
    bindSentenceSelectionHandlers();
    bindTranslationEditors(root);
  }

  /* —— 本句手動校正（不改筆記本規則本體；對齊 Mal） —— */

  function persistCurrentInventory(opts = {}) {
    const q = String(state.lastQuery || "").trim();
    const inv = state.lastInventory;
    if (!q || !inv) return null;
    keepExistingTranslation(q, inv, opts);
    prepareInventoryVocab(inv, q);
    rememberInventoryVocab(inv, { preferIncoming: false });
    // 可傳入已算過的 apiHl，避免手動校正後再全量重算一次
    const apiHl = opts.apiHl || buildApiHighlight(q, inv);
    const payload = {
      query: q,
      summary: inv.summary || "",
      translation: inv.translation || "",
      replaceTranslation: Boolean(opts.replaceTranslation),
      ownedCount: (apiHl.ownedHits || []).length,
      missingCount: (apiHl.missingItems || []).length,
      localCount: (state.lastSearch?.matches || []).length,
      items: inv.items || [],
      vocab: inv.vocab || [],
    };
    applyPersistEntryTarget(payload, opts);
    const activePid = Storage.getActiveProjectId();
    if (activePid) {
      const after = Storage.upsertProjectEntry(activePid, payload);
      if (after?.seq != null) state.projectCursorSeq = after.seq;
      updateProjectModeUI();
    } else if (!opts.skipHistory) {
      Storage.addHistoryEntry(payload);
      updateLookupNavBtns();
    }
    return apiHl;
  }

  function refreshLookupFromInventory(opts = {}) {
    const q = state.lastQuery;
    const inv = state.lastInventory;
    if (!q || !inv) return;
    const localResult = state.lastSearch || emptyLocalResult(q);
    state.lastSearch = localResult;
    const apiHl = renderHybridLookup(q, localResult, inv, opts);
    persistCurrentInventory({
      apiHl: apiHl || undefined,
      replaceTranslation: Boolean(opts.replaceTranslation),
    });
  }

  /** 從本句結果移除某規則的套用（筆記本規則保留） */
  function detachRuleFromCurrentResult(ruleId) {
    const id = String(ruleId || "").trim();
    const inv = state.lastInventory;
    if (!id || !inv) {
      showToast("沒有可編輯的查詢結果", "info");
      return;
    }
    const before = (inv.items || []).length;
    inv.items = (inv.items || []).filter((it) => {
      if (it.manualRuleId && String(it.manualRuleId) === id) return false;
      const m = resolveInventoryRule(it);
      if (m.owned && m.rule?.id === id) return false;
      return true;
    });
    if (inv.items.length === before) {
      showToast("找不到對應的本句項目", "info");
      return;
    }
    state.lastInventory = inv;
    refreshLookupFromInventory();
    showToast("已從本句移除（筆記本規則仍保留）", "success");
  }

  /** 忽略尚未收錄的某一項（僅本句） */
  function dismissInventoryItemAt(invIdx) {
    const inv = state.lastInventory;
    if (!inv?.items) return;
    const i = Number(invIdx);
    if (!Number.isFinite(i) || i < 0 || i >= inv.items.length) return;
    const name = inv.items[i]?.name || "";
    inv.items.splice(i, 1);
    state.lastInventory = inv;
    refreshLookupFromInventory();
    showToast(name ? `已忽略「${name}」` : "已從本句忽略", "info");
  }

  /** 確保有查詢盤點殼，方便手動加補充 */
  function ensureLookupInventoryShell() {
    if (!state.lastQuery) return null;
    if (!state.lastInventory) {
      state.lastInventory = {
        summary: "",
        translation: "",
        items: [],
        vocab: [],
      };
    }
    if (!Array.isArray(state.lastInventory.items)) state.lastInventory.items = [];
    return state.lastInventory;
  }

  /**
   * 將「補充用法」規則加入本句（不句中上色、不需選字）
   */
  function addSupplementaryRuleToCurrent(rule) {
    if (!rule?.id) return;
    if (
      typeof RulesService.isSupplementaryUsage === "function" &&
      !RulesService.isSupplementaryUsage(rule)
    ) {
      showToast("請選擇分類為「補充用法」的規則", "info");
      return;
    }
    const inv = ensureLookupInventoryShell();
    const q = String(state.lastQuery || "");
    if (!inv || !q) {
      showToast("請先完成一次查詢再加入補充", "info");
      return;
    }
    const already = (inv.items || []).some((it) => {
      if (String(it.manualRuleId || "") === rule.id) return true;
      const m = resolveInventoryRule(it);
      return m.owned && m.rule?.id === rule.id;
    });
    if (already) {
      showToast("本句已有此補充用法", "info");
      return;
    }
    const parsed =
      typeof RulesService.parseBilingualTitle === "function"
        ? RulesService.parseBilingualTitle(rule.title) || {}
        : {};
    inv.items = Array.isArray(inv.items) ? inv.items.slice() : [];
    inv.items.push({
      name: rule.title,
      nameFr: parsed.fr || "",
      nameZh: parsed.zh || "",
      nameKo: parsed.fr || "",
      span: "",
      category: rule.category || RulesService.SUPPLEMENTARY_CATEGORY || "補充用法",
      confidence: "high",
      source: "manual",
      manualRuleId: rule.id,
    });
    state.lastInventory = inv;
    refreshLookupFromInventory();
    showToast(`已加入補充：${rule.title}`, "success");
  }

  /** 圖例「+補充」：挑選或建立補充用法 */
  function openSupplementaryPickModal() {
    if (!state.lastQuery) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    ensureLookupInventoryShell();
    state.rulePickMode = "supplementary";
    state.selApply = null;
    hideSelApplyPop();
    const modal = $("#rule-pick-modal");
    const title = $("#rule-pick-modal-title");
    const preview = $("#rule-pick-span-preview");
    const sub = modal?.querySelector(".modal-sub");
    if (title) title.textContent = "加入補充用法";
    if (preview) preview.textContent = "不句中上色 · 排在規則卡最後";
    if (sub) {
      sub.innerHTML =
        `選擇筆記本中的<strong>補充用法</strong>加入本句；或建立新卡（分類會設為補充用法）。`;
    }
    const createHint = $(".rule-pick-create-hint");
    if (createHint) {
      createHint.innerHTML =
        `沒有合適的？<strong>建立新補充用法</strong>（儲存後自動加入本句，不句中上色）。`;
    }
    const createBtn = $("#btn-rule-pick-create");
    if (createBtn) createBtn.textContent = "建立補充用法";
    if (modal) modal.classList.remove("hidden");
    const filter = $("#rule-pick-filter");
    if (filter) {
      filter.value = "";
      setTimeout(() => filter.focus(), 40);
    }
    renderRulePickList();
  }

  /** 手動把筆記本規則套到選取片段 */
  function addRuleToCurrentResult(rule, spanText, start, end) {
    if (!rule?.id) return;
    const inv = state.lastInventory;
    const q = String(state.lastQuery || "");
    if (!inv || !q) {
      showToast("請先完成一次查詢再手動套用", "info");
      return;
    }
    const span = String(spanText || "").trim();
    if (!span) {
      showToast("沒有選取文字", "error");
      return;
    }

    // 相同文法可在句中多處各套一次；僅「同規則＋同片段（區間重疊）」才禁止
    let s = Number(start);
    let e = Number(end);
    let rangeOk =
      Number.isFinite(s) &&
      Number.isFinite(e) &&
      s >= 0 &&
      e > s &&
      e <= q.length &&
      q.slice(s, e) === span;

    function itemMatchesRule(it) {
      return (
        String(it.manualRuleId || "") === rule.id ||
        resolveInventoryRule(it).rule?.id === rule.id
      );
    }
    function rangesOverlap(a0, a1, b0, b1) {
      return !(a1 <= b0 || a0 >= b1);
    }
    /** 同規則已佔用區間：有座標用座標；無座標則各佔下一個尚未佔用的 span 出現處 */
    function collectSameRuleOccupied() {
      const occupied = [];
      const unlocated = [];
      for (const it of inv.items || []) {
        if (!itemMatchesRule(it)) continue;
        const a = Number(it.start);
        const b = Number(it.end);
        if (
          Number.isFinite(a) &&
          Number.isFinite(b) &&
          b > a &&
          a >= 0 &&
          b <= q.length
        ) {
          occupied.push({ s: a, e: b });
        } else {
          unlocated.push(it);
        }
      }
      for (const it of unlocated) {
        const sp = String(it.span || "").trim();
        if (!sp) continue;
        let from = 0;
        while (from < q.length) {
          const idx = q.indexOf(sp, from);
          if (idx < 0) break;
          const pe = idx + sp.length;
          if (!occupied.some((r) => rangesOverlap(idx, pe, r.s, r.e))) {
            occupied.push({ s: idx, e: pe });
            break;
          }
          from = idx + 1;
        }
      }
      return occupied;
    }
    function placementFree(ps, pe) {
      return !collectSameRuleOccupied().some((r) => rangesOverlap(ps, pe, r.s, r.e));
    }

    if (!rangeOk) {
      let from = 0;
      let placed = null;
      while (from < q.length) {
        const idx = q.indexOf(span, from);
        if (idx < 0) break;
        const pe = idx + span.length;
        if (placementFree(idx, pe)) {
          placed = { s: idx, e: pe };
          break;
        }
        from = idx + 1;
      }
      if (placed) {
        s = placed.s;
        e = placed.e;
        rangeOk = true;
      } else {
        const near = nearestTextOccurrence(q, span, start);
        s = near;
        e = s >= 0 ? s + span.length : -1;
        rangeOk = s >= 0 && e > s && e <= q.length && q.slice(s, e) === span;
      }
    }

    const occupied = collectSameRuleOccupied();
    const dup = rangeOk
      ? occupied.some((r) => rangesOverlap(s, e, r.s, r.e))
      : (inv.items || []).some(
          (it) => itemMatchesRule(it) && String(it.span || "").trim() === span
        );
    if (dup) {
      showToast("此片段已套用過同一則規則（可改選句中其他位置）", "info");
      return;
    }

    const coCount = (inv.items || []).filter((it) => {
      if (rangeOk && Number.isFinite(Number(it.start)) && Number.isFinite(Number(it.end))) {
        const a = Number(it.start);
        const b = Number(it.end);
        return rangesOverlap(s, e, a, b);
      }
      return String(it.span || "").trim() === span;
    }).length;

    const parsed = RulesService.parseBilingualTitle(rule.title) || {};
    const item = {
      name: rule.title,
      nameFr: parsed.fr || "",
      nameZh: parsed.zh || "",
      nameKo: parsed.fr || "",
      span,
      category: rule.category || "",
      confidence: "high",
      source: "manual",
      manualRuleId: rule.id,
    };
    if (rangeOk) {
      item.start = s;
      item.end = e;
    }
    inv.items = Array.isArray(inv.items) ? inv.items.slice() : [];
    inv.items.push(item);
    state.lastInventory = inv;
    refreshLookupFromInventory();
    if (coCount > 0) {
      showToast(`已疊加：${rule.title}（此片段共 ${coCount + 1} 則規則）`, "success");
    } else {
      showToast(`已套用：${rule.title}`, "success");
    }
  }

  function updateLocateModeBar() {
    const bar = $("#locate-mode-bar");
    if (!bar) return;
    const t = state.locateTarget;
    if (!t?.ruleId) {
      bar.classList.add("hidden");
      bar.innerHTML = "";
      document.body.classList.remove("locate-mode-active");
      return;
    }
    document.body.classList.add("locate-mode-active");
    bar.classList.remove("hidden");
    bar.innerHTML = `
      <span class="locate-mode-badge">定位中</span>
      <span class="locate-mode-text">請在句中<strong>選取</strong>對應片段 →
        <strong>${esc(t.ruleTitle || "規則")}</strong>
      </span>
      <button type="button" class="btn btn-sm btn-ghost" id="btn-locate-cancel">取消</button>
    `;
    bar.querySelector("#btn-locate-cancel")?.addEventListener("click", () => {
      cancelLocateMode();
      showToast("已取消定位", "info");
    });
  }

  function enterLocateMode(ruleId) {
    const id = String(ruleId || "").trim();
    const rule = RulesService.getById(id);
    if (!rule) {
      showToast("找不到規則", "error");
      return;
    }
    if (!state.lastQuery || !state.lastInventory) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    state.locateTarget = { ruleId: id, ruleTitle: rule.title };
    hideSelApplyPop();
    updateLocateModeBar();
    setView("lookup");
    const board = $("#sentence-board") || $("#sentence-text");
    board?.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast(`請選取「${rule.title}」在句中的位置`, "info");
  }

  function cancelLocateMode() {
    state.locateTarget = null;
    updateLocateModeBar();
    const applyBtn = $("#btn-sel-apply-rule");
    if (applyBtn) applyBtn.textContent = "套用規則";
  }

  function assignManualLocation(ruleId, cap) {
    const id = String(ruleId || "").trim();
    const rule = RulesService.getById(id);
    const inv = state.lastInventory;
    const q = String(state.lastQuery || "");
    if (!rule || !inv || !q) {
      showToast("無法定位：缺少查詢結果", "error");
      return false;
    }
    const text = String(cap?.text || "").trim();
    if (!text) {
      showToast("請先選取句中文字", "error");
      return false;
    }
    let s = Number(cap.start);
    let e = Number(cap.end);
    const rangeOk =
      Number.isFinite(s) &&
      Number.isFinite(e) &&
      s >= 0 &&
      e > s &&
      e <= q.length &&
      q.slice(s, e) === text;
    if (!rangeOk) {
      const near = nearestTextOccurrence(q, text, cap?.start);
      if (near < 0) {
        showToast("選取內容與原文對不上，請再選一次", "error");
        return false;
      }
      s = near;
      e = near + text.length;
    }

    inv.items = Array.isArray(inv.items) ? inv.items.slice() : [];
    const indices = [];
    inv.items.forEach((it, i) => {
      const m = resolveInventoryRule(it);
      if (m.rule?.id === id) indices.push(i);
    });

    const patch = (it) => {
      it.span = text;
      it.start = s;
      it.end = e;
      it.locatedManually = true;
      if (!it.manualRuleId) it.manualRuleId = id;
      if (!it.name) it.name = rule.title;
    };

    let mode = "update";
    if (indices.length) {
      let targetIdx = -1;
      for (const i of indices) {
        const found = locateInventoryItemInText(q, inv.items[i]);
        if (!found.length) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx >= 0) {
        patch(inv.items[targetIdx]);
      } else {
        const base = { ...inv.items[indices[0]] };
        patch(base);
        base.source = base.source || "manual";
        inv.items.push(base);
        mode = "add";
      }
    } else {
      const parsed = RulesService.parseBilingualTitle(rule.title) || {};
      inv.items.push({
        name: rule.title,
        nameFr: parsed.fr || "",
        nameZh: parsed.zh || "",
        nameKo: parsed.fr || "",
        span: text,
        start: s,
        end: e,
        category: rule.category || "",
        confidence: "high",
        source: "manual",
        manualRuleId: id,
        locatedManually: true,
      });
      mode = "new";
    }

    state.lastInventory = inv;
    state.locateTarget = null;
    updateLocateModeBar();
    refreshLookupFromInventory();
    showToast(
      mode === "add"
        ? `已加上定位「${text}」→ ${rule.title}`
        : `已定位「${text}」→ ${rule.title}`,
      "success"
    );
    return true;
  }

  function hideSelApplyPop() {
    const pop = $("#sel-apply-pop");
    if (pop) pop.classList.add("hidden");
    const note = $("#sel-apply-note");
    if (note) {
      note.textContent = "";
      note.classList.add("hidden");
    }
    const viewBtn = $("#btn-sel-view-rule");
    if (viewBtn) {
      viewBtn.classList.add("hidden");
      viewBtn.dataset.ruleId = "";
    }
    const applyBtn = $("#btn-sel-apply-rule");
    if (applyBtn && !state.locateTarget) applyBtn.textContent = "套用規則";
  }

  function showSelApplyPop(clientX, clientY, text, opts = {}) {
    const pop = $("#sel-apply-pop");
    const label = $("#sel-apply-text");
    if (!pop) return;
    if (label) label.textContent = `「${text.length > 24 ? text.slice(0, 24) + "…" : text}」`;
    const note = $("#sel-apply-note");
    const locate = state.locateTarget;
    if (note) {
      if (locate?.ruleId) {
        note.textContent = `定位到：${locate.ruleTitle || "規則"}`;
        note.classList.remove("hidden");
      } else if (opts.note) {
        note.textContent = opts.note;
        note.classList.remove("hidden");
      } else {
        note.textContent = "";
        note.classList.add("hidden");
      }
    }
    const applyBtn = $("#btn-sel-apply-rule");
    if (applyBtn) applyBtn.textContent = locate?.ruleId ? "確認定位" : "套用規則";
    const vocabBtn = $("#btn-sel-vocab");
    if (vocabBtn) vocabBtn.classList.toggle("hidden", Boolean(locate?.ruleId));
    const viewBtn = $("#btn-sel-view-rule");
    if (viewBtn) {
      if (opts.viewRuleId && !locate?.ruleId) {
        viewBtn.classList.remove("hidden");
        viewBtn.dataset.ruleId = opts.viewRuleId;
      } else {
        viewBtn.classList.add("hidden");
        viewBtn.dataset.ruleId = "";
      }
    }
    pop.classList.remove("hidden");
    requestAnimationFrame(() => {
      let x = clientX;
      let y = clientY;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        try {
          const r = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect();
          x = r.left + r.width / 2;
          y = r.bottom;
        } catch {
          const vv = visualViewportBox();
          x = vv.left + vv.width / 2;
          y = vv.top + 96;
        }
      }
      placeFixedPop(pop, x, y);
    });
  }

  function setVocabEditBanner(html, kind = "info") {
    const banner = $("#vocab-edit-banner");
    if (!banner) return;
    if (!html) {
      banner.classList.add("hidden");
      banner.innerHTML = "";
      return;
    }
    banner.classList.remove("hidden");
    banner.className = `result-banner ${kind}`;
    banner.innerHTML = html;
  }

  function findVocabEntryForRange(cap) {
    const list = state.lastInventory?.vocab;
    if (!Array.isArray(list) || !cap) return { entry: null, index: -1 };
    const text = String(cap.text || "").trim();
    const s = Number(cap.start);
    const e = Number(cap.end);
    const rangeOk = Number.isFinite(s) && Number.isFinite(e) && e > s;
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const ws = Number(w.start);
      const we = Number(w.end);
      if (rangeOk && Number.isFinite(ws) && Number.isFinite(we) && !(e <= ws || s >= we)) {
        return { entry: w, index: i };
      }
    }
    for (let i = 0; i < list.length; i++) {
      if (String(list[i].surface || "").trim() === text) return { entry: list[i], index: i };
    }
    return { entry: null, index: -1 };
  }

  /** select 設值；若選項沒有該值則臨時加入，避免無法顯示／再改 */
  function setSelectValue(sel, value) {
    if (!sel || sel.tagName !== "SELECT") {
      if (sel) sel.value = value || "";
      return;
    }
    const v = String(value || "").trim();
    // 清掉先前為回填加的臨時項
    sel.querySelectorAll("option[data-temp-opt]").forEach((o) => o.remove());
    if (!v) {
      sel.value = "";
      return;
    }
    const has = Array.from(sel.options).some((o) => o.value === v);
    if (!has) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      opt.dataset.tempOpt = "1";
      sel.appendChild(opt);
    }
    sel.value = v;
  }

  function fillVocabEditForm(data = {}) {
    const set = (id, v) => {
      const el = $(id);
      if (!el) return;
      if (el.tagName === "SELECT") setSelectValue(el, v);
      else el.value = v || "";
    };
    set("#vocab-edit-surface", data.surface);
    set("#vocab-edit-lemma", data.lemma);
    set("#vocab-edit-pos", data.pos);
    set("#vocab-edit-gender", data.gender);
    set("#vocab-edit-verb-group", data.verbGroup);
    set("#vocab-edit-phonetic", data.phonetic);
    set("#vocab-edit-gloss", data.gloss);
  }

  function readVocabEditForm() {
    return {
      surface: String($("#vocab-edit-surface")?.value || "").trim(),
      lemma: String($("#vocab-edit-lemma")?.value || "").trim(),
      pos: String($("#vocab-edit-pos")?.value || "").trim(),
      gender: String($("#vocab-edit-gender")?.value || "").trim(),
      verbGroup: String($("#vocab-edit-verb-group")?.value || "").trim(),
      phonetic: String($("#vocab-edit-phonetic")?.value || "").trim(),
      gloss: String($("#vocab-edit-gloss")?.value || "").trim(),
    };
  }

  function openVocabEditModal() {
    const cap = state.selApply;
    const text = String(cap?.text || "").trim();
    if (!text) {
      showToast("請先在句子中選取文字", "info");
      return;
    }
    if (!state.lastQuery) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    if (!state.lastInventory) {
      state.lastInventory = { summary: "", translation: "", items: [], vocab: [] };
    }
    if (!Array.isArray(state.lastInventory.vocab)) state.lastInventory.vocab = [];

    const range = {
      text,
      start: Number.isFinite(cap.start) ? cap.start : -1,
      end: Number.isFinite(cap.end) ? cap.end : -1,
    };
    state.vocabEditRange = range;
    hideSelApplyPop();

    const found = findVocabEntryForRange(range);
    const bankHit =
      typeof Storage.lookupVocabBank === "function" ? Storage.lookupVocabBank(text) : null;
    const base = found.entry
      ? { ...found.entry }
      : bankHit
        ? {
            surface: bankHit.surface || text,
            lemma: bankHit.lemma || "",
            pos: bankHit.pos || "",
            gender: bankHit.gender || "",
            verbGroup: bankHit.verbGroup || "",
            phonetic: bankHit.phonetic || "",
            gloss: bankHit.gloss || "",
          }
        : {
            surface: text,
            lemma: "",
            pos: "",
            gender: "",
            verbGroup: "",
            phonetic: "",
            gloss: "",
          };
    if (!base.surface) base.surface = text;
    fillVocabEditForm(base);
    setVocabEditBanner(
      found.entry
        ? `<strong>編輯既有單字</strong> — 修改後按「儲存到本句」（並更新本地單字庫）。`
        : bankHit
          ? `<strong>來自本地單字庫</strong> — 可修改後儲存到本句。`
          : `<strong>新增單字解釋</strong> — 可手動填寫或按「AI 填寫」；儲存後寫入本句與本地單字庫。`,
      "info"
    );
    const preview = $("#vocab-edit-span-preview");
    if (preview) preview.textContent = text;
    $("#vocab-edit-modal")?.classList.remove("hidden");
    setTimeout(() => $("#vocab-edit-gloss")?.focus(), 40);
  }

  function closeVocabEditModal() {
    $("#vocab-edit-modal")?.classList.add("hidden");
    state.vocabEditRange = null;
    setVocabEditBanner("");
  }

  function saveVocabEditForm(e) {
    e?.preventDefault();
    const range = state.vocabEditRange;
    const q = String(state.lastQuery || "");
    if (!range || !q) {
      showToast("沒有可寫入的查詢結果", "error");
      return;
    }
    if (!state.lastInventory) {
      state.lastInventory = { summary: "", translation: "", items: [], vocab: [] };
    }
    const form = readVocabEditForm();
    const surface = form.surface || range.text;
    if (!surface) {
      showToast("請填寫表面形", "error");
      return;
    }
    if (!form.gloss && !form.lemma && !form.phonetic) {
      showToast("請至少填寫原形、音標或意思", "info");
      return;
    }
    let start = Number(range.start);
    let end = Number(range.end);
    if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) {
      const idx = q.indexOf(surface);
      if (idx >= 0) {
        start = idx;
        end = idx + surface.length;
      } else {
        start = null;
        end = null;
      }
    }
    const row = {
      surface,
      lemma: form.lemma || surface,
      gloss: form.gloss,
      pos: form.pos,
      gender: form.gender,
      verbGroup: form.verbGroup,
      phonetic: form.phonetic,
      start,
      end,
      source: "manual",
    };
    const list = Array.isArray(state.lastInventory.vocab)
      ? state.lastInventory.vocab.slice()
      : [];
    const found = findVocabEntryForRange(range);
    if (found.index >= 0) {
      list[found.index] = { ...list[found.index], ...row };
    } else {
      let replaced = false;
      for (let i = 0; i < list.length; i++) {
        if (String(list[i].surface || "") === surface) {
          list[i] = { ...list[i], ...row };
          replaced = true;
          break;
        }
      }
      if (!replaced) list.push(row);
    }
    state.lastInventory.vocab = list;
    if (typeof Storage.upsertVocabBankEntries === "function") {
      Storage.upsertVocabBankEntries([row], { preferIncoming: true });
    }
    closeVocabEditModal();
    state.selApply = null;
    window.getSelection()?.removeAllRanges();
    refreshLookupFromInventory();
    showToast(`已寫入單字「${surface}」（本句＋本地庫）`, "success");
  }

  async function runVocabEditAi() {
    const range = state.vocabEditRange;
    const surface =
      String($("#vocab-edit-surface")?.value || "").trim() ||
      String(range?.text || "").trim();
    if (!surface) {
      showToast("請先有選取詞", "error");
      return;
    }
    if (!Storage.hasApiKey()) {
      showToast("請先到「設定」填入 API Key", "error");
      setView("settings");
      return;
    }
    const btn = $("#btn-vocab-edit-ai");
    if (btn) {
      btn.disabled = true;
      btn.classList.add("loading");
    }
    setVocabEditBanner(`<strong>AI 查詢中</strong> — 正在補齊「${esc(surface)}」…`, "info");
    try {
      const w = await AiService.completeWordFromSurface(surface, state.lastQuery || "");
      fillVocabEditForm({
        surface: w.surface || surface,
        lemma: w.lemma || "",
        pos: w.pos || "",
        gender: w.gender || "",
        verbGroup: w.verbGroup || "",
        phonetic: w.phonetic || "",
        gloss: w.gloss || "",
      });
      setVocabEditBanner(`<strong>AI 已填寫</strong> — 請核對後按「儲存到本句」。`, "success");
      showToast("AI 已填寫單字資訊", "success");
    } catch (err) {
      setVocabEditBanner(
        `<strong>AI 失敗</strong> — ${esc(err.message || "未知錯誤")}`,
        "error"
      );
      showToast(err.message || "AI 填寫失敗", "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("loading");
      }
    }
  }

  function getMarkRangeInQuery(mark) {
    const sentenceEl = $("#sentence-text");
    const q = String(state.lastQuery || "");
    if (!mark || !sentenceEl || !q) return null;
    try {
      const range = document.createRange();
      range.selectNodeContents(mark);
      let start = getTextOffsetInElement(sentenceEl, range.startContainer, range.startOffset);
      let end = getTextOffsetInElement(sentenceEl, range.endContainer, range.endOffset);
      const text = String(mark.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) return null;
      if (start >= 0 && end > start && end <= q.length && q.slice(start, end) === text) {
        return { text, start, end };
      }
      // 同形多處時取最靠近 DOM 偏移的出現處
      const near = nearestTextOccurrence(q, text, start);
      if (near >= 0) return { text, start: near, end: near + text.length };
      return { text, start: -1, end: -1 };
    } catch {
      return null;
    }
  }

  /** 在原文找 needle；有 hint 時取最靠近的出現處（支援同一文法多處） */
  function nearestTextOccurrence(src, needle, hintStart) {
    const q = String(src || "");
    const n = String(needle || "");
    if (!q || !n) return -1;
    let best = -1;
    let bestDist = Infinity;
    let from = 0;
    const hint = Number(hintStart);
    const useHint = Number.isFinite(hint) && hint >= 0;
    while (from < q.length) {
      const idx = q.indexOf(n, from);
      if (idx < 0) break;
      if (!useHint) return idx;
      const d = Math.abs(idx - hint);
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
      from = idx + 1;
    }
    return best;
  }

  function selectionIsNonEmptyInSentence() {
    const sentenceEl = $("#sentence-text");
    const sel = window.getSelection();
    if (!sentenceEl || !sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    try {
      return selectionIntersectsElement(sel.getRangeAt(0), sentenceEl);
    } catch {
      return false;
    }
  }

  function selectionIntersectsElement(range, el) {
    if (!range || !el) return false;
    try {
      if (el.contains(range.commonAncestorContainer)) return true;
      const er = document.createRange();
      er.selectNodeContents(el);
      return (
        range.compareBoundaryPoints(Range.END_TO_START, er) > 0 &&
        range.compareBoundaryPoints(Range.START_TO_END, er) < 0
      );
    } catch {
      return false;
    }
  }

  function clampRangeToElement(range, el) {
    if (!range || !el) return null;
    try {
      const er = document.createRange();
      er.selectNodeContents(el);
      const out = range.cloneRange();
      if (out.compareBoundaryPoints(Range.START_TO_START, er) < 0) {
        out.setStart(er.startContainer, er.startOffset);
      }
      if (out.compareBoundaryPoints(Range.END_TO_END, er) > 0) {
        out.setEnd(er.endContainer, er.endOffset);
      }
      if (out.collapsed) return null;
      return out;
    } catch {
      return null;
    }
  }

  function getTextOffsetInElement(root, node, offset) {
    if (!root || !node) return -1;
    if (!root.contains(node) && node !== root) {
      try {
        const er = document.createRange();
        er.selectNodeContents(root);
        const probe = document.createRange();
        probe.setStart(node, Math.max(0, offset));
        probe.collapse(true);
        if (probe.compareBoundaryPoints(Range.START_TO_START, er) <= 0) return 0;
        if (probe.compareBoundaryPoints(Range.START_TO_END, er) >= 0) {
          return (root.textContent || "").length;
        }
      } catch {
        /* fall through */
      }
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let count = 0;
      let n;
      while ((n = walker.nextNode())) {
        if (n === node) {
          return count + Math.max(0, Math.min(offset, n.textContent.length));
        }
        count += n.textContent.length;
      }
    }
    if (node.nodeType === Node.ELEMENT_NODE && (root.contains(node) || node === root)) {
      try {
        const before = document.createRange();
        before.selectNodeContents(root);
        before.setEnd(node, Math.min(Math.max(0, offset), node.childNodes.length));
        return before.toString().length;
      } catch {
        return -1;
      }
    }
    try {
      const r = document.createRange();
      r.selectNodeContents(root);
      r.setEnd(node, offset);
      return r.toString().length;
    } catch {
      return -1;
    }
  }

  function mapDomOffsetsToQuery(q, domText, start, end) {
    const src = String(q || "");
    if (!src) return { start: -1, end: -1 };
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start &&
      end <= src.length
    ) {
      return { start, end };
    }
    const qMap = [];
    for (let i = 0; i < src.length; i++) {
      if (!/\s/.test(src[i])) qMap.push(i);
    }
    if (!qMap.length) return { start: -1, end: -1 };
    function domToCompact(i) {
      let c = 0;
      const s = String(domText || "");
      for (let k = 0; k < Math.min(i, s.length); k++) {
        if (!/\s/.test(s[k])) c++;
      }
      return c;
    }
    const cs = domToCompact(start);
    const ce = domToCompact(end);
    if (cs >= qMap.length) return { start: -1, end: -1 };
    const qs = qMap[Math.min(cs, qMap.length - 1)];
    const qe = ce <= 0 ? qs : ce >= qMap.length ? src.length : qMap[ce - 1] + 1;
    if (qe > qs) return { start: qs, end: qe };
    return { start: -1, end: -1 };
  }

  function captureSentenceSelection() {
    const sentenceEl = $("#sentence-text");
    if (!sentenceEl || !state.lastQuery) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    let range = sel.getRangeAt(0);
    if (!selectionIntersectsElement(range, sentenceEl)) return null;
    const clamped = clampRangeToElement(range, sentenceEl);
    if (!clamped) return null;
    range = clamped;

    const text = String(range.toString() || "").replace(/\s+/g, " ").trim();
    if (!text) return null;

    let start = getTextOffsetInElement(sentenceEl, range.startContainer, range.startOffset);
    let end = getTextOffsetInElement(sentenceEl, range.endContainer, range.endOffset);
    if (start > end) {
      const t = start;
      start = end;
      end = t;
    }
    const q = String(state.lastQuery || "");
    const domText = sentenceEl.textContent || "";

    if (start >= 0 && end > start && end <= q.length && q.slice(start, end) === text) {
      return { text, start, end };
    }
    if (start >= 0 && end > start && end <= q.length) {
      const slice = q.slice(start, end).replace(/\s+/g, " ").trim();
      if (slice === text) return { text, start, end };
    }
    if (start >= 0 && end > start) {
      const mapped = mapDomOffsetsToQuery(q, domText, start, end);
      if (mapped.start >= 0 && mapped.end > mapped.start) {
        const slice = q.slice(mapped.start, mapped.end).replace(/\s+/g, " ").trim();
        if (slice === text || slice.includes(text) || text.includes(slice)) {
          return { text: slice || text, start: mapped.start, end: mapped.end };
        }
      }
    }
    const near = nearestTextOccurrence(q, text, start);
    if (near >= 0) return { text, start: near, end: near + text.length };
    return { text, start: -1, end: -1 };
  }

  function bindSentenceSelectionHandlers() {
    const board = $("#sentence-board");
    const sentenceEl = $("#sentence-text");
    // 必須能對到 #sentence-text（capture 用）；板子與文字都綁 mouseup 較穩
    const hosts = [board, sentenceEl].filter(Boolean);
    if (!hosts.length) return;
    for (const host of hosts) {
      if (host.dataset.selBound === "1") continue;
      host.dataset.selBound = "1";
      host.addEventListener("pointerdown", markSentenceGestureStart);
      host.addEventListener("pointermove", markSentenceGestureMove);
      host.addEventListener("mouseup", onSentenceMouseUp);
      host.addEventListener("touchend", onSentenceMouseUp, { passive: true });
    }
  }

  function onSentenceMouseUp(e) {
    if (e.target.closest && e.target.closest("#sel-apply-pop, button, a, .sentence-legend, .locate-mode-bar")) {
      return;
    }
    if (!shouldRevealSelApplyFromGesture()) return;
    suppressWordTipClick = true;
    const point = eventClientPoint(e);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const cap = captureSentenceSelection();
        if (!cap) return;
        state.selApply = cap;
        const inv = state.lastInventory;
        let note = "";
        if (inv?.items && cap.start >= 0) {
          const n = inv.items.filter((it) => {
            if (Number.isFinite(Number(it.start)) && Number.isFinite(Number(it.end))) {
              return !(cap.end <= Number(it.start) || cap.start >= Number(it.end));
            }
            return String(it.span || "").trim() === cap.text;
          }).length;
          if (n > 0) note = `此片段已有 ${n} 則 · 可再疊加`;
        }
        showSelApplyPop(point.x, point.y, cap.text, { note });
      });
    });
  }

  function onGrammarMarkClick(e, mark) {
    if (selectionIsNonEmptyInSentence()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const range = getMarkRangeInQuery(mark);
    if (!range?.text) {
      const id =
        mark.dataset.scrollRule ||
        String(mark.dataset.cycleRuleIds || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)[0];
      if (id) {
        const card =
          document.querySelector(`.rule-card[data-id="${CSS.escape(id)}"]`) ||
          document.getElementById("rule-" + id);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.classList.add("rule-card-flash");
          setTimeout(() => card.classList.remove("rule-card-flash"), 1200);
        }
      }
      return;
    }
    state.selApply = range;
    const viewId =
      mark.dataset.scrollRule ||
      String(mark.dataset.cycleRuleIds || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)[0] ||
      "";
    const inv = state.lastInventory;
    let n = 0;
    if (inv?.items && range.start >= 0) {
      n = inv.items.filter((it) => {
        if (Number.isFinite(Number(it.start)) && Number.isFinite(Number(it.end))) {
          return !(range.end <= Number(it.start) || range.start >= Number(it.end));
        }
        return String(it.span || "").trim() === range.text;
      }).length;
    }
    showSelApplyPop(e.clientX, e.clientY, range.text, {
      note: n > 0 ? `已有 ${n} 則規則 · 可再疊加其他規則` : "可為此片段套用規則",
      viewRuleId: viewId,
    });
  }

  function openRulePickModal() {
    const cap = state.selApply;
    if (!cap?.text) {
      showToast("請先在句子中選取文字", "info");
      return;
    }
    if (!state.lastQuery) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    // 僅本地結果時也可能沒有 inventory：建空殼以便套用／建立規則
    if (!state.lastInventory) {
      state.lastInventory = {
        summary: "",
        translation: "",
        items: [],
        vocab: [],
      };
    }
    if (state.locateTarget?.ruleId) {
      hideSelApplyPop();
      assignManualLocation(state.locateTarget.ruleId, cap);
      state.selApply = null;
      window.getSelection()?.removeAllRanges();
      return;
    }
    state.rulePickMode = null;
    hideSelApplyPop();
    const modal = $("#rule-pick-modal");
    const title = $("#rule-pick-modal-title");
    const preview = $("#rule-pick-span-preview");
    const sub = modal?.querySelector(".modal-sub");
    if (title) title.textContent = "套用規則";
    if (preview) preview.textContent = cap.text;
    if (sub) {
      sub.innerHTML =
        `選取片段：<strong id="rule-pick-span-preview" class="rule-pick-span">${esc(
          cap.text
        )}</strong> — 依選取字<strong>本地</strong>推送（完整形／關鍵詞／API 盤點對齊優先）；只影響本句，不改筆記本。`;
    }
    const createHint = $(".rule-pick-create-hint");
    if (createHint) {
      createHint.innerHTML =
        `沒有合適規則卡？用選取字<strong>建立新規則</strong>（名稱可再改；儲存後會套用到此片段）。`;
    }
    const createBtn = $("#btn-rule-pick-create");
    if (createBtn) createBtn.textContent = "建立新規則";
    if (modal) modal.classList.remove("hidden");
    const filter = $("#rule-pick-filter");
    if (filter) {
      filter.value = "";
      setTimeout(() => filter.focus(), 40);
    }
    renderRulePickList();
  }

  function closeRulePickModal() {
    $("#rule-pick-modal")?.classList.add("hidden");
    state.rulePickMode = null;
  }

  /** 從目前盤點詞彙推估選取片段的詞性／原形等（供規則推薦＋不定式判斷） */
  function selectionVocabHints(selText) {
    const sel = String(selText || "").trim();
    const vocab = state.lastInventory?.vocab || [];
    if (!sel) return { vocab };
    const norm = (s) =>
      String(s || "")
        .trim()
        .toLowerCase()
        .normalize("NFC");
    const n = norm(sel);
    const cap = state.selApply;
    const hasRange =
      Number.isFinite(cap?.start) && Number.isFinite(cap?.end) && cap.end > cap.start;

    let best = null;
    let bestSc = -1;
    for (const w of vocab) {
      const surf = norm(w.surface);
      const lem = norm(w.lemma);
      let sc = 0;
      if (surf === n) sc = 100;
      else if (lem === n) sc = 85;
      if (hasRange) {
        const a = Number(w.start);
        const b = Number(w.end);
        if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
          const lo = Math.max(cap.start, a);
          const hi = Math.min(cap.end, b);
          if (hi > lo) sc = Math.max(sc, 75);
        }
      }
      if (sc > bestSc) {
        bestSc = sc;
        best = w;
      }
    }

    // 本句沒對到 → 試全域單字庫
    if ((!best || bestSc < 40) && typeof Storage.lookupVocabBank === "function") {
      const hit = Storage.lookupVocabBank(sel);
      if (hit) {
        return {
          pos: hit.pos || "",
          gender: hit.gender || "",
          lemma: hit.lemma || "",
          surface: hit.surface || sel,
          verbGroup: hit.verbGroup || "",
          vocab,
          fromBank: true,
        };
      }
    }

    if (best && bestSc >= 40) {
      return {
        pos: best.pos || "",
        gender: best.gender || "",
        lemma: best.lemma || "",
        surface: best.surface || sel,
        verbGroup: best.verbGroup || best.vg || "",
        vocab,
      };
    }
    return { vocab };
  }

  /** 手動套用推薦用的上下文（盤點對齊、已套用、選取區間、單字卡原形） */
  function rulePickRankOpts(selText, overrides = {}) {
    const hints = selectionVocabHints(selText);
    const inv = state.lastInventory;
    const appliedRuleIds = [];
    if (inv && Array.isArray(inv.items)) {
      const byTitle = new Map(RulesService.getAll().map((r) => [r.title, r.id]));
      for (const it of inv.items) {
        if (it?.manualRuleId) appliedRuleIds.push(it.manualRuleId);
        // 本句已標為本地／手動來源的規則名 → 解析 id
        if (it?.source === "manual" || it?.source === "local") {
          const id = byTitle.get(String(it.name || "").trim());
          if (id) appliedRuleIds.push(id);
        }
      }
    }
    const cap = state.selApply;
    return {
      pos: hints.pos,
      gender: hints.gender,
      lemma: hints.lemma,
      surface: hints.surface,
      verbGroup: hints.verbGroup,
      vocab: hints.vocab,
      inventory: inv || null,
      inventoryItems: inv?.items || [],
      sentence: state.lastQuery || "",
      query: state.lastQuery || "",
      selStart: Number.isFinite(cap?.start) ? cap.start : undefined,
      selEnd: Number.isFinite(cap?.end) ? cap.end : undefined,
      appliedRuleIds: [...new Set(appliedRuleIds)],
      maxSuggest: 6,
      ...overrides,
    };
  }

  function renderRulePickList() {
    const box = $("#rule-pick-list");
    if (!box) return;
    const q = String($("#rule-pick-filter")?.value || "")
      .trim()
      .toLowerCase();
    const suppMode = state.rulePickMode === "supplementary";
    const selText = suppMode ? "" : String(state.selApply?.text || "").trim();

    let suggestions = [];
    let rest = RulesService.getAll();
    if (suppMode) {
      rest = rest.filter(
        (r) =>
          typeof RulesService.isSupplementaryUsage === "function" &&
          RulesService.isSupplementaryUsage(r)
      );
      if (q) {
        rest = rest.filter((r) => {
          const blob = `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
          return blob.includes(q);
        });
      }
      if (!rest.length) {
        box.innerHTML = `<p class="projects-empty">尚無「補充用法」規則。請按上方「建立補充用法」。</p>`;
        return;
      }
      const itemHtml = (r) => `
        <li class="rule-pick-item">
          <div class="rule-pick-main">
            <p class="rule-pick-title"><span class="badge badge-usage">補充</span> ${esc(r.title)}</p>
            <p class="rule-pick-meta muted">${esc(r.category || "補充用法")}</p>
          </div>
          <button type="button" class="btn btn-sm btn-primary" data-pick-rule="${esc(r.id)}">加入</button>
        </li>`;
      box.innerHTML = `<div class="rule-pick-section">
        <ul class="rule-pick-ul">${rest.map((r) => itemHtml(r)).join("")}</ul>
      </div>`;
      box.querySelectorAll("[data-pick-rule]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const rule = RulesService.getById(btn.dataset.pickRule);
          if (!rule) return;
          closeRulePickModal();
          addSupplementaryRuleToCurrent(rule);
        });
      });
      return;
    }

    let adjNote = "";
    let rankMeta = null;
    if (selText && typeof RulesService.rankRulesForSpan === "function" && !q) {
      const ranked = RulesService.rankRulesForSpan(selText, rulePickRankOpts(selText));
      suggestions = ranked.suggestions || [];
      rest = ranked.rest || rest;
      rankMeta = ranked.meta || null;
      // 動詞剖面可信時不顯示「形容詞優先」（易與實際篩選矛盾）
      if (ranked.hint?.yes && !ranked.meta?.verbFilter && !ranked.meta?.verb?.confident) {
        adjNote = ranked.hint.reason
          ? `已優先排列形容詞相關規則（${ranked.hint.reason}）`
          : "已優先排列形容詞相關規則";
      }
    } else if (q) {
      const all = RulesService.getAll();
      if (selText && typeof RulesService.rankRulesForSpan === "function") {
        const ranked = RulesService.rankRulesForSpan(
          selText,
          rulePickRankOpts(selText, { maxSuggest: 12 })
        );
        const matchQ = (r) => {
          const blob = `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
          return blob.includes(q);
        };
        suggestions = (ranked.suggestions || []).filter((s) => matchQ(s.rule));
        rest = all.filter(
          (r) => matchQ(r) && !suggestions.some((s) => s.rule.id === r.id)
        );
        rankMeta = ranked.meta || null;
        if (ranked.hint?.yes) {
          rest = rest.slice().sort((a, b) => {
            const blob = (r) =>
              `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
            const aa = /形容詞|adjectif|性數|accord|比較級/.test(blob(a)) ? 1 : 0;
            const bb = /形容詞|adjectif|性數|accord|比較級/.test(blob(b)) ? 1 : 0;
            return bb - aa;
          });
        }
      } else {
        rest = all.filter((r) => {
          const blob = `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
          return blob.includes(q);
        });
        suggestions = [];
      }
    }

    if (!suggestions.length && !rest.length) {
      box.innerHTML = `<p class="projects-empty">沒有符合的規則${
        q ? "，試試其他關鍵字" : "。可用上方「建立新規則」用選取字建卡。"
      }</p>`;
      return;
    }

    const itemHtml = (r, extra = {}) => {
      const reason =
        extra.reason
          ? `<p class="rule-pick-reason">${esc(extra.reason)}</p>`
          : "";
      const tierBadge =
        extra.tier === "strong"
          ? `<span class="badge badge-rule-suggest">高相關</span>`
          : extra.suggest
            ? `<span class="badge badge-rule-suggest">建議</span>`
            : "";
      return `
        <li class="rule-pick-item${extra.suggest ? " rule-pick-item-suggest" : ""}">
          <div class="rule-pick-main">
            <p class="rule-pick-title">${tierBadge}${esc(r.title)}</p>
            <p class="rule-pick-meta muted">${esc(r.category || "未分類")}${
              extra.score != null ? ` · 相關 ${extra.score}` : ""
            }</p>
            ${reason}
          </div>
          <button type="button" class="btn btn-sm btn-primary" data-pick-rule="${esc(r.id)}">套用</button>
        </li>`;
    };

    const hintParts = [];
    if (adjNote) hintParts.push(adjNote);
    if (rankMeta?.fragile && selText && !q) {
      hintParts.push("選取較短或像詞尾，僅顯示完整形／關鍵詞／盤點對齊的強建議");
    }
    if (rankMeta?.alignedCount > 0 && selText && !q) {
      hintParts.push(`已對齊 ${rankMeta.alignedCount} 筆 API 盤點片段`);
    }
    const vp = rankMeta?.verb;
    if (vp && selText && !q) {
      if (vp.isInfinitive) {
        hintParts.push(
          vp.hasVocabCard
            ? `不定式：選取＝單字卡原形「${vp.lemma || vp.infinitive}」`
            : `判為不定式「${vp.infinitive || selText}」`
        );
        if (vp.irregular) hintParts.push(`不規則原形 ${vp.infinitive || vp.irreg || ""}`);
      } else {
        if (vp.lemma || vp.infinitive) {
          hintParts.push(`原形 ${vp.lemma || vp.infinitive}（變位形）`);
        }
        if (vp.irregular || rankMeta?.irreg) {
          hintParts.push(`不規則 ${vp.infinitive || rankMeta.irreg}`);
        }
        if (vp.tense && vp.tense !== "infinitif") hintParts.push(`時態 ${vp.tense}`);
        if (vp.group) hintParts.push(vp.group);
      }
      if (vp.confident || rankMeta?.verbFilter) {
        hintParts.push("已排除冠詞／代詞等非動詞規則");
      }
    } else if (rankMeta?.irreg && selText && !q) {
      hintParts.push(`偵測不規則動詞 ${rankMeta.irreg}，通則詞尾已降權`);
    }
    const adjBanner = hintParts.length
      ? `<p class="panel-note rule-pick-adj-hint">${esc(hintParts.join(" · "))}</p>`
      : "";

    const suggestBlock =
      suggestions.length > 0
        ? `<div class="rule-pick-section">
            <h3 class="rule-pick-section-title">依選取「${esc(selText)}」建議</h3>
            <ul class="rule-pick-ul rule-pick-ul-suggest">${suggestions
              .map((s) =>
                itemHtml(s.rule, {
                  suggest: true,
                  tier: s.tier,
                  score: s.score,
                  reason: (s.reasons || []).slice(0, 2).join(" · "),
                })
              )
              .join("")}</ul>
          </div>`
        : selText && !q
          ? `<p class="panel-note rule-pick-no-suggest">${
              rankMeta?.fragile
                ? "短選取沒有完整形／關鍵詞命中。請選完整詞，或從下方列表搜尋規則名。"
                : "沒有高分建議，可從下方完整列表選擇或搜尋。"
            }</p>`
          : "";

    const restLimit = 80;
    const restSlice = rest.slice(0, restLimit);
    const restBlock =
      restSlice.length > 0
        ? `<div class="rule-pick-section">
            ${
              suggestions.length
                ? `<h3 class="rule-pick-section-title">其他規則</h3>`
                : ""
            }
            <ul class="rule-pick-ul">${restSlice.map((r) => itemHtml(r)).join("")}</ul>
            ${
              rest.length > restLimit
                ? `<p class="panel-note">僅顯示前 ${restLimit} 筆，請縮小搜尋。</p>`
                : ""
            }
          </div>`
        : "";

    box.innerHTML = adjBanner + suggestBlock + restBlock;

    box.querySelectorAll("[data-pick-rule]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rule = RulesService.getById(btn.dataset.pickRule);
        if (!rule) return;
        if (state.rulePickMode === "supplementary") {
          closeRulePickModal();
          addSupplementaryRuleToCurrent(rule);
          return;
        }
        const cap = state.selApply;
        if (!cap) return;
        closeRulePickModal();
        addRuleToCurrentResult(rule, cap.text, cap.start, cap.end);
        state.selApply = null;
        window.getSelection()?.removeAllRanges();
      });
    });
  }

  async function requestApiVocab(form) {
    const qVocab =
      typeof Storage.stripEnglishFromVocabQuery === "function"
        ? Storage.stripEnglishFromVocabQuery(form)
        : String(form || "").trim();
    const hasTarget =
      typeof Storage.vocabQueryHasTargetLanguage === "function"
        ? Storage.vocabQueryHasTargetLanguage(qVocab)
        : Boolean(qVocab);
    if (!hasTarget) {
      return { summary: "", translation: "", items: [], vocab: [] };
    }
    if (typeof AiService.inventoryVocabOnly === "function") {
      return await AiService.inventoryVocabOnly(qVocab);
    }
    return await AiService.inventoryGrammar(qVocab, []);
  }

  /** 以全域單字庫補本句 vocab */
  function prepareInventoryVocab(inventory, query) {
    if (!inventory) return inventory;
    const q = String(query || state.lastQuery || "");
    if (typeof Storage.mergeVocabWithBank === "function") {
      inventory.vocab = Storage.mergeVocabWithBank(
        Array.isArray(inventory.vocab) ? inventory.vocab : [],
        q
      );
    } else if (!Array.isArray(inventory.vocab)) {
      inventory.vocab = [];
    }
    // 純單字且庫裡有整詞、但列表仍空 → 強制補一筆
    const isWord =
      q &&
      !(RulesService.isMultiWordQuery && RulesService.isMultiWordQuery(q));
    if (
      isWord &&
      !(inventory.vocab || []).length &&
      typeof Storage.lookupVocabBank === "function"
    ) {
      const hit = Storage.lookupVocabBank(q.trim());
      if (hit && String(hit.gloss || "").trim()) {
        inventory.vocab = [
          {
            surface: hit.surface || q.trim(),
            lemma: hit.lemma || "",
            gloss: hit.gloss || "",
            pos: hit.pos || "",
            gender: hit.gender || "",
            verbGroup: hit.verbGroup || "",
            phonetic: hit.phonetic || "",
            fromBank: true,
            source: "local-bank",
          },
        ];
      }
    }
    if (typeof Storage.filterEnglishVocab === "function") {
      inventory.vocab = Storage.filterEnglishVocab(inventory.vocab, q);
    }
    return inventory;
  }

  function rememberInventoryVocab(inventory, opts = {}) {
    if (
      typeof Storage.upsertVocabBankEntries === "function" &&
      inventory &&
      Array.isArray(inventory.vocab) &&
      inventory.vocab.length
    ) {
      Storage.upsertVocabBankEntries(inventory.vocab, opts);
    }
  }

  /** 合併本地掃描 + 手動／API 上色（同 ruleId+區間去重；色號依規則首次出現） */
  function mergeBoardHighlights(localHl, apiHl) {
    const localSpans = Array.isArray(localHl?.spans) ? localHl.spans : [];
    const apiSpans = Array.isArray(apiHl?.spans) ? apiHl.spans : [];
    // 手動／API 在前，本地在後；同一格以先出現為準，再補另一來源
    const ordered = [...apiSpans, ...localSpans];
    const seen = new Set();
    const colorByRule = new Map();
    let colorIdx = 0;
    const spans = [];
    for (const sp of ordered) {
      if (!sp) continue;
      const rid = sp.ruleId || "";
      const key = `${rid}:${sp.start}:${sp.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (rid && !colorByRule.has(rid)) {
        // 優先沿用既有 color（API 與本地各自的 colorIndex）
        const prefer =
          typeof sp.color === "number"
            ? sp.color
            : typeof sp.colorIndex === "number"
              ? sp.colorIndex
              : colorIdx % 8;
        if (![...colorByRule.values()].includes(prefer) || !colorByRule.size) {
          colorByRule.set(rid, prefer);
        } else {
          colorByRule.set(rid, colorIdx % 8);
        }
        colorIdx += 1;
      }
      spans.push({
        ...sp,
        color: rid ? colorByRule.get(rid) ?? 0 : sp.color ?? 0,
      });
    }

    const legendMap = new Map();
    for (const h of [...(apiHl?.legend || []), ...(localHl?.legend || [])]) {
      if (!h?.ruleId || legendMap.has(h.ruleId)) continue;
      legendMap.set(h.ruleId, {
        ...h,
        owned: h.owned !== false,
        color: colorByRule.has(h.ruleId) ? colorByRule.get(h.ruleId) : h.color ?? h.colorIndex ?? 0,
        hasSpan: spans.some((s) => s.ruleId === h.ruleId),
      });
    }
    // 僅有 span、圖例漏列的規則
    for (const sp of spans) {
      if (!sp.ruleId || legendMap.has(sp.ruleId)) continue;
      legendMap.set(sp.ruleId, {
        owned: true,
        ruleId: sp.ruleId,
        ruleTitle: sp.ruleTitle || "",
        name: sp.ruleTitle || "",
        color: sp.color ?? 0,
        hasSpan: true,
      });
    }
    return {
      spans,
      legend: Array.from(legendMap.values()),
      colorByRule,
    };
  }

  function lookupStoredTranslation(query) {
    const q = String(query || "").trim();
    if (!q) return "";
    const key = normalizeLookupKey(q);
    const pid = typeof Storage.getActiveProjectId === "function" ? Storage.getActiveProjectId() : "";
    if (pid && typeof Storage.findProjectEntryByQuery === "function") {
      const t = String(Storage.findProjectEntryByQuery(pid, q)?.translation || "").trim();
      if (t) return t;
    }
    const hist = typeof Storage.loadHistory === "function" ? Storage.loadHistory() : [];
    const h = hist.find((x) => normalizeLookupKey(x?.query) === key);
    return String(h?.translation || "").trim();
  }

  function keepExistingTranslation(query, inventory, opts = {}) {
    if (!inventory || opts.replaceTranslation) return inventory;
    const stored = lookupStoredTranslation(query);
    if (stored) inventory.translation = stored;
    return inventory;
  }

  /**
   * 渲染查詢結果。
   * @returns {object|null} inventory 時回傳 buildApiHighlight 結果（A1：只算一次，供寫歷史／專案重用）
   */
  function renderHybridLookup(query, localResult, inventory, opts = {}) {
    const box = $("#lookup-result");
    if (!box) return null;
    stopGramHlCycles();

    if (inventory) {
      keepExistingTranslation(query, inventory, opts);
      prepareInventoryVocab(inventory, query);
    }

    // 以查詢本身判斷整句／單詞（勿因關閉本地時 localDisabled 把單字誤判成整句）
    const isSentence = Boolean(
      RulesService.isMultiWordQuery && RulesService.isMultiWordQuery(query)
    );
    const localHl = localHighlightFromSearch(localResult, query);
    const hasLocal = (localResult?.matches || []).length > 0 || (localHl.spans || []).length > 0;
    const analysis =
      !hasLocal && !isSentence && query
        ? Analyzer.analyze(query)
        : localResult?.analysis || null;

    const lookupModes =
      typeof Storage.loadLookupModes === "function" ? Storage.loadLookupModes() : {};
    const invSrc = String(inventory?.source || "");
    const useLocalGrammar =
      inventory?.mode === "local" ||
      invSrc === "local" ||
      invSrc.startsWith("local");

    // A1：同一輪渲染只算一次 highlight
    const apiHl = inventory ? buildApiHighlight(query, inventory) : null;
    // 本地掃描 + 手動套用／API 必須合併，否則套用後畫面不更新
    const mergedHl = mergeBoardHighlights(localHl, apiHl);
    const boardSpans = mergedHl.spans;
    const boardLegend = mergedHl.legend;
    const hasManualOrApiSpans = (apiHl?.spans || []).length > 0;
    const boardIsLocal = useLocalGrammar && (localHl.spans || []).length > 0 && !hasManualOrApiSpans;
    const boardLabel = (() => {
      if (opts.apiLoading && lookupModes.apiVocab && useLocalGrammar) {
        return "查詢內容 · 本地規則 · API 單字查詢中…";
      }
      if (opts.apiLoading && !useLocalGrammar) return "查詢內容 · 盤點中…";
      if (useLocalGrammar && hasManualOrApiSpans) return "查詢內容 · 本地＋本句套用";
      if (useLocalGrammar) return "查詢內容 · 本地規則標記";
      return undefined; // 預設 API 已收錄標記
    })();

    // sticky 列：句子上色板（含圖例）固定在頂欄下方
    let pinHtml = "";
    const vocabForBoard = inventory?.vocab || [];
    if (isSentence) {
      if (boardSpans.length || boardLegend.length || vocabForBoard.length || (inventory && apiHl)) {
        pinHtml = apiSentenceBoardHtml(
          query,
          boardSpans,
          boardLegend,
          vocabForBoard,
          {
            local: boardIsLocal || (useLocalGrammar && hasManualOrApiSpans),
            label: boardLabel,
            inventory,
          }
        );
        if (opts.apiLoading && !boardSpans.length) {
          // 載入中且尚無本地上色：補提示
          pinHtml = pinHtml.replace(
            "</p>\n        <ul class=\"sentence-legend\"",
            `<p class="panel-note" style="margin:0.4rem 0 0">盤點中…</p>\n        <ul class="sentence-legend"`
          );
        }
      } else if (query) {
        // 本地／載入中：也要 id=sentence-text，否則選字套用無反應
        pinHtml = `<div class="sentence-board" id="sentence-board">
          <p class="sentence-label"><span class="sentence-label-main">查詢內容</span></p>
          ${sentenceTextBlockHtml(esc(query))}
          <p class="sentence-edit-hint">選取文字可<strong>套用規則</strong>或<strong>建立新規則</strong>；右側<strong>+補充</strong>加入不句中上色的補充用法。</p>
          ${
            opts.apiLoading
              ? `<p class="panel-note" style="margin:0.4rem 0 0">盤點中…</p>`
              : ""
          }
          <ul class="sentence-legend" aria-label="補充用法">
            <li class="legend-item legend-item-add">
              <button type="button" class="btn-legend-add" data-add-supplementary title="加入補充用法（不句中上色）">+補充</button>
            </li>
          </ul>
          ${inventory ? sentenceTranslationHtml(inventory) : ""}
        </div>`;
      }
    } else if (query) {
      // 單詞：本地命中上色，或 API 詞彙 hover
      if (boardSpans.length || vocabForBoard.length || (apiHl && (apiHl.spans || []).length)) {
        pinHtml = apiSentenceBoardHtml(
          query,
          boardSpans,
          boardLegend,
          vocabForBoard,
          {
            local: boardIsLocal || (useLocalGrammar && hasManualOrApiSpans),
            label: useLocalGrammar
              ? hasManualOrApiSpans
                ? "查詢 · 單詞 · 本地＋本句套用"
                : "查詢 · 單詞 · 本地規則"
              : "查詢 · 單詞",
            inventory,
          }
        );
      } else {
        pinHtml = `<div class="sentence-board" id="sentence-board">
          <p class="sentence-label"><span class="sentence-label-main">查詢 · 單詞</span></p>
          ${sentenceTextBlockHtml(esc(query))}
          <p class="sentence-edit-hint">選取文字可<strong>套用規則</strong>或<strong>建立新規則</strong>；右側<strong>+補充</strong>加入不句中上色的補充用法。</p>
          ${
            opts.apiLoading
              ? `<p class="panel-note" style="margin:0.4rem 0 0">API 查詢中…</p>`
              : ""
          }
          <ul class="sentence-legend" aria-label="補充用法">
            <li class="legend-item legend-item-add">
              <button type="button" class="btn-legend-add" data-add-supplementary title="加入補充用法（不句中上色）">+補充</button>
            </li>
          </ul>
          ${inventory ? sentenceTranslationHtml(inventory) : ""}
        </div>`;
      }
    }

    // 可捲動主體（已收錄卡、尚未收錄、本地卡…）
    let bodyHtml = "";
    if (hasLocal) {
      bodyHtml += `<div class="result-banner success"><strong>找到本地規則</strong><span>${
        isSentence ? "本句" : `「${esc(localResult.form || query)}」`
      }共 ${localResult.matches?.length || localHl.ownedHits.length} 筆對應</span></div>`;
      bodyHtml += localMatchesSection(localResult);
    } else if (!isSentence && useLocalGrammar) {
      bodyHtml += noLocalMatchActions(query, analysis);
    } else if (
      !isSentence &&
      !lookupModes.apiGrammar &&
      analysis &&
      (!inventory || !(inventory.items || []).length)
    ) {
      bodyHtml += noLocalMatchActions(query, analysis);
    }

    if (inventory && apiHl) {
      // 詞彙僅句中底線 hover 顯示，不另列「詞彙結果」面板
      // 本地掃描列表與「已收錄／手動套用」分開：本地區塊只列掃描命中；
      // 手動套用必須立刻出現在已收錄面板（不可因 localSectionShown 整塊隱藏）
      const localSectionShown =
        hasLocal && (localResult?.matches || []).length > 0;
      const localRuleIds = new Set(
        (localResult?.matches || []).map((m) => m.rule?.id).filter(Boolean)
      );
      const ownedHitsForPanel = localSectionShown
        ? (apiHl.ownedHits || []).filter((h) => !localRuleIds.has(h.rule?.id))
        : apiHl.ownedHits || [];
      const ownedCount = ownedHitsForPanel.length;
      const showOwnedPanel =
        ownedCount > 0 ||
        // 即時 API 文法：即使 0 筆也顯示空殼提示
        Boolean(lookupModes.apiGrammar);

      if (showOwnedPanel) {
        // 已收錄在上，尚未收錄在下（可本句移除／手動定位）
        bodyHtml += `
          <section class="panel" id="lookup-owned-rules">
            <div class="panel-head">
              <h3>已收錄的規則</h3>
              <span class="badge badge-local">${ownedCount} 筆 · 與句中同色</span>
            </div>
            ${
              ownedCount
                ? `<p class="panel-note lookup-edit-hint">API 可能誤判。操作列：編輯 · 手動定位／重新定位 · <strong>本句移除</strong>。選字可套用／疊加規則。<strong>補充用法</strong>為琥珀標、固定在後、不句中上色。</p>
            <div class="match-list">
              ${ownedHitsForPanel
                .map((h) => {
                  const isSupp =
                    h.supplementary ||
                    h.colorIndex === "usage" ||
                    (typeof RulesService.isSupplementaryUsage === "function" &&
                      RulesService.isSupplementaryUsage(h.rule));
                  const color = isSupp
                    ? "usage"
                    : mergedHl.colorByRule?.get(h.rule?.id) ?? h.colorIndex ?? 0;
                  const unlocated = !isSupp && h.hasSpan === false;
                  const colorKey = `<div class="match-color-key" style="margin:0.35rem 0 0.15rem">
                <span class="legend-swatch gram-hl-${color}"></span>
                <span class="muted" style="font-size:0.85rem">${
                  isSupp
                    ? "補充用法 · 不句中上色"
                    : unlocated
                    ? "句中未定位 — 用下方「手動定位」"
                    : `句中第 ${h.order ?? "—"} 色`
                }</span>
              </div>`;
                  return ruleCardHtml(h.rule, {
                    mode: "lookup",
                    badge: "本句已套用",
                    colorIndex: color,
                    hasSpan: isSupp ? null : h.hasSpan === true,
                    extra:
                      colorKey +
                      (h.notes?.length
                        ? `<p class="muted" style="font-size:0.85rem;margin-top:0.25rem">命中：${esc(
                            h.notes.join(" · ")
                          )}</p>`
                        : ""),
                  });
                })
                .join("")}
            </div>`
                : `<p class="panel-note">本句尚無已套用的筆記本規則。可在上方<strong>選取文字</strong>後「套用規則」手動加上。</p>`
            }
          </section>`;
      }
      // 翻譯／尚未收錄：有 API 盤點或歷史快照時都要顯示（歷史 local 快照勿只留翻譯）
      const isPureLocalPass =
        useLocalGrammar &&
        localSectionShown &&
        !(inventory.items || []).some(
          (it) => it && it.source !== "local" && it.source !== "manual"
        ) &&
        !(apiHl.missingItems || []).length;
      if (!isPureLocalPass) {
        bodyHtml += missingInventoryHtml(inventory, apiHl.missingItems);
      }
    } else if (opts.apiLoading) {
      bodyHtml += `
        <section class="panel" id="api-inventory-slot">
          <div class="panel-head">
            <h3>查詢中</h3>
            <span class="badge badge-api-fallback">請稍候…</span>
          </div>
          <p class="panel-note">正在呼叫 API…</p>
        </section>`;
    } else if (opts.apiError) {
      bodyHtml += `
        <section class="panel" id="api-inventory-slot">
          <div class="result-banner error" style="margin:0">
            <strong>查詢失敗</strong>
            <span>${esc(opts.apiError)}</span>
          </div>
          <p class="panel-note">可到設定檢查 API Key。</p>
        </section>`;
    } else if (Storage.isApiLookupEnabled() && !Storage.hasApiKey()) {
      bodyHtml += `
        <section class="panel" id="api-inventory-slot">
          <div class="panel-head">
            <h3>API 查詢</h3>
            <span class="badge">未設定</span>
          </div>
          <p class="panel-note">
            目前模式需要 <strong>API Key</strong>。請到設定填入。
          </p>
        </section>`;
    }

    // 外層 stack 含下方列表高度，sticky 才不會「捲過就消失」
    let stackInner = pinHtml + `<div class="lookup-result-body">${bodyHtml}</div>`;

    box.innerHTML = `<div class="lookup-result-stack">${stackInner}</div>`;
    bindLookupResultEvents(query, inventory, analysis);
    bindWordTipHovers(box);
    startGramHlCycles(box);
    if (state.locateTarget) updateLocateModeBar();
    syncAppHeaderHeight();
    return apiHl;
  }

  async function fetchLookupInventory(query) {
    const form = String(query || "").trim();
    const modes = Storage.loadLookupModes();
    const anyMode = modes.apiGrammar || modes.apiVocab;
    const needApi = modes.apiGrammar || modes.apiVocab;
    const isMulti =
      RulesService.isMultiWordQuery && RulesService.isMultiWordQuery(form);
    const localResult = {
      form,
      mode: isMulti ? "sentence" : "single",
      matches: [],
      localDisabled: Boolean(isMulti),
      analysis:
        !isMulti && typeof Analyzer !== "undefined" ? Analyzer.analyze(form) : null,
    };

    if (!anyMode) {
      const inventory = {
        summary: "手動模式",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
      };
      keepExistingTranslation(form, inventory);
      return { inventory, localResult: emptyLocalResult(form) };
    }
    if (needApi && !Storage.hasApiKey()) {
      const err = new Error("此模式需要 API Key，請先到「設定」填入");
      err.code = "NEED_API_KEY";
      throw err;
    }

    const wantApiVocab = Boolean(modes.apiVocab);
    const wantApiGrammar = Boolean(modes.apiGrammar);
    let inventory;

    if (wantApiGrammar) {
      const titles = RulesService.getAll().map((r) => r.title);
      inventory = await AiService.inventoryGrammar(form, titles);
      if (!wantApiVocab) {
        inventory.vocab = [];
      }
    } else if (wantApiVocab) {
      inventory = await requestApiVocab(form);
      inventory.items = [];
    } else {
      inventory = { summary: "", translation: "", items: [], vocab: [] };
    }

    if (!wantApiGrammar && wantApiVocab) {
      inventory.items = [];
      inventory.summary =
        inventory.summary || `API 單字查詢：${(inventory.vocab || []).length} 詞`;
    }

    keepExistingTranslation(form, inventory);
    return { inventory, localResult };
  }

  async function runLookup(forcedQuery) {
    if (state.bulkImport?.running) {
      if (isViewingBulkProject()) {
        showToast("此專案正在整批分析，可用 ← → 或「句子列表」先看已完成的句子", "info");
      } else {
        showToast("另有專案正在整批分析。可先看目前專案已有句子，或按提示列回到分析中的專案", "info");
      }
      return;
    }
    const input = $("#lookup-input");
    const query = (forcedQuery != null ? forcedQuery : input?.value || "").trim();
    if (!query) {
      showToast("請輸入查詢內容", "error");
      return;
    }
    if (input) input.value = query;
    state.lastQuery = query;

    const modes = Storage.loadLookupModes();
    const anyMode = modes.apiGrammar || modes.apiVocab;
    // 未開啟任何掃描：仍可查詢、顯示句子，供選字套用／補充用法
    if (!anyMode) {
      const emptyLocal = {
        form: query,
        mode: "sentence",
        matches: [],
        localDisabled: true,
        analysis: null,
      };
      const inventory = {
        summary: "手動模式",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
      };
      state.lastSearch = emptyLocal;
      state.lastInventory = inventory;
      renderHybridLookup(query, emptyLocal, inventory);
      showToast("已顯示句子 · 可選字套用規則（未開啟掃描模式）", "info");
      return;
    }

    const needApi = modes.apiGrammar || modes.apiVocab;
    const isMulti =
      RulesService.isMultiWordQuery && RulesService.isMultiWordQuery(query);

    const localResult = {
      form: query,
      mode: isMulti ? "sentence" : "single",
      matches: [],
      localDisabled: Boolean(isMulti),
      analysis: !isMulti && typeof Analyzer !== "undefined" ? Analyzer.analyze(query) : null,
    };
    state.lastSearch = localResult;
    state.lastInventory = null;

    if (needApi && !Storage.hasApiKey()) {
      renderHybridLookup(query, localResult, null);
      showToast("此模式需要 API Key，請先到「設定」填入", "error");
      setView("settings");
      return;
    }

    renderHybridLookup(query, localResult, null, { apiLoading: true });

    const myToken = ++state.lookupToken;
    state.lookupBusy = true;
    state.pendingLookupQuery = query;
    state.pendingLookupLocalResult = localResult;
    updateBackgroundLookupBanner();

    try {
      // 不需要 API 文法時走輕量單字請求（不傳規則標題、不產文法 i）
      // API 單字：不論詞庫覆蓋率，每句都整句查詢
      const wantApiVocab = Boolean(modes.apiVocab);
      const wantApiGrammar = Boolean(modes.apiGrammar);
      let inventory;

      if (wantApiGrammar) {
        const titles = RulesService.getAll().map((r) => r.title);
        inventory = await AiService.inventoryGrammar(query, titles);
        if (!wantApiVocab) {
          inventory.vocab = [];
        }
      } else if (wantApiVocab) {
        inventory = await requestApiVocab(query);
        inventory.items = [];
      } else {
        inventory = { summary: "", translation: "", items: [], vocab: [] };
      }

      if (!wantApiGrammar && wantApiVocab) {
        inventory.items = [];
        inventory.summary =
          inventory.summary || `API 單字查詢：${(inventory.vocab || []).length} 詞`;
      }

      const stillMine = myToken === state.lookupToken;
      const stillViewing = stillMine && isViewingLookupQuery(query);

      if (stillViewing) {
        state.lastInventory = inventory;
        const apiHl =
          renderHybridLookup(query, localResult, inventory) ||
          buildApiHighlight(query, inventory);
        const { before, after, activePid } = persistLookupPayload(
          query,
          inventory,
          apiHl,
          localResult,
          { keepCursor: false }
        );
        const vCount = (inventory.vocab || []).length;
        const iCount = (inventory.items || []).length;
        if (activePid) {
          if (before) {
            showToast(`已更新第 ${after?.seq} 號快照（序號不變）`, "success");
          } else {
            showToast(`已加入專案第 ${after?.seq} 號`, "success");
          }
        } else {
          const bits = [];
          if (wantApiGrammar) bits.push(`文法 ${iCount}`);
          if (wantApiVocab || vCount) bits.push(`詞彙 ${vCount}`);
          showToast(
            bits.length
              ? `查詢完成 · ${bits.join(" · ")}`
              : "查詢完成",
            vCount || iCount || (localResult.matches || []).length ? "success" : "info"
          );
        }
      } else {
        // 使用者已切到其他已查過句子：只寫入儲存，不覆寫畫面
        const apiHl = buildApiHighlight(query, inventory);
        const { activePid } = persistLookupPayload(query, inventory, apiHl, localResult, {
          keepCursor: true,
        });
        if (stillMine) {
          const where = activePid ? "專案" : "歷史";
          const vocabNote = inventory.vocab?.length ? ` · 詞彙 ${inventory.vocab.length}` : "";
          showToast(
            `「${truncateQueryPreview(query)}」查詢完成，已存入${where}${vocabNote}`,
            "success"
          );
        }
      }
    } catch (err) {
      const stillMine = myToken === state.lookupToken;
      if (stillMine && isViewingLookupQuery(query)) {
        renderHybridLookup(query, localResult, null, {
          apiError: err.message || "未知錯誤",
        });
      }
      if (stillMine) {
        showToast(err.message || "API 失敗", "error");
      }
    } finally {
      clearPendingLookup(myToken);
    }
  }

  /* —— Data IO（規則 + 專案） —— */
  function exportRules() {
    const json =
      typeof Storage.exportDataJSON === "function"
        ? Storage.exportDataJSON(RulesService.getAll())
        : Storage.exportRulesJSON(RulesService.getAll());
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lugus-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const nProj =
      typeof Storage.listProjects === "function" ? Storage.listProjects().length : 0;
    showToast(
      `已匯出：規則 ${RulesService.getAll().length} 筆` + (nProj ? ` · 專案 ${nProj} 個` : ""),
      "success"
    );
  }

  function importRules(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        if (typeof Storage.importDataJSON === "function") {
          const result = Storage.importDataJSON(text, "merge");
          RulesService.setAll(result.rules || []);
          updateRuleCount();
          updateProjectModeUI();
          let msg = `規則 ${result.rules?.length ?? 0} 筆`;
          if (result.projects) {
            msg += ` · 專案 +${result.projects.added}/覆寫 ${result.projects.updated}`;
          } else if (result.kind === "rules-only" || result.kind === "rules-bundle") {
            msg += "（無專案資料）";
          }
          showToast(`已合併匯入：${msg}`, "success");
          if (result.projects && typeof Storage.flushProjects === "function") {
            Storage.flushProjects().catch((err) => console.warn("[import flush]", err));
          }
        } else {
          const merged = Storage.importRulesJSON(text, "merge");
          RulesService.setAll(merged);
          showToast(`已匯入，目前共 ${merged.length} 筆規則`, "success");
          updateRuleCount();
        }
        if (state.view === "rules") renderRulesList();
      } catch (err) {
        showToast("匯入失敗：" + err.message, "error");
      }
    };
    reader.readAsText(file);
  }

  function renderVocabBankList() {
    const box = $("#vocab-bank-list");
    const countEl = $("#vocab-bank-count");
    if (!box) return;
    const filterQ = String($("#vocab-bank-filter")?.value || "").trim();
    const list =
      typeof Storage.listVocabBankEntries === "function"
        ? Storage.listVocabBankEntries(filterQ)
        : [];
    if (countEl) {
      countEl.textContent = filterQ
        ? `篩選後 ${list.length} 筆 · 本地單字會自動套用到新句子`
        : `共 ${list.length} 筆 · 手改會寫入詞庫；多義可設主要義或刪義項`;
    }
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><p>${
        filterQ
          ? "沒有符合的單字。"
          : "單字本還是空的。<br/>查詢並編輯單字後會自動累積；或先做一次 API 單字查詢。"
      }</p></div>`;
      return;
    }
    box.innerHTML = `<ul class="vocab-bank-list">${list
      .map((e) => {
        const senses = Array.isArray(e.senses) ? e.senses : [];
        const senseHtml = senses
          .map((s) => {
            const isP = s.id === e.primarySenseId;
            return `<li class="vocab-bank-sense${isP ? " is-primary" : ""}">
              <span class="vocab-bank-sense-gloss">${esc(s.gloss || "（無意思）")}</span>
              ${s.lemma ? `<span class="muted"> · ${esc(s.lemma)}</span>` : ""}
              ${isP ? `<span class="badge badge-local">主要</span>` : ""}
              <span class="vocab-bank-sense-actions">
                ${
                  !isP
                    ? `<button type="button" class="btn btn-sm btn-ghost" data-vb-primary="${esc(
                        e.key
                      )}" data-sense-id="${esc(s.id)}">設為主要</button>`
                    : ""
                }
                <button type="button" class="btn btn-sm btn-danger-ghost" data-vb-del-sense="${esc(
                  e.key
                )}" data-sense-id="${esc(s.id)}">刪義項</button>
              </span>
            </li>`;
          })
          .join("");
        return `<li class="vocab-bank-item" data-key="${esc(e.key)}">
          <div class="vocab-bank-main">
            <p class="vocab-bank-surface"><span class="pos-line" data-pos-kind="${esc(
              posUnderlineKind(e.pos)
            )}" data-lemma="${esc(e.lemma || "")}" title="${
              e.lemma ? esc(`點擊複製並朗讀原形「${e.lemma}」`) : ""
            }">${esc(e.surface || e.key)}</span>${
              e.senseCount > 1
                ? `<span class="badge badge-api-fallback">${e.senseCount} 義</span>`
                : ""
            }</p>
            <p class="vocab-bank-meta muted">${e.lemma ? `原形 ${esc(e.lemma)} · ` : ""}${
              e.pos ? esc(e.pos) : ""
            }${e.gender ? ` · ${esc(e.gender)}` : ""}${
              e.phonetic ? ` · ${esc(e.phonetic)}` : ""
            }</p>
            <p class="vocab-bank-gloss">${esc(e.gloss || "—")}</p>
            ${senses.length > 1 ? `<ul class="vocab-bank-senses">${senseHtml}</ul>` : ""}
          </div>
          <div class="vocab-bank-actions">
            <button type="button" class="btn btn-sm btn-danger-ghost" data-vb-delete="${esc(
              e.key
            )}">刪除詞</button>
          </div>
        </li>`;
      })
      .join("")}</ul>`;
    box.querySelectorAll(".vocab-bank-surface .pos-line[data-lemma]").forEach((el) => {
      if (!String(el.dataset.lemma || "").trim()) return;
      el.addEventListener("click", () => copyLemmaToClipboard(el.dataset.lemma));
    });
    box.querySelectorAll("[data-vb-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.vbDelete;
        if (!key || !confirm(`刪除「${key}」及其所有義項？`)) return;
        Storage.removeVocabBankEntry(key);
        renderVocabBankList();
        showToast("已刪除單字", "info");
      });
    });
    box.querySelectorAll("[data-vb-del-sense]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.vbDelSense;
        const sid = btn.dataset.senseId;
        if (!key || !sid) return;
        Storage.removeVocabBankSense(key, sid);
        renderVocabBankList();
        showToast("已刪除義項", "info");
      });
    });
    box.querySelectorAll("[data-vb-primary]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.vbPrimary;
        const sid = btn.dataset.senseId;
        if (!key || !sid) return;
        Storage.setVocabBankPrimarySense(key, sid);
        renderVocabBankList();
        showToast("已設為主要義項", "success");
      });
    });
  }

  function bindEvents() {
    bindPadChrome();
    document.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-pos-toggle]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      togglePosUnderline(btn.dataset.posToggle);
    });
    $$(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.action === "projects") {
          onNavProjects();
          return;
        }
        const v = btn.dataset.view;
        if (v && v !== "form") setView(v);
      });
    });

    $("#lookup-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      runLookup();
    });

    // Enter 查詢；Shift+Enter 換行
    $("#lookup-input")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      if (e.shiftKey) return;
      e.preventDefault();
      const form = $("#lookup-form");
      if (form?.requestSubmit) form.requestSubmit();
      else runLookup();
    });
    $("#lookup-input")?.addEventListener("input", () => {
      if (isProjectMode()) updateProjectModeUI();
      if (state.lookupBusy) updateBackgroundLookupBanner();
    });

    $("#btn-new-rule")?.addEventListener("click", () => openForm());
    $("#vocab-bank-filter")?.addEventListener("input", () => renderVocabBankList());
    $("#rule-form")?.addEventListener("submit", saveForm);
    $("#btn-form-cancel")?.addEventListener("click", () => {
      if (state.aiBusy && state.aiJob?.status === "running") {
        setView(getFormReturnView());
        showToast("AI 仍在背景填寫，草稿已保留", "info");
        return;
      }
      state.editingId = null;
      state.todoSourceId = null;
      state.draft = null;
      state.pendingSelApply = null;
      state.pendingSupplementaryApply = false;
      setView(getFormReturnView());
    });
    $("#btn-ai-complete")?.addEventListener("click", () => runAiComplete());
    $("#btn-ai-job-form")?.addEventListener("click", () => returnToAiForm());
    $("#btn-ai-job-dismiss")?.addEventListener("click", () => dismissAiJobBar());
    $("#form-has-persons")?.addEventListener("change", () => togglePersonsUI());
    $("#rules-filter")?.addEventListener("input", () => renderRulesList());
    $("#btn-clear-history")?.addEventListener("click", () => clearAllHistory());
    $("#history-filter")?.addEventListener("input", () => renderHistory());
    $("#btn-lookup-seq-prev")?.addEventListener("click", () => onLookupSeqPrev());
    $("#btn-lookup-seq-next")?.addEventListener("click", () => onLookupSeqNext());

    // 專案
    $("#btn-projects-modal-close")?.addEventListener("click", () => closeProjectsModal());
    $("#projects-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeProjectsModal();
    });
    $("#btn-projects-crumb-root")?.addEventListener("click", () => {
      state.projectsBrowseId = null;
      renderProjectsList();
      $("#project-new-name")?.focus();
    });
    $("#project-mode-collection")?.addEventListener("click", () => {
      const p = Storage.getActiveProject();
      openProjectsModal({ browseId: p ? p.collectionId || "" : null });
    });
    bindCollectionCrumbRename();
    $("#btn-project-create")?.addEventListener("click", () => createProjectFromModal());
    $("#project-new-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createProjectFromModal();
      }
    });
    bindProjectNameEdit();
    $("#btn-project-leave")?.addEventListener("click", () => leaveProject());
    $("#btn-project-entries")?.addEventListener("click", () => openProjectEntriesModal());
    $("#project-bulk-input")?.addEventListener("input", () => updateBulkImportHint());
    $("#btn-project-bulk-split")?.addEventListener("click", () => applyBulkSentenceBreaks());
    $("#btn-project-bulk-split-comma")?.addEventListener("click", () => applyBulkCommaBreaks());
    $("#btn-project-bulk-run")?.addEventListener("click", () => runProjectBulkImport());
    $("#btn-project-bulk-cancel")?.addEventListener("click", () => cancelProjectBulkImport());
    $("#btn-project-bulk-clear")?.addEventListener("click", () => {
      const ta = $("#project-bulk-input");
      if (ta) ta.value = "";
      updateBulkImportHint();
      ta?.focus();
    });
    $("#btn-project-entries-modal-close")?.addEventListener("click", () =>
      closeProjectEntriesModal()
    );
    $("#project-entries-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeProjectEntriesModal();
    });
    $("#project-entries-filter")?.addEventListener("input", () => {
      const pid = Storage.getActiveProjectId();
      if (pid) renderProjectEntriesList(pid);
    });

    // 選字／已標片段：套用規則（可疊加）
    $("#btn-sel-apply-rule")?.addEventListener("click", () => openRulePickModal());
    $("#btn-sel-vocab")?.addEventListener("click", () => openVocabEditModal());
    $("#btn-vocab-edit-close")?.addEventListener("click", () => closeVocabEditModal());
    $("#btn-vocab-edit-cancel")?.addEventListener("click", () => closeVocabEditModal());
    $("#btn-vocab-edit-ai")?.addEventListener("click", () => runVocabEditAi());
    $("#vocab-edit-form")?.addEventListener("submit", saveVocabEditForm);
    {
      const overlay = $("#vocab-edit-modal");
      let pressOnOverlay = false;
      overlay?.addEventListener("mousedown", (e) => {
        pressOnOverlay = e.target === overlay;
      });
      overlay?.addEventListener("click", (e) => {
        if (pressOnOverlay && e.target === overlay) closeVocabEditModal();
        pressOnOverlay = false;
      });
    }
    $("#btn-sel-view-rule")?.addEventListener("click", () => {
      const id = $("#btn-sel-view-rule")?.dataset?.ruleId;
      hideSelApplyPop();
      if (id) {
        const card =
          document.querySelector(`.rule-card[data-id="${CSS.escape(id)}"]`) ||
          document.getElementById("rule-" + id);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.classList.add("rule-card-flash");
          setTimeout(() => card.classList.remove("rule-card-flash"), 1200);
        } else {
          setView("rules");
          requestAnimationFrame(() => {
            const el = document.getElementById("rule-" + id);
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        }
      }
    });
    $("#btn-sel-apply-cancel")?.addEventListener("click", () => {
      hideSelApplyPop();
      state.selApply = null;
      if (state.locateTarget) {
        showToast("可再選一次片段，或按上方「取消」結束定位", "info");
      }
      window.getSelection()?.removeAllRanges();
    });
    $("#btn-rule-pick-close")?.addEventListener("click", () => closeRulePickModal());
    $("#btn-rule-pick-create")?.addEventListener("click", () => openCreateRuleFromSelection());
    $("#rule-pick-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeRulePickModal();
    });
    $("#rule-pick-filter")?.addEventListener("input", () => renderRulePickList());
    const dismissSelApplyIfOutside = (e) => {
      const pop = $("#sel-apply-pop");
      if (!pop || pop.classList.contains("hidden")) return;
      if (pop.contains(e.target)) return;
      if (e.target.closest && e.target.closest("#sentence-text, #sentence-board")) {
        return;
      }
      hideSelApplyPop();
    };
    document.addEventListener("pointerdown", dismissSelApplyIfOutside);
    const revealSelApplyOutsideBoard = (e) => {
      if (state.view !== "lookup") return;
      if (e.target.closest && e.target.closest("#sel-apply-pop, button, a, input, textarea")) {
        return;
      }
      if (!$("#sentence-text")) return;
      if (e.target.closest && e.target.closest("#sentence-board")) return;
      if (!shouldRevealSelApplyFromGesture()) return;
      suppressWordTipClick = true;
      const point = eventClientPoint(e);
      requestAnimationFrame(() => {
        const cap = captureSentenceSelection();
        if (!cap) return;
        if (
          state.selApply &&
          state.selApply.text === cap.text &&
          state.selApply.start === cap.start &&
          !$("#sel-apply-pop")?.classList.contains("hidden")
        ) {
          return;
        }
        state.selApply = cap;
        showSelApplyPop(point.x, point.y, cap.text, {});
      });
    };
    document.addEventListener("mouseup", revealSelApplyOutsideBoard);
    document.addEventListener("touchend", revealSelApplyOutsideBoard, { passive: true });
    let selChangeTimer = 0;
    document.addEventListener("selectionchange", () => {
      if (!isCoarsePointer() || state.view !== "lookup") return;
      if (!shouldRevealSelApplyFromGesture()) return;
      clearTimeout(selChangeTimer);
      selChangeTimer = window.setTimeout(() => {
        const cap = captureSentenceSelection();
        if (!cap) return;
        if (
          state.selApply &&
          state.selApply.text === cap.text &&
          state.selApply.start === cap.start &&
          !$("#sel-apply-pop")?.classList.contains("hidden")
        ) {
          return;
        }
        state.selApply = cap;
        let x = NaN;
        let y = NaN;
        try {
          const r = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect();
          x = r.left + r.width / 2;
          y = r.bottom;
        } catch {
          /* ignore */
        }
        showSelApplyPop(x, y, cap.text, {});
      }, 380);
    });

    document.addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-sentence-select-edit]");
      if (editBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleSentenceSelectEdit();
        return;
      }
      const btn = e.target.closest("[data-speak-sentence]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      speakCurrentSentence();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!$("#vocab-edit-modal")?.classList.contains("hidden")) {
          closeVocabEditModal();
          return;
        }
        if (!$("#rule-pick-modal")?.classList.contains("hidden")) {
          closeRulePickModal();
          return;
        }
        if (!$("#sel-apply-pop")?.classList.contains("hidden")) {
          hideSelApplyPop();
          state.selApply = null;
          return;
        }
        if (isSentenceSelectEdit()) {
          setSentenceSelectEdit(false);
          return;
        }
        if (state.locateTarget) {
          cancelLocateMode();
          showToast("已取消定位", "info");
          return;
        }
        if (!$("#project-entries-modal")?.classList.contains("hidden")) {
          closeProjectEntriesModal();
          return;
        }
        if (!$("#projects-modal")?.classList.contains("hidden")) {
          closeProjectsModal();
        }
        return;
      }

      // WASD／ZXCVBNM／方向鍵（輸入中不攔截）
      handleAppHotkeys(e);
    });

    $("#settings-form")?.addEventListener("submit", saveSettingsForm);
    $("#settings-api-tts")?.addEventListener("change", () => onApiTtsToggle());
    $("#settings-mode-api-grammar")?.addEventListener("change", () =>
      onLookupModeToggle()
    );
    $("#settings-mode-api-vocab")?.addEventListener("change", () =>
      onLookupModeToggle()
    );
    $("#btn-settings-modes-all")?.addEventListener("click", () => onSettingsModesAllClick());
    $("#btn-test-api")?.addEventListener("click", () => testApiConnection());
    $("#btn-clear-key")?.addEventListener("click", clearApiKey);
    $("#settings-api-provider")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-api-provider]");
      if (!btn) return;
      switchApiProvider(btn.dataset.apiProvider);
    });
    $("#settings-model-shortcuts")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-model-id]");
      if (!btn) return;
      applyModelShortcut(btn.dataset.modelId);
    });
    $("#btn-toggle-key")?.addEventListener("click", () => {
      const input = $("#settings-api-key");
      const btn = $("#btn-toggle-key");
      if (!input || !btn) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "隱藏" : "顯示";
    });
    $("#btn-export")?.addEventListener("click", exportRules);
    $("#btn-import")?.addEventListener("click", () => {
      const ok = confirm(
        "確定後將「合併」匯入（同 id 覆蓋規則／專案）。\n按取消則中止。\n\n可匯入：完整備份（規則+專案）、舊版規則陣列、或專案檔。"
      );
      if (ok) $("#import-file")?.click();
    });
    $("#import-file")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) importRules(file);
      e.target.value = "";
    });
    $("#btn-reset-seed")?.addEventListener("click", async () => {
      if (
        !confirm(
          "將清除所有本地規則與待辦，並重新載入種子資料。確定？（不會清除 API Key 與專案）"
        )
      )
        return;
      Storage.resetToSeed();
      await RulesService.init();
      state.lastSearch = null;
      state.lastQuery = "";
      state.lastInventory = null;
      showToast("已重設為種子資料", "success");
      setView("rules");
      renderRulesList();
      updateRuleCount();
    });
  }

  /** 量測頂欄高度，讓句中 sticky 列精準貼在下方 */
  function syncAppHeaderHeight() {
    const header = document.querySelector(".app-header");
    if (!header) return;
    const h = Math.ceil(header.getBoundingClientRect().height);
    if (h > 0) {
      document.documentElement.style.setProperty("--app-header-h", `${h}px`);
    }
  }

  async function init() {
    try {
      if (typeof Storage.initProjectsDb === "function") {
        await Storage.initProjectsDb();
      }
    } catch (err) {
      console.warn("[projects idb init]", err);
    }
    await RulesService.init();
    try {
      if (typeof Storage.harvestVocabBankFromSnapshots === "function") {
        const n = Storage.harvestVocabBankFromSnapshots();
        if (n > 0) console.info(`[vocab-bank] harvested ${n} entries`);
      }
    } catch (err) {
      console.warn("[vocab-bank] harvest failed", err);
    }
    bindEvents();
    updateLookupModeUI();
    updateApiStatusDot();
    if (Storage.getActiveProjectId()) {
      state.projectCursorSeq = null;
    }
    updateProjectModeUI();
    syncAppHeaderHeight();
    window.addEventListener("resize", () => syncAppHeaderHeight());
    setView("lookup");
    updateRuleCount();
    // 版面穩定後再量一次（與 Mal 對齊）
    requestAnimationFrame(() => syncAppHeaderHeight());
  }

  return { init, openForm };
})();

document.addEventListener("DOMContentLoaded", () => {
  App.init().catch((err) => {
    console.error(err);
    const box = document.getElementById("lookup-result");
    if (box) {
      box.innerHTML = `<div class="result-banner error"><strong>初始化失敗</strong><span>${String(
        err.message || err
      )
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</span></div>`;
    }
  });
});
