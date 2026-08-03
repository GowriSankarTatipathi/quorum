/**
 * Confidence without anchors clusters at 0.9 and means nothing. Anchored rubrics
 * measurably improve calibration, and calibration is the only thing that makes the
 * confidence indicator in the UI worth showing rather than actively misleading.
 */
export const UNCERTAINTY_CONTRACT = `<uncertainty>
You must never invent a value.

- If a value is not present, return null and set "reason" to "not_present".
- If a value is present but ambiguous (multiple candidates, unclear units, obscured by an
  overlay), return your best candidate with confidence below 0.6 and state in "ambiguity"
  what specifically is unclear.
- Confidence is calibrated, not decorative. Use this rubric:
    0.95-1.00  literal text, unambiguous label, single candidate
    0.80-0.94  clear but required light inference (e.g. reading a table header)
    0.60-0.79  required interpretation or unit conversion
    0.30-0.59  ambiguous; a careful human might read it differently
    0.00-0.29  guessing — prefer null instead

A null with a reason is a correct answer. A plausible number you did not actually read is
a defect that will reach an accountant's client.
</uncertainty>`;

export const JSON_ONLY = `<format>
Return a single JSON object and nothing else. No prose before or after it, no markdown
fences, no commentary. Every field described in the schema must be present; use null
rather than omitting a field.
</format>`;
