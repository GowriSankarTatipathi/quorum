import type { ElementDescriptor } from '@quorum/core';
import type { BoundingBox } from './driver.js';

/**
 * A node as it comes out of the accessibility tree, before compression.
 * Deliberately structural: the same shape can be produced by Playwright, by a fixture,
 * or by a future driver, so compression is testable without a browser.
 */
export interface RawAxNode {
  role: string;
  name?: string;
  value?: string;
  description?: string;
  focusable?: boolean;
  disabled?: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  selected?: boolean;
  expanded?: boolean;
  level?: number;
  /** DOM-derived attributes the a11y tree does not carry but the Trust Ladder needs. */
  inputType?: string;
  isSubmit?: boolean;
  href?: string;
  box?: BoundingBox;
  children?: RawAxNode[];
}

export interface CompressOptions {
  /** Rough ceiling on the rendered tree, measured in characters (~4 chars per token). */
  maxChars: number;
  /** Text longer than this is truncated with an explicit marker. */
  maxTextLength: number;
  /** Viewport height, used to drop far-offscreen nodes. */
  viewportHeight: number;
  scrollY: number;
  /** Nodes beyond this many screens below the fold are dropped unless focusable. */
  offscreenScreens: number;
}

export const DEFAULT_COMPRESS_OPTIONS: CompressOptions = {
  maxChars: 16_000,
  maxTextLength: 200,
  viewportHeight: 800,
  scrollY: 0,
  offscreenScreens: 2,
};

export interface CompressedSnapshot {
  tree: string;
  elements: Map<number, ElementDescriptor>;
  boxes: Map<number, BoundingBox>;
  nodeCount: number;
  /** True when the tree hit the character ceiling and was cut short. */
  truncated: boolean;
}

/**
 * Roles that carry no information a model can act on. Dropping them is where most of
 * the 30× reduction against raw HTML comes from — a modern SaaS page is mostly
 * scaffolding.
 */
const NOISE_ROLES = new Set([
  'generic',
  'none',
  'presentation',
  'InlineTextBox',
  'LineBreak',
  'paragraph',
  'RootWebArea',
  'Section',
  'Abbr',
  'emphasis',
  'strong',
  'superscript',
  'subscript',
  'time',
]);

/** Roles that are always kept, because the agent may need to act on them. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'treeitem',
  'dialog',
  'alertdialog',
]);

const isInteractive = (node: RawAxNode): boolean =>
  INTERACTIVE_ROLES.has(node.role) || node.focusable === true;

const hasContent = (node: RawAxNode): boolean =>
  (node.name?.trim().length ?? 0) > 0 || (node.value?.trim().length ?? 0) > 0;

const TEXT_ROLES = new Set(['StaticText', 'text']);

/**
 * A StaticText child usually repeats its parent's accessible name — a heading and the text
 * inside it are one fact, and emitting both doubles the tree while offering the model two
 * refs for one thing, only one of which is clickable.
 *
 * But it is only a duplicate when the strings actually match. A price sitting in a
 * paragraph has no parent heading to carry it, and dropping those removed exactly the data
 * the run exists to extract.
 */
const duplicatesParent = (node: RawAxNode, parent: RawAxNode | null): boolean => {
  if (!TEXT_ROLES.has(node.role) || !parent) return false;
  const text = (node.name ?? '').trim();
  return text.length > 0 && text === (parent.name ?? '').trim();
};

