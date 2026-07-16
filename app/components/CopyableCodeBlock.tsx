"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./CopyableCodeBlock.module.css";

type CopyState = "idle" | "copied" | "selected";

type CopyableCodeBlockProps = {
  value: string;
  label: string;
  caption?: string;
  meta?: string;
};

function copyWithTemporaryTextarea(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.inset = "-9999px auto auto -9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export default function CopyableCodeBlock({
  value,
  label,
  caption,
  meta,
}: CopyableCodeBlockProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const codeRef = useRef<HTMLElement>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasHeader = Boolean(caption || meta);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  function scheduleReset() {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopyState("idle"), 2200);
  }

  function selectCode() {
    const code = codeRef.current;
    if (!code) return;

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(code);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  async function handleCopy() {
    let copied = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) copied = copyWithTemporaryTextarea(value);

    if (copied) {
      setCopyState("copied");
    } else {
      selectCode();
      setCopyState("selected");
    }

    scheduleReset();
  }

  const button = (
    <button
      type="button"
      className={`${styles.copyButton}${hasHeader ? "" : ` ${styles.floatingButton}`}`}
      data-copy-code
      data-copy-state={copyState}
      aria-label={`Copy ${label}`}
      onClick={handleCopy}
    >
      {copyState === "copied"
        ? "[ copied ]"
        : copyState === "selected"
          ? "[ selected ]"
          : "[ copy ]"}
    </button>
  );

  return (
    <div
      className={hasHeader ? "docs__codeShell" : styles.copyable}
      data-copyable-code
    >
      {hasHeader ? (
        <div className="docs__codeHead">
          {caption ? <span>{caption}</span> : null}
          <div className={styles.headActions}>
            {meta ? <code>{meta}</code> : null}
            {button}
          </div>
        </div>
      ) : button}
      <pre><code ref={codeRef}>{value}</code></pre>
      <span className={styles.srOnly} role="status" aria-live="polite">
        {copyState === "copied"
          ? `${label} copied to the clipboard.`
          : copyState === "selected"
            ? `Clipboard access was unavailable. ${label} is selected; use your keyboard copy command.`
            : ""}
      </span>
    </div>
  );
}
