import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
const publicSiteV2 = process.env.FREGE_PUBLIC_SITE_V2 === "true";
export const alt = publicSiteV2
  ? "Frege — many agents, one organizational reality"
  : "Frege — your agents share a company; they should share a brain";

// Departure Mono — site font. Satori reads OTF (not woff2), so we ship the OTF
// alongside the woff2 used by the live site.
export default async function OpenGraphImage() {
  const departure = await readFile(
    join(process.cwd(), "public/fonts/DepartureMono-Regular.otf"),
  );

  if (publicSiteV2) {
    const [newsreader, hesperus] = await Promise.all([
      readFile(join(process.cwd(), "public/fonts/Newsreader72pt-Regular.ttf")),
      readFile(join(process.cwd(), "public/art/hesperus/hesperus-social-card.jpg")),
    ]);
    const hesperusData = `data:image/jpeg;base64,${hesperus.toString("base64")}`;

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            overflow: "hidden",
            backgroundColor: "#03140d",
            backgroundImage: `url(${hesperusData})`,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "cover",
            color: "#f2f0e8",
            display: "flex",
            flexDirection: "column",
            padding: "48px 58px 42px",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              background:
                "linear-gradient(90deg, rgba(3,20,13,0.98) 0%, rgba(3,20,13,0.92) 39%, rgba(3,20,13,0.28) 68%, rgba(3,20,13,0.05) 100%)",
            }}
          />

          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingBottom: 18,
              borderBottom: "1px solid rgba(166,255,203,0.42)",
              color: "#a6ffcb",
              fontFamily: "Departure Mono",
              fontSize: 16,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            <span>Frege / governed agent context</span>
            <span>Hesperus · evening star</span>
          </div>

          <div
            style={{
              position: "relative",
              width: 710,
              display: "flex",
              flexDirection: "column",
              gap: 22,
            }}
          >
            <span
              style={{
                color: "#a6ffcb",
                fontFamily: "Departure Mono",
                fontSize: 17,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Building the operating system for AI agents
            </span>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontFamily: "Newsreader Frege",
                fontSize: 72,
                lineHeight: 0.95,
                letterSpacing: "-0.04em",
              }}
            >
              <span>Many agents.</span>
              <span style={{ color: "#a6ffcb" }}>One organizational reality.</span>
            </div>
            <span
              style={{
                width: 620,
                color: "#c9cec4",
                fontFamily: "Departure Mono",
                fontSize: 18,
                lineHeight: 1.45,
              }}
            >
              Governed memory, scoped and cited context, and reviewable updates for the agents your team already uses.
            </span>
          </div>

          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 18,
              borderTop: "1px solid rgba(166,255,203,0.42)",
              color: "#a6ffcb",
              fontFamily: "Departure Mono",
              fontSize: 16,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            <span>MCP + REST / organization + role</span>
            <span>frege.dev</span>
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
          {
            name: "Newsreader Frege",
            data: newsreader,
            style: "normal",
            weight: 400,
          },
        ],
      },
    );
  }

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
          <span>create account →</span>
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
