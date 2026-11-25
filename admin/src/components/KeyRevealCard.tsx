import { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Copy, MessageSquare } from 'lucide-react';
import type { CreateLicenseResponse } from '../types/license';
import { billingLabel, formatDate, planLabel } from '../lib/format';

interface KeyRevealCardProps {
  result: CreateLicenseResponse;
  title?: string;
  onViewDetail: (keyHash: string) => void;
  onCreateAnother?: () => void;
}

export function KeyRevealCard({
  result,
  title = 'License Key Issued',
  onViewDetail,
  onCreateAnother,
}: KeyRevealCardProps) {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedEn, setCopiedEn] = useState(false);
  const [copiedKm, setCopiedKm] = useState(false);
  const [previewLang, setPreviewLang] = useState<'km' | 'en'>('km');

  async function copyText(text: string, which: 'key' | 'en' | 'km') {
    await navigator.clipboard.writeText(text);
    if (which === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else if (which === 'en') {
      setCopiedEn(true);
      setTimeout(() => setCopiedEn(false), 2000);
    } else {
      setCopiedKm(true);
      setTimeout(() => setCopiedKm(false), 2000);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-600 mt-1">
            {planLabel(result.license.plan)} · {billingLabel(result.license.billing)} ·{' '}
            {result.license.maxDevices} max devices · Expires {formatDate(result.license.expiresAt)}
          </p>
        </div>
        <span className="text-xs font-mono text-slate-500">
          Hash prefix: {result.keyHashPrefix}
        </span>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" />
        <div className="text-sm leading-relaxed">
          <span className="font-semibold">Shown only once.</span> Plain license keys are never saved
          in Firestore. Copy the key or Telegram message now before leaving this screen.
        </div>
      </div>

      {/* Large copy-friendly key box */}
      <div className="p-5 rounded-xl bg-slate-900 text-white space-y-4">
        <div className="text-xs font-medium text-slate-400">KamChi License Key</div>
        <div className="font-mono text-xl sm:text-2xl font-semibold tracking-wider break-all select-all">
          {result.plainKey}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => copyText(result.plainKey, 'key')}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors whitespace-nowrap"
          >
            {copiedKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copiedKey ? 'Key Copied' : 'Copy Key'}
          </button>
          <button
            type="button"
            onClick={() => copyText(result.telegramMessages.km, 'km')}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            {copiedKm ? <Check className="w-4 h-4 text-emerald-400" /> : <MessageSquare className="w-4 h-4" />}
            {copiedKm ? 'Copied KM Message' : 'Copy Telegram (KM)'}
          </button>
          <button
            type="button"
            onClick={() => copyText(result.telegramMessages.en, 'en')}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            {copiedEn ? <Check className="w-4 h-4 text-emerald-400" /> : <MessageSquare className="w-4 h-4" />}
            {copiedEn ? 'Copied EN Message' : 'Copy Telegram (EN)'}
          </button>
        </div>
      </div>

      {/* Telegram message preview */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-slate-700">Telegram Message Preview</span>
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setPreviewLang('km')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                previewLang === 'km'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Khmer (KM)
            </button>
            <button
              type="button"
              onClick={() => setPreviewLang('en')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                previewLang === 'en'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              English (EN)
            </button>
          </div>
        </div>
        <pre className="p-4 text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg whitespace-pre-wrap font-sans leading-relaxed">
          {previewLang === 'km' ? result.telegramMessages.km : result.telegramMessages.en}
        </pre>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
        <button
          type="button"
          onClick={() => onViewDetail(result.keyHash)}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
        >
          Open License Record
          <ArrowRight className="w-4 h-4" />
        </button>
        {onCreateAnother && (
          <button
            type="button"
            onClick={onCreateAnother}
            className="px-4 py-2.5 text-sm font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors whitespace-nowrap"
          >
            Issue Another Key
          </button>
        )}
      </div>
    </div>
  );
}
