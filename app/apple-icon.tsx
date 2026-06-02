import { ImageResponse } from "next/og";

// iOS home-screen icon, generated from the FasoStock logo.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const glyph = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4Z"/><path d="M3 12l9 4 9-4"/><path d="M3 17l9 4 9-4"/></svg>`;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "#16a34a",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img width={112} height={112} alt="FasoStock" src={`data:image/svg+xml;utf8,${encodeURIComponent(glyph)}`} />
      </div>
    ),
    size,
  );
}