/** Keep a node only if it is actionable or says something not already said. */
const isInteresting = (node: RawAxNode, parent: RawAxNode | null): boolean =>
  isInteractive(node) ||
  (!NOISE_ROLES.has(node.role) && hasContent(node) && !duplicatesParent(node, parent));

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…[+${String(clean.length - max)}]`;
}

/**
 * Drop nodes far below the fold, unless they are focusable.
 *
 * Long marketing pages carry thousands of nodes the agent will never reach in this step,
 * and paying for them crowds out the content that matters. Focusable nodes are always
 * kept because keyboard navigation can reach them without scrolling.
 */
function isVisible(node: RawAxNode, options: CompressOptions): boolean {
  if (!node.box) return true;
  if (node.focusable === true) return true;
  const limit = options.scrollY + options.viewportHeight * (options.offscreenScreens + 1);
  const above = options.scrollY - options.viewportHeight * options.offscreenScreens;
  return node.box.y <= limit && node.box.y + node.box.height >= above;
}

/**
 * Collapse chains of single-child wrappers.
 *
 * `div > div > div > span` is four lines of indentation carrying one fact. Flattening it
 * preserves the fact and removes the depth, which matters because deeply-nested trees
 * measurably degrade a model's ability to locate anything.
 */
function collapse(node: RawAxNode): RawAxNode {
  let current = node;
  while (
    current.children?.length === 1 &&
    !isInteractive(current) &&
    !hasContent(current) &&
    NOISE_ROLES.has(current.role)
  ) {
    current = current.children[0]!;
  }
  return { ...current, children: (current.children ?? []).map(collapse) };
}

function describeState(node: RawAxNode): string {
  const parts: string[] = [];
  if (node.checked === true) parts.push('checked=true');
  else if (node.checked === 'mixed') parts.push('checked=mixed');
  // Toggle state is the single most load-bearing attribute on a pricing page: it is how
  // the agent can tell whether it is reading monthly or annual figures.
  if (node.pressed === true) parts.push('pressed=true');
  else if (node.pressed === false) parts.push('pressed=false');
  if (node.selected === true) parts.push('selected=true');
  if (node.expanded !== undefined) parts.push(`expanded=${String(node.expanded)}`);
  if (node.disabled === true) parts.push('disabled=true');
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/**
 * Compress an accessibility tree into the model's primary input.
 *
 * The output uses numeric refs rather than CSS selectors. Models hallucinate selectors
 * constantly, and a hallucinated selector that *happens* to match something is the worst
 * possible outcome: a confident wrong click. Refs are minted here and resolved through
 * our own map, so an invalid ref is a caught, typed error and a valid one is guaranteed
 * to be the element the model actually saw.
 */
export function compressAxTree(
  root: RawAxNode,
  options: CompressOptions = DEFAULT_COMPRESS_OPTIONS,
): CompressedSnapshot {
  const elements = new Map<number, ElementDescriptor>();
  const boxes = new Map<number, BoundingBox>();
  const lines: string[] = [];
  let nextRef = 1;
  let chars = 0;
  let truncated = false;
  let nodeCount = 0;

  const walk = (node: RawAxNode, depth: number, parent: RawAxNode | null): void => {
    if (truncated) return;
    if (!isVisible(node, options)) return;

    let childDepth = depth;

    if (isInteresting(node, parent)) {
      nodeCount += 1;
      const ref = nextRef;
      nextRef += 1;

      const name = truncate(node.name ?? '', options.maxTextLength);
      const value = node.value ? truncate(node.value, options.maxTextLength) : '';

      const descriptor: ElementDescriptor = {
        ref,
        role: node.role,
        name,
        ...(node.inputType === undefined ? {} : { inputType: node.inputType }),
        ...(node.isSubmit === undefined ? {} : { isSubmit: node.isSubmit }),
        ...(node.href === undefined ? {} : { href: node.href }),
      };
      elements.set(ref, descriptor);
      if (node.box) boxes.set(ref, node.box);

      const indent = '  '.repeat(Math.min(depth, 8));
      const parts = [`${indent}[${String(ref)}] ${node.role}`];
      if (name.length > 0) parts.push(` "${name}"`);
      if (value.length > 0) parts.push(` value="${value}"`);
      if (node.href) parts.push(` ${node.href}`);
      parts.push(describeState(node));

      const line = parts.join('');
      if (chars + line.length > options.maxChars) {
        truncated = true;
        lines.push(`${indent}… tree truncated at the size limit; scroll or narrow the step`);
        return;
      }
      chars += line.length + 1;
      lines.push(line);
      childDepth = depth + 1;
    }

    for (const child of node.children ?? []) walk(child, childDepth, node);
  };

  walk(collapse(root), 0, null);

  return { tree: lines.join('\n'), elements, boxes, nodeCount, truncated };
}

/**
 * Hash of the rendered tree. Comparing it before and after an action is what turns "the
 * agent clicked and nothing happened, so it clicked again" — the most common way a
 * browser agent burns a run — into a typed, recoverable failure.
 */
export function contentHash(tree: string): string {
  // FNV-1a: no crypto dependency, fast, and collision resistance is not a security
  // property here — this only ever compares two snapshots of the same page.
  let hash = 0x811c9dc5;
  for (let i = 0; i < tree.length; i += 1) {
    hash ^= tree.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
