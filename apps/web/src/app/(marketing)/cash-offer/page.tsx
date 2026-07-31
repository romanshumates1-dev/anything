'use client';

import { useState } from 'react';

const CONSENT_VERSION = 'v2026-07-29';

export default function CashOfferPage() {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    propertyAddress: '',
    consentTextVersion: CONSENT_VERSION,
  });
  const [status, setStatus] = useState<{ ok?: boolean; message?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await fetch('/api/consent/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim(),
          propertyAddress: form.propertyAddress.trim(),
          consentMethod: 'web_form',
          source: 'cash_offer_landing',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Submission failed');
      setStatus({ ok: true, message: 'Request received. We will review and respond within 24 hours.' });
      setForm({ firstName: '', lastName: '', email: '', phone: '', propertyAddress: '', consentTextVersion: CONSENT_VERSION });
    } catch (err: any) {
      setStatus({ ok: false, message: err?.message || 'Submission error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">Get a cash offer</h1>
      <p className="mt-2 text-gray-600">
        Submit the form below. By submitting you agree to our terms and consent to receive communications about your property.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">First name</label>
            <input className="mt-1 w-full rounded border border-gray-300 p-2" value={form.firstName} onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Last name</label>
            <input className="mt-1 w-full rounded border border-gray-300 p-2" value={form.lastName} onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))} required />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Email</label>
          <input type="email" className="mt-1 w-full rounded border border-gray-300 p-2" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} required />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Phone</label>
          <input className="mt-1 w-full rounded border border-gray-300 p-2" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} required />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Property address</label>
          <input className="mt-1 w-full rounded border border-gray-300 p-2" value={form.propertyAddress} onChange={(e) => setForm(f => ({ ...f, propertyAddress: e.target.value }))} required />
        </div>

        <div className="rounded border border-gray-200 p-3 text-xs text-gray-600">
          <label className="font-semibold">Consent text version: {CONSENT_VERSION}</label>
          <p className="mt-1">
            By submitting, you consent to be contacted at the email and phone provided, including via automated or prerecorded messages where permitted, about your property or related offers. Opt-out is available by replying STOP (SMS) or using the unsubscribe link (email).
          </p>
        </div>

        <button disabled={submitting} className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
          {submitting ? 'Submitting...' : 'Request my cash offer'}
        </button>

        {status?.message && (
          <div className={`rounded p-3 text-sm ${status.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
            {status.message}
          </div>
        )}
      </form>
    </div>
  );
}