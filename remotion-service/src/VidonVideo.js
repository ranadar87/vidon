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

// קומפוזיציה בסיסית: רצף סצנות עם fade, נכס ויזואלי לכל סצנה, טקסט על המסך,
// קריינות ומוזיקה כשכבות אודיו. עיצוב לפי brand colors.

function Scene({ scene, brand }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const durationFrames = (scene.durationSec || 4) * fps;
  const opacity = interpolate(
    frame,
    [0, 10, durationFrames - 10, durationFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const primary = (brand.colors && brand.colors[0]) || "#0A0A11";
  const accent = (brand.colors && brand.colors[1]) || "#7C6CF7";

  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: primary, opacity } },
    scene.visualUrl
      ? (scene.visualType === "avatar_clip" || scene.visualType === "broll"
          ? React.createElement(Video, { src: scene.visualUrl, style: { width: "100%", height: "100%", objectFit: "cover" } })
          : React.createElement(Img, { src: scene.visualUrl, style: { width: "100%", height: "100%", objectFit: "cover" } }))
      : null,
    scene.text
      ? React.createElement(
          AbsoluteFill,
          { style: { justifyContent: "flex-end", alignItems: "center", padding: 80 } },
          React.createElement(
            "div",
            {
              style: {
                background: accent,
                color: "#fff",
                fontFamily: "sans-serif",
                fontSize: 56,
                fontWeight: 700,
                lineHeight: 1.2,
                padding: "24px 36px",
                borderRadius: 18,
                textAlign: "center",
                direction: "rtl",
              },
            },
            scene.text
          )
        )
      : null
  );
}

function VidonVideo(props) {
  const { scenes = [], brand = {}, voiceover, music } = props;
  const { fps } = useVideoConfig();
  let offset = 0;

  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: "#000" } },
    scenes.map((scene) => {
      const from = offset;
      const dur = (scene.durationSec || 4) * fps;
      offset += dur;
      return React.createElement(
        Sequence,
        { key: scene.id, from, durationInFrames: dur },
        React.createElement(Scene, { scene, brand })
      );
    }),
    voiceover ? React.createElement(Audio, { src: voiceover }) : null,
    music ? React.createElement(Audio, { src: music, volume: 0.25 }) : null
  );
}

module.exports = { VidonVideo };