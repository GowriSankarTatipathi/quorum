import { describe, expect, it } from 'vitest';
import { reduceEvent, useRunStore, type StreamEvent } from './run-store.js';

let seq = 0;
const event = (type: string, payload: unknown, over: Partial<StreamEvent> = {}): StreamEvent => {
  seq += 1;
  return {
    id: `evt_${String(seq)}`,
    seq,
    type,
    agent: null,
    stepId: null,
    payload,
    causationId: null,
    correlationId: null,
    ts: new Date(1_700_000_000_000 + seq * 100).toISOString(),
    ...over,
  };
};

const fresh = () => {
  useRunStore.getState().reset('run_1');
  return useRunStore;
};

describe('idempotency', () => {
  it('ignores an event it has already applied', () => {
    // Reconnection replays from a cursor and overlaps by design; dedup lives here so the
    // client needs no dedup logic of its own.
    const store = fresh();
    const created = event('claim.created', {
      claimId: 'c1',
      entity: 'Ramp',
      field: 'price',
      value: 15,
      unit: 'USD',
      confidence: 0.96,
      sourceUrl: 'https://ramp.com/pricing',
    });
    store.getState().applyEvent(created);
    store.getState().applyEvent(created);
    expect(store.getState().claims.size).toBe(1);
    expect(store.getState().events).toHaveLength(1);
  });

  it('tracks the highest sequence number for the reconnect cursor', () => {
    const store = fresh();
    store.getState().applyBatch([event('run.created', {}), event('run.created', {})]);
    expect(store.getState().lastSeq).toBe(seq);
  });
});

describe('status projection', () => {
  it('follows run.status.changed', () => {
    const store = fresh();
    store.getState().applyEvent(event('run.status.changed', { from: 'CREATED', to: 'PLANNING' }));
    expect(store.getState().status).toBe('PLANNING');
    store
      .getState()
      .applyEvent(event('run.status.changed', { from: 'PLANNING', to: 'AWAITING_APPROVAL' }));
    expect(store.getState().status).toBe('AWAITING_APPROVAL');
  });

  it('preserves planHash when run.status.changed to AWAITING_APPROVAL is applied after plan.completed', () => {
    const store = fresh();
    store.getState().applyEvent(event('plan.completed', { stepCount: 2, totalEstimatedUsd: 0.1, planHash: 'hash_xyz' }));
    expect(store.getState().planHash).toBe('hash_xyz');
    
    store.getState().applyEvent(event('run.status.changed', { from: 'PLANNING', to: 'AWAITING_APPROVAL' }));
    expect(store.getState().status).toBe('AWAITING_APPROVAL');
    expect(store.getState().planHash).toBe('hash_xyz');
  });

  it('marks terminal states', () => {
    const store = fresh();
    store.getState().applyEvent(event('run.completed', { claimCount: 3 }));
    expect(store.getState().status).toBe('COMPLETED');
  });

  it('clears in-progress agent lanes when a run reaches a terminal state', () => {
    const store = fresh();
    store.getState().applyEvent(event('agent.started', { agent: 'verification', stepIndex: null }, { correlationId: 'v1' }));
    store.getState().applyEvent(event('agent.started', { agent: 'browser', stepIndex: 0 }, { correlationId: 'b1' }));
    store.getState().applyEvent(event('agent.finished', { agent: 'browser', durationMs: 100, confidence: 1 }, { correlationId: 'b1' }));
    
    expect(store.getState().agents.verification).toBe('running');
    expect(store.getState().agents.browser).toBe('done');

    store.getState().applyEvent(event('run.status.changed', { from: 'VERIFYING', to: 'FAILED' }));
    
    expect(store.getState().agents.verification).toBe('failed');
    expect(store.getState().agents.browser).toBe('done');
    
    // Ensure no lane is 'running'
    for (const val of Object.values(store.getState().agents)) {
      expect(val).not.toBe('running');
    }
  });
});

describe('plan steps', () => {
  it('accumulates steps as the planner streams them', () => {
    const store = fresh();
    for (let i = 0; i < 3; i += 1) {
      store.getState().applyEvent(
        event('plan.step.proposed', {
          index: i,
          objective: `Step ${String(i)}`,
          targetUrl: null,
          riskLevel: 'LOW',
          notes: null,
          agentPath: ['browser'],
          estimatedMs: 1_000,
          estimatedUsd: 0.05,
        }),
      );
    }
    expect(store.getState().steps.size).toBe(3);
    expect(store.getState().steps.get(1)?.objective).toBe('Step 1');
  });
});

