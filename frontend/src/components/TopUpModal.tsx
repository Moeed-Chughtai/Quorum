"use client";

import { useCallback, useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { createTopupIntent, topUpWallet, getWalletBalance } from "@/lib/api";

/* ------------------------------------------------------------------ */
/* Stripe singleton                                                    */
/* ------------------------------------------------------------------ */

const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
let stripePromise: Promise<Stripe | null> | null = null;

function getStripe() {
  if (!stripePromise && PK) {
    stripePromise = loadStripe(PK);
  }
  return stripePromise;
}

/* ------------------------------------------------------------------ */
/* Preset amount buttons                                               */
/* ------------------------------------------------------------------ */

const PRESETS = [1, 5, 10, 25];

/* ------------------------------------------------------------------ */
/* Inner checkout form (must be inside <Elements>)                     */
/* ------------------------------------------------------------------ */

function CheckoutForm({
  amountCents,
  onSuccess,
  onCancel,
}: {
  amountCents: number;
  onSuccess: (balanceMicro: number) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true);
    setError(null);

    const { error: submitErr } = await elements.submit();
    if (submitErr) {
      setError(submitErr.message ?? "Validation failed");
      setPaying(false);
      return;
    }

    const { error: confirmErr } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });

    if (confirmErr) {
      setError(confirmErr.message ?? "Payment failed");
      setPaying(false);
      return;
    }

    // Payment succeeded — credit local wallet immediately
    try {
      const data = await topUpWallet("demo", amountCents / 100);
      onSuccess(data.balance_microdollars);
    } catch {
      // topUpWallet failed — refetch current balance so nav still updates
      try {
        const fallback = await getWalletBalance("demo");
        onSuccess(fallback.balance_microdollars);
      } catch {
        onSuccess(0);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />
      {error && (
        <p className="text-[12px] text-red-400">{error}</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={paying || !stripe}
          className="flex-1 py-2 rounded-lg text-[13px] font-medium bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-40 transition-colors"
        >
          {paying ? "Processing…" : `Pay $${(amountCents / 100).toFixed(2)}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={paying}
          className="px-4 py-2 rounded-lg text-[13px] text-[#a8a29e] hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Main modal                                                          */
/* ------------------------------------------------------------------ */

export default function TopUpModal({
  open,
  onClose,
  onBalanceUpdated,
}: {
  open: boolean;
  onClose: () => void;
  onBalanceUpdated: (balanceMicro: number) => void;
}) {
  const [step, setStep] = useState<"amount" | "pay">("amount");
  const [amount, setAmount] = useState("5");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setStep("amount");
      setAmount("5");
      setClientSecret(null);
      setError(null);
    }
  }, [open]);

  const amountCents = Math.round(parseFloat(amount || "0") * 100);
  const valid = amountCents >= 50 && amountCents <= 10000; // $0.50 – $100

  const handleQuickAdd = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      const data = await topUpWallet("demo", amountCents / 100);
      onBalanceUpdated(data.balance_microdollars);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add funds");
    } finally {
      setLoading(false);
    }
  }, [valid, amountCents, onBalanceUpdated, onClose]);

  const handleProceed = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      const data = await createTopupIntent("demo", amountCents);
      setClientSecret(data.client_secret);
      setStep("pay");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create payment");
    } finally {
      setLoading(false);
    }
  }, [valid, amountCents]);

  const handleSuccess = useCallback(
    (balanceMicro: number) => {
      onBalanceUpdated(balanceMicro);
      onClose();
    },
    [onBalanceUpdated, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative w-full max-w-sm mx-4 rounded-xl border border-[#2e2a26] bg-[#1a1715] shadow-2xl overflow-hidden animate-enter">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[#f0ede8]">
            Add Funds
          </h2>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded text-[#a8a29e] hover:text-white hover:bg-white/10 transition-colors text-[14px]"
          >
            ✕
          </button>
        </div>

        <div className="px-5 pb-5">
          {step === "amount" && (
            <div className="space-y-4">
              {/* Presets */}
              <div className="flex gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setAmount(String(p))}
                    className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                      amount === String(p)
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-400"
                        : "border-[#2e2a26] text-[#a8a29e] hover:border-[#4a4540] hover:text-white"
                    }`}
                  >
                    ${p}
                  </button>
                ))}
              </div>

              {/* Custom input */}
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[#a8a29e]">$</span>
                <input
                  type="number"
                  min="0.50"
                  max="100"
                  step="0.50"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && valid) handleProceed(); }}
                  className="w-full pl-7 pr-3 py-2.5 rounded-lg bg-[#0f0e0d] border border-[#2e2a26] text-[14px] text-white font-mono tabular-nums outline-none focus:border-emerald-500/50 transition-colors"
                  autoFocus
                />
              </div>

              {error && <p className="text-[12px] text-red-400">{error}</p>}

              <button
                onClick={handleQuickAdd}
                disabled={!valid || loading}
                className="w-full py-2.5 rounded-lg text-[13px] font-medium bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-40 transition-colors"
              >
                {loading ? "Adding…" : "Add Funds"}
              </button>

              {PK && (
                <button
                  onClick={handleProceed}
                  disabled={!valid || loading}
                  className="w-full py-2 rounded-lg text-[12px] font-medium border border-[#2e2a26] text-[#a8a29e] hover:border-[#4a4540] hover:text-white disabled:opacity-40 transition-colors"
                >
                  {loading ? "Creating…" : "Pay with Stripe →"}
                </button>
              )}

              <p className="text-[10px] text-[#6b6560] text-center">
                Min $0.50 · Max $100 · Powered by Stripe
              </p>
            </div>
          )}

          {step === "pay" && clientSecret && (
            <Elements
              stripe={getStripe()}
              options={{
                clientSecret,
                appearance: {
                  theme: "night",
                  variables: {
                    colorPrimary: "#10b981",
                    colorBackground: "#0f0e0d",
                    colorText: "#f0ede8",
                    colorDanger: "#ef4444",
                    fontFamily: "system-ui, sans-serif",
                    borderRadius: "8px",
                    spacingUnit: "4px",
                  },
                  rules: {
                    ".Input": {
                      border: "1px solid #2e2a26",
                      boxShadow: "none",
                    },
                    ".Input:focus": {
                      border: "1px solid rgba(16,185,129,0.5)",
                      boxShadow: "none",
                    },
                  },
                },
              }}
            >
              <CheckoutForm
                amountCents={amountCents}
                onSuccess={handleSuccess}
                onCancel={() => { setStep("amount"); setClientSecret(null); }}
              />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}
