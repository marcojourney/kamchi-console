export function formatDate(iso: string | null): string {
  if (!iso) return 'Lifetime';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Invalid date';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Invalid date';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function planLabel(plan: string): string {
  if (plan === 'business') return 'Business';
  if (plan === 'pro') return 'Pro';
  return 'Free';
}

export function billingLabel(billing: string): string {
  if (billing === 'lifetime') return 'Lifetime';
  if (billing === 'yearly') return 'Yearly';
  return 'Monthly';
}
