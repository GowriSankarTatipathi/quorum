import type { CDPSession, Page } from 'playwright-core';
import type { RawAxNode } from '../snapshot.js';
import type { DOMRectLike } from './page-script.js';

/**
 * The accessibility tree plus the DOM facts it does not carry, joined by node IDENTITY.
 *
 * An earlier version matched the two by accessible name and was silently wrong: a heading
 * and a link that read "Pricing" share a name, so the heading inherited the link's href,
 * and a `<button role="radio">` inherited `isSubmit`. That last one is not cosmetic — the
 * Trust Ladder gates `isSubmit` at L3, so a billing-period toggle would have demanded a
 * human signature on every run. CDP hands back `backendDOMNodeId` per node, so the join is
 * now exact.
 */
interface CdpAxValue {
  type: string;
  value?: unknown;
}

interface CdpAxProperty {
  name: string;
  value: CdpAxValue;
}

interface CdpAxNode {
  nodeId: string;
  ignored?: boolean;
  role?: CdpAxValue;
  name?: CdpAxValue;
  description?: CdpAxValue;
  value?: CdpAxValue;
  properties?: CdpAxProperty[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

export interface DomFacts {
  inputType?: string;
  isSubmit?: boolean;
  href?: string;
  box?: DOMRectLike;
}

const asString = (value: CdpAxValue | undefined): string | undefined => {
  const raw = value?.value;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return undefined;
};

function readProperties(node: CdpAxNode): Partial<RawAxNode> {
  const out: Partial<RawAxNode> = {};
  for (const property of node.properties ?? []) {
    const raw = property.value.value;
    switch (property.name) {
      case 'focusable':
        out.focusable = raw === true;
        break;
      case 'disabled':
        out.disabled = raw === true;
        break;
      case 'checked':
        out.checked = raw === 'mixed' ? 'mixed' : raw === true || raw === 'true';
        break;
      case 'pressed':
        out.pressed = raw === 'mixed' ? 'mixed' : raw === true || raw === 'true';
        break;
      case 'selected':
        out.selected = raw === true;
        break;
      case 'expanded':
        out.expanded = raw === true;
        break;
      case 'level': {
        const level = Number(raw);
        if (Number.isFinite(level)) out.level = level;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Roles worth spending a DOM round trip on: the ones an agent can act upon. */
const ACTIONABLE = new Set([
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
]);

/**
 * Read the attributes the Trust Ladder needs, straight off the identified element.
 *
 * `isSubmit` is true only for a button that actually sits inside a form. A `<button>` with
 * no type defaults to `type=submit` per the HTML spec, but outside a form it submits
 * nothing — treating it as a commit would gate every toggle and dropdown on the page.
 */
const READ_FACTS = `function () {
  const el = this;
  const rect = el.getBoundingClientRect();
  const type = el.getAttribute('type');
  const tag = el.tagName;
  const inForm = typeof el.closest === 'function' && el.closest('form') !== null;
  return {
    inputType: type === null ? undefined : type.toLowerCase(),
    isSubmit:
      inForm &&
      ((tag === 'BUTTON' && (type === null || type.toLowerCase() === 'submit')) ||
        (tag === 'INPUT' && (type || '').toLowerCase() === 'submit')),
    href: tag === 'A' ? el.getAttribute('href') || undefined : undefined,
    box: {
      x: Math.round(rect.x + window.scrollX),
      y: Math.round(rect.y + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}`;

async function factsFor(cdp: CDPSession, backendNodeId: number): Promise<DomFacts | null> {
  try {
    const resolved = (await cdp.send('DOM.resolveNode', { backendNodeId })) as {
      object?: { objectId?: string };
    };
    const objectId = resolved.object?.objectId;
    if (!objectId) return null;

    const called = (await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: READ_FACTS,
      returnByValue: true,
    })) as { result?: { value?: DomFacts } };

    await cdp.send('Runtime.releaseObject', { objectId }).catch(() => undefined);
    return called.result?.value ?? null;
  } catch {
    // A node can be detached between the tree snapshot and the resolve; the a11y facts we
    // already have are still usable, so the element is kept without DOM extras.
    return null;
  }
}

export async function getAccessibilityTree(page: Page): Promise<RawAxNode | null> {
  let cdp: CDPSession | null = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: CdpAxNode[] };
    if (nodes.length === 0) return null;

    const byId = new Map(nodes.map((node) => [node.nodeId, node]));

    // Resolve DOM facts only for actionable nodes — typically 10–40 on a page rather than
    // the several hundred an accessibility tree contains.
    const actionable = nodes.filter(
      (node) =>
        node.ignored !== true &&
        node.backendDOMNodeId !== undefined &&
        ACTIONABLE.has(asString(node.role) ?? ''),
    );
    const resolvedFacts = await Promise.all(
      actionable.map(
        async (node) => [node.nodeId, await factsFor(cdp!, node.backendDOMNodeId!)] as const,
      ),
    );
    const factsByNodeId = new Map(
      resolvedFacts.filter((entry): entry is [string, DomFacts] => entry[1] !== null),
    );

    const build = (id: string): RawAxNode[] => {
      const node = byId.get(id);
      if (!node) return [];

      const children = (node.childIds ?? []).flatMap(build);
      if (node.ignored === true) return children;

      const facts = factsByNodeId.get(node.nodeId);
      return [
        {
          role: asString(node.role) ?? 'generic',
          name: asString(node.name) ?? '',
          ...(asString(node.value) === undefined ? {} : { value: asString(node.value) }),
          ...(asString(node.description) === undefined
            ? {}
            : { description: asString(node.description) }),
          ...readProperties(node),
          ...(facts?.inputType === undefined ? {} : { inputType: facts.inputType }),
          ...(facts?.isSubmit === undefined ? {} : { isSubmit: facts.isSubmit }),
          ...(facts?.href === undefined ? {} : { href: facts.href }),
          ...(facts?.box === undefined ? {} : { box: facts.box }),
          children,
        },
      ];
    };

    const roots = build(nodes[0]!.nodeId);
    return roots[0] ?? null;
  } finally {
    await cdp?.detach().catch(() => undefined);
  }
}
