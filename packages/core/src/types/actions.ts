/**
 * The closed vocabulary of browser actions. It is an enum, not free-form code, so
 * that the worst outcome of a successful prompt injection is a WRONG action from a
 * known, gated set — never an ARBITRARY one.
 */
export type BrowserActionType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'select'
  | 'scroll'
  | 'wait_for'
  | 'press'
  | 'screenshot'
  | 'extract_ready'
  | 'give_up';

/**
 * Everything the Trust Ladder needs to know about the element an action targets.
 * Minted by our own snapshot code from the accessibility tree — never by the model.
 */
export interface ElementDescriptor {
  /** Numeric ref from the page snapshot. Resolved server-side against a real handle. */
  ref: number;
  /** ARIA role, e.g. 'button' | 'link' | 'textbox' | 'checkbox' | 'combobox'. */
  role: string;
  /** Accessible name, e.g. 'Submit application'. */
  name: string;
  /** For form controls: the underlying input type, e.g. 'password' | 'email' | 'file'. */
  inputType?: string;
  /** True when the element submits its owning form. */
  isSubmit?: boolean;
  /** Absolute URL for links. */
  href?: string;
}

export interface NavigateAction {
  type: 'navigate';
  url: string;
}
export interface ClickAction {
  type: 'click';
  ref: number;
  target: ElementDescriptor;
}
export interface TypeAction {
  type: 'type';
  ref: number;
  target: ElementDescriptor;
  text: string;
}
export interface SelectAction {
  type: 'select';
  ref: number;
  target: ElementDescriptor;
  value: string;
}
export interface ScrollAction {
  type: 'scroll';
  direction: 'up' | 'down';
  pixels: number;
}
export interface WaitForAction {
  type: 'wait_for';
  ref?: number;
  milliseconds?: number;
}
export interface PressAction {
  type: 'press';
  key: string;
  /** Present when a form control has focus — an Enter press then submits it. */
  focused?: ElementDescriptor;
}
export interface ScreenshotAction {
  type: 'screenshot';
}
export interface ExtractReadyAction {
  type: 'extract_ready';
  note?: string;
}
export interface GiveUpAction {
  type: 'give_up';
  reason: string;
}

export type BrowserAction =
  | NavigateAction
  | ClickAction
  | TypeAction
  | SelectAction
  | ScrollAction
  | WaitForAction
  | PressAction
  | ScreenshotAction
  | ExtractReadyAction
  | GiveUpAction;

/** Per-action-type timeouts. One global timeout is either too short for navigation
 *  or leaves the user watching a spinner after a failed click. */
export const ACTION_TIMEOUTS_MS: Record<BrowserActionType, number> = {
  navigate: 20_000,
  click: 5_000,
  type: 5_000,
  select: 5_000,
  scroll: 3_000,
  wait_for: 15_000,
  press: 5_000,
  screenshot: 10_000,
  extract_ready: 1_000,
  give_up: 1_000,
};
