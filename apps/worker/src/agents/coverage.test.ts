import { describe, expect, it } from 'vitest';
import { findCoverageGaps } from './coverage.js';

describe('approved schema coverage', () => {
  const schema = { price: 'number|null', features: 'string[]' };
  it('identifies every missing feature list across the four pricing plans', () => {
    const claims = ['Starter', 'Collect', 'Control', 'Enterprise'].map((entity, index) => ({
      entity,
      field: 'price',
      value: index === 3 ? null : [0, 8, 18][index],
      nullReason: index === 3 ? 'custom pricing' : null,
    }));
    expect(findCoverageGaps(schema, claims)).toEqual(
      claims.map(({ entity }) => ({ entity, field: 'features' })),
    );
  });
  it('does not count custom pricing as an invented zero or an omitted field', () => {
    expect(
      findCoverageGaps(schema, [
        { entity: 'Enterprise', field: 'price', value: null, nullReason: 'Contact sales' },
        { entity: 'Enterprise', field: 'features', value: ['Dedicated support'] },
      ]),
    ).toEqual([]);
  });
  it('reports empty lists, blank strings, and unexplained nulls as gaps', () => {
    for (const value of [[], '', null])
      expect(
        findCoverageGaps({ features: 'string[]' }, [
          { entity: 'Starter', field: 'features', value },
        ]),
      ).toEqual([{ entity: 'Starter', field: 'features' }]);
  });
  it('does not silently pass a zero-claim extraction', () => {
    expect(findCoverageGaps(schema, [])).toEqual([
      { entity: null, field: 'price' },
      { entity: null, field: 'features' },
    ]);
  });
  it('keeps quarantined entities in the completeness check', () => {
    expect(findCoverageGaps({ features: 'string[]' }, [], ['Starter'])).toEqual([
      { entity: 'Starter', field: 'features' },
    ]);
  });
  it('does not invent requirements for a navigation-only step', () => {
    expect(findCoverageGaps(null, [])).toEqual([]);
  });
});
