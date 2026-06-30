import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// triggerRender — שולח בקשת רינדור לשירות Remotion החיצוני (Railway).
// נקרא ע"י ה-orchestrator כשכל שלבי הנכסים הצליחו.
// payload: { job_id }
// השירות מרנדר אסינכרונית ומחזיר תוצאות ל-renderWebhook עם ה-secret.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const { job_id } = await req.json().catch(() => ({}));
    if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 });

    const renderUrl = Deno.env.get("RAILWAY_RENDER_URL");
    const secret = Deno.env.get("RENDER_WEBHOOK_SECRET");
    if (!renderUrl || !secret) {
      return Response.json({ error: 'RAILWAY_RENDER_URL / RENDER_WEBHOOK_SECRET not configured' }, { status: 500 });
    }

    const job = await sr.entities.Job.get(job_id);
    if (!job) return Response.json({ error: 'job not found' }, { status: 404 });

    const brief = await sr.entities.Brief.get(job.brief_id);
    const assets = await sr.entities.Asset.filter({ job_id });

    // בניית מבנה הסצנות לשירות הרינדור: לכל סצנה — נכס ויזואלי + טקסט
    const scenes = (brief.json?.scenes || []).map((s) => {
      const visual = assets.find(a => a.scene_id === s.id && ["still", "avatar_clip", "broll"].includes(a.type));
      return {
        id: s.id,
        durationSec: s.durationSec || 4,
        visualUrl: visual?.url || null,
        visualType: visual?.type || "still",
        text: s.onScreenText || s.script || "",
      };
    });

    const voiceover = assets.find(a => a.type === "voiceover")?.url || null;
    const music = assets.find(a => a.type === "music_track")?.url || null;
    const captionData = assets.find(a => a.type === "caption_data")?.url || null;
    const renders = await sr.entities.Render.filter({ job_id });
    const aspectRatios = renders.map(r => r.aspect_ratio);

    // callback URL חוזר ל-renderWebhook עם ה-secret
    const appId = Deno.env.get("BASE44_APP_ID");
    const callbackUrl = `${url_origin(req)}/api/apps/${appId}/functions/renderWebhook?secret=${encodeURIComponent(secret)}`;
    // uploadUrl — שירות הרינדור מעלה אליו את ה-MP4, והוא נשמר באחסון Base44
    const uploadUrl = `${url_origin(req)}/api/apps/${appId}/functions/uploadRender?secret=${encodeURIComponent(secret)}`;

    const payload = {
      jobId: job_id,
      brand: brief.json?.project?.brand || {},
      scenes,
      voiceover,
      music,
      captionData,
      aspectRatios,
      callbackUrl,
      uploadUrl,
    };

    const res = await fetch(renderUrl.replace(/\/$/, "") + "/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-render-secret": secret },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text();
      return Response.json({ error: `render service ${res.status}: ${txt}` }, { status: 502 });
    }

    return Response.json({ success: true, submitted: aspectRatios });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function url_origin(req) {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}