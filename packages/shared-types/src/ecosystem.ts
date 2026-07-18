/**
 * Shared ecosystem identifiers used by controller and ai-service validation.
 * Keep in sync with `Ecosystem` in `@speccursor/shared-types`.
 */
export const ALLOWED_ECOSYSTEMS = [
  'node',
  'rust',
  'python',
  'go',
  'lean',
  'dockerfile',
] as const;

export type AllowedEcosystem = (typeof ALLOWED_ECOSYSTEMS)[number];

export function isAllowedEcosystem(value: string): value is AllowedEcosystem {
  return (ALLOWED_ECOSYSTEMS as readonly string[]).includes(value);
}
