import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// transcribeScribe — Scribe adapter אמיתי לכתוביות word-level.
// מקבל { audioUrl }, מתמלל דרך ElevenLabs Scribe STT (speech-to-text),
// מחזיר { url, cost_usd, words } כאשר words = [{word, start, end}] על ציר הסרטון.
// caption_data נשמר כקובץ JSON באחסון Base44 וה-URL מוחזר (כך triggerRender שולף אותו).
// תמחור Scribe: ~$0.40 לדקת אודיו.

const COST_PER_MIN = 0.40;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const { audioUrl } = await req.json().catch(() => ({}));
    if (!audioUrl) return Response.json({ error: 'audioUrl required' }, { status: 400 });

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) return Response.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 });

    // שולפים את האודיו ושולחים ל-Scribe STT כ-multipart
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) return Response.json({ error: `fetch audio ${audioRes.status}` }, { status: 502 });
    const audioBlob = await audioRes.blob();

    const form = new FormData();
    form.append("file", audioBlob, "voiceover.mp3");
    form.append("model_id", "scribe_v1");
    form.append("timestamps_granularity", "word");
    form.append("language_code", "heb");

    const sttRes = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
    });

    if (!sttRes.ok) {
      const txt = await sttRes.text();
      return Response.json({ error: `scribe ${sttRes.status}: ${txt}` }, { status: 502 });
    }

    const data = await sttRes.json();
    // Scribe מחזיר words עם type ('word'/'spacing'); שומרים רק מילים אמיתיות
    const words = (data.words || [])
      .filter((w) => w.type === "word" || !w.type)
      .map((w) => ({ word: w.text || w.word, start: w.start, end: w.end }));

    const durationSec = words.length ? words[words.length - 1].end : 0;
    const cost_usd = (durationSec / 60) * COST_PER_MIN;

    // שמירת caption_data כקובץ JSON באחסון — triggerRender שולף ומפרק per-scene
    const json = JSON.stringify({ words, text: data.text || "" });
    const file = new File([json], `captions-${Date.now()}.json`, { type: "application/json" });
    const { file_url } = await sr.integrations.Core.UploadFile({ file });

    return Response.json({ url: file_url, cost_usd, words });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});