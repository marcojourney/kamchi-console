import { useState } from 'react';
import { AlertCircle, KeyRound } from 'lucide-react';
import { adminApi } from '../lib/api';
import {
  DEFAULT_MAX_DEVICES,
  type CreateLicenseResponse,
  type LicenseBilling,
  type LicensePlan,
} from '../types/license';
import { KeyRevealCard } from '../components/KeyRevealCard';

interface CreateLicensePageProps {
  onViewDetail: (keyHash: string) => void;
}

type ExpiryPreset = '1m' | '1y' | 'lifetime' | 'custom';

export function CreateLicensePage({ onViewDetail }: CreateLicensePageProps) {
  const [plan, setPlan] = useState<LicensePlan>('pro');
  const [billing, setBilling] = useState<LicenseBilling>('yearly');
  const [preset, setPreset] = useState<ExpiryPreset>('1y');
  const [customDate, setCustomDate] = useState('');
  const [maxDevices, setMaxDevices] = useState<number>(DEFAULT_MAX_DEVICES.pro);
  const [buyerContact, setBuyerContact] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateLicenseResponse | null>(null);

  function handlePlanChange(nextPlan: LicensePlan) {
    setPlan(nextPlan);
    setMaxDevices(DEFAULT_MAX_DEVICES[nextPlan]);
  }

  function handlePresetChange(nextPreset: ExpiryPreset) {
    setPreset(nextPreset);
    if (nextPreset === '1m') setBilling('monthly');
    else if (nextPreset === '1y') setBilling('yearly');
    else if (nextPreset === 'lifetime') setBilling('lifetime');
  }

  function resolveExpiresAtIso(): string | null {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    if (preset === 'lifetime') return null;
    if (preset === '1m') return new Date(now + 30 * day).toISOString();
    if (preset === '1y') return new Date(now + 365 * day).toISOString();
    if (!customDate) {
      throw new Error('Choose a custom expiration date.');
    }
    return new Date(`${customDate}T23:59:59.000Z`).toISOString();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let expiresAt: string | null = null;
    try {
      expiresAt = resolveExpiresAtIso();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid expiration date.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await adminApi.createLicense({
        plan,
        billing,
        expiresAt,
        maxDevices,
        buyerContact: buyerContact.trim(),
        notes: notes.trim(),
      });
      setCreated(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create license.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setCreated(null);
    setBuyerContact('');
    setNotes('');
    setCustomDate('');
    setError(null);
  }

  if (created) {
    return (
      <div className="max-w-3xl space-y-6">
        <KeyRevealCard
          result={created}
          onViewDetail={onViewDetail}
          onCreateAnother={resetForm}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Create License</h1>
        <p className="text-sm text-slate-600 mt-1">
          Issue a new KamChi key after confirming ABA or KHQR payment. The plain key is shown once.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-200 bg-red-50 text-red-900">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
      >
        {/* Plan selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-800">Plan</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'pro', title: 'Pro', hint: '2 devices default' },
              { id: 'business', title: 'Business', hint: '5 devices default' },
              { id: 'free', title: 'Free', hint: '1 device default' },
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handlePlanChange(option.id)}
                className={`p-3 text-left rounded-lg border transition-colors ${
                  plan === option.id
                    ? 'border-teal-700 bg-teal-50/70 text-teal-950'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="text-sm font-semibold">{option.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{option.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Expiry presets */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-800">Duration Preset</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([
              { id: '1m', label: '1 Month' },
              { id: '1y', label: '1 Year' },
              { id: 'lifetime', label: 'Lifetime' },
              { id: 'custom', label: 'Custom Date' },
            ] as const).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handlePresetChange(item.id)}
                className={`px-3 py-2.5 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  preset === item.id
                    ? 'border-teal-700 bg-teal-50/70 text-teal-950'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="pt-2">
              <input
                type="date"
                required
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="w-full sm:w-auto px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          )}
        </div>

        {/* Billing & Max Devices */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="create-billing" className="block text-sm font-medium text-slate-800">
              Billing Cycle
            </label>
            <select
              id="create-billing"
              value={billing}
              onChange={(e) => setBilling(e.target.value as LicenseBilling)}
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="lifetime">Lifetime</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="create-max-devices" className="block text-sm font-medium text-slate-800">
              Max Devices
            </label>
            <input
              id="create-max-devices"
              type="number"
              min={1}
              max={100}
              required
              value={maxDevices}
              onChange={(e) => setMaxDevices(Number(e.target.value))}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        </div>

        {/* Buyer Contact */}
        <div className="space-y-1.5">
          <label htmlFor="create-buyer-contact" className="block text-sm font-medium text-slate-800">
            Buyer Contact
          </label>
          <input
            id="create-buyer-contact"
            type="text"
            maxLength={200}
            value={buyerContact}
            onChange={(e) => setBuyerContact(e.target.value)}
            placeholder="Telegram @username or phone number (e.g. 012 345 678)"
            className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <label htmlFor="create-notes" className="block text-sm font-medium text-slate-800">
            Notes
          </label>
          <textarea
            id="create-notes"
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ABA / KHQR transaction reference, shop name, or renewal note..."
            className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div className="pt-2 flex items-center justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <KeyRound className="w-4 h-4" />
            {submitting ? 'Generating Key...' : 'Generate License Key'}
          </button>
        </div>
      </form>
    </div>
  );
}
