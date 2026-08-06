import {
  BROWSER_PROMPT_VERSION,
  buildBrowserPrompt,
  type BrowserAgentInput,
} from './browser.v2.js';
import {
  CRITIC_PROMPT_VERSION,
  buildCriticPrompt,
  type CriticAgentInput,
  type CriticClaimView,
} from './critic.v4.js';
import { PLANNER_PROMPT_VERSION, buildPlannerPrompt, type PlannerInput } from './planner.v5.js';
import {
  REASONING_PROMPT_VERSION,
  buildReasoningPrompt,
  type ReasoningAgentInput,
} from './reasoning.v5.js';
import {
  RECOVERY_PROMPT_VERSION,
  buildRecoveryPrompt,
  type RecoveryAgentInput,
  type RecoveryAttemptView,
} from './recovery.v2.js';
import {
  VERIFICATION_PROMPT_VERSION,
  buildVerificationPrompt,
  type VerificationAgentInput,
} from './verification.v2.js';

export interface BuiltPrompt {
  system: string;
  user: string;
}

interface PromptEntry<TInput> {
  version: string;
  build: (input: TInput) => BuiltPrompt;
}

/**
 * Version pinning per agent.
 *
 * Prompts are the highest-variance component of the system, so changing one is a
 * deploy-worthy event that must be attributable. Every `LlmCall` row stores the version
 * that produced it, which turns "verified extraction rate fell after Tuesday" into a
 * single GROUP BY — and lets a new version be canaried and compared on quality before it
 * becomes the default.
 */
export interface PromptRegistry {
  planner: PromptEntry<PlannerInput>;
  browser: PromptEntry<BrowserAgentInput>;
  reasoning: PromptEntry<ReasoningAgentInput>;
  verification: PromptEntry<VerificationAgentInput>;
  critic: PromptEntry<CriticAgentInput>;
  recovery: PromptEntry<RecoveryAgentInput>;
}

export const PROMPT_REGISTRY: PromptRegistry = {
  planner: { version: PLANNER_PROMPT_VERSION, build: buildPlannerPrompt },
  browser: { version: BROWSER_PROMPT_VERSION, build: buildBrowserPrompt },
  reasoning: { version: REASONING_PROMPT_VERSION, build: buildReasoningPrompt },
  verification: { version: VERIFICATION_PROMPT_VERSION, build: buildVerificationPrompt },
  critic: { version: CRITIC_PROMPT_VERSION, build: buildCriticPrompt },
  recovery: { version: RECOVERY_PROMPT_VERSION, build: buildRecoveryPrompt },
};

export {
  PLANNER_PROMPT_VERSION,
  BROWSER_PROMPT_VERSION,
  REASONING_PROMPT_VERSION,
  VERIFICATION_PROMPT_VERSION,
  CRITIC_PROMPT_VERSION,
  RECOVERY_PROMPT_VERSION,
  buildPlannerPrompt,
  buildBrowserPrompt,
  buildReasoningPrompt,
  buildVerificationPrompt,
  buildCriticPrompt,
  buildRecoveryPrompt,
};
export type {
  PlannerInput,
  BrowserAgentInput,
  ReasoningAgentInput,
  VerificationAgentInput,
  CriticAgentInput,
  CriticClaimView,
  RecoveryAgentInput,
  RecoveryAttemptView,
};
