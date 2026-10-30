/** The Videmak Research AI wordmark: a blue "V" tile, "VIDEMAK" and "Research AI" in blue under it. */
export function Logo({ size = 32, showName = true }: { size?: number; showName?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-ink">
      <span
        className="grid shrink-0 place-items-center rounded-[9px] bg-gradient-to-br from-blue-500 to-blue-700 shadow-[0_4px_12px_-4px_rgba(37,99,235,.6)]"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 5l7 14 7-14" />
          <path d="M12 19l2.5-5" />
        </svg>
      </span>
      {showName && (
        <span className="flex flex-col leading-none" aria-label="Videmak Research AI">
          <span className="font-black tracking-[0.01em]" style={{ fontSize: Math.round(size * 0.6) }} aria-hidden="true">VIDEMAK</span>
          <span className="mt-[2px] border-t-2 border-brand pt-[2px] font-bold text-brand" style={{ fontSize: Math.round(size * 0.36) }} aria-hidden="true">Research AI</span>
        </span>
      )}
    </span>
  );
}
