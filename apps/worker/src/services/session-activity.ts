/** Keep an executing run from being mistaken for an abandoned browser session. */
export function keepSessionAlive(touch: () => void, idleTimeoutMs: number): () => void {
  touch();
  const timer = setInterval(touch, Math.max(1, Math.floor(idleTimeoutMs / 3)));
  timer.unref();
  return () => clearInterval(timer);
}