describe('agent turns', () => {
  const correlationId = 'corr_1';

  it('opens a turn on agent.started and closes it on agent.finished', () => {
    const store = fresh();
    store
      .getState()
      .applyEvent(event('agent.started', { agent: 'browser', stepIndex: 0 }, { correlationId }));
    expect(store.getState().agents.browser).toBe('running');
    expect(store.getState().turns).toHaveLength(1);

    store
      .getState()
      .applyEvent(
        event(
          'agent.finished',
          { agent: 'browser', durationMs: 210, confidence: 0.9 },
          { correlationId },
        ),
      );
    expect(store.getState().agents.browser).toBe('done');
    expect(store.getState().turns[0]?.durationMs).toBe(210);
    expect(store.getState().turns[0]?.confidence).toBe(0.9);
  });

  it('accumulates streamed reasoning into the right turn', () => {
    const store = fresh();
    store
      .getState()
      .applyEvent(event('agent.started', { agent: 'browser', stepIndex: 0 }, { correlationId }));
    store.getState().applyEvent(event('llm.token', { text: 'Three ' }, { correlationId }));
    store.getState().applyEvent(event('llm.token', { text: 'tiers.' }, { correlationId }));
    expect(store.getState().turns[0]?.reasoning).toBe('Three tiers.');
  });

  it('routes tokens to the correct turn when two agents overlap', () => {
    const store = fresh();
    store
      .getState()
      .applyEvent(
        event('agent.started', { agent: 'browser', stepIndex: 0 }, { correlationId: 'a' }),
      );
    store
      .getState()
      .applyEvent(
        event('agent.started', { agent: 'critic', stepIndex: null }, { correlationId: 'b' }),
      );
    store
      .getState()
      .applyEvent(event('llm.token', { text: 'browser text' }, { correlationId: 'a' }));
    store
      .getState()
      .applyEvent(event('llm.token', { text: 'critic text' }, { correlationId: 'b' }));

    const turns = store.getState().turns;
    expect(turns.find((t) => t.correlationId === 'a')?.reasoning).toBe('browser text');
    expect(turns.find((t) => t.correlationId === 'b')?.reasoning).toBe('critic text');
  });

  it('records actions and marks the last one complete', () => {
    const store = fresh();
    store
      .getState()
      .applyEvent(event('agent.started', { agent: 'browser', stepIndex: 0 }, { correlationId }));
    store
      .getState()
      .applyEvent(
        event(
          'browser.action.start',
          { action: { type: 'click' }, trustLevel: 2, highlight: null },
          { correlationId },
        ),
      );
    store
      .getState()
      .applyEvent(
        event(
          'browser.action.ok',
          { action: { type: 'click' }, durationMs: 312, changed: true },
          { correlationId },
        ),
      );

    const actions = store.getState().turns[0]?.actions ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'click', ok: true, durationMs: 312 });
  });
});

describe('cost accumulation', () => {
  it('sums spend and tokens across calls', () => {
    const store = fresh();
    for (const usd of [0.135, 0.093]) {
      store.getState().applyEvent(
        event('llm.response', {
          agent: 'planner',
          model: 'claude-opus-4',
          latencyMs: 100,
          cost: { usd, inputTokens: 1_000, outputTokens: 200 },
          cached: false,
        }),
      );
    }
    expect(store.getState().spentUsd).toBeCloseTo(0.228, 6);
    expect(store.getState().inputTokens).toBe(2_000);
    expect(store.getState().outputTokens).toBe(400);
  });
});

describe('browser state', () => {
  it('shows the highlight before the action and clears it after', () => {
    // The affordance that lets a user predict intent and pause before a bad click.
    const store = fresh();
    const box = { x: 10, y: 20, width: 100, height: 40 };
    store
      .getState()
      .applyEvent(
        event('browser.action.start', { action: { type: 'click' }, trustLevel: 1, highlight: box }),
      );
    expect(store.getState().highlight).toEqual(box);
    store
      .getState()
      .applyEvent(
        event('browser.action.ok', { action: { type: 'click' }, durationMs: 5, changed: true }),
      );
    expect(store.getState().highlight).toBeNull();
  });

  it('clears the highlight when a navigation changes the page', () => {
    const store = fresh();
    store.getState().applyEvent(
      event('browser.action.start', {
        action: { type: 'click' },
        trustLevel: 1,
        highlight: { x: 0, y: 0, width: 1, height: 1 },
      }),
    );
    store
      .getState()
      .applyEvent(event('browser.navigate', { url: 'https://brex.com/pricing', title: 'Pricing' }));
    expect(store.getState().highlight).toBeNull();
    expect(store.getState().pageUrl).toBe('https://brex.com/pricing');
  });
});

describe('browser viewport state', () => {
  it('transitions through session states based on events', () => {
    const store = fresh();
    expect(store.getState().browserSessionState).toBe('not_started');

    store.getState().applyEvent(event('browser.session.opened', { liveViewUrl: 'http://localhost' }));
    expect(store.getState().browserSessionState).toBe('open');
    expect(store.getState().liveViewUrl).toBe('http://localhost');

    store.getState().applyEvent(event('browser.screenshot', { url: 'blob:...' }));
    expect(store.getState().frame?.url).toBe('blob:...');

    store.getState().applyEvent(event('browser.session.closed', { durationMs: 4000 }));
    expect(store.getState().browserSessionState).toBe('closed');
  });
});

