"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import styles from "./AsciiImageCascade.module.css";

type AsciiImageCascadeProps = {
  className?: string;
  imageId?: string;
  charSet?: string;
  cellSize?: number;
  compactCellSize?: number;
  duration?: number;
  fps?: number;
  opacity?: number;
  compactOpacity?: number;
  blendMode?: CSSProperties["mixBlendMode"];
  washColor?: string;
  washOpacity?: number;
  compactWashOpacity?: number;
  shadowColor?: string;
  midColor?: string;
  highlightColor?: string;
  edgeEmphasis?: number;
  darkThreshold?: number;
  bloom?: number;
  density?: number;
  compactDensity?: number;
  ditherStrength?: number;
  cascadeWidth?: number;
  focusX?: number;
  focusY?: number;
  phaseMode?: "left-to-right" | "radial-out" | "radial-in" | "center-out" | "ambient";
};

type Rgb = { r: number; g: number; b: number };

type SampleGrid = {
  cols: number;
  rows: number;
  width: number;
  height: number;
  xStep: number;
  yStep: number;
  fontSize: number;
  pixels: Uint8ClampedArray;
  compact: boolean;
};

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

const DEFAULT_CHAR_SET = "fregegovernedmemory";

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function fract(value: number) {
  return value - Math.floor(value);
}

function hash2d(x: number, y: number, seed = 0) {
  let value = Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + seed * 1442695041;
  value = (value ^ (value >>> 13)) * 1274126177;
  return (value ^ (value >>> 16)) >>> 0;
}

