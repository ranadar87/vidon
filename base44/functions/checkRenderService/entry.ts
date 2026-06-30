import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// בדיקת בריאות לשירות הרינדור (Remotion על Railway).
// קורא ל-/health ומחזיר אבחון ברור: מוגדר? מגיב? זה באמת שירות הרינדור (ולא אפליקציית VIDON)?

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const renderUrl = Deno.env.get("RAILWAY_RENDER_URL");
    if (!renderUrl) {
      return Response.json({
        ok: false,
        configured: false,
        message: "RAILWAY_RENDER_URL לא מוגדר. הגדר אותו בהגדרות הסביבה של האפליקציה.",
      });
    }

    const healthUrl = renderUrl.replace(/\/+$/, "") + "/health";
    let status, body;
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(healthUrl, { signal: ctrl.signal });
      clearTimeout(timeout);
      status = res.status;
      body = (await res.text()).slice(0, 300);
    } catch (err) {
      return Response.json({
        ok: false,
        configured: true,
        url: renderUrl,
        message: "לא ניתן להתחבר לשירות. ייתכן שהשירות לא פעיל ב-Railway או שהכתובת שגויה. (" + err.message + ")",
      });
    }

    let isHealthy = false;
    try {
      isHealthy = status === 200 && JSON.parse(body).ok === true;
    } catch (_e) { /* body אינו JSON תקין */ }

    if (isHealthy) {
      return Response.json({
        ok: true,
        configured: true,
        url: renderUrl,
        message: "שירות הרינדור פעיל ומגיב.",
      });
    }

    // 200 אבל לא הפורמט הצפוי — כנראה הכתובת מצביעה לאפליקציה אחרת (למשל VIDON עצמה)
    return Response.json({
      ok: false,
      configured: true,
      url: renderUrl,
      message: status === 404 || /could not be found/i.test(body)
        ? "הכתובת מגיבה אבל זו לא נראית כתובת שירות הרינדור (קיבלנו 404). ודא ש-RAILWAY_RENDER_URL מצביע לשירות ה-Remotion ולא לאפליקציית VIDON."
        : "השירות הגיב בסטטוס " + status + " אך לא בפורמט הצפוי. ודא שהשירות הנכון פרוס.",
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});