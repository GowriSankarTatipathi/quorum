/** Checks only fields explicitly declared by the approved plan; never guesses entities. */
export interface CoverageClaim {
  entity: string;
  field: string;
  value: unknown;
  nullReason?: string | null;
}
export interface CoverageGap {
  entity: string | null;
  field: string;
}

export function findCoverageGaps(
  schema: Record<string, unknown> | null,
  claims: readonly CoverageClaim[],
  attemptedEntities: readonly string[] = [],
): CoverageGap[] {
  const fields = Object.keys(schema ?? {});
  if (!fields.length) return [];
  const relevant = claims.filter((claim) => fields.includes(claim.field));
  const entities = new Set([...relevant.map((claim) => claim.entity), ...attemptedEntities]);
  if (!entities.size) return fields.map((field) => ({ entity: null, field }));
  const gaps: CoverageGap[] = [];
  for (const entity of entities) {
    for (const field of fields) {
      const present = relevant.some(
        (claim) =>
          claim.entity === entity &&
          claim.field === field &&
          (claim.value === null
            ? Boolean(claim.nullReason?.trim())
            : Array.isArray(claim.value)
              ? claim.value.length > 0
              : typeof claim.value === 'string'
                ? claim.value.trim().length > 0
                : true),
      );
      if (!present) gaps.push({ entity, field });
    }
  }
  return gaps;
}

export function describeCoverageGaps(gaps: readonly CoverageGap[]): string {
  return gaps
    .map(
      ({ entity, field }) => `${entity ?? 'No extracted entity'} — ${field.replaceAll('_', ' ')}`,
    )
    .join('; ');
}
