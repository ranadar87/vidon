import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ttsElevenLabs — קריאת TTS אמיתית מול ElevenLabs.
// מקבל { script, voiceId, account_id, job_id }, מייצר MP3, מעלה לאחסון Base44,
// ומחזיר { url, cost_usd, units }. נקרא ע"י ה-orchestrator (service-to-service).
// ElevenLabs מתמחר לפי תווים — מחיר מוערך: ~$0.30 ל-1000 תווים (Creator tier).

const COST_PER_1K_CHARS = 0.30;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const { script, voiceId } = await req.json().catch(() => ({}));
    if (!script || !voiceId) {
      return Response.json({ error: 'script and voiceId required' }, { status: 400 });
    }

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) return Response.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 });

    // קריאת TTS — מודל רב-לשוני שתומך בעברית
    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: script,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!ttsRes.ok) {
      const txt = await ttsRes.text();
      return Response.json({ error: `elevenlabs ${ttsRes.status}: ${txt}` }, { status: 502 });
    }

    // העלאת ה-MP3 לאחסון Base44 וקבלת URL קבוע
    const audioBuffer = await ttsRes.arrayBuffer();
    const file = new File([audioBuffer], `vo-${Date.now()}.mp3`, { type: "audio/mpeg" });
    const { file_url } = await sr.integrations.Core.UploadFile({ file });

    const units = script.length;
    const cost_usd = (units / 1000) * COST_PER_1K_CHARS;

    return Response.json({ url: file_url, cost_usd, units });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});