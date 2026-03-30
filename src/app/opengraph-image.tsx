import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import { join } from "path";

export const alt = "Clauvis — Todo manager for developers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const mascotData = await readFile(join(process.cwd(), "public", "mascot.png"));
  const mascotBase64 = `data:image/png;base64,${mascotData.toString("base64")}`;

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
          <img
            src={mascotBase64}
            width={56}
            height={56}
            style={{ borderRadius: "10px" }}
          />
          <span
            style={{
              fontSize: "24px",
              color: "#a78bfa",
              letterSpacing: "0.1em",
            }}
          >
            clauvis
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginBottom: "24px",
          }}
        >
          <span
            style={{
              fontSize: "56px",
              fontWeight: 300,
              color: "#e0e0e0",
              lineHeight: 1.2,
            }}
          >
            Your todos, where
          </span>
          <div style={{ display: "flex" }}>
            <span
              style={{
                fontSize: "56px",
                fontWeight: 300,
                color: "#e0e0e0",
                lineHeight: 1.2,
              }}
            >
              you{" "}
            </span>
            <span
              style={{
                fontSize: "56px",
                fontWeight: 400,
                color: "#a78bfa",
                lineHeight: 1.2,
              }}
            >
              actually
            </span>
            <span
              style={{
                fontSize: "56px",
                fontWeight: 300,
                color: "#e0e0e0",
                lineHeight: 1.2,
              }}
            >
              {" "}work.
            </span>
          </div>
        </div>
        <span
          style={{
            fontSize: "22px",
            color: "#6b6b6b",
          }}
        >
          Telegram + Claude Code + Natural Language
        </span>
      </div>
    ),
    { ...size }
  );
}
