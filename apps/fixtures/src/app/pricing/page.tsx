'use client';

import { useState } from 'react';

const TIERS = [
  {
    name: 'Starter',
    monthly: 0,
    annual: 0,
    seats: '1 seat',
    features: ['Expense capture', 'CSV export'],
  },
  {
    name: 'Collect',
    monthly: 8,
    annual: 5,
    seats: 'per user',
    features: ['Everything in Starter', 'Approvals', 'Receipt matching'],
  },
  {
    name: 'Control',
    monthly: 18,
    annual: 14,
    seats: 'per user',
    features: ['Everything in Collect', 'SSO', 'Audit trail'],
  },
  {
    name: 'Enterprise',
    monthly: null,
    annual: null,
    seats: 'custom',
    features: ['Everything in Control', 'Dedicated support'],
  },
];

/**
 * NOTE: the toggle defaults to ANNUAL, exactly as several real vendors do. An agent
 * that extracts without checking the billing period will report a number that is ~40%
 * below the monthly rate and is not comparable with competitors quoted monthly.
 */
export default function FixturePricing() {
  const [period, setPeriod] = useState<'monthly' | 'annual'>('annual');

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Pricing</h1>

      <div
        role="radiogroup"
        aria-label="Billing period"
        className="mt-6 inline-flex rounded-full border border-neutral-300 p-1"
      >
        {(['monthly', 'annual'] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={period === p}
            onClick={() => setPeriod(p)}
            className={`rounded-full px-4 py-1.5 text-sm capitalize ${
              period === p ? 'bg-neutral-900 text-white' : 'text-neutral-600'
            }`}
          >
            {p}
            {p === 'annual' ? ' −20%' : ''}
          </button>
        ))}
      </div>

      <div data-testid="pricing-grid" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => {
          const amount = period === 'monthly' ? tier.monthly : tier.annual;
          return (
            <section key={tier.name} className="rounded-lg border border-neutral-200 p-4">
              <h2 className="font-medium">{tier.name}</h2>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {amount === null ? 'Custom' : `$${amount}`}
              </p>
              <p className="text-xs text-neutral-500">
                {amount === null ? 'contact sales' : `${tier.seats} / month`}
              </p>
              <ul className="mt-3 space-y-1 text-sm text-neutral-600">
                {tier.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
