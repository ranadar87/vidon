import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ה-Orchestrator (MVP בתוך BASE44) — בונה DAG לפי videoType, מריץ steps מול adapters,
// מקדם async steps, מפעיל רינדור כשכל הנכסים מוכנים, וסוגר עם capture/refund.
// מיועד לריצה ע"י scheduled automation לכל job פעיל, ובנוסף מהיר ע"י webhook.

const MAX_ATTEMPTS = 3;

// ----- בניית ה-DAG לפי videoType -----
function buildSteps(brief) {
  const steps = [];
  const vt = brief.format.videoType;

  const isAvatar = vt === "ugc_avatar";

  // קריינות — באווטאר חייבת להיווצר ראשונה כדי לסנכרן שפתיים (lip-sync)
  if (brief.voiceover?.enabled) {
    steps.push({ name: "voiceover", provider: "elevenlabs", depends_on: [], input: { script: brief.voiceover.fullScript, voiceId: brief.voiceover.voiceId }, async: false });
  }

  // שלבי מקור ויזואלי — לכל סצנה
  for (const s of brief.scenes) {
    if (isAvatar) {
      // ugc_avatar: קליפ אווטאר HeyGen מסונכרן לקריינות. תלוי ב-voiceover (אם קיים).
      steps.push({
        name: `visual:${s.id}`,
        provider: "heygen",
        depends_on: brief.voiceover?.enabled ? ["voiceover"] : [],
        input: { scene: s, brand: brief.project.brand, avatarId: brief.avatar?.avatarId, script: s.script || brief.voiceover?.fullScript },
        async: true,
      });
    } else {
      steps.push({
        name: `visual:${s.id}`,
        provider: s.visual.source === "nano_banana" ? "nano_banana"
          : s.visual.source === "wavespeed" ? "wavespeed"
          : s.visual.source === "openrouter" ? "openrouter"
          : s.visual.source === "veo" ? "veo"
          : s.visual.source === "kling" ? "kling" : "stock",
        depends_on: [],
        input: { scene: s, brand: brief.project.brand },
        async: ["veo", "kling"].includes(s.visual.source),
      });
    }
  }

  // כתוביות — תלויות בקריינות (Scribe צריך את האודיו)
  if (brief.captions?.enabled) {
    steps.push({ name: "captions", provider: "scribe", depends_on: brief.voiceover?.enabled ? ["voiceover"] : [], input: {}, async: false });
  }

  // מוזיקה
  if (brief.music?.enabled) {
    steps.push({ name: "music", provider: brief.music.source === "suno" ? "suno" : "library", depends_on: [], input: { mood: brief.music.mood, trackRef: brief.music.trackRef }, async: false });
  }

  return steps;
}

// בניית prompt לתמונה מתוך הסצנה והמותג — משותף לכל ספקי התמונות.
function buildImagePrompt(scene, brand) {
  const b = brand || {};
  return [
    scene.visual?.prompt || scene.script || scene.onScreenText || "professional marketing scene",
    b.style ? `style: ${b.style}` : "",
    Array.isArray(b.colors) && b.colors.length ? `brand colors: ${b.colors.join(", ")}` : "",
    "cinematic, high quality, professional photography",
  ].filter(Boolean).join(", ");
}

