import { describe, expect, it } from 'vitest';
import { DISPATCH_TRIGGER_MESSAGE_TYPE } from '../../src/runtime/dispatch-trigger';

describe('DISPATCH_TRIGGER_MESSAGE_TYPE', () => {
  it('is a stable string constant, distinct from any job/priority/store name in this codebase', () => {
    expect(DISPATCH_TRIGGER_MESSAGE_TYPE).toBe('hdna-trigger-dispatch');
    expect(DISPATCH_TRIGGER_MESSAGE_TYPE).not.toBe('run_trial4_benchmark_case');
    expect(DISPATCH_TRIGGER_MESSAGE_TYPE).not.toBe('hdna-dispatch');
  });
});
