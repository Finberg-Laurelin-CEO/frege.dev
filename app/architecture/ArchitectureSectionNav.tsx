"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./architecture-v2.module.css";

type SectionItem = readonly [number: string, id: string, label: string];

export default function ArchitectureSectionNav({
  items,
}: {
  items: readonly SectionItem[];
}) {
  const [activeId, setActiveId] = useState(items[0]?.[1] ?? "overview");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const sections = items
      .map(([, id]) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null);

    if (sections.length === 0) return;

    let frame = 0;
    const updateActiveSection = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const readingLine = Math.min(window.innerHeight * 0.28, 240);
        let nextId = sections[0].id;

        for (const section of sections) {
          if (section.getBoundingClientRect().top <= readingLine) nextId = section.id;
          else break;
        }

        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) {
          nextId = sections.at(-1)?.id ?? nextId;
        }

        setActiveId((current) => (current === nextId ? current : nextId));
      });
    };

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    window.addEventListener("hashchange", updateActiveSection);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
      window.removeEventListener("hashchange", updateActiveSection);
    };
  }, [items]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || window.innerWidth > 820) return;

    const activeLink = list.querySelector<HTMLElement>("[data-active='true'] a");
    if (!activeLink) return;

    const targetLeft = activeLink.offsetLeft - (list.clientWidth - activeLink.offsetWidth) / 2;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: Math.max(0, targetLeft), behavior: reducedMotion ? "auto" : "smooth" });
  }, [activeId]);

  const activeIndex = Math.max(0, items.findIndex(([, id]) => id === activeId));
  const activeItem = items[activeIndex] ?? items[0];

  return (
    <nav className={styles.architectureNavigator} aria-label="Architecture sections">
      <div className={styles.architectureNavigatorHead}>
        <span className={styles.architectureNavigatorPulse} aria-hidden="true" />
        <span>system map</span>
        <span>{String(activeIndex + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}</span>
        <strong>{activeItem?.[2] ?? "Overview"}</strong>
      </div>

      <ol className={styles.architectureNavigatorList} ref={listRef}>
        {items.map(([number, id, label], index) => {
          const active = id === activeId;
          const branch = index === items.length - 1 ? "└─" : active ? "◆─" : "├─";

          return (
            <li key={id} data-active={active ? "true" : "false"}>
              <a
                className={styles.architectureNavigatorLink}
                href={`#${id}`}
                aria-current={active ? "location" : undefined}
                onClick={() => setActiveId(id)}
              >
                <span className={styles.architectureNavigatorBranch} aria-hidden="true">{branch}</span>
                <span className={styles.architectureNavigatorNumber}>{number}</span>
                <span className={styles.architectureNavigatorLabel}>{label}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
