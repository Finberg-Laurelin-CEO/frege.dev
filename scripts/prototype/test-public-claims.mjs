import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();

async function read(path) {
  return readFile(`${root}/${path}`, "utf8");
}

function parseCssColor(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      r: Number.parseInt(hex[1].slice(0, 2), 16),
      g: Number.parseInt(hex[1].slice(2, 4), 16),
      b: Number.parseInt(hex[1].slice(4, 6), 16),
      a: 1,
    };
  }

  const rgba = value.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
  );
  assert.ok(rgba, `unsupported CSS color in contrast test: ${value}`);
  return {
    r: Number(rgba[1]),
    g: Number(rgba[2]),
    b: Number(rgba[3]),
    a: rgba[4] === undefined ? 1 : Number(rgba[4]),
  };
}

function composite(foreground, background) {
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}

function relativeLuminance(color) {
  const linear = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const opaqueForeground = composite(foreground, background);
  const lighter = Math.max(relativeLuminance(opaqueForeground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(opaqueForeground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function lastCssVariable(stylesheet, name) {
  const matches = [...stylesheet.matchAll(new RegExp(`--${name}\\s*:\\s*([^;]+);`, "g"))];
  assert.ok(matches.length > 0, `missing CSS variable --${name}`);
  return matches.at(-1)[1].trim();
}

function assertTokenContrast(stylesheet, foregroundName, backgroundName, minimum, label) {
  const foreground = parseCssColor(lastCssVariable(stylesheet, foregroundName));
  const background = parseCssColor(lastCssVariable(stylesheet, backgroundName));
  const ratio = contrastRatio(foreground, background);
  assert.ok(ratio >= minimum, `${label} contrast ${ratio.toFixed(2)}:1 is below ${minimum}:1`);
}

test("the public MCP tool list stays in sync with the shipped CLI", async () => {
  const [cli, docs] = await Promise.all([
    read("packages/frege-cli/bin/frege-mcp.mjs"),
    read("app/docs/page.tsx"),
  ]);

  const cliTools = [...cli.matchAll(/name:\s*"(frege_[a-z_]+)"/g)].map((match) => match[1]);
  const documentedTools = [...docs.matchAll(/\["(frege_[a-z_]+)",/g)].map((match) => match[1]);
  const flaggedTools = ["frege_list_skills", "frege_get_skill"];
  const publicCliTools = cliTools.filter((tool) => !flaggedTools.includes(tool));

  assert.equal(cliTools.length, 25, "update this expectation when the CLI contract changes");
  assert.deepEqual(
    [...new Set(documentedTools)].sort(),
    [...new Set(publicCliTools)].sort(),
    "app/docs/page.tsx must document every always-on MCP tool and no flagged tools",
  );
  for (const flaggedTool of flaggedTools) {
    assert.equal(documentedTools.includes(flaggedTool), false, `${flaggedTool} must stay hidden while feature-flagged`);
  }

  for (const hostedTool of [
    "frege_list_agents",
    "frege_run_agent",
    "frege_get_agent_run",
    "frege_invoke_model",
  ]) {
    assert.equal(cliTools.includes(hostedTool), false, `${hostedTool} must not ship in the MVP MCP surface`);
    assert.equal(documentedTools.includes(hostedTool), false, `${hostedTool} must not appear in public tool docs`);
  }
});

test("public positioning avoids private YC material and superseded product claims", async () => {
  const publicDocs = (await readdir(`${root}/docs`, { recursive: true }))
    .filter((path) => /\.(md|mdx|ya?ml)$/i.test(path))
    .map((path) => `docs/${path}`);
  const publicFiles = [
    "README.md",
    "frege.docs.yml",
    "app/page.tsx",
    "app/components/PublicHomeV2.tsx",
    "app/architecture/page.tsx",
    "app/docs/page.tsx",
    "app/pricing/page.tsx",
    "app/roadmap/page.tsx",
    "lib/public-roadmap.ts",
    ...publicDocs,
  ];
  const copy = (await Promise.all(publicFiles.map(read))).join("\n").toLowerCase();

  for (const forbidden of [
    "yc application",
    "y combinator",
    "same answer for everyone",
    "no new client to install",
    "full observability",
    "runs the agent loop",
    "brain can't drift",
  ]) {
    assert.equal(copy.includes(forbidden), false, `public copy contains forbidden claim: ${forbidden}`);
  }

  assert.doesNotMatch(copy, /\byc\b/, "public repository copy contains a YC reference");
});

test("the public roadmap has statuses but no speculative dates", async () => {
  const [registry, page] = await Promise.all([
    read("lib/public-roadmap.ts"),
    read("app/roadmap/page.tsx"),
  ]);
  const copy = `${registry}\n${page}`;

  for (const label of ["Available now", "Building next", "Later"]) {
    assert.match(copy, new RegExp(label));
  }
  assert.doesNotMatch(copy, /\b20\d{2}\b|\bQ[1-4]\b/);
});

test("live run room availability is public only behind its production flag", async () => {
  const [home, readme] = await Promise.all([
    read("app/components/PublicHomeV2.tsx"),
    read("README.md"),
  ]);

  assert.match(home, /process\.env\.FREGE_LIVE_RUN_ROOMS === "true"/);
  assert.match(home, /Shared live agent sessions \(private beta, Codex\)/);
  assert.match(readme, /Shared live Codex sessions \(private beta\)/);
});

test("optimized public artwork stays inside its performance budgets", async () => {
  const assets = [
    "public/art/hesperus/hesperus-duotone-desktop.avif",
    "public/art/hesperus/hesperus-duotone-desktop.webp",
    "public/art/hesperus/hesperus-duotone-mobile.avif",
    "public/art/hesperus/hesperus-duotone-mobile.webp",
    "public/art/hesperus/hesperus-halftone-desktop.avif",
    "public/art/hesperus/hesperus-halftone-desktop.webp",
    "public/art/hesperus/hesperus-halftone-mobile.avif",
    "public/art/hesperus/hesperus-halftone-mobile.webp",
    "public/art/system/context-lines.avif",
    "public/art/system/context-lines.webp",
    "public/art/system/fragmentation-atkinson.avif",
    "public/art/system/fragmentation-atkinson.webp",
    "public/art/system/persistence-dots.avif",
    "public/art/system/persistence-dots.webp",
    "public/art/system/provenance-diamonds.avif",
    "public/art/system/provenance-diamonds.webp",
    "public/art/user/corridor-diagonal.avif",
    "public/art/user/corridor-diagonal.webp",
    "public/art/user/sundial-characters.avif",
    "public/art/user/sundial-characters.webp",
    "public/art/demorgan/phosphorus-hesperus-dither.avif",
    "public/art/demorgan/phosphorus-hesperus-dither.webp",
    "public/art/demorgan/phosphorus-hesperus-dither-mobile.avif",
    "public/art/demorgan/phosphorus-hesperus-dither-mobile.webp",
  ];

  for (const asset of assets) {
    const metadata = await stat(`${root}/${asset}`);
    assert.ok(metadata.size <= 250_000, `${asset} exceeds the 250KB hero budget`);
  }

  const social = await stat(`${root}/public/art/hesperus/hesperus-social-card.jpg`);
  assert.ok(social.size <= 200_000, "Hesperus social card exceeds 200KB");
});

test("public text tokens retain readable contrast on their solid surfaces", async () => {
  const [global, home, secondary, docs, architecture, roadmap] = await Promise.all([
    read("public/styles.css"),
    read("app/public-v2.module.css"),
    read("app/secondary-public-v2.module.css"),
    read("app/docs/docs-v2.module.css"),
    read("app/architecture/architecture-v2.module.css"),
    read("app/roadmap/roadmap.module.css"),
  ]);

  assertTokenContrast(global, "muted", "bg", 4.5, "auth and signup secondary text");
  assertTokenContrast(home, "v2-paper-muted", "v2-field", 7, "home body text");
  assertTokenContrast(secondary, "secondary-muted", "secondary-field", 7, "secondary-page body text");
  assertTokenContrast(secondary, "secondary-faint", "secondary-field", 4.5, "secondary-page small labels");
  assertTokenContrast(docs, "docs-muted", "docs-field", 7, "docs body text");
  assertTokenContrast(docs, "docs-dim", "docs-field", 6, "docs small labels");
  assertTokenContrast(architecture, "architectureV2Muted", "architectureV2Field", 7, "architecture body text");
  assertTokenContrast(architecture, "architectureV2Faint", "architectureV2Field", 4.5, "architecture small labels");
  assertTokenContrast(roadmap, "roadmapV2Muted", "roadmapV2Field", 7, "roadmap body text");
  assertTokenContrast(roadmap, "roadmapV2Faint", "roadmapV2Field", 4.5, "roadmap small labels");
});

test("V2 long-form color rules outrank the legacy docs cascade", async () => {
  const [docs, architecture] = await Promise.all([
    read("app/docs/docs-v2.module.css"),
    read("app/architecture/architecture-v2.module.css"),
  ]);

  for (const selector of [
    ".docsV2 :global(.docs__main) h2",
    ".docsV2 :global(.docs__main) h3",
    ".docsV2 :global(.docs__main) p",
    ".docsV2 :global(.docs__main) ul",
    ".docsV2 :global(.docs__main) ol",
    ".docsV2 :global(.docs__main) li::marker",
    ".docsV2 :global(.docs__main) code",
    ".docsV2 :global(.docs__main) pre",
  ]) {
    assert.ok(docs.includes(selector), `docs V2 is missing its high-specificity color rule: ${selector}`);
  }

  for (const selector of [
    ".architectureV2 :global(.docs__main) h2",
    ".architectureV2 :global(.docs__main) p",
    ".architectureV2 :global(.docs__main) ul",
    ".architectureV2 :global(.docs__main) ol",
    ".architectureV2 :global(.docs__main) li::marker",
    ".architectureV2 :global(.docs__main) code",
    ".architectureV2 :global(.docs__main .diagram)",
  ]) {
    assert.ok(architecture.includes(selector), `architecture V2 is missing its high-specificity color rule: ${selector}`);
  }
});

test("Docs copy controls cover runnable snippets without touching diagrams", async () => {
  const [docs, copyable, architecture] = await Promise.all([
    read("app/docs/page.tsx"),
    read("app/components/CopyableCodeBlock.tsx"),
    read("app/architecture/page.tsx"),
  ]);

  assert.equal(
    [...docs.matchAll(/<CopyableCodeBlock\b/g)].length,
    10,
    "every runnable Docs snippet should have one copy control",
  );
  assert.match(copyable, /navigator\.clipboard\?\.writeText/);
  assert.match(copyable, /document\.execCommand\("copy"\)/);
  assert.match(copyable, /type="button"/);
  assert.match(copyable, /aria-live="polite"/);
  assert.match(copyable, /data-copy-code/);
  assert.doesNotMatch(architecture, /CopyableCodeBlock/);
});

test("full-frame artwork uses the shared image-derived ASCII cascade safely", async () => {
  const [component, motionStyles, home, docs, roadmap, architecture] = await Promise.all([
    read("app/components/AsciiImageCascade.tsx"),
    read("app/components/AsciiImageCascade.module.css"),
    read("app/components/PublicHomeV2.tsx"),
    read("app/docs/page.tsx"),
    read("app/roadmap/page.tsx"),
    read("app/architecture/page.tsx"),
  ]);

  assert.equal([...home.matchAll(/<AsciiImageCascade\b/g)].length, 2);
  assert.equal([...docs.matchAll(/<AsciiImageCascade\b/g)].length, 1);
  assert.equal([...roadmap.matchAll(/<AsciiImageCascade\b/g)].length, 1);
  assert.equal([...architecture.matchAll(/<AsciiImageCascade\b/g)].length, 3);

  const demoStart = home.indexOf('id="demo"');
  const demoEnd = home.indexOf('<AsciiDivider index="02"');
  assert.ok(demoStart > -1 && demoEnd > demoStart);
  assert.doesNotMatch(
    home.slice(demoStart, demoEnd),
    /AsciiImageCascade/,
    "the inset Scoped passage plate should remain static",
  );

  assert.match(component, /data-ascii-image-cascade/);
  assert.match(component, /<canvas/);
  assert.match(component, /DEFAULT_CHAR_SET = "fregegovernedmemory"/);
  assert.match(component, /duration = 3400/);
  assert.match(component, /getImageData/);
  assert.match(component, /getComputedStyle\(image\)\.objectPosition/);
  assert.match(component, /density = 0\.64/);
  assert.match(component, /if \(fixedNoise > occupancy\) continue/);
  assert.match(component, /compactDensity/);
  assert.match(component, /IntersectionObserver/);
  assert.match(component, /ResizeObserver/);
  assert.match(component, /visibilitychange/);
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(component, /<pre/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(motionStyles, /\.canvas/);
  assert.match(motionStyles, /\.wash/);
  assert.match(motionStyles, /mix-blend-mode: soft-light/);
  assert.match(motionStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(motionStyles, /pointer-events: none/);
  assert.match(motionStyles, /contain: strict/);
  assert.match(motionStyles, /--ascii-cascade-opacity-compact/);
});

test("the V2 repaint preserves the deployed conversion route graph", async () => {
  const [home, nav, footer] = await Promise.all([
    read("app/components/PublicHomeV2.tsx"),
    read("app/components/SiteNav.tsx"),
    read("app/components/SiteFooter.tsx"),
  ]);
  const copy = `${home}\n${nav}\n${footer}`;

  for (const href of [
    'href="/signup"',
    'href="/pricing"',
    'href="/architecture"',
    'href="/docs"',
    'href="/contact"',
    'href="/privacy"',
    'href="/terms"',
    'href="/login?next=/console"',
  ]) {
    assert.match(copy, new RegExp(href.replace(/[?]/g, "\\?")), `missing conversion link: ${href}`);
  }

  for (const anchor of ["demo", "compare", "how", "outcomes", "start"]) {
    assert.match(home, new RegExp(`id="${anchor}"`), `missing legacy-compatible anchor: #${anchor}`);
  }

  assert.match(copy, /github\.com\/Finberg-Laurelin-CEO\/frege\.dev/);
  assert.doesNotMatch(copy.toLowerCase(), /start free/);
});
