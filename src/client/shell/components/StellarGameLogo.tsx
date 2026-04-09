/**
 * Shared SVG logo component — "STELLAR.GAME" with a star accent.
 * Used by both mobile and desktop nav bars.
 */
export function StellarGameLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 470 60"
      fill="none"
      className={className}
    >
      {/* Star accent */}
      <g transform="translate(4,6)">
        <path
          d="M24 2l5.09 15.66H45.6l-13.35 9.7 5.1 15.65L24 33.32 10.65 43.01l5.1-15.66L2.4 17.66h16.51z"
          fill="currentColor"
          opacity="0.9"
        />
      </g>
      {/* STELLAR.GAME — single text element with inline dot.
          textLength keeps the rendered width stable across font
          substitutions so the dot sits flush against STELLAR and GAME
          regardless of which sans-serif the client falls back to. */}
      <text
        x="56"
        y="40"
        textLength="400"
        lengthAdjust="spacing"
        fontFamily="'Segoe UI', system-ui, -apple-system, sans-serif"
        fontWeight="800"
        fontSize="42"
        fill="currentColor"
      >
        STELLAR<tspan opacity="0.75">.</tspan>GAME
      </text>
      {/* Subtle underline accent, matched to the textLength above. */}
      <rect
        x="56"
        y="48"
        width="400"
        height="2"
        rx="1"
        fill="currentColor"
        opacity="0.2"
      />
    </svg>
  );
}
