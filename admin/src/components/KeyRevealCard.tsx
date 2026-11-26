import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  MessageSquare,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import type { CreateLicenseResponse } from '../types/license';
import { billingLabel, formatDate, planLabel } from '../lib/format';

interface KeyRevealCardProps {
  result: CreateLicenseResponse;
  title?: string;
  onViewDetail: (keyIdHex: string) => void;
  onCreateAnother?: () => void;
}

export function KeyRevealCard({
  result,
  title = 'Offline License Key Generated',
  onViewDetail,
  onCreateAnother,
}: KeyRevealCardProps) {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedEn, setCopiedEn] = useState(false);
  const [copiedKm, setCopiedKm] = useState(false);
  const [previewLang, setPreviewLang] = useState<'km' | 'en'>('km');
  const [showQr, setShowQr] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(result.plainKey, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) {
          setQrDataUrl(url);
          setQrError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setQrError(err instanceof Error ? err.message : 'Failed to render QR code.');
        }
      });
    return () => {
      active = false;
    };
  }, [result.plainKey]);

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

  function handleDownloadLicenseFile() {
    const blob = new Blob([result.kamchiLicenseFileContent], {
      type: 'text/plain;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.kamchiLicenseFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleDownloadQrPng() {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${result.keyIdHex}-${result.license.plan}-qr.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
            {result.selfVerify.valid ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 whitespace-nowrap">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Verified for KamChi
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-md border border-red-200 bg-red-50 text-red-800 whitespace-nowrap">
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                Verification Failed
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-1.5">
            {planLabel(result.license.plan)} · {billingLabel(result.license.billing)} · Expires{' '}
            {formatDate(result.license.expiresAt)} · {result.license.maxDevices} device(s) ·{' '}
            {result.license.bindingMode === 'bound' && result.license.deviceCode
              ? `Bound to ${result.license.deviceCode}`
              : 'Unbound'}
          </p>
        </div>

        <div className="text-xs font-mono text-slate-600 shrink-0">
          Key ID: <span className="font-semibold text-slate-900">{result.keyIdHex}</span>
        </div>
      </div>

      {/* Self-verification breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
        <div className="flex items-center gap-2 text-slate-700">
          <CheckCircle2
            className={`w-4 h-4 shrink-0 ${
              result.selfVerify.checksumValid ? 'text-emerald-700' : 'text-red-700'
            }`}
          />
          <span>SHA-256 Checksum (2B)</span>
        </div>
        <div className="flex items-center gap-2 text-slate-700">
          <CheckCircle2
            className={`w-4 h-4 shrink-0 ${
              result.selfVerify.signatureValid ? 'text-emerald-700' : 'text-red-700'
            }`}
          />
          <span>Ed25519 Signature (64B)</span>
        </div>
        <div className="flex items-center gap-2 text-slate-700">
          <CheckCircle2
            className={`w-4 h-4 shrink-0 ${
              result.selfVerify.deviceCodeHashMatches ? 'text-emerald-700' : 'text-red-700'
            }`}
          />
          <span>Device Hash Match (8B)</span>
        </div>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" />
        <div className="text-sm leading-relaxed">
          <span className="font-semibold">Save or send now.</span> Only a masked copy is recorded
          in the log. Download the <code className="font-mono text-xs">.kamchi-license</code> file
          or copy the key before leaving this screen.
        </div>
      </div>

      {/* Large copy-friendly key box */}
      <div className="p-5 rounded-xl bg-slate-900 text-white space-y-4">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
          <span>KamChi Offline Key (144-char Base32)</span>
          <span className="font-mono">v{result.selfVerify.payloadVersion}</span>
        </div>
        <div className="font-mono text-sm sm:text-base font-medium tracking-wide break-all select-all leading-relaxed">
          {result.plainKey}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-1">
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
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            {copiedKm ? <Check className="w-4 h-4 text-emerald-400" /> : <MessageSquare className="w-4 h-4" />}
            {copiedKm ? 'Copied KM' : 'Copy Telegram (KM)'}
          </button>

          <button
            type="button"
            onClick={() => copyText(result.telegramMessages.en, 'en')}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            {copiedEn ? <Check className="w-4 h-4 text-emerald-400" /> : <MessageSquare className="w-4 h-4" />}
            {copiedEn ? 'Copied EN' : 'Copy Telegram (EN)'}
          </button>

          <button
            type="button"
            onClick={handleDownloadLicenseFile}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileText className="w-4 h-4" />
            Download .kamchi-license
          </button>

          <button
            type="button"
            onClick={() => setShowQr((v) => !v)}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <QrCode className="w-4 h-4" />
            {showQr ? 'Hide QR Code' : 'Show QR Code'}
          </button>
        </div>
      </div>

      {/* QR Code + Telegram Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {showQr && (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-3">
            <div className="text-xs font-medium text-slate-600">
              Scan directly with KamChi QR Scanner
            </div>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR code for KamChi license ${result.keyIdHex}`}
                className="w-52 h-52 bg-white p-2 rounded-lg border border-slate-200"
              />
            ) : (
              <div className="w-52 h-52 flex items-center justify-center text-xs text-slate-500">
                {qrError ?? 'Rendering QR...'}
              </div>
            )}
            <button
              type="button"
              disabled={!qrDataUrl}
              onClick={handleDownloadQrPng}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Download QR PNG
            </button>
          </div>
        )}

        <div className={`space-y-3 ${showQr ? '' : 'lg:col-span-2'}`}>
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
          <pre className="p-4 text-xs sm:text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg whitespace-pre-wrap font-sans leading-relaxed break-words">
            {previewLang === 'km' ? result.telegramMessages.km : result.telegramMessages.en}
          </pre>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
        <button
          type="button"
          onClick={() => onViewDetail(result.keyIdHex)}
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
