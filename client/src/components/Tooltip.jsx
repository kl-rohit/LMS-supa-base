// Small styled hover/focus tooltip for icon-only controls.
//
// The native `title` attribute works, but the browser paints it in an
// unpredictable spot with no styling, so on dense action rows it can appear far
// from the icon and read poorly on dark surfaces. This renders a themed bubble
// directly above the wrapped control, centered on it, on hover OR keyboard
// focus, so the help text is always legible right where the user is looking.
//
// Usage: wrap a single button / link and pass the label.
//   <Tooltip label="Delete login"><button>…</button></Tooltip>
// Drop the element's own `title` so the native bubble does not double up.

export default function Tooltip({ label, children, className = '' }) {
  if (!label) return children;
  return (
    <span className={`relative inline-flex group/tip ${className}`}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2
                   whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white
                   opacity-0 shadow-lg transition-opacity duration-150
                   group-hover/tip:opacity-100 group-focus-within/tip:opacity-100
                   dark:bg-gray-700"
      >
        {label}
      </span>
    </span>
  );
}
