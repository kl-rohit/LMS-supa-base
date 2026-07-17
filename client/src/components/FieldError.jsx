// Inline per-field error message. Renders nothing when there's no error, so it
// can sit unconditionally under any input:
//   <FieldError msg={errors.email} />
import { AlertCircle } from 'lucide-react';

export default function FieldError({ msg, className = '' }) {
  if (!msg) return null;
  return (
    <p className={'field-error ' + className} role="alert">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{msg}</span>
    </p>
  );
}
