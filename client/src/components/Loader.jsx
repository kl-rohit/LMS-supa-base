import { Loader2 } from 'lucide-react';

export default function Loader({ text = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      <p className="mt-3 text-sm text-gray-500">{text}</p>
    </div>
  );
}