describe('claims', () => {
  const created = (id: string, confidence = 0.96) =>
    event('claim.created', {
      claimId: id,
      entity: 'Ramp',
      field: 'price',
      value: 15,
      unit: 'USD',
      confidence,
      sourceUrl: 'https://ramp.com/pricing',
    });

  it('fills the table live, so value accrues continuously', () => {
    const store = fresh();
    store.getState().applyBatch([created('c1'), created('c2')]);
    expect(store.getState().claims.size).toBe(2);
    expect(store.getState().claims.get('c1')?.status).toBe('UNVERIFIED');
  });

  it('marks a claim verified', () => {
    const store = fresh();
    store.getState().applyEvent(created('c1'));
    store
      .getState()
      .applyEvent(
        event('claim.verified', { claimId: 'c1', verdict: 'VERIFIED', confidence: 0.98 }),
      );
    expect(store.getState().claims.get('c1')?.status).toBe('VERIFIED');
  });

  it('marks a claim contradicted, which is the outcome worth surfacing', () => {
    const store = fresh();
    store.getState().applyEvent(created('c1'));
    store
      .getState()
      .applyEvent(
        event('claim.contradicted', { claimId: 'c1', claimed: 15, independentReading: 12 }),
      );
    expect(store.getState().claims.get('c1')?.status).toBe('CONTRADICTED');
  });

  it('ignores a verdict for a claim it has never seen', () => {
    const store = fresh();
    store
      .getState()
      .applyEvent(
        event('claim.verified', { claimId: 'unknown', verdict: 'VERIFIED', confidence: 1 }),
      );
    expect(store.getState().claims.size).toBe(0);
  });
});

describe('approvals and critiques', () => {
  it('holds a pending approval until it is decided', () => {
    const store = fresh();
    store.getState().applyEvent(
      event('approval.requested', {
        approvalId: 'ap_1',
        trustLevel: 3,
        reason: 'This submits a form.',
        action: { type: 'click' },
        payload: { email: 'maya@chen-cpa.com' },
        screenshotKey: null,
      }),
    );
    expect(store.getState().pendingApproval?.approvalId).toBe('ap_1');
    store
      .getState()
      .applyEvent(
        event('approval.granted', { approvalId: 'ap_1', by: 'u1', edited: false, scope: 'SINGLE' }),
      );
    expect(store.getState().pendingApproval).toBeNull();
  });

  it('collects critiques in order', () => {
    const store = fresh();
    store.getState().applyEvent(
      event('critique.raised', {
        critiqueId: 'cr_1',
        kind: 'UNIT_MISMATCH',
        severity: 'BLOCKING',
        message: "Expensify's $5 is the annual rate.",
        claimIds: ['c1'],
      }),
    );
    expect(store.getState().critiques[0]?.severity).toBe('BLOCKING');
  });
});

describe('reduceEvent purity', () => {
  it('does not mutate the state it is given, so replay is reproducible', () => {
    const store = fresh();
    const before = store.getState();
    const snapshot = { claims: before.claims, turns: before.turns };
    reduceEvent(before, event('run.status.changed', { from: 'CREATED', to: 'PLANNING' }));
    expect(store.getState().claims).toBe(snapshot.claims);
    expect(store.getState().turns).toBe(snapshot.turns);
    expect(store.getState().status).toBe('CREATED');
  });
});

describe('event buffer', () => {
  it('is bounded so a long run cannot grow memory without limit', () => {
    const store = fresh();
    store
      .getState()
      .applyBatch(Array.from({ length: 2_500 }, () => event('llm.token', { text: 'x' })));
    expect(store.getState().events.length).toBeLessThanOrEqual(2_000);
  });
});

describe('terminal status handling', () => {
  it('clears all running lanes when the run fails', () => {
    const store = fresh();
    
    // Start two agents
    store.getState().applyEvent(event('agent.started', { agent: 'browser', stepIndex: 0 }));
    store.getState().applyEvent(event('agent.started', { agent: 'verification', stepIndex: null }));
    
    // Both should be running
    expect(store.getState().agents['browser']).toBe('running');
    expect(store.getState().agents['verification']).toBe('running');
    
    // Run fails
    store.getState().applyEvent(event('run.status.changed', { from: 'EXECUTING', to: 'FAILED' }));
    
    // Browser is now failed, verification is failed (wait, all running agents become failed on FAILED)
    expect(store.getState().agents['browser']).toBe('failed');
    expect(store.getState().agents['verification']).toBe('failed');
  });

  it('marks running lanes as idle when the run completes', () => {
    const store = fresh();
    store.getState().applyEvent(event('agent.started', { agent: 'browser', stepIndex: 0 }));
    
    store.getState().applyEvent(event('run.status.changed', { from: 'EXECUTING', to: 'COMPLETED' }));
    
    expect(store.getState().agents['browser']).toBe('idle');
  });
});
