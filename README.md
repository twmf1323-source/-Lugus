# Lugus · 法語文法筆記本

使用者可自行維護的法語文法規則筆記本。  
**單詞**：本地比對（變位詞尾、省音、關鍵詞）。  
**整句**：僅 **API 盤點**（句中標記、翻譯、詞彙原形 hover、尚未收錄、查詢歷史）。  
已取消本地整句掃描。

## 功能

| 功能 | 說明 |
|------|------|
| 本地查詢 | **僅單詞**；省音、六人稱詞尾、否定關鍵詞 |
| 離線分析 | 單詞查無規則時啟發式推估原形／時態／人稱 |
| API 盤點 | 整句必填 Key；已收錄標記、翻譯、詞彙原形、尚未收錄 |
| 本句手動校正 | 選字套用／疊加規則；規則卡「本句移除」；未定位可「手動定位」（對齊 Mal） |
| 詞彙 hover | 盤點回傳實詞原形／簡義，句中滑過查看 |
| 查詢歷史 | 快照含 vocab；搜尋；再看一次；查詢框「上一句」捷徑 |
| 規則 CRUD | 標題建議「中文（法語）」；分類；可選六人稱 |
| AI 自動填寫 | 短鍵 JSON；背景填卡 |
| 待辦清單 | 缺失文法可加入；建卡後自動清除 |
| 匯入／匯出 | JSON 備份與合併匯入 |
| 種子資料 | 內建常見變位與否定等 |

## 設計原則

1. **單詞**可離線本地比對；**整句**不跑本地掃描
2. 整句查詢需要 API Key
3. 規則名建議 **中文（法語）**，方便與盤點嚴格比對
4. 動詞保留 **六人稱格子**；一般文法用關鍵詞與說明
5. **不規則動詞另立規則**：être／avoir／aller／pouvoir 等不可被「第一組 -er」通則詞尾吞掉；需專屬卡（完整形六格、標題含不定詞）

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

1. 輸入 `pouvais` → 本地命中規則卡；有 Key 時再盤點補強
2. 查無規則 → 離線分析＋建卡／待辦

### 整句

1. 設定 API Key 後輸入 `Je n'ai pas déjeuné.`
2. 句中標記已收錄、下方尚未收錄、整句翻譯、滑過實詞看原形

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
│   ├── rules.js      # 規則 CRUD＋本地搜尋
│   ├── ai.js         # 盤點＋規則填寫
│   └── app.js        # UI 流程
├── data/seed-rules.json
├── netlify.toml
└── README.md
```

## 技術備註

- 純前端、無 build 步驟
- 基礎分析為詞尾啟發式 + 小型不規則表，**非完整文法引擎**
- API 使用 OpenAI 相容 chat completions（預設 xAI）
