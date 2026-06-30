# Dockerfile דטרמיניסטי לשירות הרינדור Remotion.
# Railway מעדיף Dockerfile על Nixpacks — כך הבנייה זהה בכל פעם ולא תלויה
# בהגדרות Root Directory / nixpacks.toml שלא נטענו.
#
# מבוסס על Debian slim עם כל ספריות המערכת ש-Chromium Headless דורש
# (libglib, nss, atk וכו') — אלו שחסרו וגרמו ל-"error while loading shared libraries".
FROM node:20-slim

# ספריות מערכת הנדרשות ל-Chromium headless + ffmpeg לרינדור
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# התקנת תלויות
COPY package*.json ./
RUN npm install --omit=dev

# העתקת שאר הקוד
COPY . .

# הורדת דפדפן Chromium ש-Remotion ישתמש בו (תואם לגרסת @remotion/renderer).
# הספריות שהותקנו למעלה מאפשרות לו לרוץ ללא שגיאת shared libraries.
RUN npx remotion browser ensure

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]