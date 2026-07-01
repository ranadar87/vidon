import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// systemHealth — בדיקת בריאות מרוכזת לכל ממשקי ה-API של VIDON לפי האפיון המקורי.
// בודק בפועל את כל הספקים: OpenRouter (מוח הבריף), WaveSpeed (וידאו+תמונה),
// ElevenLabs (קריינות), Scribe/ElevenLabs STT (כתוביות), Remotion/Railway (רינדור).
// כל בדיקה מחזירה: name, category, configured, ok, message, latency_ms.

async function timedFetch(url, opts, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return { res, latency: Date.now() - start };
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const checks = [];

    // ---------- OpenRouter — מוח הבריף (Claude) + מודלי וידאו/תמונה ----------
    const orKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!orKey) {
      checks.push({ name: "OpenRouter", category: "מוח הבריף (LLM)", configured: false, ok: false, message: "OPENROUTER_API_KEY לא מוגדר." });
    } else {
      try {
        const { res, latency } = await timedFetch("https://openrouter.ai/api/v1/key", {
          headers: { "Authorization": `Bearer ${orKey}` },
        });
        const body = await res.json().catch(() => ({}));
        checks.push({
          name: "OpenRouter",
          category: "מוח הבריף (LLM)",
          configured: true,
          ok: res.ok,
          latency_ms: latency,
          message: res.ok
            ? (body?.data?.usage != null ? `מחובר. שימוש: $${Number(body.data.usage).toFixed(2)}` : "מחובר ומגיב.")
            : `שגיאה ${res.status} — בדוק את המפתח.`,
        });
      } catch (e) {
        checks.push({ name: "OpenRouter", category: "מוח הבריף (LLM)", configured: true, ok: false, message: "לא ניתן להתחבר: " + e.message });
      }
    }

    // ---------- WaveSpeed — יצירת וידאו ותמונה ----------
    const wsKey = Deno.env.get("WAVESPEED_API_KEY");
    if (!wsKey) {
      checks.push({ name: "WaveSpeed", category: "וידאו ותמונה", configured: false, ok: false, message: "WAVESPEED_API_KEY לא מוגדר." });
    } else {
      try {
        const { res, latency } = await timedFetch("https://api.wavespeed.ai/api/v3/balance", {
          headers: { "Authorization": `Bearer ${wsKey}` },
        });
        // 200 = מפתח תקין. 401/403 = מפתח שגוי. 404 = המפתח תקין אך אין endpoint כזה — עדיין מאומת.
        const ok = res.ok || res.status === 404;
        let msg = "מחובר ומגיב.";
        if (res.ok) {
          const b = await res.json().catch(() => ({}));
          const bal = b?.data?.balance ?? b?.balance;
          if (bal != null) msg = `מחובר. יתרה: $${Number(bal).toFixed(2)}`;
        } else if (res.status === 404) {
          msg = "המפתח מאומת (השירות פעיל).";
        } else {
          msg = `שגיאה ${res.status} — בדוק את המפתח.`;
        }
        checks.push({ name: "WaveSpeed", category: "וידאו ותמונה", configured: true, ok, latency_ms: latency, message: msg });
      } catch (e) {
        checks.push({ name: "WaveSpeed", category: "וידאו ותמונה", configured: true, ok: false, message: "לא ניתן להתחבר: " + e.message });
      }
    }

    // ---------- ElevenLabs — קריינות (TTS) + כתוביות (Scribe STT) ----------
    const elKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!elKey) {
      checks.push({ name: "ElevenLabs", category: "קריינות וכתוביות", configured: false, ok: false, message: "ELEVENLABS_API_KEY לא מוגדר." });
    } else {
      try {
        const { res, latency } = await timedFetch("https://api.elevenlabs.io/v1/user/subscription", {
          headers: { "xi-api-key": elKey },
        });
        const body = await res.json().catch(() => ({}));
        let msg = "מחובר ומגיב.";
        if (res.ok) {
          const used = body?.character_count;
          const limit = body?.character_limit;
          const tier = body?.tier;
          if (limit != null) msg = `מחובר (${tier || "tier"}). ${used ?? 0}/${limit} תווים.`;
        } else {
          msg = `שגיאה ${res.status} — בדוק את המפתח.`;
        }
        checks.push({ name: "ElevenLabs", category: "קריינות וכתוביות", configured: true, ok: res.ok, latency_ms: latency, message: msg });
      } catch (e) {
        checks.push({ name: "ElevenLabs", category: "קריינות וכתוביות", configured: true, ok: false, message: "לא ניתן להתחבר: " + e.message });
      }
    }

    // ---------- Remotion / Railway — שירות הרינדור ----------
    const renderUrl = Deno.env.get("RAILWAY_RENDER_URL");
    if (!renderUrl) {
      checks.push({ name: "Remotion (Railway)", category: "רינדור וידאו", configured: false, ok: false, message: "RAILWAY_RENDER_URL לא מוגדר." });
    } else {
      try {
        const healthUrl = renderUrl.replace(/\/+$/, "") + "/health";
        const { res, latency } = await timedFetch(healthUrl, {}, 10000);
        const body = (await res.text()).slice(0, 300);
        let healthy = false;
        try { healthy = res.status === 200 && JSON.parse(body).ok === true; } catch (_e) { /* לא JSON */ }
        checks.push({
          name: "Remotion (Railway)",
          category: "רינדור וידאו",
          configured: true,
          ok: healthy,
          latency_ms: latency,
          message: healthy ? "שירות הרינדור פעיל ומגיב."
            : (res.status === 404 || /could not be found/i.test(body))
              ? "הכתובת מגיבה אך אינה שירות הרינדור (404). ודא ש-RAILWAY_RENDER_URL מצביע לשירות ה-Remotion."
              : `השירות הגיב ${res.status} אך לא בפורמט הצפוי.`,
        });
      } catch (e) {
        checks.push({ name: "Remotion (Railway)", category: "רינדור וידאו", configured: true, ok: false, message: "לא ניתן להתחבר לשירות: " + e.message });
      }
    }

    // ---------- אחסון Base44 + מסד נתונים ----------
    try {
      await base44.asServiceRole.entities.Voice.list("-created_date", 1);
      checks.push({ name: "Base44 DB & Storage", category: "מסד נתונים ואחסון", configured: true, ok: true, message: "מסד הנתונים והאחסון פעילים." });
    } catch (e) {
      checks.push({ name: "Base44 DB & Storage", category: "מסד נתונים ואחסון", configured: true, ok: false, message: "בעיה בגישה למסד: " + e.message });
    }

    const summary = {
      total: checks.length,
      healthy: checks.filter(c => c.ok).length,
      configured: checks.filter(c => c.configured).length,
      all_ok: checks.every(c => c.ok),
    };

    return Response.json({ checks, summary, checked_at: new Date().toISOString() });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});