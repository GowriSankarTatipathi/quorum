/**
 * Models wrap JSON in prose or fences more often than they should, even when asked not
 * to. Recovering the object costs nothing and turns a retry — which costs a second call
 * and real money — into a parse. Anything beyond this is a genuine failure and is
 * reported as a schema violation rather than repaired by guessing.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new SyntaxError('Model returned an empty response');

  const direct = tryParse(trimmed);
  if (direct.ok) return direct.value;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed.ok) return parsed.value;
  }

  // Fall back to the outermost balanced object or array in the response.
  const slice = outermostJsonSlice(trimmed);
  if (slice !== null) {
    const parsed = tryParse(slice);
    if (parsed.ok) return parsed.value;
  }

  throw new SyntaxError(`Model response was not valid JSON: ${trimmed.slice(0, 200)}`);
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Scans for a balanced object/array, ignoring braces inside string literals. */
function outermostJsonSlice(text: string): string | null {
  const openIndex = text.search(/[{[]/);
  if (openIndex === -1) return null;

  const opener = text[openIndex]!;
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return null;
}
