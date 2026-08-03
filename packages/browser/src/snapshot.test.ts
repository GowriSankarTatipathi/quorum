import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPRESS_OPTIONS,
  compressAxTree,
  contentHash,
  type RawAxNode,
} from './snapshot.js';

const node = (over: Partial<RawAxNode> = {}): RawAxNode => ({ role: 'generic', ...over });

const pricingPage = (): RawAxNode =>
  node({
    role: 'RootWebArea',
    name: 'Pricing',
    children: [
      node({
        children: [
          node({
            children: [node({ role: 'link', name: 'Pricing', href: '/pricing' })],
          }),
        ],
      }),
      node({
        role: 'radiogroup',
        name: 'Billing period',
        children: [
          node({ role: 'radio', name: 'Monthly', pressed: false, focusable: true }),
          node({ role: 'radio', name: 'Annual −20%', pressed: true, focusable: true }),
        ],
      }),
      node({
        role: 'region',
        name: 'Pricing tiers',
        children: [
          node({ role: 'heading', name: 'Premium', level: 2 }),
          node({ role: 'text', name: '$12 /user/month' }),
          node({ role: 'button', name: 'Get started', isSubmit: false }),
        ],
      }),
    ],
  });

describe('compressAxTree', () => {
  it('mints sequential refs and resolves them to descriptors', () => {
    const snapshot = compressAxTree(pricingPage());
    expect(snapshot.elements.size).toBeGreaterThan(0);
    const refs = [...snapshot.elements.keys()];
    expect(refs).toEqual(refs.map((_, i) => i + 1));
  });

  it('renders refs the model can cite, and never a CSS selector', () => {
    const { tree } = compressAxTree(pricingPage());
    expect(tree).toMatch(/\[\d+\] link "Pricing"/);
    expect(tree).not.toMatch(/div|querySelector|\.class/);
  });

  it('preserves toggle state — the fact the whole pricing demo turns on', () => {
    const { tree } = compressAxTree(pricingPage());
    expect(tree).toContain('radio "Annual −20%" pressed=true');
    expect(tree).toContain('radio "Monthly" pressed=false');
  });

  it('drops structural noise that carries no information', () => {
    const { tree } = compressAxTree(pricingPage());
    expect(tree).not.toContain('generic');
    expect(tree).not.toContain('RootWebArea');
  });

  it('keeps interactive nodes even when they have no accessible name', () => {
    const snapshot = compressAxTree(node({ children: [node({ role: 'button', name: '' })] }));
    expect(snapshot.elements.size).toBe(1);
    expect(snapshot.elements.get(1)?.role).toBe('button');
  });

  it('carries the attributes the Trust Ladder classifies on', () => {
    const snapshot = compressAxTree(
      node({
        children: [
          node({ role: 'textbox', name: 'Password', inputType: 'password', focusable: true }),
          node({ role: 'button', name: 'Sign in', isSubmit: true }),
        ],
      }),
    );
    expect(snapshot.elements.get(1)?.inputType).toBe('password');
    expect(snapshot.elements.get(2)?.isSubmit).toBe(true);
  });

  it('truncates long text with an explicit marker rather than silently cutting', () => {
    const long = 'x'.repeat(500);
    const { tree } = compressAxTree(node({ children: [node({ role: 'text', name: long })] }), {
      ...DEFAULT_COMPRESS_OPTIONS,
      maxTextLength: 50,
    });
    expect(tree).toContain('…[+450]');
  });

  it('normalises whitespace so the same page hashes identically across renders', () => {
    const a = compressAxTree(node({ children: [node({ role: 'text', name: 'a   b\n\nc' })] }));
    const b = compressAxTree(node({ children: [node({ role: 'text', name: 'a b c' })] }));
    expect(contentHash(a.tree)).toBe(contentHash(b.tree));
  });

  it('drops nodes far below the fold but keeps focusable ones', () => {
    const snapshot = compressAxTree(
      node({
        children: [
          node({
            role: 'text',
            name: 'far below',
            box: { x: 0, y: 50_000, width: 10, height: 10 },
          }),
          node({
            role: 'button',
            name: 'also far below',
            focusable: true,
            box: { x: 0, y: 50_000, width: 10, height: 10 },
          }),
        ],
      }),
    );
    const names = [...snapshot.elements.values()].map((e) => e.name);
    expect(names).not.toContain('far below');
    expect(names).toContain('also far below');
  });

  it('records bounding boxes so the UI can highlight the target before the click', () => {
    const snapshot = compressAxTree(
      node({
        children: [
          node({ role: 'button', name: 'Next', box: { x: 4, y: 8, width: 60, height: 20 } }),
        ],
      }),
    );
    expect(snapshot.boxes.get(1)).toEqual({ x: 4, y: 8, width: 60, height: 20 });
  });

  it('stops at the size ceiling and says so instead of blowing the context window', () => {
    const many = Array.from({ length: 5_000 }, (_, i) =>
      node({ role: 'button', name: `Button number ${String(i)}` }),
    );
    const snapshot = compressAxTree(node({ children: many }), {
      ...DEFAULT_COMPRESS_OPTIONS,
      maxChars: 2_000,
    });
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.tree).toContain('tree truncated');
    expect(snapshot.tree.length).toBeLessThan(2_600);
  });

  it('produces a tree small enough to be affordable — the entire point of compression', () => {
    const snapshot = compressAxTree(pricingPage());
    // Raw HTML for a page like this is 50k–200k tokens; this must stay in the low
    // thousands of characters.
    expect(snapshot.tree.length).toBeLessThan(1_000);
  });
});

describe('contentHash', () => {
  it('is stable and differs for different trees', () => {
    expect(contentHash('a')).toBe(contentHash('a'));
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });

  it('detects that a click changed nothing, which is how loops are caught', () => {
    const before = compressAxTree(pricingPage());
    const after = compressAxTree(pricingPage());
    expect(contentHash(before.tree)).toBe(contentHash(after.tree));
  });

  it('changes when a toggle flips', () => {
    const monthly = compressAxTree(
      node({ children: [node({ role: 'radio', name: 'Monthly', pressed: true })] }),
    );
    const annual = compressAxTree(
      node({ children: [node({ role: 'radio', name: 'Monthly', pressed: false })] }),
    );
    expect(contentHash(monthly.tree)).not.toBe(contentHash(annual.tree));
  });
});
