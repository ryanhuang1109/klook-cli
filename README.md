# Travel Competitor Monitor

Cross-platform travel activity price comparison across **Klook, Trip.com, GetYourGuide, and KKday**.

跨平台旅遊活動價格監控工具，支援 **Klook、Trip.com、GetYourGuide、KKday** 四大平台。

---

## How It Works | 運作原理

Built on [opencli](https://github.com/jackwener/opencli) — an open-source framework that turns any website into a CLI.

基於 [opencli](https://github.com/jackwener/opencli) 開源框架，把任何網站變成 CLI 指令。

### 1. Browser Bridge

opencli uses a Chrome extension to borrow your existing browser login sessions. No credentials are stored — if your Chrome is logged into a website, the tool can access it just like you would.

opencli 透過 Chrome 擴充程式借用你已登入的瀏覽器 session。不儲存任何帳號密碼 — 只要 Chrome 有登入該網站，工具就能像你一樣操作。

### 2. Search 4 Platforms | 搜尋四大平台

Simultaneously search Klook, Trip.com, GetYourGuide, and KKday. Activities, prices, ratings, and reviews are extracted in real-time.

同時搜尋四大平台，即時抓取活動、價格、評分、評論數。

### 3. AI Clustering | AI 智能分組

Results from all platforms are sent to AI (Claude via OpenRouter) which groups similar products, converts currencies to USD, and identifies the best price and highest rated option per group.

所有平台結果送給 AI（Claude via OpenRouter），自動將相似產品分組、統一幣別、標出每組最低價和最高評分。

---

## Supported Platforms | 支援平台

| Platform | Search | Detail | Pricing | Date Compare |
|----------|--------|--------|---------|-------------|
| **Klook** | Public API (no login needed) | Packages + Itinerary + Inclusions + All Sections | Yes | — |
| **Trip.com** | Browser Bridge | Packages + Itinerary + Inclusions + All Sections | Yes | Yes |
| **GetYourGuide** | Browser Bridge | Packages + Itinerary + Inclusions + All Sections | Yes | — |
| **KKday** | Browser Bridge | Packages + Itinerary + Inclusions + All Sections | Yes | — |

> **Detail extraction** includes packages with pricing, itinerary steps, inclusions/exclusions, and all page sections (What to expect, How to use, Cancellation policy, etc.). Section titles are standardised to Klook naming with the platform's original title preserved.

---

## Features | 功能

- **POI Monitoring** — Configure Points of Interest (e.g. "Mt Fuji day tour", "USJ tickets") with custom keywords per platform | 設定監控景點，每個平台可設定不同搜尋關鍵字
- **Price Comparison** — AI groups similar products, normalizes to USD, highlights cheapest and best-rated | AI 自動分組、統一幣別、標出最優選擇
- **Full Page Extraction** — Extracts packages, itinerary, inclusions/exclusions, and all page sections (What to expect, How to use, Cancellation policy, etc.) with standardised section titles across platforms | 完整擷取套餐、行程、包含/不包含項目、以及所有頁面段落，跨平台標題統一標準化
- **Historical Tracking** — Save comparisons to local SQLite database, track price changes over days/weeks | 比價結果存入資料庫，追蹤每日價格變動
- **Web Dashboard** — BD colleagues use the web interface — no terminal needed | BD 同事不需要 terminal，瀏覽器直接操作

---

## Usage | 使用方式

### For BD Colleagues | BD 同事

Just open the shared URL in your browser. No installation needed.

直接用瀏覽器打開分享的 URL 即可，不需要安裝任何東西。

### CLI Examples | CLI 範例

```bash
# Search activities
opencli klook search "Mt Fuji day tour" --limit 5

# Activity detail — packages, itinerary, inclusions, all page sections
opencli klook detail 93901

# Trip.com date comparison
opencli trip detail 92795279 --compare-dates

# AI cross-platform comparison
node dist/cli.js compare "Mt Fuji day tour" --date 2026-04-15

# Price history tracking
node dist/cli.js compare-history "Mt Fuji day tour" --days 7

# Start web dashboard
npm run web
# → http://localhost:17890
```

### JSON output for AI agents

```bash
opencli klook search "Tokyo Disneyland" --limit 5 -f json
node dist/cli.js compare "Mt Fuji day tour" -f json
```

---

## Setup | 安裝指南

### Prerequisites | 前置條件

- Node.js 20+
- Chrome or Chromium browser

### Step 1: Install opencli | 安裝 opencli

```bash
npm install -g @jackwener/opencli
```

### Step 2: Install Browser Bridge Extension | 安裝瀏覽器擴充程式

This Chrome extension lets the CLI borrow your login sessions.

```bash
git clone --depth 1 https://github.com/jackwener/opencli.git /tmp/opencli
cd /tmp/opencli/extension && npm install && npm run build
```

Then in Chrome:
1. Go to `chrome://extensions/`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked**
4. Select `/tmp/opencli/extension`

### Step 3: Verify connection | 確認連線

```bash
opencli doctor
```

Expected output:
```
[OK] Daemon: running
[OK] Extension: connected
[OK] Connectivity: connected
```

### Step 4: Clone and build | 下載並建構

```bash
git clone https://github.com/ryanhuang1109/klook-cli.git
cd klook-cli
npm install
npm run build
```

### Step 5: Register plugins | 註冊平台

```bash
# Link all 4 platform plugins
ln -sf $PWD/dist/clis/klook ~/.opencli/plugins/klook
ln -sf $PWD/dist/clis/trip ~/.opencli/plugins/trip
ln -sf $PWD/dist/clis/getyourguide ~/.opencli/plugins/getyourguide
ln -sf $PWD/dist/clis/kkday ~/.opencli/plugins/kkday

# Create plugin manifests
cp opencli-plugin.json dist/clis/klook/
for p in trip getyourguide kkday; do
  echo "{\"name\":\"$p\",\"version\":\"0.1.0\",\"opencli\":\">=1.0.0\"}" > dist/clis/$p/opencli-plugin.json
done

# Verify
opencli list | grep -E "klook|trip|getyourguide|kkday"
```

### Step 6: Set OpenRouter API key | 設定 AI API 金鑰

Required for cross-platform comparison feature.

```bash
mkdir -p ~/.klook-cli
echo '{"openrouter_api_key":"sk-or-YOUR-KEY-HERE"}' > ~/.klook-cli/config.json
```

Get your key at https://openrouter.ai/keys

### Step 7: Log into platforms in Chrome | 在 Chrome 登入各平台

Open Chrome and log into these websites (only need to do this once):

- https://www.trip.com
- https://www.getyourguide.com
- https://www.kkday.com

> Klook search uses a public API — no login required.

### Step 8: Start using | 開始使用

```bash
# CLI
opencli klook search "Tokyo Disneyland" --limit 5

# Web dashboard
npm run web
# → http://localhost:17890

# Share with colleagues via ngrok
ngrok http 17890
```

---

## About Login Sessions | 關於登入

The Browser Bridge **does not store any passwords**. It works by connecting to your existing Chrome browser session — the same way you'd browse the website manually. As long as Chrome is logged in, the tool can access the site.

Browser Bridge **不儲存任何密碼**。它透過連接你現有的 Chrome 瀏覽器 session 來運作 — 跟你手動瀏覽網站完全一樣。只要 Chrome 有登入，工具就能存取。

For BD colleagues using the web dashboard: they don't need to log into anything. The server machine's Chrome handles all platform access.

BD 同事使用 web 介面時不需要自己登入任何網站。所有平台存取都由跑 server 的那台機器的 Chrome 處理。

---

## Tech Stack

- [opencli](https://github.com/jackwener/opencli) — Browser Bridge framework
- TypeScript / Node.js 20+
- [OpenRouter](https://openrouter.ai) — AI clustering (Claude)
- sql.js — Local SQLite for history tracking
- Express — Web dashboard server

---

## License

MIT
