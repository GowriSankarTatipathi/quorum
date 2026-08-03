/**
 * Code that runs INSIDE the page, not in Node.
 *
 * Playwright serialises this function, ships it to the browser and invokes it there, so it
 * may not reference anything from the enclosing module. It also cannot use the DOM lib:
 * pulling `lib.dom` into this package would let server code reach for `document` and only
 * fail at runtime. Instead the exact browser surface used is declared below — which
 * doubles as documentation of everything this script touches.
 */
export interface DOMRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DomFactEntry {
  name: string;
  inputType?: string;
  isSubmit?: boolean;
  href?: string;
  box: DOMRectLike;
}

interface PageElement {
  id: string;
  tagName: string;
  textContent: string | null;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => DOMRectLike;
}

interface PageDocument {
  querySelectorAll: (selector: string) => ArrayLike<PageElement>;
  querySelector: (selector: string) => PageElement | null;
}

interface PageWindow {
  scrollX: number;
  scrollY: number;
}

declare const document: PageDocument;
declare const window: PageWindow;
declare const CSS: { escape: (value: string) => string };

/**
 * Attributes the accessibility tree does not carry but the Trust Ladder classifies on.
 *
 * `inputType` and `isSubmit` are not ARIA concepts — an `<input type="password">` and an
 * `<input type="text">` have the same role — so without this pass the gate could not tell
 * a search box from a credential field.
 */
export function readDomFacts(): DomFactEntry[] {
  const out: DomFactEntry[] = [];
  const nodes = document.querySelectorAll('a,button,input,select,textarea,[role],[onclick]');

  for (let i = 0; i < nodes.length; i += 1) {
    const element = nodes[i]!;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const labelFor =
      element.id.length > 0
        ? (document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent ?? null)
        : null;

    const label =
      element.getAttribute('aria-label') ??
      labelFor ??
      element.getAttribute('placeholder') ??
      element.getAttribute('title') ??
      element.textContent ??
      '';

    const type = element.getAttribute('type');
    const tag = element.tagName;
    const href = tag === 'A' ? element.getAttribute('href') : null;

    out.push({
      name: label.replace(/\s+/g, ' ').trim().slice(0, 200),
      ...(type === null ? {} : { inputType: type.toLowerCase() }),
      isSubmit:
        (tag === 'BUTTON' && (type === null || type.toLowerCase() === 'submit')) ||
        (tag === 'INPUT' && (type ?? '').toLowerCase() === 'submit'),
      ...(href === null ? {} : { href }),
      box: {
        x: Math.round(rect.x + window.scrollX),
        y: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  }

  return out;
}
