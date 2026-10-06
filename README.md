# Lugus · 法語文法筆記本

使用者可自行維護的法語文法規則筆記本。  
**查詢模式**：API 文法／API 單字／手動（選字套用）。  
文法盤點採 **切詞 → 高信心本地確認／API 只消歧 → 身分對卡**（對齊韓語筆記本的 grammarKey 管線）：先把句子切成詞（省音、代詞連字號），程式依穩定種類（`neg:ne-pas`、`verb:être:present`…）產出候選。高信心項（主語代詞、ne…pas、表內不規則變位）本地直接確認；API **不讀本地卡名**，只審同形異義與未知動詞，並給翻譯。漏答只補查消歧項一次。完成後前端用 **grammarKey → 完整標題 → 唯一法語標記 → 動詞身分 → span 完整形** 對照筆記本（已收錄／尚未收錄）。  
已取消「本地文法」查詢掃描（歷史快照 source/mode 為 local 的仍可顯示）。

## 功能

| 功能 | 說明 |
|------|------|
| API 文法 | 需 Key；切詞後獨立盤點，前端再對卡；句中標記、翻譯、尚未收錄／已收錄 |
| API 單字 | 需 Key；詞彙原形 hover；可與文法並用 |
| 手動模式 | 全部查詢模式關閉；仍可查詢並選字套用 |
| 本句手動校正 | 選字套用／疊加規則；規則卡「本句移除」；未定位可「手動定位」（對齊 Mal） |
| 詞彙 hover | 盤點回傳實詞原形／簡義，句中滑過查看 |
| 查詢歷史 | 快照含 vocab；搜尋；再看一次；查詢框「上一句」捷徑 |
| 規則 CRUD | 標題建議「中文（法語）」；分類；可選六人稱 |
| AI 自動填寫 | 短鍵 JSON；背景填卡 |
| 待辦清單 | 缺失文法可加入；建卡後自動清除 |
| 匯入／匯出 | JSON 備份與合併匯入 |
| 種子資料 | 內建常見變位與否定等 |

## 設計原則

1. 查詢模式為 **API 文法**、**API 單字**、或 **手動（選字套用）**；不以本地掃描作為查詢路徑
2. API 文法／單字需要 API Key；手動模式不需 Key
3. 規則名建議 **中文（法語）**。第一／二組規則動詞用通則卡（`現在時（-er présent）`、`現在時（-ir présent）`），不為每個動詞另立。不規則才用 **不定詞＋時態（法語）**，如 `souvenir 現在時（présent）`。代詞不當文法卡，只當詞彙。
4. 動詞保留 **六人稱格子**；一般文法用關鍵詞與說明
5. **不規則動詞另立規則**：être／avoir／aller／pouvoir 等不可被「第一組 -er」通則詞尾吞掉；需專屬卡（完整形六格、標題含不定詞）

## 標準查詢流程（API 文法）

```text
原文
  → FrParse 切詞（空白／標點／省音 l' n' j'／代詞連字號）
  → 依 KIND_META 產候選：高信心本地確認 / 需消歧才進 API
  → API 只審消歧＋翻譯（不重判本地高信心、不看本地卡名）
  → 漏答只補查消歧項一次；中信心漏答不回流
  → grammarKey 身分對卡 → 已收錄／尚未收錄
```

- 切詞或對卡失敗時，回退整句盤點，**仍然不傳本地卡名**
- API 單字走輕量請求，不產文法項目
- 手動模式不呼叫 API，可選字套用

## 快速開始

```bash
cd lugus
npx --yes serve .
# 或
python -m http.server 8080
```

瀏覽器開啟顯示的網址。種子 JSON 需透過 HTTP 載入，請勿直接用 `file://`。

### 部署到 Netlify

Publish directory 設為專案根目錄（已提供 `netlify.toml`），無需 build。

## 使用流程

### 單詞

1. 輸入 `pouvais` → 切詞後 API 獨立盤點，再對照筆記本規則卡
2. 查無規則 → 尚未收錄／建卡／待辦；或選字套用

### 整句

1. 設定 API Key 後輸入 `Je n'ai pas déjeuné.`
2. 句中標記已收錄、下方尚未收錄、整句翻譯、滑過實詞看原形
3. 可選字套用、本句移除、手動定位

## 規則卡片欄位

```text
id, title, category, explanation,
has_persons, endings{je,tu,il,nous,vous,ils}, keywords[],
created_at, updated_at
```

- **title**：建議 `中文功能名（法語標記）`
- **category**：變位／時態／否定／代詞／介詞／冠詞／句型／其他
- **endings**：動詞變位六格（可填詞尾或完整形，`|` 分隔別名）

## 資料儲存

- 瀏覽器 **localStorage**（鍵名 `fvgn_*`）
- 首次載入讀取 `data/seed-rules.json`
- 歷史最多 40 筆；重設種子不清除 API Key

## 專案結構

```text
lugus/
├── index.html
├── css/styles.css
├── js/
│   ├── storage.js    # localStorage／歷史
│   ├── analyzer.js   # 本地啟發式分析
│   ├── fr-parse.js   # 切詞、候選、checklist、對卡
│   ├── rules.js      # 規則 CRUD＋本地搜尋（選字套用）
│   ├── ai.js         # 獨立盤點＋規則填寫
│   └── app.js        # UI 流程
├── data/seed-rules.json
├── netlify.toml
└── README.md
```

## 技術備註

- 純前端、無 build 步驟
- 高信心文法由本地種類目錄判定；API 只做法語需要語境的消歧（le 冠詞／COD、en 代詞／介詞、未知動詞）
- 已收錄比對走 grammarKey 身分，不用標題模糊分數
- API 使用 OpenAI 相容 chat completions（預設 xAI）
- 標準管線測試：`node js/test-fr-parse.mjs`、`node js/test-api-grammar.mjs`、`node js/test-verb-match.mjs`、`node js/test-attach-local.mjs`
