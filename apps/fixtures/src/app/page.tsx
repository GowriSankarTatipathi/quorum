const CASES = [
  {
    href: '/pricing',
    title: 'Pricing with a billing-period toggle',
    why: 'Defaults to ANNUAL. Reproduces the single most common source of incomparable pricing data, and the exact error the Critic catches in the demo.',
  },
  {
    href: '/consent',
    title: 'Consent wall over the content',
    why: 'An overlay intercepts clicks until dismissed. Exercises overlay detection, the dismiss_overlay recovery strategy, and human takeover.',
  },
];

export default function FixtureIndex() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold">QUORUM fixture site</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Deterministic reproductions of the page behaviours that break browser agents.
      </p>
      <ul className="mt-8 space-y-4">
        {CASES.map((c) => (
          <li key={c.href} className="rounded-lg border border-neutral-200 p-4">
            <a
              href={c.href}
              className="font-medium text-blue-700 underline-offset-4 hover:underline"
            >
              {c.title}
            </a>
            <p className="mt-1 text-sm text-neutral-600">{c.why}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
