import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ה-Orchestrator (MVP בתוך BASE44) — בונה DAG לפי videoType, מריץ steps מול adapters,
// מקדם async steps, מפעיל רינדור כשכל הנכסים מוכנים, וסוגר עם capture/refund.
// מיועד לריצה ע"י scheduled automation לכל job פעיל, ובנוסף מהיר ע"י webhook.

const MAX_ATTEMPTS = 3;

// ----- בניית ה-DAG לפי videoType -----
function buildSteps(brief) {
  const steps = [];
  const vt = brief.format.videoType;

  // שלבי מקור ויזואלי — לכל סצנה
  for (const s of brief.scenes) {
    steps.push({
      name: `visual:${s.id}`,
      provider: s.visual.source === "nano_banana" ? "nano_banana"
        : s.visual.source === "wavespeed" ? "wavespeed"
        : s.visual.source === "openrouter" ? "openrouter"
        : s.visual.source === "veo" ? "veo"
        : s.visual.source === "kling" ? "kling" : "stock",
      depends_on: [],
      input: { scene: s, brand: brief.project.brand },
      async: ["veo", "kling", "heygen"].includes(s.visual.source),
    });
  }

  // קריינות
  if (brief.voiceover?.enabled) {
    steps.push({ name: "voiceover", provider: "elevenlabs", depends_on: [], input: { script: brief.voiceover.fullScript, voiceId: brief.voiceover.voiceId }, async: false });
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
      // יצירת תמונה אמיתית דרך WaveSpeed (Google Nano Banana)
      const scene = input.scene || {};
      const ratio = scene.aspectRatio || "9:16";
      const prompt = buildImagePrompt(scene, input.brand);
      const model = scene.visual?.quality === "pro" ? "nano-banana-pro" : "nano-banana";
      const res = await sr.functions.invoke("genImageWaveSpeed", { prompt, aspectRatio: ratio, model });
      const data = res.data || res;
      if (data.error) throw new Error(`genImageWaveSpeed: ${data.error}`);
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
    case "scribe":
      return { assets: [{ type: "caption_data", url: "https://placeholder/captions.json" }], cost: 0.40 };
    case "library":
      return { assets: [{ type: "music_track", url: input.trackRef || "https://placeholder/music.mp3" }], cost: 0 };
    case "suno":
      return { assets: [{ type: "music_track", url: "https://placeholder/suno.mp3" }], cost: 0.50 };
    case "stock":
      return { assets: [{ type: "still", url: "https://placeholder/stock.png" }], cost: 0 };
    default:
      return { assets: [], cost: 0 };
  }
}

async function submitAdapter(provider, input) {
  // ספק אסינכרוני — submit מחזיר providerJobId. בייצור: קריאת submit אמיתית.
  return { providerJobId: `${provider}_${Date.now()}` };
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

  // 1. קידום async steps שב-running (polling fallback) — MVP: מסומנים כמושלמים מיד
  for (const s of steps.filter(s => s.status === "running")) {
    const r = await runAdapter(sr, s.provider, s.input || {});
    await saveStepResult(sr, job, s, r);
  }

  // 2. הרצת steps זמינים
  for (const s of steps.filter(s => s.status === "pending")) {
    if (!depsOk(s)) continue;
    const isAsync = ["wavespeed", "veo", "kling", "heygen"].includes(s.provider);
    if (isAsync) {
      const { providerJobId } = await submitAdapter(s.provider, s.input || {});
      await sr.entities.JobStep.update(s.id, { status: "running", provider_job_id: providerJobId, attempt: (s.attempt || 0) + 1 });
    } else {
      try {
        const r = await runAdapter(sr, s.provider, s.input || {});
        await saveStepResult(sr, job, s, r);
      } catch (e) {
        await retryOrFail(sr, job, s, e.message);
      }
    }
  }

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
    // הפעלת שירות Remotion החיצוני (Railway) — מרנדר אסינכרונית ומחזיר ל-renderWebhook
    try {
      await sr.functions.invoke("triggerRender", { job_id: jobId });
    } catch (e) {
      // אם השירות לא מוגדר עדיין — נשאיר את הרינדורים ב-rendering למעקב ידני
      console.error("triggerRender failed:", e.message);
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