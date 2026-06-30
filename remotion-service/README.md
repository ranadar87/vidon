# VIDON · Remotion Render Service (Railway)

שירות רינדור וידאו עצמאי המבוסס על [Remotion](https://www.remotion.dev/docs/api).
VIDON (Base44) שולח אליו בקשת רינדור, השירות מרנדר MP4 לכל יחס מסך, ומחזיר את התוצאות
בחזרה ל-Base44 דרך webhook.

```
VIDON (Base44)  ──POST /render──►  שירות זה (Railway)  ──render──►  MP4
      ▲                                                              │
      └──────────  POST renderWebhook (callbackUrl)  ◄───────────────┘
```

---

## מבנה
- `server.js` — שרת Express. `POST /render` מקבל job, מרנדר ברקע, ומחזיר ל-callback.
- `src/index.js` — רישום הקומפוזיציה `VidonVideo` + חישוב משך/מימדים דינמי.
- `src/VidonVideo.js` — הקומפוזיציה: רצף סצנות + קריינות + מוזיקה + טקסט עם צבעי מותג.
- `nixpacks.toml` — מתקין ffmpeg + chromium (חובה ל-Remotion על Railway).

---

## שלב 1 — העלאה ל-Git
1. צור repo חדש ב-GitHub (למשל `vidon-remotion`).
2. העתק את התיקייה `remotion-service/` לשורש ה-repo (או דחוף אותה כפי שהיא).
3. ```bash
   cd remotion-service
   git init && git add . && git commit -m "VIDON remotion service"
   git remote add origin https://github.com/<user>/vidon-remotion.git
   git push -u origin main
   ```

## שלב 2 — Deploy ל-Railway
1. ב-[railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** ובחר את ה-repo.
2. Railway יזהה את `nixpacks.toml` ויתקין Node + ffmpeg + chromium אוטומטית.
3. ב-**Variables** הגדר:
   - `RENDER_WEBHOOK_SECRET` — מחרוזת אקראית ארוכה (תזדקק לאותה מחרוזת ב-VIDON).
   - `UPLOAD_BASE_URL` — כתובת אחסון ציבורי שאליה השירות יעלה את ה-MP4 (ראה שלב 4).
4. לאחר ה-deploy העתק את ה-**public URL** של השירות (למשל `https://vidon-remotion.up.railway.app`).

> ⚠️ הקצֵה לפחות **2GB RAM** לשירות (Settings → Resources) — רינדור Remotion צורך זיכרון.

## שלב 3 — חיבור ל-VIDON
ב-Base44, בהגדרות הסביבה (Environment Variables) של האפליקציה, הגדר שני secrets:
- `RAILWAY_RENDER_URL` = ה-public URL מ-Railway.
- `RENDER_WEBHOOK_SECRET` = **אותה** מחרוזת שהגדרת ב-Railway.

זהו — מרגע זה, כש-job מסיים לייצר נכסים, ה-orchestrator קורא ל-`triggerRender`,
השירות מרנדר, ומחזיר את ה-URLs ל-`renderWebhook`.

## שלב 4 — אחסון התוצרים
השירות מרנדר MP4 לקובץ זמני וצריך להעלות אותו לאחסון ציבורי כדי שיהיה URL לצפייה.
ערוך את הפונקציה `uploadOutput` ב-`server.js` לפי הספק שלך:
- **S3 / Cloudflare R2** — השתמש ב-`@aws-sdk/client-s3` והחזר את ה-public URL.
- **Supabase Storage** — `supabase.storage.from(bucket).upload(...)`.
- **פשוט להתחלה** — שירות PUT כמו [transfer.sh] או bucket עם presigned PUT, דרך `UPLOAD_BASE_URL`.

## בדיקה מקומית
```bash
npm install
RENDER_WEBHOOK_SECRET=test UPLOAD_BASE_URL=https://... node server.js
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" -H "x-render-secret: test" \
  -d '{"jobId":"test","aspectRatios":["9:16"],"scenes":[{"id":"s1","durationSec":3,"text":"שלום","visualUrl":null}],"callbackUrl":"https://webhook.site/..."}'
``