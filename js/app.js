/**
 * Lugus · 法語文法筆記本 — 主應用
 * 單詞：本地比對 · 整句：僅 API 盤點 · 歷史 · 專案（同 Mal）
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
    aiJob: null,
    gramHlCycleTimers: [],
    /** 專案模式目前游標序號（瀏覽用；與永久 seq 對應） */
    projectCursorSeq: null,
    /**
     * 選字套用規則的暫存
     * @type {null | { text: string, start: number, end: number }}
     */
    selApply: null,
    /** 單字解釋編輯中的區間 */
    vocabEditRange: null,
    /**
     * 選字「建立新規則」：儲存後自動套回此片段
     * @type {null | { text: string, start: number, end: number }}
     */
    pendingSelApply: null,
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
    const needApi = modes.apiGrammar || modes.apiVocab;
    const ready = Storage.hasApiKey();
    const anyMode = modes.apiGrammar || modes.localGrammar || modes.apiVocab;
    // 手動模式（全關）仍可用；僅「開了 API 卻沒 Key」為未就緒
    dot.classList.toggle("ready", anyMode ? (needApi ? ready : true) : true);
    if (!anyMode) {
      dot.title = "手動模式（未開掃描 · 仍可查詢）";
    } else if (!needApi) {
      dot.title = "本地文法排查（不呼叫 API）";
    } else {
      const label = Storage.formatLookupModesLabel(modes);
      dot.title = ready ? `${label} · Key 已設定` : `${label} · 尚未設定 Key`;
    }
  }

  function updateLookupModeUI() {
    const modes = Storage.loadLookupModes();
    const desc = $("#lookup-mode-desc");
    if (desc) {
      const bits = [];
      if (modes.apiGrammar) bits.push("<strong>API 文法</strong>");
      if (modes.localGrammar) bits.push("<strong>本地文法</strong>");
      if (modes.apiVocab) bits.push("<strong>API 單字</strong>");
      if (!bits.length) {
        const empty =
          "目前：手動模式 · 可直接查詢並選字套用（右側可再開 API／本地掃描）";
        desc.innerHTML = empty;
        desc.title = empty;
      } else {
        const needKey = modes.apiGrammar || modes.apiVocab;
        const line =
          `目前：${bits.join(" · ")}` +
          (needKey ? " · 需 API Key" : " · 無需 API Key") +
          " · 可選字套用／本句移除";
        desc.innerHTML = line;
        desc.title = line.replace(/<\/?strong>/g, "");
      }
    }
    const apiG = $("#settings-mode-api-grammar");
    const localG = $("#settings-mode-local-grammar");
    const apiV = $("#settings-mode-api-vocab");
    if (apiG) apiG.checked = Boolean(modes.apiGrammar);
    if (localG) localG.checked = Boolean(modes.localGrammar);
    if (apiV) apiV.checked = Boolean(modes.apiVocab);
    const keyReq = $("#settings-api-key-req");
    if (keyReq) keyReq.hidden = !(modes.apiGrammar || modes.apiVocab);
    syncSettingsModesAllBtn(modes);
    updateApiStatusDot();
  }

  /** 全部開啟：API 文法 + API 單字（本地關閉，因文法互斥） */
  function areAllLookupModesOn(modes) {
    const m = modes || Storage.loadLookupModes();
    return Boolean(m.apiGrammar && m.apiVocab && !m.localGrammar);
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
      // 全部開啟：API 文法 + 單字（與本地文法互斥，故關本地）
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
    if (view === "todos") renderTodos();
    if (view === "history") renderHistory();
    if (view === "settings") fillSettingsForm();
    if (view === "lookup") updateLookupModeUI();
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

  function fillSettingsForm() {
    const s = Storage.loadSettings();
    $("#settings-api-key").value = s.apiKey || "";
    $("#settings-base-url").value = s.baseUrl || Storage.DEFAULT_SETTINGS.baseUrl;
    $("#settings-model").value = s.model || Storage.DEFAULT_SETTINGS.model;
    const input = $("#settings-api-key");
    if (input) input.type = "password";
    const toggle = $("#btn-toggle-key");
    if (toggle) toggle.textContent = "顯示";
    updateLookupModeUI();
    const modes = Storage.loadLookupModes();
    const modeLabel = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (s.apiKey) {
      setSettingsStatus(
        `已設定 API Key（${maskKey(s.apiKey)}）· 模型 ${s.model} · ${modeLabel}`,
        "ok"
      );
    } else if (needApi) {
      setSettingsStatus("尚未設定 API Key — API 文法／單字與 AI 填寫無法使用", "warn");
    } else if (modes.localGrammar) {
      setSettingsStatus("本地文法排查 · 無需 Key；AI 自動填寫仍需 API Key", "ok");
    } else {
      setSettingsStatus("手動模式 · 可查詢並選字套用（未開掃描）", "ok");
    }
  }

  function readLookupModesFromForm() {
    return {
      apiGrammar: Boolean($("#settings-mode-api-grammar")?.checked),
      localGrammar: Boolean($("#settings-mode-local-grammar")?.checked),
      apiVocab: Boolean($("#settings-mode-api-vocab")?.checked),
    };
  }

  function onLookupModeToggle(changed) {
    const raw = readLookupModesFromForm();
    if (changed === "apiGrammar" && raw.apiGrammar) raw.localGrammar = false;
    if (changed === "localGrammar" && raw.localGrammar) raw.apiGrammar = false;
    const modes = Storage.saveLookupModes(raw);
    updateLookupModeUI();
    const label = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (!modes.apiGrammar && !modes.localGrammar && !modes.apiVocab) {
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
    if (raw.apiGrammar && raw.localGrammar) raw.localGrammar = false;
    const modes = Storage.saveLookupModes(raw);
    const next = Storage.saveSettings({
      apiKey: $("#settings-api-key").value,
      baseUrl: $("#settings-base-url").value,
      model: $("#settings-model").value,
      lookupModes: modes,
    });
    updateLookupModeUI();
    const modeLabel = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (next.apiKey) {
      setSettingsStatus(
        `已儲存（${maskKey(next.apiKey)}）· 模型 ${next.model} · ${modeLabel}`,
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
    Storage.saveSettings({
      apiKey: $("#settings-api-key").value,
      baseUrl: $("#settings-base-url").value,
      model: $("#settings-model").value,
    });
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
    if (!confirm("確定清除本機儲存的 API Key？")) return;
    Storage.clearApiKey();
    $("#settings-api-key").value = "";
    updateApiStatusDot();
    setSettingsStatus("API Key 已清除", "warn");
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
      box.innerHTML = `<div class="empty-state"><p>還沒有查詢紀錄。<br/>到「查詢」完成 API 盤點後會出現在這裡。</p></div>`;
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
        ? `回到專案「${project.name || "未命名"}」（離開請用查詢頁「離開專案」）`
        : "建立、開啟或管理專案（歌詞等連貫文本）";
    }

    if (inProject) {
      const nameEl = $("#project-mode-name");
      const posEl = $("#project-mode-pos");
      if (nameEl) nameEl.textContent = project.name || "未命名專案";
      const entries = Storage.getProjectEntriesSorted(project);
      const total = entries.length;
      let curSeq = state.projectCursorSeq;
      const curQ = String($("#lookup-input")?.value || "").trim();
      if (curQ) {
        const hit = Storage.findProjectEntryByQuery(project.id, curQ);
        if (hit) curSeq = hit.seq;
      }
      if (posEl) {
        if (total === 0) {
          posEl.textContent = "尚無句子 · 查詢後會編為第 1 號";
        } else if (curSeq != null && entries.some((e) => e.seq === curSeq)) {
          const idx = entries.findIndex((e) => e.seq === curSeq) + 1;
          posEl.textContent = `第 ${curSeq} 號 · ${idx}/${total} 句`;
        } else {
          posEl.textContent = `共 ${total} 句 · 查新句會接續編號`;
        }
      }
    }

    updateLookupNavBtns();
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
          const hit = Storage.findProjectEntryByQuery(project?.id, curQ);
          if (hit) curSeq = hit.seq;
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
        prevBtn.title = "上一號句子";
        prevBtn.setAttribute("aria-label", "上一號句子");
      }
      nextBtn.disabled = total === 0 || (curIdx >= 0 && curIdx >= total - 1);
      nextBtn.title = "下一號句子";
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
    nextBtn.title = has ? "再看歷史中的上一句（本機紀錄）" : "尚無查詢歷史";
    nextBtn.setAttribute("aria-label", has ? "再看歷史上一句" : "尚無查詢歷史");
  }

  function resolveProjectCursorIndex(entries) {
    if (!entries?.length) return -1;
    let curSeq = state.projectCursorSeq;
    const curQ = String($("#lookup-input")?.value || "").trim();
    if (curQ) {
      const hit = entries.find(
        (e) => Storage.normalizeQueryKey(e.query) === Storage.normalizeQueryKey(curQ)
      );
      if (hit) curSeq = hit.seq;
    }
    if (curSeq == null) return -1;
    return entries.findIndex((e) => e.seq === curSeq);
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

  /**
   * 查詢頁方向鍵導航：← 上一句 · → 下一句
   * @returns {boolean} 是否已處理
   */
  function handleLookupArrowNav(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if (state.view !== "lookup") return false;
    if (state.lookupBusy) return false;
    if (isEditableKeyTarget(e.target)) return false;
    if (!$("#vocab-edit-modal")?.classList.contains("hidden")) return false;
    if (!$("#rule-pick-modal")?.classList.contains("hidden")) return false;
    if (!$("#projects-modal")?.classList.contains("hidden")) return false;
    if (!$("#project-entries-modal")?.classList.contains("hidden")) return false;
    if (!$("#sel-apply-pop")?.classList.contains("hidden")) return false;
    if (state.locateTarget) return false;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onLookupSeqPrev();
      return true;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onLookupSeqNext();
      return true;
    }
    return false;
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

  function openProjectsModal() {
    if (Storage.getActiveProjectId()) {
      onNavProjects();
      return;
    }
    const modal = $("#projects-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    renderProjectsList();
    const input = $("#project-new-name");
    if (input) {
      input.value = "";
      setTimeout(() => input.focus(), 50);
    }
  }

  function closeProjectsModal() {
    $("#projects-modal")?.classList.add("hidden");
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
    const list = Storage.listProjects();
    const activeId = Storage.getActiveProjectId();
    if (!list.length) {
      box.innerHTML = `<p class="projects-empty">尚無專案。輸入名稱後按「建立」，適合歌詞、對話等連貫文本。</p>`;
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
      li.querySelector("[data-proj-delete]")?.addEventListener("click", () => {
        const p = Storage.getProject(id);
        if (!p) return;
        if (
          !confirm(
            `確定刪除專案「${p.name}」？\n內含 ${(p.entries || []).length} 句將一併清除（無法復原）。`
          )
        ) {
          return;
        }
        Storage.deleteProject(id);
        if (!Storage.getActiveProjectId()) {
          state.projectCursorSeq = null;
        }
        updateProjectModeUI();
        renderProjectsList();
        showToast("已刪除專案", "info");
      });
    });
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
      sub.textContent = `「${project.name}」· 共 ${all.length} 句 · 序號永久固定，刪除後不重編`;
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
    state.projectCursorSeq = null;
    closeProjectsModal();
    setView("lookup");
    updateProjectModeUI();
    const entries = Storage.getProjectEntriesSorted(p);
    if (entries.length) {
      reviewProjectEntry(entries[0], { silent: true });
      showToast(`已進入專案「${p.name}」· ${entries.length} 句`, "success");
    } else {
      const input = $("#lookup-input");
      if (input) input.value = "";
      const box = $("#lookup-result");
      if (box) box.innerHTML = "";
      showToast(`已進入專案「${p.name}」· 查詢第一句將編為第 1 號`, "success");
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
    showToast("已離開專案（一般查詢模式）", "info");
  }

  function createProjectFromModal() {
    const input = $("#project-new-name");
    const name = String(input?.value || "").trim();
    if (!name) {
      showToast("請輸入專案名稱", "error");
      input?.focus();
      return;
    }
    const p = Storage.createProject(name);
    if (input) input.value = "";
    renderProjectsList();
    showToast(`已建立「${p.name}」`, "success");
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
        : "規則名建議「中文（法語）」；動詞變位勾選六人稱";

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
      let saved;
      if (state.editingId) {
        saved = RulesService.update(state.editingId, input);
      } else {
        saved = RulesService.create(input);
      }
      const cleared = clearTodosAfterRuleSaved(input.title);
      const pendingSupp = state.pendingSupplementaryApply;
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
        state.lastSearch = RulesService.search(state.lastQuery);
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
      )}」寫入規則名（可改成「中文（法語）」格式）。儲存後會<strong>自動套用到該片段</strong>。`,
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

    const jobId = uidJob();
    const job = {
      id: jobId,
      title,
      editingId: state.editingId,
      todoSourceId: state.todoSourceId,
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
      const draft = await AiService.completeRuleFromTitle(title);
      const stillSameJob = state.aiJob && state.aiJob.id === jobId;
      if (stillSameJob) {
        state.aiJob.status = "done";
        state.editingId = job.editingId;
        state.todoSourceId = job.todoSourceId;
        if (draft.title) $("#form-title").value = draft.title;
        $("#form-explanation").value = draft.explanation || "";
        if (draft.category) fillCategorySelect(draft.category);
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
      matchedWords = [],
      extra = "",
      mode = "notebook",
      hasSpan = null,
    } = opts;

    const isSupp =
      colorIndex === "usage" ||
      (typeof RulesService.isSupplementaryUsage === "function" &&
        RulesService.isSupplementaryUsage(rule));
    const colorBadge = isSupp
      ? `<span class="badge badge-usage">補充用法</span>`
      : colorIndex != null && colorIndex !== "usage"
        ? `<span class="badge gram-badge gram-hl-${colorIndex}">色 ${Number(colorIndex) + 1}</span>`
        : "";
    const cat = rule.category
      ? `<span class="badge ${isSupp ? "badge-usage" : "badge-category"}">${esc(
          rule.category
        )}</span>`
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

    if (compact) {
      return `
        <article class="rule-card compact${tintClass}" data-id="${esc(rule.id)}" id="rule-${esc(rule.id)}">
          ${colorEdge}
          <div class="rule-card-top">
            ${badge ? `<span class="badge badge-local">${esc(badge)}</span>` : ""}
            ${cat}${colorBadge}
            <h4>${esc(rule.title)}</h4>
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

    const hitLabels = (hitPersons || []).map((h) => h.label).join("、");
    const wordsLine = matchedWords.length
      ? matchedWords.map((w) => `<code>${esc(w)}</code>`).join(" ")
      : highlightForm
        ? `<code>${esc(highlightForm)}</code>`
        : "";

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
          ${badge ? `<span class="badge badge-local">${esc(badge)}</span>` : ""}
          ${cat}${colorBadge}
          ${isLookup ? `<span class="badge badge-api-fallback">本句</span>` : ""}
          ${
            isLookup && effectiveHasSpan === false
              ? `<span class="badge badge-api-fallback">句中未定位</span>`
              : ""
          }
          <h3>${esc(rule.title)}</h3>
        </div>
        ${
          wordsLine
            ? `<div class="apply-box"><h4>句中命中</h4><p>${wordsLine}${hitLabels ? ` → ${esc(hitLabels)}` : ""}</p></div>`
            : ""
        }
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
          state.lastSearch = RulesService.search(state.lastQuery);
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
      h.needle ? `${h.ruleTitle} ← ${h.needle}` : h.ruleTitle || "";
    const stack = [
      {
        color: s.color,
        ruleId: s.ruleId,
        ruleTitle: s.ruleTitle,
        needle: s.needle,
      },
      ...(s.coHits || []),
    ];
    const multi = stack.length > 1;
    const tip = multi
      ? stack.map((h, i) => `${i + 1}. ${tipOf(h)}`).join(" ｜ ") + "（顏色輪播）"
      : tipOf(stack[0]);
    const colorsAttr = multi ? ` data-cycle-colors="${stack.map((h) => h.color).join(",")}"` : "";
    const titlesAttr = multi
      ? ` data-cycle-titles="${esc(stack.map((h) => tipOf(h)).join("\n"))}"`
      : "";
    const multiClass = multi ? " gram-hl-cycle" : "";
    const ruleIdsAttr = multi
      ? ` data-cycle-rule-ids="${stack.map((h) => h.ruleId || "").join(",")}"`
      : s.ruleId
        ? ` data-scroll-rule="${esc(s.ruleId)}"`
        : "";
    return `<mark class="gram-hl gram-hl-${stack[0].color}${multiClass}" title="${esc(
      tip
    )}"${colorsAttr}${titlesAttr}${ruleIdsAttr}>`;
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
    ]
      .filter(Boolean)
      .join(" · ");
    return `<span class="word-tip" tabindex="0" data-lemma="${esc(v.lemma)}" data-gloss="${esc(
      v.gloss
    )}" data-pos="${esc(v.pos)}" data-gender="${esc(g)}" data-verb-group="${esc(
      vg?.code || ""
    )}" data-verb-group-label="${esc(vg?.label || "")}" data-phonetic="${esc(
      ipa
    )}" data-surface="${esc(v.surface)}" title="${esc(fallbackTitle)}">`;
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

  function ensureWordTipPop() {
    let el = document.getElementById("word-tip-pop");
    if (el) return el;
    el = document.createElement("div");
    el.id = "word-tip-pop";
    el.className = "word-tip-pop hidden";
    el.setAttribute("role", "tooltip");
    document.body.appendChild(el);
    return el;
  }

  function hideWordTipPop() {
    const el = document.getElementById("word-tip-pop");
    if (el) {
      el.classList.add("hidden");
      el.innerHTML = "";
    }
  }

  function showWordTipPop(anchor, data) {
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
    pop.classList.remove("hidden");
    const rect = anchor.getBoundingClientRect();
    const pad = 8;
    let top = rect.bottom + pad + window.scrollY;
    let left = rect.left + window.scrollX;
    const pr = pop.getBoundingClientRect();
    if (left + pr.width > window.scrollX + window.innerWidth - 12) {
      left = Math.max(12, window.scrollX + window.innerWidth - pr.width - 12);
    }
    if (rect.bottom + pr.height + pad > window.innerHeight && rect.top > pr.height + pad) {
      top = rect.top + window.scrollY - pr.height - pad;
    }
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
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
      el.addEventListener("mouseenter", () => showWordTipPop(el, data));
      el.addEventListener("mouseleave", () => hideWordTipPop());
      el.addEventListener("focus", () => showWordTipPop(el, data));
      el.addEventListener("blur", () => hideWordTipPop());
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

  function apiSentenceBoardHtml(query, spans, apiLegend, vocabList) {
    const sorted = (spans || [])
      .slice()
      .sort((a, b) => a.start - b.start || b.end - a.end - (a.end - a.start));
    const used = [];
    for (const s of sorted) {
      if (s.start >= query.length || s.end > query.length || s.start >= s.end) continue;
      const hit = {
        color: s.color ?? 0,
        ruleId: s.ruleId || "",
        ruleTitle: s.ruleTitle || "",
        needle: s.needle || "",
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

    // 圖例僅句中上色的規則；補充用法不進圖例色點，改用右側「+補充」
    const legendOwned = (apiLegend || []).filter(
      (h) => h.owned && !h.supplementary && h.color !== "usage"
    );
    const legend = legendOwned
      .map(
        (h) => `
        <li class="legend-item">
          <span class="legend-swatch gram-hl-${h.color}"></span>
          <button type="button" class="legend-link" data-scroll-rule="${esc(h.ruleId)}">${esc(
          h.ruleTitle || h.name
        )}</button>
          ${!h.hasSpan ? `<span class="legend-count">（句中未定位）</span>` : ""}
        </li>`
      )
      .join("");

    const hasCycle = used.some((u) => (u.coHits || []).length > 0);
    const hasVocab = vocabLocs.length > 0;
    return `
      <div class="sentence-board" id="sentence-board">
        <div id="locate-mode-bar" class="locate-mode-bar hidden" role="status"></div>
        <p class="sentence-label">
          <span class="sentence-label-main">查詢內容 · API 已收錄標記</span>
          ${hasCycle ? `<span class="sentence-cycle-hint">共置輪播</span>` : ""}
          ${hasVocab ? `<span class="sentence-cycle-hint">滑過看原形／音標／性別</span>` : ""}
        </p>
        <p class="sentence-text" id="sentence-text">${html || esc(query)}</p>
        <p class="sentence-edit-hint">選取文字或<strong>點已上色片段</strong>可套用／疊加規則；下方規則卡可<strong>本句移除</strong>或<strong>手動定位</strong>。右側<strong>+補充</strong>可加入不句中上色的補充用法。</p>
        ${
          !used.length
            ? `<p class="panel-note" style="margin:0.5rem 0 0">尚無已收錄規則可在句中標記（未收錄見下方）。${
                hasVocab ? "滑過底線詞可看原形、性別與意思。" : ""
              } 也可選字手動套用或按 +補充。</p>`
            : ""
        }
        <ul class="sentence-legend" aria-label="句中規則與補充">
          ${legend}
          <li class="legend-item legend-item-add">
            <button type="button" class="btn-legend-add" data-add-supplementary title="加入補充用法（不句中上色）">+補充</button>
          </li>
        </ul>
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
          color,
          apiName: it.name,
          invIdx: i,
          needle: loc.needle || it.span || it.nameFr || "",
        });
      }
    }

    const firstPos = new Map();
    for (const s of spans) {
      const prev = firstPos.get(s.ruleId);
      if (prev == null || s.start < prev) firstPos.set(s.ruleId, s.start);
    }
    legend.sort((a, b) => {
      if (Boolean(a.supplementary) !== Boolean(b.supplementary)) {
        return a.supplementary ? 1 : -1;
      }
      const pa = firstPos.has(a.ruleId) ? firstPos.get(a.ruleId) : 1e9;
      const pb = firstPos.has(b.ruleId) ? firstPos.get(b.ruleId) : 1e9;
      if (pa !== pb) return pa - pb;
      return a.invIdx - b.invIdx;
    });
    const recolor = new Map();
    let ci = 0;
    for (const h of legend) {
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

  function sentenceTranslationHtml(inventory) {
    const t = String(inventory?.translation || "").trim();
    if (!t) return "";
    return `
      <div class="inv-sentence-translation">
        <span class="inv-label">翻譯</span>
        <p class="inv-sentence-text">${esc(t)}</p>
      </div>`;
  }

  function missingInventoryHtml(inventory, missingItems) {
    if (!inventory) return "";
    const list = missingItems || [];
    const sentenceTr = sentenceTranslationHtml(inventory);
    const summary = inventory.summary
      ? `<p class="panel-note">${esc(inventory.summary)}</p>`
      : "";

    if (!list.length) {
      return `
        <section class="panel panel-suggest" id="api-inventory-slot">
          <div class="panel-head">
            <h3>API 盤點 · 尚未收錄</h3>
            <span class="badge badge-owned">全部已有筆記</span>
          </div>
          ${sentenceTr}
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
        ${sentenceTr}
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
            .map((m) =>
              ruleCardHtml(m.rule, {
                highlightForm: result.form,
                hitPersons: m.hitPersons,
                badge: "本地規則",
                colorIndex: m.colorIndex ?? 0,
              })
            )
            .join("")}
        </div>
        ${
          result.partial?.length
            ? `<details class="related-block"><summary>其他可能相關（${result.partial.length}）</summary>
                <div class="match-list compact">${result.partial
                  .map((m) => ruleCardHtml(m.rule, { compact: true, badge: "相關" }))
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
        <strong>本地未比對到規則</strong>
        <span>${
          isIrreg
            ? "此為不規則動詞，須另立專屬規則（完整形六格），不可套用第一組通則詞尾"
            : "可建立規則，或等待／查看下方 API 盤點"
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
  }

  /* —— 本句手動校正（不改筆記本規則本體；對齊 Mal） —— */

  function persistCurrentInventory(opts = {}) {
    const q = String(state.lastQuery || "").trim();
    const inv = state.lastInventory;
    if (!q || !inv) return null;
    // 可傳入已算過的 apiHl，避免手動校正後再全量重算一次
    const apiHl = opts.apiHl || buildApiHighlight(q, inv);
    const payload = {
      query: q,
      summary: inv.summary || "",
      translation: inv.translation || "",
      ownedCount: (apiHl.ownedHits || []).length,
      missingCount: (apiHl.missingItems || []).length,
      localCount: (state.lastSearch?.matches || []).length,
      items: inv.items || [],
      vocab: inv.vocab || [],
    };
    const activePid = Storage.getActiveProjectId();
    if (activePid) {
      Storage.upsertProjectEntry(activePid, payload);
      const after = Storage.findProjectEntryByQuery(activePid, q);
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
    const localResult = state.lastSearch || RulesService.search(q);
    state.lastSearch = localResult;
    const apiHl = renderHybridLookup(q, localResult, inv, opts);
    persistCurrentInventory({ apiHl: apiHl || undefined });
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
      const pad = 8;
      const rect = pop.getBoundingClientRect();
      let left = clientX - rect.width / 2;
      let top = clientY + 12;
      left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));
      if (top + rect.height > window.innerHeight - pad) {
        top = clientY - rect.height - 12;
      }
      top = Math.max(pad, top);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
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

  function fillVocabEditForm(data = {}) {
    const set = (id, v) => {
      const el = $(id);
      if (el) el.value = v || "";
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
    const base = found.entry
      ? { ...found.entry }
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
        ? `<strong>編輯既有單字</strong> — 修改後按「儲存到本句」。`
        : `<strong>新增單字解釋</strong> — 可手動填寫或按「AI 填寫」。`,
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
    closeVocabEditModal();
    state.selApply = null;
    window.getSelection()?.removeAllRanges();
    refreshLookupFromInventory();
    showToast(`已寫入單字「${surface}」`, "success");
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
      host.addEventListener("mouseup", onSentenceMouseUp);
    }
  }

  function onSentenceMouseUp(e) {
    if (e.target.closest && e.target.closest("#sel-apply-pop, button, a, .sentence-legend, .locate-mode-bar")) {
      return;
    }
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
        showSelApplyPop(e.clientX, e.clientY, cap.text, { note });
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
        )}</strong> — 依選取字<strong>本地</strong>推送可能規則置頂；只影響本句，不改筆記本。`;
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

  /** 從目前盤點詞彙推估選取片段的詞性等（供規則推薦） */
  function selectionVocabHints(selText) {
    const sel = String(selText || "").trim();
    if (!sel) return { vocab: state.lastInventory?.vocab || [] };
    const vocab = state.lastInventory?.vocab || [];
    const norm = (s) =>
      String(s || "")
        .trim()
        .toLowerCase()
        .normalize("NFC");
    const n = norm(sel);
    for (const w of vocab) {
      if (norm(w.surface) === n || norm(w.lemma) === n) {
        return {
          pos: w.pos || "",
          gender: w.gender || "",
          vocab,
        };
      }
    }
    return { vocab };
  }

  function renderRulePickList() {
    const box = $("#rule-pick-list");
    if (!box) return;
    const q = String($("#rule-pick-filter")?.value || "")
      .trim()
      .toLowerCase();
    const suppMode = state.rulePickMode === "supplementary";
    const selText = suppMode ? "" : String(state.selApply?.text || "").trim();
    const hints = selectionVocabHints(selText);

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
    if (selText && typeof RulesService.rankRulesForSpan === "function" && !q) {
      const ranked = RulesService.rankRulesForSpan(selText, {
        minScore: 8,
        maxSuggest: 8,
        pos: hints.pos,
        gender: hints.gender,
        vocab: hints.vocab,
      });
      suggestions = ranked.suggestions || [];
      rest = ranked.rest || rest;
      if (ranked.hint?.yes) {
        adjNote = ranked.hint.reason
          ? `已優先排列形容詞相關規則（${ranked.hint.reason}）`
          : "已優先排列形容詞相關規則";
      }
    } else if (q) {
      const all = RulesService.getAll();
      if (selText && typeof RulesService.rankRulesForSpan === "function") {
        const ranked = RulesService.rankRulesForSpan(selText, {
          minScore: 6,
          maxSuggest: 12,
          pos: hints.pos,
          gender: hints.gender,
          vocab: hints.vocab,
        });
        const matchQ = (r) => {
          const blob = `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
          return blob.includes(q);
        };
        suggestions = (ranked.suggestions || []).filter((s) => matchQ(s.rule));
        rest = all.filter(
          (r) => matchQ(r) && !suggestions.some((s) => s.rule.id === r.id)
        );
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
      const badge = extra.suggest
        ? `<span class="badge badge-rule-suggest">建議</span>`
        : "";
      return `
        <li class="rule-pick-item${extra.suggest ? " rule-pick-item-suggest" : ""}">
          <div class="rule-pick-main">
            <p class="rule-pick-title">${badge}${esc(r.title)}</p>
            <p class="rule-pick-meta muted">${esc(r.category || "未分類")}${
              extra.score != null ? ` · 相關 ${extra.score}` : ""
            }</p>
            ${reason}
          </div>
          <button type="button" class="btn btn-sm btn-primary" data-pick-rule="${esc(r.id)}">套用</button>
        </li>`;
    };

    const adjBanner = adjNote
      ? `<p class="panel-note rule-pick-adj-hint">${esc(adjNote)}</p>`
      : "";

    const suggestBlock =
      suggestions.length > 0
        ? `<div class="rule-pick-section">
            <h3 class="rule-pick-section-title">依選取「${esc(selText)}」建議</h3>
            <ul class="rule-pick-ul rule-pick-ul-suggest">${suggestions
              .map((s) =>
                itemHtml(s.rule, {
                  suggest: true,
                  score: s.score,
                  reason: (s.reasons || []).slice(0, 2).join(" · "),
                })
              )
              .join("")}</ul>
          </div>`
        : selText && !q
          ? `<p class="panel-note rule-pick-no-suggest">沒有高分建議，可從下方完整列表選擇或搜尋。</p>`
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

  /**
   * 渲染查詢結果。
   * @returns {object|null} inventory 時回傳 buildApiHighlight 結果（A1：只算一次，供寫歷史／專案重用）
   */
  function renderHybridLookup(query, localResult, inventory, opts = {}) {
    const box = $("#lookup-result");
    if (!box) return null;
    stopGramHlCycles();

    const isSentence =
      localResult?.localDisabled ||
      localResult?.mode === "sentence" ||
      (RulesService.isMultiWordQuery && RulesService.isMultiWordQuery(query));
    const hasLocal = !isSentence && (localResult?.matches || []).length > 0;
    const analysis =
      !hasLocal && !isSentence && query
        ? Analyzer.analyze(query)
        : localResult?.analysis || null;

    // A1：同一輪渲染只算一次 highlight
    const apiHl = inventory ? buildApiHighlight(query, inventory) : null;

    // sticky 列：句子上色板（含圖例）固定在頂欄下方
    let pinHtml = "";
    if (isSentence) {
      if (inventory && apiHl) {
        pinHtml = apiSentenceBoardHtml(
          query,
          apiHl.spans,
          apiHl.legend,
          inventory.vocab || []
        );
      } else if (query) {
        // 本地／載入中：也要 id=sentence-text，否則選字套用無反應
        pinHtml = `<div class="sentence-board" id="sentence-board">
          <p class="sentence-label"><span class="sentence-label-main">查詢內容</span></p>
          <p class="sentence-text" id="sentence-text">${esc(query)}</p>
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
        </div>`;
      }
    } else if (query) {
      // 單詞：有 API 詞彙時也標上 hover（含性別）
      if (inventory && apiHl && (inventory.vocab || []).length) {
        pinHtml = apiSentenceBoardHtml(
          query,
          apiHl.spans,
          apiHl.legend,
          inventory.vocab || []
        ).replace("查詢內容 · API 已收錄標記", "查詢 · 單詞");
      } else {
        pinHtml = `<div class="sentence-board" id="sentence-board">
          <p class="sentence-label"><span class="sentence-label-main">查詢 · 單詞</span></p>
          <p class="sentence-text" id="sentence-text">${esc(query)}</p>
          <p class="sentence-edit-hint">選取文字可<strong>套用規則</strong>或<strong>建立新規則</strong>；右側<strong>+補充</strong>加入不句中上色的補充用法。</p>
          <ul class="sentence-legend" aria-label="補充用法">
            <li class="legend-item legend-item-add">
              <button type="button" class="btn-legend-add" data-add-supplementary title="加入補充用法（不句中上色）">+補充</button>
            </li>
          </ul>
        </div>`;
      }
    }

    // 可捲動主體（已收錄卡、尚未收錄、本地卡…）
    let bodyHtml = "";
    if (hasLocal) {
      bodyHtml += `<div class="result-banner success"><strong>找到本地規則</strong><span>「${esc(
        localResult.form
      )}」共 ${localResult.matches.length} 筆對應</span></div>`;
      bodyHtml += localMatchesSection(localResult);
    } else if (!isSentence) {
      bodyHtml += noLocalMatchActions(query, analysis);
    }

    if (inventory && apiHl) {
      // 已收錄在上，尚未收錄在下（可本句移除／手動定位）
      bodyHtml += `
          <section class="panel" id="lookup-owned-rules">
            <div class="panel-head">
              <h3>已收錄的規則</h3>
              <span class="badge badge-local">${apiHl.ownedHits.length} 筆 · 與句中同色</span>
            </div>
            ${
              apiHl.ownedHits.length
                ? `<p class="panel-note lookup-edit-hint">API 可能誤判。操作列：編輯 · 手動定位／重新定位 · <strong>本句移除</strong>。選字可套用／疊加規則。<strong>補充用法</strong>為琥珀標、固定在後、不句中上色。</p>
            <div class="match-list">
              ${apiHl.ownedHits
                .map((h) => {
                  const isSupp =
                    h.supplementary ||
                    h.colorIndex === "usage" ||
                    (typeof RulesService.isSupplementaryUsage === "function" &&
                      RulesService.isSupplementaryUsage(h.rule));
                  const color = isSupp ? "usage" : h.colorIndex ?? 0;
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
      bodyHtml += missingInventoryHtml(inventory, apiHl.missingItems);
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
          <p class="panel-note">可到設定檢查 API Key，或在查詢頁上方改為僅本地文法排查。</p>
        </section>`;
    } else if (Storage.isApiLookupEnabled() && !Storage.hasApiKey()) {
      bodyHtml += `
        <section class="panel" id="api-inventory-slot">
          <div class="panel-head">
            <h3>API 查詢</h3>
            <span class="badge">未設定</span>
          </div>
          <p class="panel-note">
            目前模式需要 <strong>API Key</strong>。請到設定填入，或在查詢頁上方改開「本地文法排查」。
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

  async function runLookup(forcedQuery) {
    const input = $("#lookup-input");
    const query = (forcedQuery != null ? forcedQuery : input?.value || "").trim();
    if (!query) {
      showToast("請輸入查詢內容", "error");
      return;
    }
    if (input) input.value = query;
    state.lastQuery = query;

    const modes = Storage.loadLookupModes();
    const anyMode = modes.apiGrammar || modes.localGrammar || modes.apiVocab;
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

    // 本地文法結果（僅在開啟本地文法排查時使用）
    const localResult = modes.localGrammar
      ? RulesService.search(query)
      : {
          form: query,
          mode: "sentence",
          matches: [],
          localDisabled: true,
          analysis: null,
        };
    state.lastSearch = localResult;
    state.lastInventory = null;

    // 純本地、不呼叫 API（仍建空 inventory，方便選字套用／本句規則）
    if (modes.localGrammar && !needApi) {
      const localInv = {
        summary: "",
        translation: "",
        items: [],
        vocab: [],
        source: "local",
        mode: "local",
      };
      state.lastInventory = localInv;
      renderHybridLookup(query, localResult, localInv);
      const n = (localResult.matches || []).length;
      if (n) showToast(`本地查詢：${n} 筆規則 · 可選字套用規則`, "success");
      else showToast("本地未命中規則（可選字手動套用，或改開 API 文法）", "info");
      return;
    }

    if (needApi && !Storage.hasApiKey()) {
      renderHybridLookup(query, localResult, null);
      showToast("此模式需要 API Key，請到設定填入（或改開本地文法排查）", "error");
      setView("settings");
      return;
    }

    renderHybridLookup(query, localResult, null, { apiLoading: true });

    state.lookupBusy = true;
    try {
      // 不需要 API 文法時走輕量單字請求（不傳規則標題、不產文法 i）
      const wantApiVocab = Boolean(modes.apiVocab);
      const wantApiGrammar = Boolean(modes.apiGrammar);
      let inventory;

      if (wantApiGrammar) {
        const titles = RulesService.getAll().map((r) => r.title);
        inventory = await AiService.inventoryGrammar(query, titles);
        if (!wantApiVocab) inventory.vocab = [];
      } else if (wantApiVocab && typeof AiService.inventoryVocabOnly === "function") {
        inventory = await AiService.inventoryVocabOnly(query);
      } else if (wantApiVocab) {
        const titles = RulesService.getAll().map((r) => r.title);
        inventory = await AiService.inventoryGrammar(query, titles);
        inventory.items = [];
      } else {
        inventory = { summary: "", translation: "", items: [], vocab: [] };
      }

      if (modes.localGrammar) {
        // 本地文法 +（可選）API 單字：文法用本地，詞彙用輕量 API
        inventory = {
          summary: localResult.matches?.length
            ? `本地 ${localResult.matches.length} 筆` +
              (wantApiVocab ? ` · API 單字 ${(inventory.vocab || []).length}` : "")
            : inventory.summary || "",
          translation: inventory.translation || "",
          items: [],
          vocab: wantApiVocab ? inventory.vocab || [] : [],
        };
      } else if (!wantApiGrammar && wantApiVocab) {
        inventory.items = [];
        inventory.summary =
          inventory.summary || `API 單字查詢：${(inventory.vocab || []).length} 詞`;
      }

      state.lastInventory = inventory;
      const apiHl =
        renderHybridLookup(query, localResult, inventory) ||
        buildApiHighlight(query, inventory);

      const payload = {
        query,
        summary: inventory.summary || "",
        translation: inventory.translation || "",
        ownedCount: (apiHl.ownedHits || []).length,
        missingCount: (apiHl.missingItems || []).length,
        localCount: (localResult.matches || []).length,
        items: inventory.items || [],
        vocab: inventory.vocab || [],
      };
      const activePid = Storage.getActiveProjectId();
      if (activePid) {
        const before = Storage.findProjectEntryByQuery(activePid, query);
        Storage.upsertProjectEntry(activePid, payload);
        const after = Storage.findProjectEntryByQuery(activePid, query);
        if (after?.seq != null) state.projectCursorSeq = after.seq;
        updateProjectModeUI();
        if (before) {
          showToast(`已更新第 ${after?.seq} 號快照（序號不變）`, "success");
        } else {
          showToast(`已加入專案第 ${after?.seq} 號`, "success");
        }
      } else {
        Storage.addHistoryEntry(payload);
        updateLookupNavBtns();
      }
    } catch (err) {
      renderHybridLookup(query, localResult, null, {
        apiError: err.message || "未知錯誤",
      });
      showToast(err.message || "API 失敗", "error");
    } finally {
      state.lookupBusy = false;
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

  function bindEvents() {
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
    });

    $("#btn-new-rule")?.addEventListener("click", () => openForm());
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
    $("#btn-project-create")?.addEventListener("click", () => createProjectFromModal());
    $("#project-new-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createProjectFromModal();
      }
    });
    $("#btn-project-leave")?.addEventListener("click", () => leaveProject());
    $("#btn-project-entries")?.addEventListener("click", () => openProjectEntriesModal());
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
    $("#vocab-edit-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeVocabEditModal();
    });
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
    document.addEventListener("mousedown", (e) => {
      const pop = $("#sel-apply-pop");
      if (!pop || pop.classList.contains("hidden")) return;
      if (pop.contains(e.target)) return;
      if (e.target.closest && e.target.closest("#sentence-text, #sentence-board")) {
        return;
      }
      hideSelApplyPop();
    });
    document.addEventListener("mouseup", (e) => {
      if (state.view !== "lookup") return;
      if (e.target.closest && e.target.closest("#sel-apply-pop, button, a, input, textarea")) {
        return;
      }
      if (!$("#sentence-text")) return;
      if (e.target.closest && e.target.closest("#sentence-board")) return;
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
        showSelApplyPop(e.clientX, e.clientY, cap.text, {});
      });
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

      // 左右方向鍵：上一句 / 下一句（查詢頁；輸入中不攔截）
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (handleLookupArrowNav(e)) return;
      }
    });

    $("#settings-form")?.addEventListener("submit", saveSettingsForm);
    $("#settings-mode-api-grammar")?.addEventListener("change", () =>
      onLookupModeToggle("apiGrammar")
    );
    $("#settings-mode-local-grammar")?.addEventListener("change", () =>
      onLookupModeToggle("localGrammar")
    );
    $("#settings-mode-api-vocab")?.addEventListener("change", () =>
      onLookupModeToggle("apiVocab")
    );
    $("#btn-settings-modes-all")?.addEventListener("click", () => onSettingsModesAllClick());
    $("#btn-test-api")?.addEventListener("click", () => testApiConnection());
    $("#btn-clear-key")?.addEventListener("click", clearApiKey);
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
    await RulesService.init();
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
