import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Webhook מקבל תוצאות משירות ה-render החיצוני (Remotion).
// חוזה: { jobId, renders: [{ aspect_ratio, status, url }] }
// מאומת ע"י shared secret ב-query (?secret=...) כי נקרא ללא auth משתמש.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const url = new URL(req.url);
    const secret = url.searchParams.get("secret");
    if (secret !== Deno.env.get("RENDER_WEBHOOK_SECRET")) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const { jobId, renders } = await req.json();
    if (!jobId || !Array.isArray(renders)) {
      return Response.json({ error: 'jobId and renders[] required' }, { status: 400 });
    }

    // עדכון שורות Render לפי aspect_ratio
    const existing = await sr.entities.Render.filter({ job_id: jobId });
    const byRatio = Object.fromEntries(existing.map(r => [r.aspect_ratio, r]));

    for (const r of renders) {
      const row = byRatio[r.aspect_ratio];
      if (row) {
        await sr.entities.Render.update(row.id, { status: r.status, url: r.url, error: r.error });
      }
    }

    // אם כל הרינדורים הושלמו — קידום ה-job דרך ה-orchestrator
    const updated = await sr.entities.Render.filter({ job_id: jobId });
    if (updated.length && updated.every(x => x.status === "completed")) {
      await base44.functions.invoke("orchestratorTick", { job_id: jobId });
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});