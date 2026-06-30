# VIDON — Technical Handover Document (Phase 1 / MVP)

> פלטפורמת הפקת וידאו chat-driven שהופכת מטרה שיווקית לקובץ MP4 מוכן-לפרסום.
> מסמך זה מתאר את כל מה שקיים ובוצע במערכת ברמת מתכנת: ארכיטקטורה, מודל נתונים, פונקציות backend, flow לכל מסך, וטכנולוגיות.

---

## 1. Tech Stack

| שכבה | טכנולוגיה |
|------|-----------|
| Frontend | React 18 + Vite, React Router v6, TailwindCSS, shadcn/ui, lucide-react |
| State/Data | `@tanstack/react-query`, Base44 SDK (`@base44/sdk`) |
| Backend (BaaS) | Base44 — Entities (DB), Backend Functions (Deno runtime), Automations, Auth, Storage |
| Backend Functions | Deno + `@base44/sdk` (service-role), `fetch` נטיבי |
| LLM | Claude Sonnet דרך OpenRouter (`briefChat`) |
| תמונות | WaveSpeed — Google Nano Banana (`genImageWaveSpeed`); OpenRouter Image (`genImageOpenRouter`) |
| קריינות (TTS) | ElevenLabs (`ttsElevenLabs`) |
| כתוביות (STT) | ElevenLabs Scribe — word-level timestamps (`transcribeScribe`) |
| אווטאר UGC | HeyGen (adapter ב-orchestrator — MVP stub) |
| רינדור | Remotion על Railway (שירות חיצוני נפרד, Docker + Chromium) |
| כיוון | RTL מלא (עברית), כתוביות karaoke ברמת מילה |

### Secrets (מוגדרים בסביבה)
`WAVESPEED_API_KEY`, `ELEVENLABS_API_KEY`, `OPENROUTER_API_KEY`, `RAILWAY_RENDER_URL`, `RENDER_WEBHOOK_SECRET`

---

## 2. Data Model (Entities)

multi-tenant מהיסוד — לכל ישות יש `account_id`. שדות built-in בכל רשומה: `id`, `created_date`, `updated_date`, `created_by_id`.

| Entity | תפקיד | שדות מפתח |
|--------|-------|-----------|
| **Account** | דייר/סביבת עבודה (LeadON). שורש ה-multi-tenancy | `name`, `slug`, `default_markup` (×5), `credit_value_ils` (0.15) |
| **Client** | המותג שעבורו מופק הסרטון | `brand_name`, `brand_colors[]` (HEX), `logo_url`, `brand_font`, `default_vertical` |
| **Project** | בקשת סרטון בודדת — היחידה המרכזית | `title`, `goal`, `vertical`, `status`, `current_brief_id`, `credits_estimate` |
| **Brief** | מסמך האמת היחיד (JSON), עם גרסאות. מאושר = immutable | `version`, `status` (draft/approved/superseded), `json`, `phase`, `credits_estimate` |
| **Preset** | תבנית brief לפי ורטיקל (נטענת מוקדם לצ׳אט) | `vertical`, `name`, `brief_template` (object) |
| **Job** | ריצת הפקה אסינכרונית של brief מאושר | `state` (machine), `video_type`, `progress_pct`, `idempotency_key` |
| **JobStep** | מעקב לכל שלב ב-pipeline (DAG) — retries + כשל חלקי | `name`, `provider`, `status`, `depends_on[]`, `input`, `output`, `attempt` |
| **Asset** | נכס ביניים | `type` (still/voiceover/avatar_clip/caption_data/music_track/broll), `scene_id`, `url`, `meta` |
| **Render** | תוצר MP4 סופי ליחס תצוגה. מפתח ייחודי: (job_id, aspect_ratio) | `aspect_ratio`, `status`, `url`, `duration_sec` |
| **CreditLedger** | תנועות קרדיט (append-only) | `type` (hold/capture/refund/adjustment), `credits`, `note` |
| **ApiCostLog** | עלות API בפועל לכל שלב (append-only) — בסיס ל-capture | `provider`, `step`, `cost_usd`, `units` |
| **ProviderConfig** | תצורת ספק: markup, rate, enable, מכסות | `capability`, `provider`, `rate_usd`, `rate_unit`, `enabled`, `is_default` |
| **Voice** | ספריית קולות עברית (רק qa_passed נחשפים) | `label`, `voice_id`, `gender`, `style`, `qa_passed` |
| **MusicTrack** | ספריית מוזיקה רישוית | `title`, `mood`, `source`, `url`, `license` |
| **User** (built-in) | משתמשים, role admin/user | — |

### Job State Machine
`draft → briefing → approved → generating_assets → rendering → review → delivered / completed`
ענפי כשל: `failed`, `refunded`.

---

## 3. Backend Functions (Deno)