// ----- מיפוי adapter לכל ספק. elevenlabs מחובר ל-API אמיתי; השאר stubs להחלפה הדרגתית. -----
async function runAdapter(sr, provider, input) {
  // ספק סינכרוני קצר — מחזיר assets + cost. בייצור: קריאת HTTP אמיתית לספק.
  switch (provider) {
    case "nano_banana":
    case "wavespeed": {
      // יצירת תמונה אמיתית דרך WaveSpeed (Google Nano Banana) — inline, ללא קריאת
      // functions.invoke פנימית (זו נכשלת ב-403 עקב timeout קצר על ה-poll הארוך).
      const scene = input.scene || {};
      const ratio = scene.aspectRatio || "9:16";
      const prompt = buildImagePrompt(scene, input.brand);
      const model = scene.visual?.quality === "pro" ? "nano-banana-pro" : "nano-banana";
      const data = await genWaveSpeedImage(sr, { prompt, aspectRatio: ratio, model });
      return { assets: [{ type: "still", url: data.url, scene_id: scene.id, meta: { provider_url: data.provider_image_url } }], cost: data.cost_usd || 0 };
    }
    case "openrouter": {
      // יצירת תמונה אמיתית דרך OpenRouter Image API
      const scene = input.scene || {};
      const ratio = scene.aspectRatio || "9:16";
      const prompt = buildImagePrompt(scene, input.brand);
      const res = await sr.functions.invoke("genImageOpenRouter", { prompt, aspectRatio: ratio, model: scene.visual?.model });
      const data = res.data || res;
      if (data.error) throw new Error(`genImageOpenRouter: ${data.error}`);
      return { assets: [{ type: "still", url: data.url, scene_id: scene.id }], cost: data.cost_usd || 0 };
    }
    case "elevenlabs": {
      // קריינות אמיתית מול ElevenLabs דרך פונקציית ttsElevenLabs
      const res = await sr.functions.invoke("ttsElevenLabs", { script: input.script, voiceId: input.voiceId });
      const data = res.data || res;
      if (data.error) throw new Error(`ttsElevenLabs: ${data.error}`);
      return { assets: [{ type: "voiceover", url: data.url, meta: { units: data.units } }], cost: data.cost_usd || 0 };
    }
    case "heygen": {
      // קליפ אווטאר UGC מסונכרן-שפתיים. MVP: stub — בייצור קריאת submit/poll אמיתית מול HeyGen.
      const scene = input.scene || {};
      return { assets: [{ type: "avatar_clip", url: "https://placeholder/avatar.mp4", scene_id: scene.id, meta: { avatarId: input.avatarId } }], cost: 1.20 };
    }
    case "scribe": {
      // כתוביות word-level אמיתיות דרך Scribe STT על האודיו של הקריינות
      if (!input.audioUrl) throw new Error("scribe: missing voiceover audioUrl");
      const res = await sr.functions.invoke("transcribeScribe", { audioUrl: input.audioUrl });
      const data = res.data || res;
      if (data.error) throw new Error(`transcribeScribe: ${data.error}`);
      return { assets: [{ type: "caption_data", url: data.url, meta: { words: data.words?.length || 0 } }], cost: data.cost_usd || 0 };
    }
    case "library":
      // רק טראק אמיתי (URL http) נשמר כנכס; אחרת אין מוזיקה — אחרת הרינדור נכשל
      // בניסיון להוריד placeholder לא קיים.
      return /^https?:\/\//.test(input.trackRef || "")
        ? { assets: [{ type: "music_track", url: input.trackRef }], cost: 0 }
        : { assets: [], cost: 0 };
    case "suno":
      return { assets: [{ type: "music_track", url: "https://placeholder/suno.mp3" }], cost: 0.50 };
    case "stock":
      return { assets: [{ type: "still", url: "https://placeholder/stock.png" }], cost: 0 };
    default:
      return { assets: [], cost: 0 };
  }
}

// יצירת תמונה inline דרך WaveSpeed: submit → poll → הורדה והעלאה לאחסון Base44.
// מועתק מ-genImageWaveSpeed כדי להימנע מקריאת functions.invoke פנימית (403 על poll ארוך).
const WS_BASE = "https://api.wavespeed.ai/api/v3";
const WS_COST = { "nano-banana": 0.038, "nano-banana-pro": 0.08 };
const WS_RATIOS = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

