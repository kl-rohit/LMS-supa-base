// Shared "analytics console" design language for the admin Dashboard and
// Reports. Adapted from the dark analytics-console reference, but every colour
// is expressed through the app's theme tokens (base Tailwind classes that
// index.css remaps under .dark), so the whole thing inverts cleanly between
// light and dark and stays responsive. No hardcoded palette.
//
// Exports:
//   PageTitle    — just the title block (pulse dot + title + subtitle)
//   PageHeader   — title + live pulse dot + optional subtitle / right actions
//   MetricCard   — stat tile with a coloured accent top-bar + micro-label
//   Panel        — bordered surface with an uppercase micro-title + actions
//   SectionLabel — standalone uppercase micro-label

const ACCENT_BAR = {
  indigo: 'bg-indigo-500',
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
  cyan: 'bg-cyan-500',
};

const TONE = {
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-rose-600',
  muted: 'text-gray-400',
};

export function PageTitle({ title, subtitle, live = true }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {live && <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse flex-shrink-0" />}
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight">{title}</h1>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, right, live = true }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <PageTitle title={title} subtitle={subtitle} live={live} />
      {right && <div className="flex items-center gap-2 flex-shrink-0">{right}</div>}
    </div>
  );
}

export function MetricCard({ label, value, sub, tone = 'muted', accent = 'indigo', icon: Icon, onClick, dataTour }) {
  return (
    <div
      onClick={onClick}
      data-tour={dataTour}
      className={`relative overflow-hidden rounded-xl bg-white border border-gray-200 p-4 ${onClick ? 'cursor-pointer hover:border-gray-300 transition-colors' : ''}`}
    >
      <span className={`absolute top-0 inset-x-0 h-[3px] ${ACCENT_BAR[accent] || ACCENT_BAR.indigo} opacity-80`} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400 truncate">{label}</span>
        {Icon && <Icon className="w-4 h-4 text-gray-300 flex-shrink-0" />}
      </div>
      <div className="text-2xl font-semibold text-gray-900 mt-2 leading-none">{value}</div>
      {sub && <div className={`text-[11px] mt-1.5 ${TONE[tone] || TONE.muted}`}>{sub}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = '', dataTour }) {
  return (
    <div data-tour={dataTour} className={`rounded-xl bg-white border border-gray-200 p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 mb-4">
          {title && <SectionLabel>{title}</SectionLabel>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function SectionLabel({ children, className = '' }) {
  return (
    <h3 className={`text-[11px] font-semibold uppercase tracking-wider text-gray-400 ${className}`}>{children}</h3>
  );
}
