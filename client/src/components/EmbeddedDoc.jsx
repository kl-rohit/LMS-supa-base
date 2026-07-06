// Reusable in-app document viewer. Embeds a Google Drive file (via its /preview
// URL) or a direct link inside the app so the student never leaves for Drive.
//
// The mask: Drive's preview shows a built-in "open in Drive / pop-out" control
// in the top-right. That button lives INSIDE Google's cross-origin iframe, so it
// cannot be removed by our code — instead we cover that corner with an opaque
// element that both hides it and blocks the click. Best-effort: if Google ever
// repositions the control, the mask offset may need adjusting.
//
// Reused by: portal Question Papers, course documents (CoursePlayer), and any
// other place that needs to show a shared file.

import { driveEmbedUrl } from '../utils/youtube';

export default function EmbeddedDoc({ url, title, className = '' }) {
  const src = driveEmbedUrl(url) || url;
  if (!src) {
    return <div className="p-6 text-sm text-gray-500">This file can't be previewed.</div>;
  }
  return (
    <div className={`relative w-full h-full ${className}`}>
      <iframe
        src={src}
        title={title || 'Document'}
        className="w-full h-full border-0"
        allowFullScreen
      />
      {/* Covers Drive's top-right pop-out control (cross-origin — can't remove). */}
      <div
        className="absolute top-0 right-0 h-14 w-16 bg-neutral-800 pointer-events-auto"
        aria-hidden="true"
      />
    </div>
  );
}
