# 🚀 Rocket.new Automation Agent

A production-ready **Playwright (TypeScript)** automation agent that automates the complete lifecycle of application generation on the **Rocket.new** platform.

---

## 📋 What It Does

| Step | Description |
|------|-------------|
| **1** | Accepts user inputs (number of apps, technology, use case, type) |
| **2** | Generates structured app definitions using **ChatGPT API** |
| **3** | Stores definitions in a **local CSV** file |
| **4** | Logs in to **Rocket.new** and creates each application |
| **5** | Waits for code generation to complete |
| **6** | **Publishes** each application |
| **7** | Extracts and stores published URLs |
| **8** | **Analyzes** each published app (pages, navigation, console errors, broken links, UI) |
| **9** | Generates a **comparison report** and writes results back to CSV |

---

## 🏗️ Architecture

```
src/
├── config/
│   └── config.ts              # Environment config + type definitions
├── services/
│   ├── chatgpt.service.ts     # OpenAI API integration
│   └── csvStorage.service.ts  # Local CSV storage (replaces Google Sheets)
├── agents/
│   ├── appDefinition.agent.ts # Step 1+2: Generate & store definitions
│   ├── rocketBuilder.agent.ts # Step 3: Build & publish on Rocket.new
│   └── analysis.agent.ts      # Step 4+5: Analyze & report
├── playwright/
│   ├── browserManager.ts      # Browser lifecycle management
│   └── rocketPage.ts          # Page Object Model for Rocket.new
├── scripts/
│   └── saveAuthState.ts       # One-time Google login session saver
├── utils/
│   ├── logger.ts              # Winston structured logging
│   └── retry.ts               # Generic retry with exponential backoff
└── runner/
    └── automationRunner.ts    # End-to-end pipeline orchestrator

tests/
└── runAutomation.spec.ts      # Playwright test entrypoint
```

**Design Patterns**: Page Object Model + Service Layer + Agent Architecture

---

## ⚙️ Prerequisites

- **Node.js** ≥ 18.0.0
- **npm** ≥ 8.0.0
- An **OpenAI API key** (for app definition generation)
- A **Rocket.new account** (Google login)

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Configure Environment

```bash
# Copy the example env file
copy .env.example .env    # Windows
cp .env.example .env      # Mac/Linux
```

Edit `.env` and fill in your API key:

```env
OPENAI_API_KEY=sk-your-real-api-key
```

### 3. Save Your Google Login Session

Since Rocket.new uses **Google OAuth**, you need to login manually once and save the session:

```bash
npx ts-node src/scripts/saveAuthState.ts
```

This opens a browser → you sign in with Google → press Enter → session is saved to `auth/storageState.json`.
All subsequent runs reuse this saved session automatically.

> **Note:** Re-run this command whenever your session expires.

### 4. Run the Automation

#### Full Pipeline (all steps)
```bash
npx playwright test tests/runAutomation.spec.ts --grep "Full Pipeline"
```

#### Individual Steps
```bash
# Step 1 & 2 only — Generate app definitions
npx playwright test tests/runAutomation.spec.ts --grep "Step 1"

# Step 3 only — Build and publish (requires CSV from Step 1)
npx playwright test tests/runAutomation.spec.ts --grep "Step 3"

# Step 4 & 5 only — Analyze published apps
npx playwright test tests/runAutomation.spec.ts --grep "Step 4"
```

#### Smoke Test (no credentials required)
```bash
npx playwright test tests/runAutomation.spec.ts --grep "smoke"
```

### 5. Customize Input

Override defaults via environment variables:

```bash
NUM_APPS=5 TECHNOLOGY=NextJS USE_CASE=Dashboard APP_TYPE="Finance Dashboard" npx playwright test
```

---

## 📁 Output Files

After running, you'll find:

| File | Description |
|------|-------------|
| `output/app_definitions.csv` | App definitions + published URLs + analysis |
| `output/app_definitions_analysis_report.csv` | Detailed analysis report |
| `output/screenshots/` | Screenshots of generated and analyzed apps |
| `output/logs/automation.log` | Full structured log |
| `output/logs/errors.log` | Error-only log |
| `test-results/` | Playwright test results + traces |

---

## 📊 Analysis Checks

The analysis agent validates each published application for:

- ✅ **Expected vs Actual Pages**
- ✅ **Navigation functionality**
- ✅ **Missing modules**
- ✅ **Broken links** (HTTP status checks)
- ✅ **Console errors** (runtime JS errors)
- ✅ **UI layout issues** (overflow, broken images, empty containers)
- ✅ **Missing features** (keyword-based heuristic)
- 📸 **Full-page screenshots**

---

## 🔧 Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | Your OpenAI API key (required) |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model to use |
| `AUTH_STATE_PATH` | `./auth/storageState.json` | Path to saved Google login session |
| `BASE_URL` | `https://rocket.new` | Rocket.new base URL |
| `CSV_OUTPUT_PATH` | `./output/app_definitions.csv` | CSV output path |
| `MAX_RETRIES` | `3` | Retry attempts for flaky operations |
| `RETRY_DELAY_MS` | `2000` | Delay between retries |
| `HEADLESS` | `false` | Run browser in headless mode |

---

## 🧪 Development

```bash
# Type check
npx tsc --noEmit

# Build
npm run build

# Run all tests
npm test
```

---

## 📝 Notes

- The automation uses **smart waits** (locator-based, network idle, polling) — no static `setTimeout` waits.
- Each step has **retry logic** with exponential backoff for resilience.
- The browser manager configures **tracing** and **video recording** for debugging failures.
- Logs are written to both console (colorized) and files (structured).
- If an app build fails, the agent logs the error, takes a screenshot, and continues with the next app.
