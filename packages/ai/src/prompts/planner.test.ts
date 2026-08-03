import { describe, expect, it } from 'vitest';
import { PLANNER_PROMPT_VERSION, buildPlannerPrompt } from './planner.v3.js';
import { PROMPT_REGISTRY } from './registry.js';

const base = {
  goal: 'Get the pricing tiers for Ramp, Brex and Expensify.',
  mode: 'BALANCED' as const,
  budgetUsd: 0.5,
  maxSteps: 20,
  allowedDomains: ['ramp.com', 'brex.com'],
};

describe('buildPlannerPrompt', () => {
  it('carries the goal verbatim inside a delimiter', () => {
    const prompt = buildPlannerPrompt(base);
    expect(prompt.user).toContain(`<goal>${base.goal}</goal>`);
  });

  it('states the workspace policy the planner must respect', () => {
    const prompt = buildPlannerPrompt(base);
    expect(prompt.user).toContain('ramp.com, brex.com');
    expect(prompt.user).toContain('max_budget_usd: 0.50');
    expect(prompt.user).toContain('max_steps: 20');
  });

  it('says "any public https site" rather than leaving the field blank', () => {
    expect(buildPlannerPrompt({ ...base, allowedDomains: [] }).user).toContain(
      'any public https site',
    );
  });

  it('includes recipe corrections only when there are some', () => {
    expect(buildPlannerPrompt(base).user).not.toContain('prior_corrections');
    expect(
      buildPlannerPrompt({ ...base, recipeHints: 'airbase uses .io not .com' }).user,
    ).toContain('<prior_corrections>airbase uses .io not .com</prior_corrections>');
  });

  it('varies the autonomy guidance by mode but never permits batching commits', () => {
    for (const mode of ['CAREFUL', 'BALANCED', 'AUTONOMOUS'] as const) {
      const prompt = buildPlannerPrompt({ ...base, mode });
      // Prompts are hard-wrapped for readability, so the assertion normalises whitespace
      // rather than depending on where a line happens to break.
      const flat = prompt.system.replace(/\s+/g, ' ');
      expect(flat).toContain(`Mode is "${mode}"`);
      expect(flat).toContain(
        'Never batch anything that submits data or changes state, in any mode',
      );
    }
  });

  it('embeds the uncertainty rubric, the domain priors and the schema', () => {
    const { system } = buildPlannerPrompt(base);
    expect(system).toContain('0.95-1.00');
    expect(system).toContain('billed yearly');
    expect(system).toContain('"riskLevel"');
    expect(system).toContain('"refusal"');
  });

  it('instructs the planner to refuse rather than invent steps that will fail', () => {
    expect(buildPlannerPrompt(base).system).toContain('set "refusal"');
  });
});

describe('prompt registry', () => {
  it('pins a version that is recorded on every call for later bisection', () => {
    expect(PROMPT_REGISTRY.planner.version).toBe(PLANNER_PROMPT_VERSION);
    expect(PLANNER_PROMPT_VERSION).toMatch(/^planner\.v\d+$/);
  });

  it('builds through the registry identically to the direct builder', () => {
    expect(PROMPT_REGISTRY.planner.build(base)).toEqual(buildPlannerPrompt(base));
  });
});
