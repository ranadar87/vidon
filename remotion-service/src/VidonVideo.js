const React = require("react");
const {
  AbsoluteFill,
  Sequence,
  Audio,
  Img,
  Video,
  useVideoConfig,
  interpolate,
  useCurrentFrame,
} = require("remotion");

// קומפוזיציה: רצף סצנות עם transition library, נכס ויזואלי לכל סצנה,
// כתוביות RTL ברמת מילה (karaoke highlight), וקריינות+מוזיקה עם ducking אוטומטי.

// ----- Transition library: מחזיר {opacity, transform} לכל פריים בתוך הסצנה -----
function transitionStyle(transition, frame, durationFrames, fps) {
  const t = Math.round((transition?.durationSec ?? 0.4) * fps) || 12;
  const type = transition?.type || "fade";
  const easeIn = (range) => interpolate(frame, [0, t], range, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const easeOut = (range) => interpolate(frame, [durationFrames - t, durationFrames], range, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  switch (type) {
    case "cut":
      return { opacity: 1, transform: "none" };
    case "slide": {
      const x = easeIn([100, 0]);
      const xOut = easeOut([0, -100]);
      return { opacity: 1, transform: `translateX(${frame < durationFrames - t ? x : xOut}%)` };
    }
    case "zoom": {
      const scaleIn = easeIn([1.15, 1]);
      const opacity = Math.min(easeIn([0, 1]), easeOut([1, 0]));
      return { opacity, transform: `scale(${scaleIn})` };
    }
    case "fade":
    default: {
      const opacity = Math.min(easeIn([0, 1]), easeOut([1, 0]));
      return { opacity, transform: "none" };
    }
  }
}

// ----- כתוביות RTL: מוצא את המילה הפעילה לפי word-level timestamps -----
function Captions({ words, sceneFromSec, accent }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const absSec = sceneFromSec + frame / fps;
  if (!Array.isArray(words) || words.length === 0) return null;

  // חלון המילים הרלוונטי לשורת הכתובית הנוכחית (עד ~7 מילים סביב הפעילה)
  const activeIdx = words.findIndex((w) => absSec >= w.start && absSec < w.end);
  if (activeIdx === -1) return null;
  const lineStart = Math.max(0, activeIdx - 3);
  const line = words.slice(lineStart, lineStart + 7);

  return React.createElement(
    AbsoluteFill,
    { style: { justifyContent: "flex-end", alignItems: "center", padding: 100, pointerEvents: "none" } },
    React.createElement(
      "div",
      {
        style: {
          direction: "rtl",
          unicodeBidi: "plaintext",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0 14px",
          maxWidth: "85%",
          fontFamily: "'Assistant', 'Heebo', sans-serif",
          fontSize: 60,
          fontWeight: 800,
          lineHeight: 1.3,
          textShadow: "0 4px 18px rgba(0,0,0,0.65)",
        },
      },
      line.map((w, i) => {
        const isActive = absSec >= w.start && absSec < w.end;
        return React.createElement(
          "span",
          {
            key: lineStart + i,
            style: {
              color: isActive ? accent : "#ffffff",
              transform: isActive ? "translateY(-2px)" : "none",
              transition: "color 0.08s",
            },
          },
          w.word
        );
      })
    )
  );
}

function Scene({ scene, brand }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const durationFrames = (scene.durationSec || 4) * fps;
  const { opacity, transform } = transitionStyle(scene.transition, frame, durationFrames, fps);
  const primary = (brand.colors && brand.colors[0]) || "#0A0A11";
  const accent = (brand.colors && brand.colors[1]) || "#7C6CF7";

  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: primary, opacity, transform } },
    scene.visualUrl
      ? (scene.visualType === "avatar_clip" || scene.visualType === "broll"
          ? React.createElement(Video, { src: scene.visualUrl, style: { width: "100%", height: "100%", objectFit: "cover" } })
          : React.createElement(Img, { src: scene.visualUrl, style: { width: "100%", height: "100%", objectFit: "cover" } }))
      : null,
    // כתוביות karaoke ברמת מילה אם קיימות; אחרת fallback לטקסט סטטי על המסך
    scene.words && scene.words.length
      ? React.createElement(Captions, { words: scene.words, sceneFromSec: scene.fromSec || 0, accent })
      : scene.text
      ? React.createElement(
          AbsoluteFill,
          { style: { justifyContent: "flex-end", alignItems: "center", padding: 80 } },
          React.createElement(
            "div",
            {
              style: {
                background: accent,
                color: "#fff",
                fontFamily: "'Assistant', 'Heebo', sans-serif",
                fontSize: 56,
                fontWeight: 700,
                lineHeight: 1.2,
                padding: "24px 36px",
                borderRadius: 18,
                textAlign: "center",
                direction: "rtl",
                unicodeBidi: "plaintext",
              },
            },
            scene.text
          )
        )
      : null
  );
}

// ----- audio ducking: מוזיקה יורדת אוטומטית בקטעים שיש בהם קריינות -----
function DuckedMusic({ src, voiceSegments }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;
  const base = 0.28;
  const ducked = 0.08;
  const speaking = (voiceSegments || []).some((seg) => sec >= seg.start && sec < seg.end);
  return React.createElement(Audio, { src, volume: speaking ? ducked : base });
}

function VidonVideo(props) {
  const { scenes = [], brand = {}, voiceover, music, voiceSegments } = props;
  const { fps } = useVideoConfig();
  let offset = 0;

  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: "#000" } },
    scenes.map((scene) => {
      const from = offset;
      const dur = (scene.durationSec || 4) * fps;
      offset += dur;
      // fromSec מאפשר לכתוביות לחשב timestamp אבסולוטי על ציר הסרטון
      const sceneWithTime = Object.assign({}, scene, { fromSec: from / fps });
      return React.createElement(
        Sequence,
        { key: scene.id, from, durationInFrames: dur },
        React.createElement(Scene, { scene: sceneWithTime, brand })
      );
    }),
    voiceover ? React.createElement(Audio, { src: voiceover }) : null,
    music
      ? (voiceSegments && voiceSegments.length
          ? React.createElement(DuckedMusic, { src: music, voiceSegments })
          : React.createElement(Audio, { src: music, volume: 0.25 }))
      : null
  );
}

module.exports = { VidonVideo };