| Function | טריגר | תפקיד |
|----------|-------|-------|
| **briefChat** | Frontend (NewVideo) | מנוע Brief Intelligence. Claude Sonnet דרך OpenRouter, stateless-agentic. מחזיר JSON-only לפי schema, deep-merge לתוך ה-brief, הזרקת context (project/brand/voices/music), guardrails על שדות רגישים, ותמחור server-side. |
| **priceBrief** | נקרא ע"י briefChat/approveBrief | מנוע תמחור **דטרמיניסטי** (code-based, לא LLM). Σ עלויות לפי ProviderConfig × fx × markup → credits. מונע מה-LLM להמציא מחירים. |
| **approveBrief** | Frontend (BriefEditor) | אימות brief מלא, נעילת קרדיטים (`CreditLedger` hold), סימון brief+project כ-approved, יצירת `Job` עם idempotency_key. |
| **orchestratorTick** | Automation (כל 10 דק׳) + on-demand | ה-Orchestrator. בונה DAG לפי `videoType`, מריץ adapters, מקדם async steps, מפעיל רינדור כשהנכסים מוכנים, סוגר עם capture/refund. ראה §4. |
| **genImageWaveSpeed** | adapter | יצירת תמונה (Nano Banana): submit → poll → הורדה והעלאה ל-Base44 Storage. |
| **genImageOpenRouter** | adapter | יצירת תמונה דרך OpenRouter Image API. |
| **ttsElevenLabs** | adapter | קריינות אמיתית מ-ElevenLabs. |
| **transcribeScribe** | adapter | כתוביות word-level (Scribe STT) על אודיו הקריינות. |
| **triggerRender** | (inline ב-orchestrator) | בניית payload (scenes, voiceover, music, captions, audio-ducking) ושליחה לשירות Remotion. |
| **renderWebhook** | Railway → Base44 | callback בסיום רינדור — מעדכן `Render` ל-completed/failed. |
| **uploadRender** | Railway → Base44 | קליטת קובץ ה-MP4 לאחסון Base44. |
| **observabilityMetrics** | Frontend (Observability) | aggregation מטריקות pipeline (זמני שלבים, success rate, עלויות). |
| **checkRenderService** | Frontend (Settings) | health-check לשירות ה-Railway. |

### הערות ארכיטקטורה חשובות (לקחים מהבנייה)
- כל ה-DAG וה-adapters רצים **inline בתוך `orchestratorTick`** (WaveSpeed, triggerRender) כדי לעקוף 403 על קריאות `functions.invoke` פנימיות עם poll ארוך.
- URLs ל-callback/upload נבנים בפורמט `https://<app-id>.base44.app/...` כדי לעקוף שגיאות אימות dispatcher.
- שלבים סינכרוניים-כבדים (תמונה/קריינות) רצים **במקביל** עם `Promise.allSettled` כדי לא לחרוג מ-timeout.
- כל adapter עטוף ב-try/catch → כשל בודד נופל ל-`retryOrFail` (עד 3 ניסיונות) ולא מקריס את ה-tick.
- early-exit: אם כל ה-Renders completed — סוגרים job מיד לפני בנייה מחדש של steps.

---

## 4. Orchestrator Flow (`orchestratorTick`)

```
Automation (10 min) / webhook
        │
        ▼
  tick(jobId)
        │
        ├─ early-exit: כל ה-Renders completed? → capture credits → Job=completed, Project=delivered
        ├─ יש Render failed?                    → refund credits → Job=failed
        │
        ├─ אין JobSteps?  → buildSteps(brief) לפי videoType → צור steps → Job=generating_assets
        │     • voiceover (ElevenLabs)         [image_motion/hybrid: depends_on=[]]
        │     • visual:<sceneId> לכל סצנה        [nano_banana/wavespeed/openrouter/veo/kling/heygen]
        │     • captions (Scribe)               [depends_on: voiceover]
        │     • music (library/suno)
        │
        ├─ קדם async steps שב-running (poll fallback)
        ├─ הרץ steps זמינים (depsOk):
        │     • async (veo/kling/heygen) → submit → running
        │     • sync (תמונה/קריינות/כתוביות)  → Promise.allSettled
        │
        ├─ כל ה-steps succeeded?  → צור Render לכל aspectRatio → Job=rendering (80%) → submitRender()
        │
        └─ סגירה: Renders completed → capture | Render failed → refund
```

**Credit Capture**: `Σ ApiCostLog.cost_usd × 3.7(fx) × markup ÷ 0.15` → credits בפועל, חסום בתקרת ה-hold.

---

## 5. Frontend — Routing & Layout

- **`src/App.jsx`** — router. כל הדפים מוגנים תחת `ProtectedRoute` → `Layout` (layout route עם `<Outlet/>`).
- **`src/components/Layout.jsx`** — sidebar RTL קבוע (לוגו VIDON + 8 פריטי ניווט), main scrollable.
- **Auth pages** (built-in): `/login`, `/register`, `/forgot-password`, `/reset-password` — תורגמו לעברית.

| Route | Page | תיאור |
|-------|------|-------|
| `/` | Dashboard | סקירה כללית |
| `/new` | NewVideo | יצירת brief בצ׳אט |
| `/brief/:briefId` | BriefEditor | סקירה + אישור brief |
| `/render/:jobId` | RenderProgress | מעקב רינדור real-time |
| `/project/:projectId` | ProjectDetail | פרטי פרויקט + jobs |
| `/library` | Library | renders + presets |
| `/voices` | Voices | ספריית קולות + QA |
| `/clients` | Clients | ניהול לקוחות/מותגים |
| `/budget` | Budget | קרדיטים + מרווח |
| `/observability` | Observability | מטריקות pipeline |
| `/settings` | Settings | ספקים, rates, markup, health-check |