async function genWaveSpeedImage(sr, { prompt, aspectRatio, model }) {
  const apiKey = Deno.env.get("WAVESPEED_API_KEY");
  if (!apiKey) throw new Error("WAVESPEED_API_KEY not configured");
  const modelName = model === "nano-banana-pro" ? "nano-banana-pro" : "nano-banana";
  const ratio = WS_RATIOS.includes(aspectRatio) ? aspectRatio : "1:1";

  const submitRes = await fetch(`${WS_BASE}/google/${modelName}/text-to-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ prompt, aspect_ratio: ratio, output_format: "png" }),
  });
  if (!submitRes.ok) throw new Error(`wavespeed submit ${submitRes.status}: ${await submitRes.text()}`);
  const submitData = await submitRes.json();
  const predictionId = submitData?.data?.id || submitData?.id;
  if (!predictionId) throw new Error("wavespeed returned no prediction id");

  let imageUrl = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const pollRes = await fetch(`${WS_BASE}/predictions/${predictionId}/result`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    if (!pollRes.ok) continue;
    const d = (await pollRes.json())?.data || {};
    if (d.status === "completed") { imageUrl = (d.outputs && d.outputs[0]) || (d.output && d.output[0]) || d.url; break; }
    if (d.status === "failed") throw new Error(`wavespeed failed: ${d.error || "unknown"}`);
  }
  if (!imageUrl) throw new Error("wavespeed timeout");

  const blob = await fetch(imageUrl).then(r => r.blob());
  const file = new File([blob], `wavespeed-${predictionId}.png`, { type: "image/png" });
  const uploaded = await sr.integrations.Core.UploadFile({ file });
  return { url: uploaded.file_url, cost_usd: WS_COST[modelName], provider_image_url: imageUrl };
}

async function submitAdapter(provider, input) {
  // ספק אסינכרוני — submit מחזיר providerJobId. בייצור: קריאת submit אמיתית.
  return { providerJobId: `${provider}_${Date.now()}` };
}

// שליחת בקשת רינדור לשירות Remotion (Railway) inline — מועתק מ-triggerRender כדי
// להימנע מקריאת functions.invoke פנימית (403). מרנדר אסינכרונית ומחזיר ל-renderWebhook.
async function submitRender(sr, jobId, brief) {
  const renderUrl = Deno.env.get("RAILWAY_RENDER_URL");
  const secret = Deno.env.get("RENDER_WEBHOOK_SECRET");
  if (!renderUrl || !secret) throw new Error("RAILWAY_RENDER_URL / RENDER_WEBHOOK_SECRET not configured");

  const assets = await sr.entities.Asset.filter({ job_id: jobId });
  const scenes = (brief.json?.scenes || []).map((s) => {
    const visual = assets.find(a => a.scene_id === s.id && ["still", "avatar_clip", "broll"].includes(a.type));
    return {
      id: s.id,
      durationSec: s.durationSec || 4,
      visualUrl: visual?.url || null,
      visualType: visual?.type || "still",
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
          const start = acc;
          const end = acc + (sc.durationSec || 4);
          sc.words = allWords.filter(w => w.start >= start && w.start < end).map(w => ({ word: w.word, start: w.start, end: w.end }));
          acc = end;
        }
        voiceSegments = allWords.map(w => ({ start: w.start, end: w.end }));
      }
    } catch (e) {
      console.error("caption_data parse failed:", e.message);
    }
  }

  const renders = await sr.entities.Render.filter({ job_id: jobId });
  const aspectRatios = renders.map(r => r.aspect_ratio);

  const appId = Deno.env.get("BASE44_APP_ID");
  const base = `https://${appId}.base44.app/api/apps/${appId}`;
  const callbackUrl = `${base}/functions/renderWebhook?secret=${encodeURIComponent(secret)}`;
  const uploadUrl = `${base}/functions/uploadRender?secret=${encodeURIComponent(secret)}`;

  const payload = {
    jobId, brand: brief.json?.project?.brand || {}, scenes, voiceover, music,
    captionData, voiceSegments, aspectRatios, callbackUrl, uploadUrl,
  };

  const res = await fetch(renderUrl.replace(/\/$/, "") + "/render", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-render-secret": secret },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`render service ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // נקרא או ע"י scheduler (service) או ע"י משתמש — נשתמש ב-service role לכל הפעולות
    const sr = base44.asServiceRole;

    const body = await req.json().catch(() => ({}));
    let jobIds = [];
    if (body.job_id) {
      jobIds = [body.job_id];
    } else {
      // scheduler mode: כל ה-jobs הפעילים
      const active = await sr.entities.Job.filter({ state: "approved" });
      const gen = await sr.entities.Job.filter({ state: "generating_assets" });
      const rend = await sr.entities.Job.filter({ state: "rendering" });
      jobIds = [...active, ...gen, ...rend].map(j => j.id);
    }

    const ticked = [];
    for (const jobId of jobIds) {
      ticked.push(await tick(sr, jobId));
    }

    return Response.json({ ticked });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function tick(sr, jobId) {
  const job = await sr.entities.Job.get(jobId);
  if (!job) return { jobId, skipped: "not found" };
  if (["completed", "failed", "refunded", "delivered"].includes(job.state)) {
    return { jobId, skipped: job.state };
  }

  const brief = await sr.entities.Brief.get(job.brief_id);

  // סגירה מוקדמת: אם הרינדורים כבר הושלמו, סוגרים את ה-job מיד —
  // לפני כל ניסיון לבנות מחדש steps (אחרת ה-job "מתחיל מחדש" בטעות).
  const existingRenders = await sr.entities.Render.filter({ job_id: jobId });
  if (existingRenders.length && existingRenders.every(r => r.status === "completed")) {
    await captureCredits(sr, job);
    await sr.entities.Job.update(jobId, { state: "completed", progress_pct: 100, completed_at: new Date().toISOString() });
    await sr.entities.Project.update(job.project_id, { status: "delivered" });
    return { jobId, state: "completed" };
  }
  if (existingRenders.length && existingRenders.some(r => r.status === "failed")) {
    await refundCredits(sr, job);
    await sr.entities.Job.update(jobId, { state: "failed" });
    await sr.entities.Project.update(job.project_id, { status: "failed" });
    return { jobId, state: "failed" };
  }

  // יצירת JobSteps בפעם הראשונה
  let steps = await sr.entities.JobStep.filter({ job_id: jobId });
  if (steps.length === 0) {
    const defs = buildSteps(brief.json);
    for (const d of defs) {
      await sr.entities.JobStep.create({
        account_id: job.account_id,
        job_id: jobId,
        name: d.name,
        provider: d.provider,
        status: "pending",
        attempt: 0,
        depends_on: d.depends_on,
        input: d.input,
      });
    }
    await sr.entities.Job.update(jobId, { state: "generating_assets" });
    steps = await sr.entities.JobStep.filter({ job_id: jobId });
  }

  const byName = Object.fromEntries(steps.map(s => [s.name, s]));
  const depsOk = (s) => (s.depends_on || []).every(d => byName[d]?.status === "succeeded");

  // הזרקת תלויות זמן-ריצה ל-input: Scribe צריך את ה-URL של אודיו הקריינות.
  const resolveInput = async (s) => {
    const input = { ...(s.input || {}) };
    if (s.provider === "scribe" && !input.audioUrl) {
      const vo = (await sr.entities.Asset.filter({ job_id: jobId, type: "voiceover" }))[0];
      input.audioUrl = vo?.url;
    }
    return input;
  };

  // 1. קידום async steps שב-running (polling fallback) — MVP: מסומנים כמושלמים מיד.
  // עטוף ב-try/catch כדי שכשל ספק בודד ייפול ל-retryOrFail ולא יקריס את כל ה-tick.
  for (const s of steps.filter(s => s.status === "running")) {
    try {
      const r = await runAdapter(sr, s.provider, await resolveInput(s));
      await saveStepResult(sr, job, s, r);
    } catch (e) {
      await retryOrFail(sr, job, s, e.message);
    }
  }

  // 2. הרצת steps זמינים. שלבים סינכרוניים-כבדים (יצירת תמונה/קריינות) רצים במקביל
  // עם Promise.allSettled — אחרת ריצה סדרתית של כמה תמונות חורגת מה-timeout.
  const ready = steps.filter(s => s.status === "pending" && depsOk(s));
  const asyncReady = ready.filter(s => ["veo", "kling", "heygen"].includes(s.provider));
  const syncReady = ready.filter(s => !["veo", "kling", "heygen"].includes(s.provider));

  for (const s of asyncReady) {
    const { providerJobId } = await submitAdapter(s.provider, s.input || {});
    await sr.entities.JobStep.update(s.id, { status: "running", provider_job_id: providerJobId, attempt: (s.attempt || 0) + 1 });
  }

  await Promise.allSettled(syncReady.map(async (s) => {
    try {
      const r = await runAdapter(sr, s.provider, await resolveInput(s));
      await saveStepResult(sr, job, s, r);
    } catch (e) {
      await retryOrFail(sr, job, s, e.message);
    }
  }));

  // refresh
  steps = await sr.entities.JobStep.filter({ job_id: jobId });
  const allAssetsSucceeded = steps.every(s => s.status === "succeeded");
  const anyFailed = steps.some(s => s.status === "failed");

  // 3. הפעלת רינדור כשכל שלבי הנכסים הצליחו
  let renders = await sr.entities.Render.filter({ job_id: jobId });
  if (allAssetsSucceeded && renders.length === 0) {
    for (const ar of brief.json.format.aspectRatios) {
      await sr.entities.Render.create({ account_id: job.account_id, job_id: jobId, aspect_ratio: ar, status: "rendering" });
    }
    await sr.entities.Job.update(jobId, { state: "rendering", progress_pct: 80 });
    // הפעלת שירות Remotion החיצוני (Railway) — inline, ללא functions.invoke
    // (קריאה פנימית מחזירה 403). מרנדר אסינכרונית ומחזיר ל-renderWebhook.
    try {
      await submitRender(sr, jobId, brief);
    } catch (e) {
      console.error("submitRender failed:", e.message);
    }
    renders = await sr.entities.Render.filter({ job_id: jobId });
  }

  // 4. סגירה
  renders = await sr.entities.Render.filter({ job_id: jobId });
  if (renders.length && renders.every(r => r.status === "completed")) {
    await captureCredits(sr, job);
    await sr.entities.Job.update(jobId, { state: "completed", progress_pct: 100, completed_at: new Date().toISOString() });
    await sr.entities.Project.update(job.project_id, { status: "delivered" });
    return { jobId, state: "completed" };
  }

  if (anyFailed) {
    await refundCredits(sr, job);
    await sr.entities.Job.update(jobId, { state: "failed" });
    await sr.entities.Project.update(job.project_id, { status: "failed" });
    return { jobId, state: "failed" };
  }

  return { jobId, state: job.state, steps: steps.map(s => ({ name: s.name, status: s.status })) };
}

async function saveStepResult(sr, job, step, r) {
  for (const a of (r.assets || [])) {
    await sr.entities.Asset.create({ account_id: job.account_id, job_id: job.id, job_step_id: step.id, type: a.type, url: a.url, scene_id: a.scene_id, meta: a.meta || {} });
  }
  await sr.entities.ApiCostLog.create({ account_id: job.account_id, job_id: job.id, job_step_id: step.id, provider: step.provider, step: step.name, cost_usd: r.cost || 0 });
  await sr.entities.JobStep.update(step.id, { status: "succeeded", output: { assets: r.assets } });
}

async function retryOrFail(sr, job, step, error) {
  const attempt = (step.attempt || 0) + 1;
  if (attempt >= MAX_ATTEMPTS) {
    await sr.entities.JobStep.update(step.id, { status: "failed", attempt, error });
  } else {
    await sr.entities.JobStep.update(step.id, { status: "pending", attempt, error });
  }
}

// Capture: Σ ApiCostLog × fx × markup → credits בפועל, חסום בתקרת ה-hold
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
  const holds = await sr.entities.CreditLedger.filter({ project_id: job.project_id, type: "hold" });
  const held = holds.reduce((s, h) => s + (h.credits || 0), 0);
  await sr.entities.CreditLedger.create({ account_id: job.account_id, project_id: job.project_id, job_id: job.id, type: "refund", credits: -held, note: `refund על כשל job ${job.id}` });
}