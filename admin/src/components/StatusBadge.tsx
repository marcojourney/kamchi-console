import { Ban, CheckCircle2, Clock } from 'lucide-react';
import type { LicenseStatus } from '../types/license';

export function StatusBadge({ status }: { status: LicenseStatus }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Active
      </span>
    );
  }
  if (status === 'revoked') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-md border border-red-200 bg-red-50 text-red-800 whitespace-nowrap shrink-0">
        <Ban className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Revoked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-md border border-amber-200 bg-amber-50 text-amber-800 whitespace-nowrap shrink-0">
      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      Expired
    </span>
  );
}
