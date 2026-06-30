const React = require("react");
const { registerRoot, Composition } = require("remotion");
const { VidonVideo } = require("./VidonVideo");

const FPS = 30;

function RemotionRoot() {
  return React.createElement(Composition, {
    id: "VidonVideo",
    component: VidonVideo,
    // ברירת מחדל; durationInFrames מחושב דינמית ב-calculateMetadata
    durationInFrames: 150,
    fps: FPS,
    width: 1080,
    height: 1920,
    defaultProps: { scenes: [], brand: {}, aspectRatio: "9:16" },
    calculateMetadata: ({ props }) => {
      const totalSec = (props.scenes || []).reduce((s, sc) => s + (sc.durationSec || 4), 0) || 5;
      const dims = {
        "9:16": { width: 1080, height: 1920 },
        "1:1": { width: 1080, height: 1080 },
        "4:5": { width: 1080, height: 1350 },
        "16:9": { width: 1920, height: 1080 },
      }[props.aspectRatio] || { width: 1080, height: 1920 };
      return {
        durationInFrames: Math.ceil(totalSec * FPS),
        width: dims.width,
        height: dims.height,
        fps: FPS,
      };
    },
  });
}

registerRoot(RemotionRoot);