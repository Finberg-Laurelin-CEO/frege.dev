import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = "Frege — your agents share a company; they should share a brain";

// Departure Mono — site font. Satori reads OTF (not woff2), so we ship the OTF
// alongside the woff2 used by the live site.
export default async function OpenGraphImage() {
  const departure = await readFile(
    join(process.cwd(), "public/fonts/DepartureMono-Regular.otf"),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#ffffff",
          color: "#000000",
          fontFamily: "Departure Mono",
          display: "flex",
          flexDirection: "column",
          padding: "56px 64px",
          justifyContent: "space-between",
        }}
      >
        {/* top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 22,
            color: "#6b6b6b",
            borderBottom: "1px solid #e2e2e2",
            paddingBottom: 22,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            {/* terminal traffic-light dots, drawn as shapes so the OG render
                never reaches for a dynamic font to cover the ● glyph */}
            <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: "#6b6b6b" }} />
            <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: "#6b6b6b" }} />
            <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: "#6b6b6b" }} />
            <span style={{ marginLeft: 22, color: "#000" }}>
              frege — ssh agent@frege.dev
            </span>
          </div>
          <span>v0 · pilot</span>
        </div>

        {/* hero */}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 33, color: "#6b6b6b", display: "flex" }}>
            agent@frege:~$ get_context
          </div>
          <div
            style={{
              fontSize: 56,
              lineHeight: 1.15,
              display: "flex",
              maxWidth: 1050,
            }}
          >
            Your agents share a company.
          </div>
          <div
            style={{
              fontSize: 56,
              lineHeight: 1.15,
              display: "flex",
              maxWidth: 1050,
              color: "#6b6b6b",
            }}
          >
            They should share a brain.
          </div>
          <div
            style={{
              fontSize: 22,
              lineHeight: 1.5,
              color: "#000",
              display: "flex",
              maxWidth: 1050,
            }}
          >
            one governed memory layer for teams running multiple agents — scoped,
            cited context with access control, audit, and reviewable writes.
            MCP-native.
          </div>
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            borderTop: "1px solid #e2e2e2",
            paddingTop: 22,
            color: "#6b6b6b",
          }}
        >
          <span style={{ color: "#0033cc" }}>frege.dev</span>
          <span>request pilot access →</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Departure Mono",
          data: departure,
          style: "normal",
          weight: 400,
        },
      ],
    },
  );
}