function parseHexColor(value: string): Rgb {
  const normalized = value.replace("#", "").trim();
  const full = normalized.length === 3
    ? normalized.split("").map((character) => `${character}${character}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  const weight = clamp(amount);
  return {
    r: Math.round(from.r + (to.r - from.r) * weight),
    g: Math.round(from.g + (to.g - from.g) * weight),
    b: Math.round(from.b + (to.b - from.b) * weight),
  };
}

function rgbString(color: Rgb, alpha: number) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha)})`;
}

function positionFactor(value: string | undefined, axis: "x" | "y") {
  if (!value) return 0.5;
  const normalized = value.toLowerCase();
  if (normalized.endsWith("%")) return clamp(Number.parseFloat(normalized) / 100);
  if (normalized === "left" || normalized === "top") return 0;
  if (normalized === "right" || normalized === "bottom") return 1;
  if (normalized === "center") return 0.5;
  if (normalized.endsWith("px")) return axis === "x" ? 0.5 : 0.5;
  return 0.5;
}

function getObjectPosition(image: HTMLImageElement) {
  const [x = "50%", y = "50%"] = getComputedStyle(image).objectPosition.split(/\s+/);
  return {
    x: positionFactor(x, "x"),
    y: positionFactor(y, "y"),
  };
}

function getImageForCascade(root: HTMLElement, imageId?: string) {
  if (imageId) {
    const image = document.getElementById(imageId);
    return image instanceof HTMLImageElement ? image : null;
  }

  const image = root.parentElement?.querySelector("img");
  return image instanceof HTMLImageElement ? image : null;
}

export default function AsciiImageCascade({
  className = "",
  imageId,
  charSet = DEFAULT_CHAR_SET,
  cellSize = 46,
  compactCellSize,
  duration = 3400,
  fps = 20,
  opacity = 0.66,
  compactOpacity,
  blendMode = "screen",
  washColor = "#004128",
  washOpacity = 0.12,
  compactWashOpacity,
  shadowColor = "#00170f",
  midColor = "#0a7548",
  highlightColor = "#a4dfbc",
  edgeEmphasis = 0.82,
  darkThreshold = 0.57,
  bloom = 3,
  density = 0.64,
  compactDensity,
  ditherStrength = 0.72,
  cascadeWidth = 0.105,
  focusX = 0.5,
  focusY = 0.46,
  phaseMode = "left-to-right",
}: AsciiImageCascadeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const image = getImageForCascade(root, imageId);
    if (!image) {
      root.dataset.asciiCascadeState = "missing-image";
      return;
    }

    const context = canvas.getContext("2d");
    const sampleCanvas = document.createElement("canvas");
    const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!context || !sampleContext) {
      root.dataset.asciiCascadeState = "unsupported";
      return;
    }

    const safeChars = charSet.trim() || DEFAULT_CHAR_SET;
    const shadow = parseHexColor(shadowColor);
    const mid = parseHexColor(midColor);
    const highlight = parseHexColor(highlightColor);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let grid: SampleGrid | null = null;
    let animationFrame = 0;
    let lastFrame = 0;
    let visible = false;
    let disposed = false;

    const rebuild = () => {
      if (disposed || image.naturalWidth === 0 || image.naturalHeight === 0) return;

      const bounds = root.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      const compact = width <= 700;
      const fontSize = Math.max(
        7,
        compact ? (compactCellSize ?? Math.max(7, cellSize - 4)) : cellSize,
      );
      const xStep = Math.max(5, fontSize * 0.66);
      const yStep = Math.max(7, fontSize * 1.02);
      const cols = Math.ceil(width / xStep) + 1;
      const rows = Math.ceil(height / yStep) + 1;
      const dpr = Math.min(window.devicePixelRatio || 1, compact ? 1.25 : 1.5);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = true;

      sampleCanvas.width = cols;
      sampleCanvas.height = rows;
      sampleContext.clearRect(0, 0, cols, rows);

      const position = getObjectPosition(image);
      const coverScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const sourceWidth = width / coverScale;
      const sourceHeight = height / coverScale;
      const sourceX = (image.naturalWidth - sourceWidth) * position.x;
      const sourceY = (image.naturalHeight - sourceHeight) * position.y;

      sampleContext.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        cols,
        rows,
      );

      try {
        grid = {
          cols,
          rows,
          width,
          height,
          xStep,
          yStep,
          fontSize,
          pixels: sampleContext.getImageData(0, 0, cols, rows).data,
          compact,
        };
        root.dataset.asciiCascadeState = "ready";
      } catch {
        grid = null;
        root.dataset.asciiCascadeState = "unavailable";
      }
    };

    const luminanceAt = (activeGrid: SampleGrid, column: number, row: number) => {
      const safeColumn = Math.min(activeGrid.cols - 1, Math.max(0, column));
      const safeRow = Math.min(activeGrid.rows - 1, Math.max(0, row));
      const offset = (safeRow * activeGrid.cols + safeColumn) * 4;
      const red = activeGrid.pixels[offset] / 255;
      const green = activeGrid.pixels[offset + 1] / 255;
      const blue = activeGrid.pixels[offset + 2] / 255;
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };

    const render = (timestamp: number, forceStatic = false) => {
      const activeGrid = grid;
      if (!activeGrid) return;

      const elapsed = timestamp || performance.now();
      const cycle = elapsed / Math.max(800, duration);
      const staticFrame = forceStatic || reducedMotion.matches;
      const { cols, rows, width, height, xStep, yStep, fontSize, compact } = activeGrid;
      const activeDensity = clamp(compact ? (compactDensity ?? density * 0.86) : density);
      const activeDitherStrength = clamp(ditherStrength);
      const activeCascadeWidth = clamp(cascadeWidth, 0.045, 0.22);
      const glitchCycle = elapsed / 920;
      const glitchSeed = Math.floor(glitchCycle);

      context.clearRect(0, 0, width, height);
      context.font = `${fontSize}px "Departure Mono", ui-monospace, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.shadowColor = rgbString(highlight, 0.48);
      context.shadowBlur = staticFrame ? 0 : bloom;

      const glitchActive = !staticFrame && fract(glitchCycle) < 0.045;
      const darkFloor = clamp(darkThreshold);

      for (let row = 0; row < rows; row += 1) {
        const y = row * yStep + yStep * 0.5;
        const yNorm = rows <= 1 ? 0 : row / (rows - 1);

        for (let column = 0; column < cols; column += 1) {
          const xNorm = cols <= 1 ? 0 : column / (cols - 1);
          const sourceLuminance = luminanceAt(activeGrid, column, row);
          const edge = clamp(
            Math.abs(sourceLuminance - luminanceAt(activeGrid, column + 1, row)) +
            Math.abs(sourceLuminance - luminanceAt(activeGrid, column, row + 1)),
          );
          const radialDistance = Math.hypot(xNorm - focusX, yNorm - focusY) / 0.74;
          const fixedNoise = (hash2d(column, row, 17) % 10_000) / 10_000;
          const bayer = (BAYER_4[row % 4][column % 4] + 0.5) / 16;
          const radialFocus = 1 - clamp(radialDistance);
          const radialDither = Math.sin(radialDistance * 26 + fixedNoise * Math.PI) * 0.025;
          const orderedDither = (bayer - 0.5) * 0.12;
          const tone = clamp(
            sourceLuminance * 0.84 +
            edge * clamp(edgeEmphasis) * 0.64 +
            radialDither -
            orderedDither,
          );
          const detail = clamp(
            tone * 0.5 +
            edge * clamp(edgeEmphasis) * 0.72 +
            radialFocus * 0.08,
          );
          const occupancy = clamp(
            activeDensity * (0.28 + detail * 0.72) +
            (0.5 - bayer) * 0.07,
          );
          if (fixedNoise > occupancy) continue;

          const rowJitter = ((hash2d(0, row) % 1000) / 1000 - 0.5) * 0.065;
          const phaseCoordinate = (() => {
            if (phaseMode === "radial-out") return clamp(radialDistance);
            if (phaseMode === "radial-in") return 1 - clamp(radialDistance);
            if (phaseMode === "center-out") return Math.abs(xNorm - focusX) * 2;
            if (phaseMode === "ambient") return (hash2d(column, row, 31) % 1000) / 1000;
            return xNorm;
          })();
          const localCycle = staticFrame
            ? phaseCoordinate + 0.18
            : cycle - phaseCoordinate + rowJitter;
          const localPhase = fract(localCycle);
          const distanceToWave = Math.min(localPhase, 1 - localPhase);
          const cascade = staticFrame
            ? 0
            : Math.exp(
              -(distanceToWave * distanceToWave) /
              (2 * activeCascadeWidth * activeCascadeWidth),
            );
          const epoch = Math.floor(localCycle);
          const flickerStep = cascade > 0.12 ? Math.floor(localPhase * 18) : 0;
          const temporalNoise =
            (hash2d(column, row, epoch * 31 + flickerStep) % 10_000) / 10_000;
          const motionMix = cascade * activeDitherStrength;
          const flicker = temporalNoise < 0.24
            ? 0.04
            : temporalNoise < 0.54
              ? 0.34
              : 1;
          const quietAlpha = 0.8 + fixedNoise * 0.18;
          const alphaMotion = quietAlpha + (flicker - quietAlpha) * motionMix;
          const mappedIndex = Math.round((1 - tone) * (safeChars.length - 1));
          const mutation = staticFrame
            ? 0
            : Math.round((temporalNoise - 0.5) * 5 * motionMix);
          const glitchRow = glitchActive && hash2d(3, row, glitchSeed) % 17 === 0;
          const glitchMutation = glitchRow && temporalNoise < 0.55
            ? (hash2d(column, row, glitchSeed) % 5) - 2
            : 0;
          const characterIndex = Math.min(
            safeChars.length - 1,
            Math.max(0, mappedIndex + mutation + glitchMutation),
          );
          const character = safeChars[characterIndex];
          const shadowGate = sourceLuminance < darkFloor
            ? 0.42 + (sourceLuminance / Math.max(0.01, darkFloor)) * 0.38
            : 1;
          const baseAlpha = clamp(
            0.05 +
            tone * 0.36 +
            edge * clamp(edgeEmphasis) * 0.32,
            0.025,
            0.76,
          );
          const glitchFactor = glitchRow && temporalNoise < 0.55 ? 0.18 : 1;
          const alpha = clamp(
            baseAlpha * shadowGate * alphaMotion * glitchFactor,
            0,
            1,
          );
          const color = tone < 0.56
            ? mixRgb(shadow, mid, tone / 0.56)
            : mixRgb(mid, highlight, (tone - 0.56) / 0.44);
          const x = column * xStep + xStep * 0.5;

          context.fillStyle = rgbString(color, alpha);
          context.fillText(character, x, y);
        }
      }
    };

    const animate = (timestamp: number) => {
      if (disposed || !visible || reducedMotion.matches) return;

      if (timestamp - lastFrame >= 1000 / Math.max(8, fps)) {
        render(timestamp);
        lastFrame = timestamp;
      }

      animationFrame = requestAnimationFrame(animate);
    };

    const start = () => {
      if (disposed || !visible || reducedMotion.matches || animationFrame) return;
      animationFrame = requestAnimationFrame(animate);
    };

    const stop = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };

    const renderForMotionPreference = () => {
      stop();
      render(performance.now(), reducedMotion.matches);
      if (!reducedMotion.matches) start();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else if (visible) {
        renderForMotionPreference();
      }
    };

    const imageReady = async () => {
      if (image.decode) {
        try {
          await image.decode();
        } catch {
          // A completed image can still be sampled if decode() rejects.
        }
      }
      rebuild();
      renderForMotionPreference();
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        root.dataset.asciiCascadeActive = visible ? "true" : "false";
        if (visible) {
          rebuild();
          renderForMotionPreference();
        } else {
          stop();
        }
      },
      { rootMargin: "160px 0px" },
    );
    const resizeObserver = new ResizeObserver(() => {
      rebuild();
      if (visible) renderForMotionPreference();
    });

    observer.observe(root);
    resizeObserver.observe(root);
    reducedMotion.addEventListener("change", renderForMotionPreference);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    image.addEventListener("load", imageReady);
    void document.fonts.load(`${cellSize}px "Departure Mono"`).then(imageReady);
    if (image.complete && image.naturalWidth > 0) void imageReady();

    return () => {
      disposed = true;
      stop();
      observer.disconnect();
      resizeObserver.disconnect();
      reducedMotion.removeEventListener("change", renderForMotionPreference);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      image.removeEventListener("load", imageReady);
    };
  }, [
    bloom,
    cascadeWidth,
    cellSize,
    charSet,
    compactCellSize,
    compactDensity,
    darkThreshold,
    density,
    ditherStrength,
    duration,
    edgeEmphasis,
    fps,
    focusX,
    focusY,
    highlightColor,
    imageId,
    midColor,
    phaseMode,
    shadowColor,
  ]);

  return (
    <div
      ref={rootRef}
      className={`${styles.cascade} ${className}`.trim()}
      style={{
        "--ascii-cascade-opacity": opacity,
        "--ascii-cascade-opacity-compact": compactOpacity ?? opacity * 0.82,
        "--ascii-cascade-blend": blendMode,
        "--ascii-cascade-wash": washColor,
        "--ascii-cascade-wash-opacity": washOpacity,
        "--ascii-cascade-wash-opacity-compact":
          compactWashOpacity ?? washOpacity * 0.72,
      } as CSSProperties}
      data-ascii-image-cascade
      data-ascii-cascade-active="false"
      data-ascii-character-set={charSet}
      aria-hidden="true"
    >
      <span className={styles.wash} />
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
