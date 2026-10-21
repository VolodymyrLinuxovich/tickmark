/** The Tickmark mark: a green tile with an auditor's check. Same drawing as app/icon.svg. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#17714A" />
      <path d="M8.6 16.8l4.9 4.9L23.6 10.6" fill="none" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
