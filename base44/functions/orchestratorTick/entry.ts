import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ============================================================================
// VIDON Orchestrator (worker v2) — בתוך BASE44, ללא Redis.
//
// מה השתנה מול הגרסה הקודמת, ולמה:
//  1. ביטול חיוב כפול: ספקים איטיים (תמונות WaveSpeed) הומרו מ-submit+poll של 90ש'
//     בתוך tick אחד → ל-submit קצר ששומר provider_job_id, ואז poll קצר אחד לכל tick.
//     אם tick נהרג באמצע — ה-provider_job_id כבר שמור, אז לעולם לא שולחים submit שני.
//  2. rate-limiting אמיתי: לפני submit בודקים concurrency + rate_limit_per_min
//     מ-ProviderConfig (cross-job). השדות שהיו קיימים — עכשיו נאכפים.
//  3. job lease (best-effort): רק tick אחד מעבד job בכל רגע — מונע races בין ה-tick
//     המתוזמן ל-tick שמופעל מ-webhook. ה-lease פג מעצמו (תקֵף JOB_LEASE_MS).
//  4. reaper: step שתקוע ב-running מעבר ל-timeout משוחזר (retry) או נכשל.
//  5. resume: action:"resume" מאתחל job שנכשל, מריץ רק שלבים שנפלו, ושומר על נכסים
//     שכבר נוצרו (אין חיוב חוזר על מה שהצליח).
//
// הערה: ה-lease הוא best-effort (BASE44 ללא atomic CAS). ב-scale אמיתי — worker
// חיצוני + Redis/BullMQ. לווליום של כלי פנימי זה מספיק.
// ============================================================================

const MAX_ATTEMPTS = 3;
const JOB_LEASE_MS = 90_000;          // tick לא יחפוף על אותו job
const STEP_STALE_MS = 5 * 60_000;     // step "running" בלי provider_job_id מעבר לזה = יתום → retry
const POLL_TIMEOUT_MS = 12 * 60_000;  // step נסקר (poll) יותר מדי זמן → נכשל
const MAX_SUBMITS_PER_TICK = 6;       // חסם submits חדשים ל-tick
const MAX_SYNC_HEAVY_PER_TICK = 1;    // חסם פעולות סינכרוניות-כבדות (TTS/Scribe) ל-tick
const MAX_FINALIZE_PER_TICK = 4;      // חסם הורדה+העלאה של תמונות שהושלמו ל-tick

const WS_BASE = "https://api.wavespeed.ai/api/v3";
const WS_COST = { "nano-banana": 0.038, "nano-banana-pro": 0.08 };
const WS_RATIOS = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

// סיווג ספקים לפי אופן הריצה
const IMG_WS = new Set(["nano_banana", "wavespeed"]);        // תמונה דרך WaveSpeed: submit→poll
const ASYNC_STUB = new Set(["veo", "kling", "heygen"]);      // וידאו/אווטאר: submit→poll (stub עד אינטגרציה אמיתית)
const SYNC_HEAVY = new Set(["elevenlabs", "scribe", "openrouter"]); // קריאה קצרה חוסמת — אחת ל-tick
const SYNC_INSTANT = new Set(["library", "suno", "stock"]);  // מיידי
const isPollable = (p) => IMG_WS.has(p) || ASYNC_STUB.has(p);

