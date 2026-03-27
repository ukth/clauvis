import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Clauvis — Todo manager for developers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#0c0c0c",
          fontFamily: "monospace",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "40px",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "10px",
              backgroundColor: "#e2a832",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
              fontWeight: "bold",
              color: "#0c0c0c",
            }}
          >
            C
          </div>
          <span
            style={{
              fontSize: "24px",
              color: "#e2a832",
              letterSpacing: "0.1em",
            }}
          >
            clauvis
          </span>
        </div>
        <div
          style={{
            fontSize: "56px",
            fontWeight: 300,
            color: "#e0e0e0",
            lineHeight: 1.2,
            marginBottom: "24px",
            fontFamily: "sans-serif",
          }}
        >
          Your todos, where
          <br />
          you{" "}
          <span style={{ color: "#e2a832", fontWeight: 400 }}>actually</span>{" "}
          work.
        </div>
        <div
          style={{
            fontSize: "22px",
            color: "#6b6b6b",
            fontFamily: "sans-serif",
          }}
        >
          Telegram + Claude Code + Natural Language
        </div>
      </div>
    ),
    { ...size }
  );
}
