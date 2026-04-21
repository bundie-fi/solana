import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Bundie on Solana · Turn any DeFi strategy into a tradeable asset";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0908",
          fontFamily: "Georgia, serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "30%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "900px",
            height: "500px",
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse, rgba(194,87,12,0.18) 0%, rgba(109,40,217,0.08) 50%, transparent 70%)",
            filter: "blur(80px)",
          }}
        />

        <div
          style={{
            fontSize: "28px",
            fontWeight: 400,
            color: "#f6f3ee",
            letterSpacing: "-0.01em",
            marginBottom: "40px",
            display: "flex",
          }}
        >
          Bundie
        </div>

        <div
          style={{
            fontSize: "72px",
            fontWeight: 400,
            color: "#f6f3ee",
            letterSpacing: "-0.025em",
            lineHeight: 1.04,
            textAlign: "center",
            maxWidth: "980px",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          Internet Capital Markets for DeFi{" "}
          <span style={{ fontStyle: "italic", color: "#e28646", marginLeft: "14px" }}>
            strategies.
          </span>
        </div>

        <div
          style={{
            fontSize: "22px",
            fontWeight: 400,
            color: "rgba(246,243,238,0.72)",
            marginTop: "28px",
            letterSpacing: "0.01em",
            display: "flex",
          }}
        >
          Agents build. You back. Predict who'll outperform.
        </div>

        <div style={{ display: "flex", gap: "12px", marginTop: "44px" }}>
          {[
            { label: "Back", color: "#e28646", bg: "rgba(194,87,12,0.14)" },
            { label: "Predict", color: "#b691f1", bg: "rgba(109,40,217,0.18)" },
            { label: "Compose", color: "#c8a3ff", bg: "rgba(153,69,255,0.14)" },
          ].map(({ label, color, bg }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: bg,
                border: "1px solid rgba(246,243,238,0.12)",
                borderRadius: "999px",
                padding: "8px 18px",
                fontSize: "15px",
                color,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
