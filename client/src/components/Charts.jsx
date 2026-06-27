// Lightweight, dependency-free chart kit for the Reports module. Pure inline
// SVG so it adds no bundle weight. Data-series colours are passed in as solid
// hex (vivid in both light and dark); all surfaces/text use the app's themed
// classes (bg-white, text-gray-*, bg-gray-100), which index.css remaps under
// .dark — so charts recolour correctly with the theme automatically.
import { useState } from 'react';

// Small, theme-aware floating tooltip. Rendered inside a `relative` wrapper and
// positioned via inline left/top. pointer-events-none so it never blocks the
// element underneath; bg-gray-900 inverts to a light surface under .dark, which
// stays readable. tip: { x, y, text } or null. `align` keeps the box from
// pushing past the right edge so it cannot trigger horizontal page scroll.
function ChartTip({ tip }) {
  if (!tip) return null;
  return (
    <div
      className="absolute pointer-events-none z-10 px-2 py-1 rounded-md bg-gray-900 text-white text-xs shadow whitespace-nowrap -translate-x-1/2 -translate-y-full max-w-[60vw] overflow-hidden text-ellipsis"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  );
}

// Donut / ring chart. data: [{ label, value, color }]. Optional centre text.
export function Donut({ data = [], size = 160, thickness = 22, centervalue, centerlabel }) {
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const cx = size / 2;
  const [hover, setHover] = useState(null); // hovered segment index or null
  const fmtVal = (v) => Number(v).toLocaleString('en-IN');
  // Tooltip anchored near the top of the ring, in the SVG's own pixel space.
  const tip = hover != null && data[hover]
    ? { x: cx, y: thickness, text: `${data[hover].label}: ${fmtVal(data[hover].value)}` }
    : null;
  // When a segment is hovered, reflect it in the centre text (only if the chart
  // already shows a centre value; otherwise leave the centre untouched).
  const showCenter = centervalue !== undefined;
  const centerMain = showCenter && hover != null && data[hover] ? fmtVal(data[hover].value) : centervalue;
  const centerSub = showCenter && hover != null && data[hover] ? data[hover].label : centerlabel;
  return (
    <div className="flex items-center justify-center sm:justify-start gap-5 flex-wrap">
      <div className="relative flex-shrink-0">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="max-w-[40vw] h-auto text-gray-900">
          {/* track — currentColor (themed) so it inverts in dark mode */}
          <circle cx={cx} cy={cx} r={r} fill="none" strokeWidth={thickness} stroke="currentColor" className="text-gray-100" />
          {total > 0 && data.map((d, i) => {
            const frac = (Number(d.value) || 0) / total;
            const len = frac * c;
            const active = hover === i;
            const seg = (
              <circle
                key={i}
                cx={cx} cy={cx} r={r} fill="none"
                strokeWidth={active ? thickness + 4 : thickness}
                stroke={d.color}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cx})`}
                strokeLinecap="butt"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onClick={() => setHover((h) => (h === i ? null : i))}
              >
                <title>{`${d.label}: ${fmtVal(d.value)}`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
          {showCenter && (
            <>
              <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="currentColor" className="text-gray-900 font-bold" style={{ fontSize: size * 0.2 }}>{centerMain}</text>
              {centerSub && <text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" fill="currentColor" className="text-gray-500" style={{ fontSize: size * 0.085 }}>{centerSub}</text>}
            </>
          )}
        </svg>
        <ChartTip tip={tip} />
      </div>
      <ul className="space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2 text-gray-600">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: d.color }} />
            <span className="font-medium text-gray-900">{Number(d.value).toLocaleString('en-IN')}</span>
            <span>{d.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Horizontal bar chart. data: [{ label, value, color }]. fmt formats values.
export function BarChart({ data = [], fmt = (v) => Number(v).toLocaleString('en-IN') }) {
  const max = Math.max(1, ...data.map((d) => Number(d.value) || 0));
  const [hover, setHover] = useState(null); // hovered row index or null
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-600">{d.label}</span>
            <span className="font-semibold text-gray-900">{fmt(d.value)}</span>
          </div>
          {/* relative wrapper hosts the floating tooltip for this row */}
          <div className="relative">
            <div
              className="h-2.5 rounded-full bg-gray-100 overflow-hidden cursor-pointer"
              title={`${d.label}: ${fmt(d.value)}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              onClick={() => setHover((h) => (h === i ? null : i))}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${((Number(d.value) || 0) / max) * 100}%`,
                  backgroundColor: d.color,
                  outline: hover === i ? '1px solid currentColor' : 'none',
                }}
              />
            </div>
            {hover === i && (
              <ChartTip tip={{ x: '50%', y: 0, text: `${d.label}: ${fmt(d.value)}` }} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Compact stat tile with an accent dot. value already formatted.
export function StatTile({ label, value, color, sub }) {
  return (
    <div className="rounded-xl bg-gray-50 p-4">
      <div className="flex items-center gap-2">
        {color && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />}
        <p className="text-xs text-gray-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// Multi-series line / trend chart. series: [{ name, color, points:[{ x, y }] }].
// All series share the x labels of the first series. fmt formats y values for
// the optional tooltip-free labels. Axes/gridlines use currentColor + a themed
// text class so they recolour with the app theme; series use their hex colour.
export function LineChart({ series = [], height = 180, fmt = (v) => Number(v).toLocaleString('en-IN') }) {
  const valid = (series || []).filter((s) => Array.isArray(s.points) && s.points.length > 0);
  if (valid.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-6">No data to show yet.</p>;
  }
  const labels = valid[0].points.map((p) => p.x);
  const n = labels.length;
  const maxY = Math.max(1, ...valid.flatMap((s) => s.points.map((p) => Number(p.y) || 0)));
  const W = 320, H = height;
  const padL = 8, padR = 8, padT = 12, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xAt = (i) => padL + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const yAt = (v) => padT + plotH - (plotH * ((Number(v) || 0) / maxY));
  const gridLines = 4;
  // hovered point key "si:i" or null. Position the tooltip in the SVG's own
  // pixel space; the SVG scales to its container so the box stays anchored to
  // the dot. Clamp the tooltip x so it never spills past the chart edges.
  const [hover, setHover] = useState(null);
  let tip = null;
  if (hover) {
    const [hsi, hi] = hover.split(':').map(Number);
    const s = valid[hsi];
    const p = s && s.points[hi];
    if (p) {
      const pxPct = (Math.min(W - padR, Math.max(padL, xAt(hi))) / W) * 100;
      tip = { x: `${pxPct}%`, y: (yAt(p.y) / H) * 100 + '%', text: `${p.x}: ${fmt(p.y)}` };
    }
  }
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* gridlines — faint, themed */}
        <g stroke="currentColor" className="text-gray-100">
          {Array.from({ length: gridLines + 1 }).map((_, i) => {
            const y = padT + (plotH * i) / gridLines;
            return <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} strokeWidth="1" />;
          })}
        </g>
        {/* series polylines + dots */}
        {valid.map((s, si) => {
          const pts = s.points.map((p, i) => `${xAt(i)},${yAt(p.y)}`).join(' ');
          return (
            <g key={si}>
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((p, i) => {
                const key = `${si}:${i}`;
                const active = hover === key;
                return (
                  <circle
                    key={i}
                    cx={xAt(i)} cy={yAt(p.y)}
                    r={active ? 4.5 : 2.5}
                    fill={s.color}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHover(key)}
                    onMouseLeave={() => setHover((h) => (h === key ? null : h))}
                    onClick={() => setHover((h) => (h === key ? null : key))}
                  >
                    <title>{`${s.name}  ${p.x}: ${fmt(p.y)}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
        {/* x-axis labels — themed */}
        <g fill="currentColor" className="text-gray-400">
          {labels.map((lab, i) => (
            <text key={i} x={xAt(i)} y={H - 8} textAnchor="middle" style={{ fontSize: 9 }}>{lab}</text>
          ))}
        </g>
      </svg>
      <ChartTip tip={tip} />
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm mt-2 justify-center sm:justify-start">
        {valid.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-gray-600">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span>{s.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Vertical grouped / clustered bar chart. groups: ['Jan',...] x labels.
// series: [{ name, color, values:[n,...] }] aligned to groups. Complements the
// horizontal BarChart above. Axis text uses currentColor + themed text class.
export function GroupedBarChart({ groups = [], series = [], fmt = (v) => Number(v).toLocaleString('en-IN') }) {
  const valid = (series || []).filter((s) => Array.isArray(s.values));
  if (!groups.length || valid.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-6">No data to show yet.</p>;
  }
  const maxY = Math.max(1, ...valid.flatMap((s) => s.values.map((v) => Number(v) || 0)));
  const W = 320, H = 180;
  const padL = 8, padR = 8, padT = 12, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const groupW = plotW / groups.length;
  const innerPad = groupW * 0.18;
  const barAreaW = groupW - innerPad * 2;
  const barW = Math.max(2, barAreaW / valid.length);
  const yAt = (v) => padT + plotH - (plotH * ((Number(v) || 0) / maxY));
  const gridLines = 4;
  // hovered bar key "gi:si" or null. Tooltip is positioned in the SVG's own
  // pixel space (converted to % so it tracks the responsive scaling) and shows
  // the series name plus the formatted value. x is clamped to the plot area so
  // the box never pushes past the edge and triggers horizontal page scroll.
  const [hover, setHover] = useState(null);
  let tip = null;
  if (hover) {
    const [hgi, hsi] = hover.split(':').map(Number);
    const s = valid[hsi];
    if (s) {
      const v = Number(s.values[hgi]) || 0;
      const bx = padL + groupW * hgi + innerPad + barW * hsi + barW / 2;
      const pxPct = (Math.min(W - padR, Math.max(padL, bx)) / W) * 100;
      tip = { x: `${pxPct}%`, y: (yAt(v) / H) * 100 + '%', text: `${s.name}: ${fmt(v)}` };
    }
  }
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* gridlines — faint, themed */}
        <g stroke="currentColor" className="text-gray-100">
          {Array.from({ length: gridLines + 1 }).map((_, i) => {
            const y = padT + (plotH * i) / gridLines;
            return <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} strokeWidth="1" />;
          })}
        </g>
        {/* grouped bars */}
        {groups.map((g, gi) => {
          const gx = padL + groupW * gi + innerPad;
          return (
            <g key={gi}>
              {valid.map((s, si) => {
                const v = Number(s.values[gi]) || 0;
                const y = yAt(v);
                const key = `${gi}:${si}`;
                const active = hover === key;
                return (
                  <rect
                    key={si}
                    x={gx + barW * si}
                    y={y}
                    width={Math.max(1, barW - 1)}
                    height={Math.max(0, padT + plotH - y)}
                    rx="1.5"
                    fill={s.color}
                    style={{ cursor: 'pointer' }}
                    fillOpacity={hover && !active ? 0.55 : 1}
                    stroke={active ? 'currentColor' : 'none'}
                    strokeWidth={active ? 0.75 : 0}
                    className="text-gray-900"
                    onMouseEnter={() => setHover(key)}
                    onMouseLeave={() => setHover((h) => (h === key ? null : h))}
                    onClick={() => setHover((h) => (h === key ? null : key))}
                  >
                    <title>{`${s.name}  ${g}: ${fmt(v)}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
        {/* x-axis labels — themed */}
        <g fill="currentColor" className="text-gray-400">
          {groups.map((g, gi) => (
            <text key={gi} x={padL + groupW * gi + groupW / 2} y={H - 8} textAnchor="middle" style={{ fontSize: 9 }}>{g}</text>
          ))}
        </g>
      </svg>
      <ChartTip tip={tip} />
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm mt-2 justify-center sm:justify-start">
        {valid.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-gray-600">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span>{s.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Inline comparison badge. Shows the percent change of current vs previous with
// an up/down triangle. Colour is favourable (emerald) or unfavourable (rose)
// based on goodIsUp. When previous is 0 or missing, shows a neutral dash.
export function TrendArrow({ current, previous, goodIsUp = true, fmt }) {
  const hasBase = previous !== undefined && previous !== null && Number(previous) !== 0;
  if (!hasBase) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400">
        <span>–</span>
      </span>
    );
  }
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  const favorable = goodIsUp ? up : !up;
  const tone = favorable ? 'text-emerald-600' : 'text-rose-600';
  const label = fmt ? fmt(Math.abs(pct)) : `${Math.abs(Math.round(pct))}%`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${tone}`}>
      <svg viewBox="0 0 8 8" width="8" height="8" fill="currentColor" aria-hidden="true">
        {up
          ? <polygon points="4,0 8,8 0,8" />
          : <polygon points="0,0 8,0 4,8" />}
      </svg>
      <span>{label}</span>
    </span>
  );
}

// Responsive table primitive. Renders a real <table> on sm+ and a stacked list
// of label:value cards on phones so wide tables never overflow. columns:
// [{ key, label, align, render?(row) }]. rows: array of objects. Optional
// onRowClick(row) makes the whole row / card clickable for drill-down.
export function MobileCardTable({ columns = [], rows = [], keyField, onRowClick }) {
  const clickable = typeof onRowClick === 'function';
  const keyOf = (row, i) => (keyField && row[keyField] != null ? row[keyField] : i);
  const cell = (col, row) => (col.render ? col.render(row) : row[col.key]);
  const alignClass = (a) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  return (
    <>
      {/* desktop / tablet table */}
      <table className="hidden sm:table w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            {columns.map((col) => (
              <th key={col.key} className={`py-2 px-3 font-medium text-gray-600 ${alignClass(col.align)}`}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={keyOf(row, i)}
              onClick={clickable ? () => onRowClick(row) : undefined}
              className={`border-b border-gray-200 ${clickable ? 'cursor-pointer' : ''}`}
            >
              {columns.map((col) => (
                <td key={col.key} className={`py-2 px-3 text-gray-900 ${alignClass(col.align)}`}>{cell(col, row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {/* mobile stacked cards */}
      <div className="sm:hidden space-y-2">
        {rows.map((row, i) => (
          <div
            key={keyOf(row, i)}
            onClick={clickable ? () => onRowClick(row) : undefined}
            className={`rounded-xl bg-gray-50 p-3 space-y-1 ${clickable ? 'cursor-pointer' : ''}`}
          >
            {columns.map((col) => (
              <div key={col.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-500">{col.label}</span>
                <span className="text-gray-900 font-medium text-right">{cell(col, row)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// Shared, theme-safe palette for report series.
export const CHART_COLORS = {
  present: '#10b981',  // emerald
  absent:  '#f43f5e',  // rose
  late:    '#f59e0b',  // amber
  active:  '#6366f1',  // indigo
  inactive:'#94a3b8',  // slate
  fees:    '#6366f1',
  additional: '#f59e0b',
  series: ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#a855f7'],
};
