"use client";

// Scroll reveal wrapper for landing page sections.

import { useEffect, useRef, type ReactNode } from "react";

/** Fades a section in once it scrolls into view. Shows immediately without IntersectionObserver. */
export function Reveal({ children, className = "", as: Tag = "section", id }: { children: ReactNode; className?: string; as?: "section" | "div"; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      el.classList.add("in");
      return;
    }
    // Reveal once and stop observing, so sections do not fade out again on scroll up.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref as never} id={id} className={`reveal ${className}`}>
      {children}
    </Tag>
  );
}
