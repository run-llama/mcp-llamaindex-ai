/**
 * Event shape, held apart from both its producer (`usage.ts`) and its PostHog
 * sink, which would otherwise import each other in a cycle.
 */

/** Value recorded when a dimension cannot be resolved. */
export const UNKNOWN = 'unknown';

export type ToolOutcome =
  | 'success'
  | 'tool_error'
  | 'rate_limited'
  | 'unauthenticated'
  | 'exception';

/**
 * `surface` is the base path's first segment — a literal in every route file,
 * so the value set stays closed despite `/classify/[configId]` and its
 * siblings carrying a caller-supplied segment. `scoped` records whether that
 * segment was present.
 */
export type UsageSurface = {
  surface: string;
  scoped: boolean;
};

export type ToolUsageEvent = {
  tool: string;
  surface: string;
  scoped: boolean;
  region: string;
  userId: string;
  projectId: string;
  /**
   * LlamaCloud organization id, not the WorkOS `org_id` claim — separate id
   * spaces, and the platform's analytics group on the former.
   */
  organizationId: string;
  outcome: ToolOutcome;
  durationMs: number;
};
