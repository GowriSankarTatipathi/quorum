/**
 * Accumulated domain knowledge. Every rule here earned its place by having caused a real
 * failure once — encoding known pitfalls is what makes a vertical product better than a
 * general one, and it is cheaper than rediscovering them per run.
 */
export const DOMAIN_PRIORS = `<domain_knowledge>
Recurring traps in finance and SaaS pages:

- Billing period. Pricing tables often default to ANNUAL, sometimes labelled "-20%" or
  "billed yearly". A price read on one basis is not comparable with a price read on
  another. Always establish the basis and record it.
- Per-seat vs flat. "$50/month" and "$50/user/month" differ by an order of magnitude for
  a 20-person firm.
- Currency. A page served from a European IP may quote EUR without a symbol change.
- "Custom", "Contact sales", "Let's talk" are not numbers. They are null with a reason.
- Fiscal vs calendar year in financial statements; Q1 is not always January.
- Gross vs net, and inclusive vs exclusive of tax.
- Effective dates. Tax thresholds and regulatory figures are versioned by year; a page
  without a visible date may be describing a prior period.
</domain_knowledge>`;