// ----- בניית ה-DAG לפי videoType (ללא שינוי מהותי) -----
function buildSteps(brief) {
  const steps = [];
  const vt = brief.format.videoType;
  const isAvatar = vt === "ugc_avatar";
  const primaryRatio = (brief.format.aspectRatios || ["9:16"])[0];

  if (brief.voiceover?.enabled) {
    steps.push({ name: "voiceover", provider: "elevenlabs", depends_on: [], input: { script: brief.voiceover.fullScript, voiceId: brief.voiceover.voiceId }, async: false });
  }

  for (const s of brief.scenes) {
    if (isAvatar) {
      steps.push({
        name: `visual:${s.id}`, provider: "heygen",
        depends_on: brief.voiceover?.enabled ? ["voiceover"] : [],
        input: { scene: s, brand: brief.project.brand, avatarId: brief.avatar?.avatarId, script: s.script || brief.voiceover?.fullScript, aspectRatio: primaryRatio },
        async: true,
      });
    } else {
      const src = s.visual.source;
      steps.push({
        name: `visual:${s.id}`,
        provider: src === "nano_banana" ? "nano_banana" : src === "wavespeed" ? "wavespeed" : src === "openrouter" ? "openrouter" : src === "veo" ? "veo" : src === "kling" ? "kling" : "stock",
        depends_on: [],
        input: { scene: s, brand: brief.project.brand, aspectRatio: primaryRatio },
        async: ["veo", "kling"].includes(src),
      });
    }
  }

  if (brief.captions?.enabled) {
    steps.push({ name: "captions", provider: "scribe", depends_on: brief.voiceover?.enabled ? ["voiceover"] : [], input: {}, async: false });
  }
  if (brief.music?.enabled) {
    steps.push({ name: "music", provider: brief.music.source === "suno" ? "suno" : "library", depends_on: [], input: { mood: brief.music.mood, trackRef: brief.music.trackRef }, async: false });
  }
  return steps;
}

function buildImagePrompt(scene, brand) {
  const b = brand || {};
  return [
    scene.visual?.prompt || scene.script || scene.onScreenText || "professional marketing scene",
    b.style ? `style: ${b.style}` : "",
    Array.isArray(b.colors) && b.colors.length ? `brand colors: ${b.colors.join(", ")}` : "",
    "cinematic, high quality, professional photography",
  ].filter(Boolean).join(", ");
}

