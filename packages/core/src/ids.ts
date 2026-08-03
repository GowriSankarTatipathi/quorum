import { monotonicFactory, ulid } from 'ulid';

/**
 * Branded ID types. A `RunId` is not assignable to a `StepId` even though both are
 * strings, which eliminates a whole class of argument-order bugs in a codebase where
 * nearly every function takes two or three identifiers.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type RunId = Brand<string, 'RunId'>;
export type StepId = Brand<string, 'StepId'>;
export type ClaimId = Brand<string, 'ClaimId'>;
export type EventId = Brand<string, 'EventId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;

export const asRunId = (v: string): RunId => v as RunId;
export const asStepId = (v: string): StepId => v as StepId;
export const asClaimId = (v: string): ClaimId => v as ClaimId;
export const asEventId = (v: string): EventId => v as EventId;
export const asApprovalId = (v: string): ApprovalId => v as ApprovalId;
export const asSessionId = (v: string): SessionId => v as SessionId;
export const asCorrelationId = (v: string): CorrelationId => v as CorrelationId;

/**
 * ULIDs are lexicographically sortable by creation time, so ordering events by id is
 * ordering them chronologically — no separate sort key, and IDs can be minted without a
 * database round trip.
 *
 * The MONOTONIC factory is essential rather than a refinement. A plain ULID randomises
 * its suffix, so two ids generated inside the same millisecond sort arbitrarily — and a
 * fast agent emits dozens of events per millisecond. The monotonic factory increments
 * the suffix instead, which is what makes "everything after cursor X" a correct
 * statement for WebSocket reconnection rather than an almost-always-correct one.
 */
const monotonicUlid = monotonicFactory();

export const newEventId = (): EventId => asEventId(monotonicUlid());
export const newCorrelationId = (): CorrelationId => asCorrelationId(monotonicUlid());

/** Non-ordering identifiers (request ids, jti, family ids) where randomness is fine. */
export const newId = (): string => ulid();
