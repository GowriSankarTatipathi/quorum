import { describe, it, expectTypeOf } from 'vitest';
import { type SharedEnvSchema } from './index.js';
import { type z } from 'zod';
import type { LlmEnv } from '@quorum/ai';
import type { StorageConfigOptions } from '@quorum/storage';

type SharedEnv = z.infer<typeof SharedEnvSchema>;
type SharedKeys = keyof SharedEnv;

describe('SharedEnvSchema', () => {
  it('contains all variables required by StorageConfigOptions', () => {
    type Missing = Exclude<keyof StorageConfigOptions, SharedKeys>;
    expectTypeOf<Missing>().toEqualTypeOf<never>();
  });

  it('contains all variables required by LlmEnv', () => {
    type Missing = Exclude<keyof LlmEnv, SharedKeys>;
    expectTypeOf<Missing>().toEqualTypeOf<never>();
  });
});