// ----- WaveSpeed מפוצל ל-submit / poll / finalize (במקום בלוק 90ש' אחד) -----
async function wsSubmit(prompt, aspectRatio, model) {
  const apiKey = Deno.env.get("WAVESPEED_API_KEY");
  if (!apiKey) throw new Error("WAVESPEED_API_KEY not configured");
  const modelName = model === "nano-banana-pro" ? "nano-banana-pro" : "nano-banana";
  const ratio = WS_RATIOS.includes(aspectRatio) ? aspectRatio : "1:1";
  const res = await fetch(`${WS_BASE}/google/${modelName}/text-to-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ prompt, aspect_ratio: ratio, output_format: "png" }),
  });
  if (!res.ok) throw new Error(`wavespeed submit ${res.status}: ${await res.text()}`);
  const d = await res.json();
  const id = d?.data?.id || d?.id;
  if (!id) throw new Error("wavespeed: no prediction id");
  return id;
}

async function wsPoll(predictionId) {
  const apiKey = Deno.env.get("WAVESPEED_API_KEY");
  const res = await fetch(`${WS_BASE}/predictions/${predictionId}/result`, { headers: { "Authorization": `Bearer ${apiKey}` } });
  if (!res.ok) return { status: "running" };
  const d = (await res.json())?.data || {};
  if (d.status === "completed") return { status: "completed", imageUrl: (d.outputs && d.outputs[0]) || (d.output && d.output[0]) || d.url };
  if (d.status === "failed") return { status: "failed", error: d.error || "wavespeed failed" };
  return { status: "running" };
}

async function finalizeImage(sr, imageUrl, predictionId) {
  const blob = await fetch(imageUrl).then(r => r.blob());
  const file = new File([blob], `ws-${predictionId}.png`, { type: "image/png" });
  const up = await sr.integrations.Core.UploadFile({ file });
  return up.file_url;
}

// ----- submit לשלב pollable (קצר, מחזיר provider_job_id) -----
async function submitStep(sr, step) {
  const p = step.provider;
  if (IMG_WS.has(p)) {
    const scene = step.input?.scene || {};
    const prompt = buildImagePrompt(scene, step.input?.brand);
    const model = scene.visual?.quality === "pro" ? "nano-banana-pro" : "nano-banana";
    return await wsSubmit(prompt, step.input?.aspectRatio || "9:16", model);
  }
  if (ASYNC_STUB.has(p)) {
    // TODO: כאן תבוא קריאת submit אמיתית ל-HeyGen / Veo / Kling.
    return `${p}_${Date.now()}`;
  }
  throw new Error("submitStep on non-pollable provider " + p);
}

// ----- poll לשלב pollable (קצר). מסיים את השלב אם מוכן. -----
async function pollStep(sr, job, step) {
  const p = step.provider;
  if (IMG_WS.has(p)) {
    const r = await wsPoll(step.provider_job_id);
    if (r.status === "completed") {
      const url = await finalizeImage(sr, r.imageUrl, step.provider_job_id);
      const scene = step.input?.scene || {};
      const model = scene.visual?.quality === "pro" ? "nano-banana-pro" : "nano-banana";
      await saveStepResult(sr, job, step, { assets: [{ type: "still", url, scene_id: scene.id, meta: { provider_url: r.imageUrl } }], cost: WS_COST[model] });
      return "succeeded";
    }
    if (r.status === "failed") { await retryOrFail(sr, job, step, r.error); return "ended"; }
    return "running";
  }
  if (ASYNC_STUB.has(p)) {
    // STUB: HeyGen/Veo/Kling מסומנים כמושלמים מיד עם placeholder.
    // אזהרה: ugc_avatar יפיק רינדור עם קליפ placeholder עד שמחברים adapter אמיתי.
    const scene = step.input?.scene || {};
    if (p === "heygen") {
      await saveStepResult(sr, job, step, { assets: [{ type: "avatar_clip", url: "https://placeholder/avatar.mp4", scene_id: scene.id, meta: { avatarId: step.input?.avatarId, stub: true } }], cost: 1.20 });
    } else {
      await saveStepResult(sr, job, step, { assets: [{ type: "video_clip", url: "https://placeholder/gen.mp4", scene_id: scene.id, meta: { stub: true } }], cost: 0 });
    }
    return "succeeded";
  }
  return "running";
}

// ----- adapters סינכרוניים (קצרים): TTS / Scribe / OpenRouter / מוזיקה -----
async function runSyncAdapter(sr, provider, input) {
  switch (provider) {
    case "openrouter": {
      const scene = input.scene || {};
      const ratio = input.aspectRatio || "9:16";
      const prompt = buildImagePrompt(scene, input.brand);
      const res = await sr.functions.invoke("genImageOpenRouter", { prompt, aspectRatio: ratio, model: scene.visual?.model });
      const data = res.data || res;
      if (data.error) throw new Error(`genImageOpenRouter: ${data.error}`);
      return { assets: [{ type: "still", url: data.url, scene_id: scene.id }], cost: data.cost_usd || 0 };
    }
    case "elevenlabs": {
      const res = await sr.functions.invoke("ttsElevenLabs", { script: input.script, voiceId: input.voiceId });
      const data = res.data || res;
      if (data.error) throw new Error(`ttsElevenLabs: ${data.error}`);
      return { assets: [{ type: "voiceover", url: data.url, meta: { units: data.units } }], cost: data.cost_usd || 0 };
    }
    case "scribe": {
      if (!input.audioUrl) throw new Error("scribe: missing voiceover audioUrl");
      const res = await sr.functions.invoke("transcribeScribe", { audioUrl: input.audioUrl });
      const data = res.data || res;
      if (data.error) throw new Error(`transcribeScribe: ${data.error}`);
      return { assets: [{ type: "caption_data", url: data.url, meta: { words: data.words?.length || 0 } }], cost: data.cost_usd || 0 };
    }
    case "library":
      // רק טראק אמיתי (http) נשמר; אחרת אין מוזיקה (כדי לא להפיל רינדור על placeholder)
      return /^https?:\/\//.test(input.trackRef || "") ? { assets: [{ type: "music_track", url: input.trackRef }], cost: 0 } : { assets: [], cost: 0 };
    case "suno":
      // TODO: אינטגרציית Suno אמיתית. כרגע אין נכס (במקום placeholder שבור).
      return { assets: [], cost: 0 };
    case "stock":
      return { assets: [], cost: 0 };
    default:
      return { assets: [], cost: 0 };
  }
}

// הזרקת תלויות זמן-ריצה: Scribe צריך את ה-URL של אודיו הקריינות.
async function resolveInput(sr, jobId, step) {
  const input = { ...(step.input || {}) };
  if (step.provider === "scribe" && !input.audioUrl) {
    const vo = (await sr.entities.Asset.filter({ job_id: jobId, type: "voiceover" }))[0];
    input.audioUrl = vo?.url;
  }
  return input;
}

async function saveStepResult(sr, job, step, r) {
  for (const a of (r.assets || [])) {
    await sr.entities.Asset.create({ account_id: job.account_id, job_id: job.id, job_step_id: step.id, type: a.type, url: a.url, scene_id: a.scene_id, meta: a.meta || {} });
  }
  await sr.entities.ApiCostLog.create({ account_id: job.account_id, job_id: job.id, job_step_id: step.id, provider: step.provider, step: step.name, cost_usd: r.cost || 0 });
  await sr.entities.JobStep.update(step.id, { status: "succeeded", output: { assets: r.assets } });
}

async function retryOrFail(sr, job, step, error) {
  const attempt = (step.attempt || 0); // כבר הועלה ב-claim; לא מעלים שוב כאן
  if (attempt >= MAX_ATTEMPTS) {
    await sr.entities.JobStep.update(step.id, { status: "failed", error });
  } else {
    // איפוס לקראת ניסיון חוזר — מנקים provider_job_id ו-started_at כדי שיישלח submit נקי
    await sr.entities.JobStep.update(step.id, { status: "pending", error, provider_job_id: null, started_at: null });
  }
}

// ----- rate-limiting מ-ProviderConfig (cross-job) -----
function loadCfg(configs) { const m = {}; for (const c of configs) m[c.provider] = c; return m; }
async function rateOk(sr, cfgMap, provider) {
  const cfg = cfgMap[provider];
  if (!cfg) return true;
  if (cfg.concurrency != null) {
    const running = await sr.entities.JobStep.filter({ provider, status: "running" });
    if (running.length >= cfg.concurrency) return false;
  }
  if (cfg.rate_limit_per_min != null) {
    const since = Date.now() - 60_000;
    const recent = (await sr.entities.JobStep.filter({ provider })).filter(s => s.started_at && new Date(s.started_at).getTime() > since);
    if (recent.length >= cfg.rate_limit_per_min) return false;
  }
  return true;
}

// ----- שליחת בקשת רינדור לשירות Remotion (Railway) — ללא functions.invoke פנימי -----
async function submitRender(sr, jobId, brief) {
  const renderUrl = Deno.env.get("RAILWAY_RENDER_URL");
  const secret = Deno.env.get("RENDER_WEBHOOK_SECRET");
  if (!renderUrl || !secret) throw new Error("RAILWAY_RENDER_URL / RENDER_WEBHOOK_SECRET not configured");

  const assets = await sr.entities.Asset.filter({ job_id: jobId });
  const scenes = (brief.json?.scenes || []).map((s) => {
    const visual = assets.find(a => a.scene_id === s.id && ["still", "avatar_clip", "broll", "video_clip"].includes(a.type));
    return {
      id: s.id, durationSec: s.durationSec || 4,
      visualUrl: visual?.url || null, visualType: visual?.type || "still",
      text: s.onScreenText || s.script || "",
      transition: s.transition || { type: brief.json?.format?.defaultTransition || "fade", durationSec: 0.4 },
      words: [],
    };
  });

  const voiceover = assets.find(a => a.type === "voiceover")?.url || null;
  const music = assets.find(a => a.type === "music_track")?.url || null;
  const captionData = assets.find(a => a.type === "caption_data")?.url || null;

  let voiceSegments = [];
  if (captionData && brief.json?.captions?.enabled) {
    try {
      const cd = await fetch(captionData).then(r => r.json());
      const allWords = cd.words || cd;
      if (Array.isArray(allWords) && allWords.length) {
        let acc = 0;
        for (const sc of scenes) {
          const start = acc, end = acc + (sc.durationSec || 4);
          sc.words = allWords.filter(w => w.start >= start && w.start < end).map(w => ({ word: w.word, start: w.start, end: w.end }));
          acc = end;
        }
        voiceSegments = allWords.map(w => ({ start: w.start, end: w.end }));
      }
    } catch (e) { console.error("caption_data parse failed:", e.message); }
  }

  const renders = await sr.entities.Render.filter({ job_id: jobId });
  const aspectRatios = renders.map(r => r.aspect_ratio);
  const appId = Deno.env.get("BASE44_APP_ID");
  const base = `https://${appId}.base44.app/api/apps/${appId}`;
  const payload = {
    jobId, brand: brief.json?.project?.brand || {}, scenes, voiceover, music, captionData, voiceSegments, aspectRatios,
    callbackUrl: `${base}/functions/renderWebhook?secret=${encodeURIComponent(secret)}`,
    uploadUrl: `${base}/functions/uploadRender?secret=${encodeURIComponent(secret)}`,
  };
  const res = await fetch(renderUrl.replace(/\/$/, "") + "/render", {
    method: "POST", headers: { "Content-Type": "application/json", "x-render-secret": secret }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`render service ${res.status}: ${await res.text()}`);
}

// ----- credits -----
async function captureCredits(sr, job) {
  const logs = await sr.entities.ApiCostLog.filter({ job_id: job.id });
  const totalUsd = logs.reduce((sum, l) => sum + (l.cost_usd || 0), 0);
  const brief = await sr.entities.Brief.get(job.brief_id);
  const markup = brief.json?.cost?.markup || 5;
  const actualCredits = Math.ceil((totalUsd * 3.7 * markup) / 0.15);
  const heldCredits = brief.json?.cost?.credits || actualCredits;
  const capture = Math.min(actualCredits, heldCredits);
  await sr.entities.CreditLedger.create({ account_id: job.account_id, project_id: job.project_id, job_id: job.id, type: "capture", credits: capture, note: `capture בפועל ($${totalUsd.toFixed(3)})` });
}

async function refundCredits(sr, job) {
  // משחררים את ה-hold הפתוח נטו (holds − refunds קודמים) של ה-job הזה
  const ledger = await sr.entities.CreditLedger.filter({ project_id: job.project_id });
  const jobLedger = ledger.filter(l => l.job_id === job.id || l.type === "hold");
  const open = jobLedger.reduce((s, l) => s + (l.type === "hold" ? (l.credits || 0) : l.type === "refund" ? (l.credits || 0) : 0), 0);
  if (open > 0) {
    await sr.entities.CreditLedger.create({ account_id: job.account_id, project_id: job.project_id, job_id: job.id, type: "refund", credits: -open, note: `refund על כשל job ${job.id}` });
  }
}

// ----- resume: מאתחל job שנכשל, מריץ רק שלבים שנפלו, שומר נכסים שהצליחו -----
async function resumeJob(sr, jobId) {
  const job = await sr.entities.Job.get(jobId);
  if (!job) return { error: "not found" };
  if (job.state !== "failed") return { skipped: "not failed", state: job.state };

  const brief = await sr.entities.Brief.get(job.brief_id);
  const credits = brief?.json?.cost?.credits || 0;
  if (credits > 0) {
    await sr.entities.CreditLedger.create({ account_id: job.account_id, project_id: job.project_id, job_id: job.id, type: "hold", credits, note: `re-hold לחידוש job ${job.id}` });
  }

  // איפוס רק שלבים שנכשלו; שלבים שהצליחו ונכסיהם נשמרים (אין חיוב חוזר)
  const steps = await sr.entities.JobStep.filter({ job_id: jobId });
  for (const s of steps) {
    if (s.status === "failed") await sr.entities.JobStep.update(s.id, { status: "pending", attempt: 0, error: null, provider_job_id: null, started_at: null });
  }

  // איפוס רינדורים שנכשלו
  const renders = await sr.entities.Render.filter({ job_id: jobId });
  let hadFailedRender = false;
  for (const r of renders) {
    if (r.status === "failed") { hadFailedRender = true; await sr.entities.Render.update(r.id, { status: "rendering", error: null, url: null }); }
  }

  await sr.entities.Job.update(jobId, { state: "generating_assets", error_message: null, lease_until: null });
  await sr.entities.Project.update(job.project_id, { status: "approved" });

  // אם הכשל היה ברינדור (כל השלבים כבר הצליחו) — שולחים רינדור מחדש
  if (hadFailedRender) {
    try { await submitRender(sr, jobId, brief); await sr.entities.Job.update(jobId, { state: "rendering" }); }
    catch (e) { console.error("resume submitRender:", e.message); }
  }
  return { resumed: true, rehold: credits };
}

// ============================== tick ==============================
async function tick(sr, jobId, cfgMap) {
  let job = await sr.entities.Job.get(jobId);
  if (!job) return { jobId, skipped: "not found" };
  if (["completed", "failed", "refunded", "delivered"].includes(job.state)) return { jobId, skipped: job.state };

  // lease (best-effort)
  const now = Date.now();
  if (job.lease_until && new Date(job.lease_until).getTime() > now) return { jobId, skipped: "leased" };
  await sr.entities.Job.update(jobId, { lease_until: new Date(now + JOB_LEASE_MS).toISOString() });

  try {
    const brief = await sr.entities.Brief.get(job.brief_id);

    // סגירה מוקדמת לפי רינדורים
    let renders = await sr.entities.Render.filter({ job_id: jobId });
    if (renders.length && renders.every(r => r.status === "completed")) {
      await captureCredits(sr, job);
      await sr.entities.Job.update(jobId, { state: "completed", progress_pct: 100, completed_at: new Date().toISOString(), lease_until: null });
      await sr.entities.Project.update(job.project_id, { status: "delivered" });
      return { jobId, state: "completed" };
    }
    if (renders.length && renders.some(r => r.status === "failed")) {
      await refundCredits(sr, job);
      await sr.entities.Job.update(jobId, { state: "failed", lease_until: null });
      await sr.entities.Project.update(job.project_id, { status: "failed" });
      return { jobId, state: "failed" };
    }

    // יצירת steps בפעם הראשונה
    let steps = await sr.entities.JobStep.filter({ job_id: jobId });
    if (steps.length === 0) {
      for (const d of buildSteps(brief.json)) {
        await sr.entities.JobStep.create({ account_id: job.account_id, job_id: jobId, name: d.name, provider: d.provider, status: "pending", attempt: 0, depends_on: d.depends_on, input: d.input });
      }
      await sr.entities.Job.update(jobId, { state: "generating_assets" });
      steps = await sr.entities.JobStep.filter({ job_id: jobId });
    }

    // reaper — שלבים תקועים ב-running
    for (const s of steps.filter(s => s.status === "running")) {
      const age = s.started_at ? Date.now() - new Date(s.started_at).getTime() : Infinity;
      if (!s.provider_job_id && age > STEP_STALE_MS) await retryOrFail(sr, job, s, "orphaned running (tick lost)");
      else if (s.provider_job_id && age > POLL_TIMEOUT_MS) await retryOrFail(sr, job, s, "poll timeout");
    }
    steps = await sr.entities.JobStep.filter({ job_id: jobId });

    // poll לשלבים pollable שב-running (חסום finalize ל-tick)
    let finalized = 0;
    for (const s of steps.filter(s => s.status === "running" && s.provider_job_id)) {
      if (finalized >= MAX_FINALIZE_PER_TICK) break;
      try {
        const res = await pollStep(sr, job, s);
        if (res === "succeeded") finalized++;
      } catch (e) { await retryOrFail(sr, job, s, e.message); }
    }
    steps = await sr.entities.JobStep.filter({ job_id: jobId });

    // הרצת שלבים זמינים (deps מסופקות) — עם claim לפני עבודה + rate-limit + חסמים
    const byName = Object.fromEntries(steps.map(s => [s.name, s]));
    const depsOk = (s) => (s.depends_on || []).every(d => byName[d]?.status === "succeeded");
    const runnable = steps.filter(s => s.status === "pending" && depsOk(s));

    let submits = 0, syncHeavy = 0;
    for (const s of runnable) {
      const p = s.provider;
      if (!(await rateOk(sr, cfgMap, p))) continue;

      if (isPollable(p)) {
        if (submits >= MAX_SUBMITS_PER_TICK) continue;
        try {
          // claim: מסמנים running + started_at + attempt++ לפני submit (מונע ריצה כפולה)
          await sr.entities.JobStep.update(s.id, { status: "running", started_at: new Date().toISOString(), attempt: (s.attempt || 0) + 1 });
          const pid = await submitStep(sr, s);
          await sr.entities.JobStep.update(s.id, { provider_job_id: pid });
          submits++;
        } catch (e) {
          await retryOrFail(sr, job, { ...s, attempt: (s.attempt || 0) + 1 }, e.message);
        }
      } else if (SYNC_HEAVY.has(p)) {
        if (syncHeavy >= MAX_SYNC_HEAVY_PER_TICK) continue;
        syncHeavy++;
        try {
          await sr.entities.JobStep.update(s.id, { status: "running", started_at: new Date().toISOString(), attempt: (s.attempt || 0) + 1 });
          const r = await runSyncAdapter(sr, p, await resolveInput(sr, jobId, s));
          await saveStepResult(sr, job, s, r);
        } catch (e) {
          await retryOrFail(sr, job, { ...s, attempt: (s.attempt || 0) + 1 }, e.message);
        }
      } else { // SYNC_INSTANT
        try {
          await sr.entities.JobStep.update(s.id, { status: "running", started_at: new Date().toISOString(), attempt: (s.attempt || 0) + 1 });
          const r = await runSyncAdapter(sr, p, await resolveInput(sr, jobId, s));
          await saveStepResult(sr, job, s, r);
        } catch (e) {
          await retryOrFail(sr, job, { ...s, attempt: (s.attempt || 0) + 1 }, e.message);
        }
      }
    }

    steps = await sr.entities.JobStep.filter({ job_id: jobId });
    const allSucceeded = steps.length > 0 && steps.every(s => s.status === "succeeded");
    const anyFailed = steps.some(s => s.status === "failed");

    // progress עד 75% בשלב הנכסים
    const done = steps.filter(s => s.status === "succeeded").length;
    const pct = steps.length ? Math.min(75, Math.round((done / steps.length) * 75)) : 0;
    if (!allSucceeded && !anyFailed) await sr.entities.Job.update(jobId, { progress_pct: pct });

    // הפעלת רינדור כשכל הנכסים מוכנים
    renders = await sr.entities.Render.filter({ job_id: jobId });
    if (allSucceeded && renders.length === 0) {
      for (const ar of brief.json.format.aspectRatios) {
        await sr.entities.Render.create({ account_id: job.account_id, job_id: jobId, aspect_ratio: ar, status: "rendering" });
      }
      await sr.entities.Job.update(jobId, { state: "rendering", progress_pct: 80 });
      try { await submitRender(sr, jobId, brief); } catch (e) { console.error("submitRender failed:", e.message); }
      renders = await sr.entities.Render.filter({ job_id: jobId });
    }

    // סגירה
    if (renders.length && renders.every(r => r.status === "completed")) {
      await captureCredits(sr, job);
      await sr.entities.Job.update(jobId, { state: "completed", progress_pct: 100, completed_at: new Date().toISOString(), lease_until: null });
      await sr.entities.Project.update(job.project_id, { status: "delivered" });
      return { jobId, state: "completed" };
    }
    if (anyFailed) {
      await refundCredits(sr, job);
      await sr.entities.Job.update(jobId, { state: "failed", lease_until: null });
      await sr.entities.Project.update(job.project_id, { status: "failed" });
      return { jobId, state: "failed" };
    }

    await sr.entities.Job.update(jobId, { lease_until: null }); // שחרור lease
    return { jobId, state: job.state, steps: steps.map(s => ({ name: s.name, status: s.status })) };
  } catch (e) {
    await sr.entities.Job.update(jobId, { lease_until: null }).catch(() => {});
    throw e;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const cfgMap = loadCfg(await sr.entities.ProviderConfig.list());

    // resume של job שנכשל (מופעל מכפתור "נסה שוב")
    if (body.action === "resume" && body.job_id) {
      const resumed = await resumeJob(sr, body.job_id);
      const ticked = await tick(sr, body.job_id, cfgMap);
      return Response.json({ resumed, ticked });
    }

    let jobIds = [];
    if (body.job_id) {
      jobIds = [body.job_id];
    } else {
      // scheduler: כל ה-jobs הפעילים (מומלץ schedule כל דקה)
      const active = await sr.entities.Job.filter({ state: "approved" });
      const gen = await sr.entities.Job.filter({ state: "generating_assets" });
      const rend = await sr.entities.Job.filter({ state: "rendering" });
      jobIds = [...active, ...gen, ...rend].map(j => j.id);
    }

    const ticked = [];
    for (const jobId of jobIds) {
      try { ticked.push(await tick(sr, jobId, cfgMap)); }
      catch (e) { ticked.push({ jobId, error: e.message }); }
    }
    return Response.json({ ticked });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});