'use client';

import { useState } from 'react';
import { Check, CreditCard, Mail, Lock, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';

interface CheckoutFlowProps {
  plan: {
    id: string;
    name: string;
    price: number;
    originalPrice: number;
    period: string;
    features: string[];
  };
  onComplete?: (data: { email: string; paymentComplete: boolean }) => void;
}

type Step = 1 | 2 | 3;

const STEPS = [
  { num: 1, label: 'Account', icon: Mail },
  { num: 2, label: 'Payment', icon: CreditCard },
  { num: 3, label: 'Confirm', icon: Check },
];

export function CheckoutFlow({ plan, onComplete }: CheckoutFlowProps) {
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    cardNumber: '',
    expiry: '',
    cvc: '',
    name: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateStep = (currentStep: Step): boolean => {
    const newErrors: Record<string, string> = {};

    if (currentStep === 1) {
      if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
        newErrors.email = 'Please enter a valid email';
      }
      if (!formData.password || formData.password.length < 8) {
        newErrors.password = 'Password must be at least 8 characters';
      }
    }

    if (currentStep === 2) {
      if (!formData.cardNumber || formData.cardNumber.replace(/\s/g, '').length < 13) {
        newErrors.cardNumber = 'Please enter a valid card number';
      }
      if (!formData.expiry || !/^\d{2}\/\d{2}$/.test(formData.expiry)) {
        newErrors.expiry = 'Use MM/YY format';
      }
      if (!formData.cvc || !/^\d{3,4}$/.test(formData.cvc)) {
        newErrors.cvc = 'Invalid CVC';
      }
      if (!formData.name) {
        newErrors.name = 'Name is required';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const nextStep = () => {
    if (validateStep(step)) {
      if (step < 3) setStep((step + 1) as Step);
    }
  };

  const prevStep = () => {
    if (step > 1) setStep((step - 1) as Step);
  };

  const handleSubmit = async () => {
    if (!validateStep(2)) return;

    setLoading(true);
    try {
      const response = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: plan.id,
          email: formData.email,
          password: formData.password,
        }),
      });

      if (response.ok) {
        setStep(3);
        onComplete?.({ email: formData.email, paymentComplete: true });
      } else {
        const data = await response.json();
        setErrors({ submit: data.error || 'Subscription failed' });
      }
    } catch {
      setErrors({ submit: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const formatCardNumber = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(\d{4})/g, '$1 ').trim();
  };

  const formatExpiry = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 2) {
      return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    return digits;
  };

  return (
    <div className="max-w-lg mx-auto">
      {/* Progress Steps */}
      <div className="flex items-center justify-between mb-8">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  step >= s.num
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {step > s.num ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <s.icon className="h-5 w-5" />
                )}
              </div>
              <span className={`text-xs mt-1 ${step >= s.num ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-16 sm:w-24 h-0.5 mx-2 transition-all ${
                  step > s.num ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Order Summary (Always visible) */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <div className="flex justify-between items-center">
          <div>
            <span className="font-semibold text-gray-900">{plan.name}</span>
            <span className="text-sm text-gray-500 ml-2">plan</span>
          </div>
          <div className="text-right">
            <span className="text-sm text-gray-400 line-through mr-2">${plan.originalPrice}</span>
            <span className="text-xl font-bold text-gray-900">${plan.price}</span>
            <span className="text-sm text-gray-500">{plan.period}</span>
          </div>
        </div>
        <div className="mt-2 text-xs text-green-600 font-medium">
          You save ${plan.originalPrice - plan.price}/month (50% off)
        </div>
      </div>

      {/* Step Content */}
      <div className="bg-white rounded-xl border p-6">
        {/* Step 1: Account */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Create your account</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.email ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="you@example.com"
              />
              {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.password ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Min. 8 characters"
              />
              {errors.password && <p className="text-red-500 text-sm mt-1">{errors.password}</p>}
            </div>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <Lock className="h-3 w-3" /> Your information is encrypted and secure
            </p>
          </div>
        )}

        {/* Step 2: Payment */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment details</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Card number</label>
              <input
                type="text"
                value={formData.cardNumber}
                onChange={(e) => setFormData({ ...formData, cardNumber: formatCardNumber(e.target.value) })}
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.cardNumber ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="1234 5678 9012 3456"
              />
              {errors.cardNumber && <p className="text-red-500 text-sm mt-1">{errors.cardNumber}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expiry</label>
                <input
                  type="text"
                  value={formData.expiry}
                  onChange={(e) => setFormData({ ...formData, expiry: formatExpiry(e.target.value) })}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.expiry ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="MM/YY"
                />
                {errors.expiry && <p className="text-red-500 text-sm mt-1">{errors.expiry}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CVC</label>
                <input
                  type="text"
                  value={formData.cvc}
                  onChange={(e) => setFormData({ ...formData, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.cvc ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="123"
                />
                {errors.cvc && <p className="text-red-500 text-sm mt-1">{errors.cvc}</p>}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name on card</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.name ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="John Doe"
              />
              {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
            </div>
            {errors.submit && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                {errors.submit}
              </div>
            )}
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <Lock className="h-3 w-3" /> 256-bit SSL encrypted. Your card is never stored on our servers.
            </p>
          </div>
        )}

        {/* Step 3: Confirmation */}
        {step === 3 && (
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Welcome to DealFlow AI!</h2>
            <p className="text-gray-600 mb-6">
              Your {plan.name} plan is now active. Check your email for login details.
            </p>
            <div className="bg-blue-50 rounded-lg p-4 text-left">
              <h3 className="font-medium text-blue-900 mb-2">Next steps:</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>1. Import your first leads or use Lead Finder</li>
                <li>2. Create an AI-powered outreach campaign</li>
                <li>3. Watch the deals come in</li>
              </ul>
            </div>
            <a
              href="/dashboard"
              className="mt-6 inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              Go to Dashboard
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        )}

        {/* Navigation */}
        {step < 3 && (
          <div className="flex justify-between mt-6 pt-4 border-t">
            {step > 1 ? (
              <button
                onClick={prevStep}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            ) : (
              <div />
            )}
            {step === 1 ? (
              <button
                onClick={nextStep}
                className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Continue to Payment
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex items-center gap-2 bg-green-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Start 14-Day Free Trial
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Trust badges */}
      <div className="mt-6 flex flex-wrap justify-center gap-4 text-xs text-gray-400">
        <span>14-day free trial</span>
        <span>Cancel anytime</span>
        <span>30-day money-back</span>
      </div>
    </div>
  );
}