---

## 6. Flow מפורט לכל מסך

### 🏠 Dashboard (`/`)
**Load**: `Project.list` + `Job.list` + `CreditLedger.list` במקביל.
**מציג**: 4 כרטיסי סטטיסטיקה (פרויקטים, הפקות פעילות, קרדיטים מוחזקים=hold+refund, קרדיטים שנצברו=capture) + רשימת פרויקטים אחרונים עם `StatusBadge`.
**Flow**: כל פרויקט → `/project/:id`. כפתור "סרטון חדש" → `/new`.

### 💬 NewVideo (`/new`)
**שלב 1 — Setup**: שם פרויקט + בחירת ורטיקל/preset אופציונלי (נטען מ-`Preset.list`). יצירת `Project` (status=draft, vertical).
**שלב 2 — Chat**: שיחה מול `briefChat`. כל הודעה → קריאה ל-function → עדכון messages + תמחור live. ה-preset שנבחר נטען אוטומטית לשיחה.
**Flow**: כש-brief מוכן → ניווט ל-`/brief/:briefId` (אישור).

### 📋 BriefEditor (`/brief/:briefId`)
**Load**: `Brief.get(briefId)`.
**מציג**: מטא-דאטה (מטרה/שפה/מותג), סקריפט, פירוק סצנות, הגדרות אודיו (קריינות/מוזיקה/כתוביות), וחישוב עלות/קרדיטים.
**Flow**: כפתור "אישור" → `approveBrief` (נעילת קרדיטים + יצירת Job) → ניווט ל-`/render/:jobId`. brief מאושר מוצג כ-immutable.

### ⚙️ RenderProgress (`/render/:jobId`)
**Load**: `Job.get` + `JobStep.filter` + `Render.filter`.
**Polling**: כל 4 שניות מרענן progress/status.
**מציג**: progress bar, רשימת שלבי pipeline עם status icon, ורשימת renders עם כפתורי הורדה כשהושלם.

### 📁 ProjectDetail (`/project/:projectId`)
**Load**: `Project.get` → `Brief.get(current_brief_id)` → `Job.filter`.
**מציג**: פרטי פרויקט, ניווט ל-brief נוכחי, ורשימת jobs עם סטטוסים. Loading/not-found states.

### 🎬 Library (`/library`)
**Tab "renders"**: `Render.filter(completed)` — grid עם תצוגה מקדימה + הורדה.
**Tab "presets"**: `Preset.list` — ניהול presets (`PresetDialog` ליצירה, מחיקה ב-hover). מציג videoType/duration/aspectRatios.

### 🎙️ Voices (`/voices`)
**Load**: `Voice.list`. **מציג**: ספריית קולות (gender/style/id), נגן sample, toggle QA (`qa_passed`).

### 👥 Clients (`/clients`)
**Load**: `Client.list`. **מציג**: grid כרטיסי לקוח (brand_name, vertical, פלטת צבעים). דיאלוג הוספה עם validation + ברירת מחדל לצבעים.

### 💰 Budget (`/budget`)
**Load**: `CreditLedger.list` + `ApiCostLog.list`.
**מציג**: 4 כרטיסים (hold פתוח, capture, עלות API בפועל $, מרווח משוער ₪) + טבלת תנועות append-only. מרווח = `captured×0.15 − apiCostUsd×3.7`.

### 📊 Observability (`/observability`)
**Load**: `observabilityMetrics`. **מציג**: מטריקות pipeline — זמני שלבים, success rate, עלויות per provider.

### 🔧 Settings (`/settings`)
**Load**: `ProviderConfig.list` + `Account.list`.
**מציג**: markup גלובלי (Account.default_markup), טבלת ספקים עם rate_usd editable + toggle enabled, ו-`RenderServiceCheck` (health-check Railway).

---

## 7. Remotion Render Service (Railway — repo נפרד: `remotion-service/`)
- **Dockerfile** עם Chromium מוטמע (Remotion 4.x `ensureBrowser`).
- **server.js** — Express endpoint `/render` שמקבל payload מ-`orchestratorTick`.
- **VidonVideo.js** — composition: סצנות עם transitions, כתוביות karaoke RTL ברמת מילה, audio-ducking (הנמכת מוזיקה תחת קריינות).
- מרנדר אסינכרונית לכל aspectRatio → מעלה ל-Base44 דרך `uploadRender` → מודיע דרך `renderWebhook`.

---

## 8. Automations
- **orchestratorTick** — scheduled, כל 10 דקות, מעבד כל ה-jobs בסטטוסים `approved`/`generating_assets`/`rendering`.

---

## 9. סטטוס
Phase 1 / MVP — **End-to-End מלא ופעיל**. בוצע pilot run מקצה-לקצה שהפיק קובץ MP4 מוגמר עם כתוביות RTL.