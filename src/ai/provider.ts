/**
 * @deprecated since 2026-09-26. This module used to open an OpenAI-compatible chat
 * completion with credentials read from the environment.
 *
 * The project deliberately performs no model request and stores no API key: a host
 * agent (or any reasoner it calls) supplies the semantics and the visual review, and
 * the submitted answers are validated by the same gates this function used to face.
 *
 * Keep this file only as a loud migration pointer; it is never imported by the
 * pipeline. Delete it once no external caller references it.
 */
export const DEPRECATION_MESSAGE =
  'createOpenAiPlanner was removed on 2026-09-26: this project no longer calls a model or holds an API key. ' +
  'Ask for a plan task with `generate --emit-plan <task.json>` (or the MCP tool diagram_plan_request), ' +
  'answer it with your own model, then submit through `generate --plan <answer.json>` ' +
  '(MCP: diagram_plan_submit). For the model-free parser use `--offline`.';

/** Always throws. Present so that a stale caller fails clearly instead of silently. */
export function createOpenAiPlanner(): never {
  throw new Error(DEPRECATION_MESSAGE);
}
