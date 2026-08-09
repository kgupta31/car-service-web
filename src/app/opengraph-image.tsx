import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "ServiceAudit Agent — Is that car repair actually necessary?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
          backgroundColor: "#0b1220",
          backgroundImage:
            "radial-gradient(circle at 25% 20%, rgba(56,189,248,0.28), transparent 50%), radial-gradient(circle at 85% 85%, rgba(167,139,250,0.22), transparent 50%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 48 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "linear-gradient(135deg, #38bdf8, #a78bfa)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2 L19 4.5 V10 C19 15 16 18.5 12 20 C8 18.5 5 15 5 10 V4.5 Z"
                stroke="#0b1220"
                strokeWidth="1.6"
              />
              <path d="M9 11 L11 13.2 L15.5 8" stroke="#0b1220" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, color: "white" }}>ServiceAudit Agent</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 56, fontWeight: 700, color: "white", lineHeight: 1.15 }}>
            Is that repair quote
          </div>
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              lineHeight: 1.15,
              backgroundImage: "linear-gradient(90deg, #38bdf8, #a78bfa)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            actually necessary?
          </div>
        </div>
        <div style={{ fontSize: 26, color: "rgba(255,255,255,0.6)", marginTop: 28, maxWidth: 780 }}>
          Free AI agent that checks it against your car&apos;s real maintenance schedule.
        </div>
      </div>
    ),
    { ...size }
  );
}
