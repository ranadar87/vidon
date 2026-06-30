const path = require("path");
const os = require("os");
const fs = require("fs");
const express = require("express");
const { bundle } = require("@remotion/bundler");
const { renderMedia, selectComposition } = require("@remotion/renderer");

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;
const RENDER_SECRET = process.env.RENDER_WEBHOOK_SECRET;

// מיפוי aspect ratio לרזולוציה
const DIMENSIONS = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "16:9": { width: 1920, height: 1080 },
};

// bundle נבנה פעם אחת ונשמר בזיכרון
let bundlePromise = null;
function getBundle() {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: path.join(__dirname, "src", "index.js"),
      // webpackOverride אפשרי כאן במידת הצורך
    });
  }
  return bundlePromise;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/render", async (req, res) => {
  // אימות secret
  if (RENDER_SECRET && req.headers["x-render-secret"] !== RENDER_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }

  const payload = req.body;
  if (!payload || !payload.jobId || !Array.isArray(payload.aspectRatios)) {
    return res.status(400).json({ error: "jobId and aspectRatios[] required" });
  }

  // מאשרים מיד — הרינדור רץ ברקע ומחזיר ל-callbackUrl
  res.json({ accepted: true, jobId: payload.jobId, aspectRatios: payload.aspectRatios });

  renderJob(payload).catch((err) => {
    console.error("renderJob fatal:", err);
  });
});

async function renderJob(payload) {
  const { jobId, aspectRatios, callbackUrl } = payload;
  const results = [];

  let serveUrl;
  try {
    serveUrl = await getBundle();
  } catch (err) {
    console.error("bundle failed:", err);
    for (const ar of aspectRatios) {
      results.push({ aspect_ratio: ar, status: "failed", error: "bundle failed: " + err.message });
    }
    await postBack(callbackUrl, jobId, results);
    return;
  }

  for (const ar of aspectRatios) {
    const dims = DIMENSIONS[ar] || DIMENSIONS["9:16"];
    try {
      const inputProps = { ...payload, aspectRatio: ar };
      const composition = await selectComposition({
        serveUrl,
        id: "VidonVideo",
        inputProps,
      });

      const outPath = path.join(os.tmpdir(), `${jobId}-${ar.replace(":", "x")}.mp4`);
      await renderMedia({
        composition: { ...composition, width: dims.width, height: dims.height },
        serveUrl,
        codec: "h264",
        outputLocation: outPath,
        inputProps,
      });

      // העלאה לאחסון ציבורי — ראה README. כאן מחזירים את הקובץ כ-data דרך callback.
      const url = await uploadOutput(outPath, `${jobId}-${ar.replace(":", "x")}.mp4`);
      results.push({ aspect_ratio: ar, status: "completed", url });
      fs.unlink(outPath, () => {});
    } catch (err) {
      console.error(`render ${ar} failed:`, err);
      results.push({ aspect_ratio: ar, status: "failed", error: err.message });
    }
  }

  await postBack(callbackUrl, jobId, results);
}

// העלאת התוצר לאחסון. ברירת מחדל: דורש הגדרת אחסון (S3/Supabase/Cloudinary).
// אם UPLOAD_BASE_URL מוגדר — מעלים לשם; אחרת מחזירים שגיאה ברורה.
async function uploadOutput(filePath, fileName) {
  const base = process.env.UPLOAD_BASE_URL;
  if (!base) {
    throw new Error("UPLOAD_BASE_URL not configured — set up file storage (see README)");
  }
  const fileBuffer = fs.readFileSync(filePath);
  const res = await fetch(base.replace(/\/$/, "") + "/" + fileName, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: fileBuffer,
  });
  if (!res.ok) throw new Error("upload failed: " + res.status);
  // מניחים שה-URL הציבורי זהה לכתובת ה-PUT (התאם לספק האחסון שלך)
  return base.replace(/\/$/, "") + "/" + fileName;
}

async function postBack(callbackUrl, jobId, renders) {
  if (!callbackUrl) {
    console.error("no callbackUrl, results:", JSON.stringify(renders));
    return;
  }
  try {
    const res = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, renders }),
    });
    console.log("postBack status:", res.status);
  } catch (err) {
    console.error("postBack failed:", err);
  }
}

app.listen(PORT, () => console.log(`VIDON Remotion service on :${PORT}`));