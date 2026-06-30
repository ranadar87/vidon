import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// uploadRender — מקבל MP4 מקודד base64 משירות ה-Remotion, מעלה אותו לאחסון
// של Base44 דרך אינטגרציית UploadFile, ומחזיר URL ציבורי קבוע.
// מאומת ע"י shared secret ב-query (?secret=...) כי נקרא ללא auth משתמש.
// payload: { fileName, contentBase64 }

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const url = new URL(req.url);
    const secret = url.searchParams.get("secret");
    if (secret !== Deno.env.get("RENDER_WEBHOOK_SECRET")) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const { fileName, contentBase64 } = await req.json();
    if (!fileName || !contentBase64) {
      return Response.json({ error: 'fileName and contentBase64 required' }, { status: 400 });
    }

    // פענוח base64 ל-bytes ובניית File להעלאה
    const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
    const file = new File([bytes], fileName, { type: "video/mp4" });

    const { file_url } = await sr.integrations.Core.UploadFile({ file });

    return Response.json({ success: true, url: file_url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});