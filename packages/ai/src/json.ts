/** Extract the first top-level JSON object from model text (tolerates ```json fences and prose). */
export function extractJsonObject(text: string): { value: unknown | null; error: string | null } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return { value: null, error: "No JSON object found in the model output" };
  try {
    return { value: JSON.parse(candidate.slice(start, end + 1)), error: null };
  } catch (err) {
    return { value: null, error: `Model output is not valid JSON: ${(err as Error).message}` };
  }
}
