const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;

/** Minimal, safe template renderer: only `{{key}}` lookups, no expressions or code. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (match, key: string) => values[key] ?? match);
}

export function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1] as string);
}
