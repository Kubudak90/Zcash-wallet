// Line icons for navigation and actions: 24px grid, 1.5px stroke, currentColor.
// Always decorative (aria-hidden): every control that shows one also carries
// its name in text, so no icon adds or changes an accessible name.

const PATHS = {
  balance: (
    <>
      <path d="M18.5 7.5V6.25A1.25 1.25 0 0 0 17.25 5H6.25A2.25 2.25 0 0 0 4 7.25" />
      <path d="M4 7.25v10.5c0 .69.56 1.25 1.25 1.25h13.5c.69 0 1.25-.56 1.25-1.25v-9c0-.69-.56-1.25-1.25-1.25H6.25A2.25 2.25 0 0 1 4 7.25Z" />
      <circle cx="16" cy="13.25" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  send: (
    <>
      <path d="M7 17 17 7" />
      <path d="M8.75 7H17v8.25" />
    </>
  ),
  receive: (
    <>
      <path d="M17 7 7 17" />
      <path d="M15.25 17H7V8.75" />
    </>
  ),
  history: (
    <>
      <path d="M4.25 12a7.75 7.75 0 1 0 2.27-5.48" />
      <path d="M4.25 4.75v3.9h3.9" />
      <path d="M12 8.25v4l2.75 1.75" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9" />
      <circle cx="15" cy="7.5" r="2" />
      <circle cx="9" cy="16.5" r="2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.25" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
      <path d="M12 14.25v2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.75 12C4.6 8.2 8 6 12 6s7.4 2.2 9.25 6C19.4 15.8 16 18 12 18s-7.4-2.2-9.25-6Z" />
      <circle cx="12" cy="12" r="2.75" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.9 6.3A9.5 9.5 0 0 1 12 6c4 0 7.4 2.2 9.25 6a12 12 0 0 1-2.4 3.3M6.4 7.6A11.7 11.7 0 0 0 2.75 12C4.6 15.8 8 18 12 18a9.7 9.7 0 0 0 4.6-1.15" />
      <path d="M10.05 10.1a2.75 2.75 0 0 0 3.85 3.9" />
      <path d="M4 4l16 16" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.75 18.5 6v5.25c0 4.1-2.7 7.3-6.5 8.9-3.8-1.6-6.5-4.8-6.5-8.9V6Z" />
      <path d="m9.25 11.75 2 2 3.5-3.75" />
    </>
  ),
  shieldIn: (
    <>
      <path d="M12 3.75 18.5 6v5.25c0 4.1-2.7 7.3-6.5 8.9-3.8-1.6-6.5-4.8-6.5-8.9V6Z" />
      <path d="M12 8.25v6M9.5 12l2.5 2.5 2.5-2.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  check: <path d="m5 12.5 4.25 4.25L19 7" />,
  arrowRight: <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />,
  arrowLeft: <path d="M19 12H5M10.5 6.5 5 12l5.5 5.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  alert: (
    <>
      <path d="M10.7 4.75a1.5 1.5 0 0 1 2.6 0l7.1 12.5a1.5 1.5 0 0 1-1.3 2.25H4.9a1.5 1.5 0 0 1-1.3-2.25Z" />
      <path d="M12 9.75v3.75" />
      <circle cx="12" cy="16.4" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9.25 9.25 5.5 5.5M14.75 9.25l-5.5 5.5" />
    </>
  ),
  okCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.25 2.5 2.5 4.5-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  sync: (
    <>
      <path d="M19.25 12A7.25 7.25 0 0 1 6.4 16.6M4.75 12A7.25 7.25 0 0 1 17.6 7.4" />
      <path d="M18 3.75v3.9h-3.9M6 20.25v-3.9h3.9" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15.5" r="3.75" />
      <path d="m10.75 12.75 8.25-8.25M16 7.5l2.5 2.5M13.75 9.75l2 2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  server: (
    <>
      <rect x="4" y="4.5" width="16" height="6" rx="1.75" />
      <rect x="4" y="13.5" width="16" height="6" rx="1.75" />
      <path d="M7.75 7.5h.5M7.75 16.5h.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.25 2.4 3.4 5.25 3.4 8.5s-1.15 6.1-3.4 8.5c-2.25-2.4-3.4-5.25-3.4-8.5S9.75 5.9 12 3.5Z" />
    </>
  ),
  external: (
    <>
      <path d="M13.5 4.75h5.75v5.75M19.25 4.75 11 13" />
      <path d="M17.5 13.75v4A1.5 1.5 0 0 1 16 19.25H6.25a1.5 1.5 0 0 1-1.5-1.5V8A1.5 1.5 0 0 1 6.25 6.5h4" />
    </>
  ),
  trash: <path d="M4.75 7h14.5M9.75 7V5.25h4.5V7M6.75 7l.85 12.25h8.8L17.25 7" />,
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 19.5v.5M20 14v.5" />
    </>
  ),
  code: <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.25 5.5l-2.5 13" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
