import { afterEach, expect, it, vi } from 'vitest';
import { keepSessionAlive } from './session-activity.js';
afterEach(() => vi.useRealTimers());
it('keeps the session active through a model call longer than the idle timeout and stops on cleanup', () => {
  vi.useFakeTimers();
  let lastTouched = Date.now();
  const touch = vi.fn(() => {
    lastTouched = Date.now();
  });
  const stop = keepSessionAlive(touch, 60_000);
  vi.advanceTimersByTime(105_000);
  expect(Date.now() - lastTouched).toBeLessThan(60_000);
  const count = touch.mock.calls.length;
  stop();
  vi.advanceTimersByTime(120_000);
  expect(touch).toHaveBeenCalledTimes(count);
});
