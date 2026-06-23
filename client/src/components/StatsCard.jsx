export default function StatsCard({ icon: Icon, title, value, color = 'indigo', subtitle, onClick }) {
  const colorMap = {
    indigo: 'bg-indigo-100 text-indigo-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    rose: 'bg-rose-100 text-rose-600',
    blue: 'bg-blue-100 text-blue-600',
    purple: 'bg-purple-100 text-purple-600',
  };

  const clickable = typeof onClick === 'function';

  // When a card is hot-wired we render it as a real <button> so it's
  // keyboard-focusable and announces as actionable to screen readers. The
  // hover lift + ring mirrors the other clickable surfaces in the app.
  const Tag = clickable ? 'button' : 'div';

  return (
    <Tag
      {...(clickable ? { type: 'button', onClick } : {})}
      className={`card flex items-start gap-4 w-full text-left ${
        clickable
          ? 'cursor-pointer transition-shadow transition-transform hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400'
          : ''
      }`}
    >
      <div className={`flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center ${colorMap[color] || colorMap.indigo}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-sm text-gray-500 font-medium">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
      </div>
    </Tag>
  );
}
