import { DIAGRAM_TYPES, LAYOUT_ALGORITHMS } from '../model/types.js';

/**
 * Contracts for an external reasoner (the host agent or a model it calls).
 *
 * This module intentionally holds only text: the project performs no model request
 * and owns no credential. A caller asks for a plan request, answers it, and submits
 * the answer through `src/agent/intake.ts`, where every existing gate still applies.
 */
export const PLAN_SYSTEM_PROMPT = `You plan diagram semantics. Return only one JSON object with keys diagram, confidence, uncertainties.
diagram is a Diagram DSL object with id, title, type, nodes, edges, optional containers and type-specific DSL fields. Supported types: ${DIAGRAM_TYPES.join(', ')}.
You own the structure and the notation: choose the nodes, relationships, groupings and diagram type the material calls for, and choose the composition. The tool does not judge whether your structure is the right one; it refuses only what it cannot render truthfully (broken references, an unknown shape or relationship type, an edge it failed to route).
Provenance is optional under the default ai-led profile. Supply provenance: {source: "request"|"document"|"image"|"template", quote: string, confidence: number} per element when the figure must stay traceable; note that layout.profile="strict" re-verifies every quote as an exact substring of its source. uncertainties is an array of {description, blocking}; under ai-led a blocking uncertainty is reported, not rejected.
Extract only elements supported by the supplied material. Do not fill gaps with generic examples, sample workflows, or guessed business features. Preserve stable IDs when revising. Use correct UML relationship types. Do not output x, y, width, height, edge routes, Draw.io XML, or markdown. ELK handles geometry. You may set layout.algorithm to ${LAYOUT_ALGORITHMS.join(', ')} to steer composition - layered for flows and tiers, mrtree for trees, stress for force-like networks, radial for a hub-and-ring reading; omit it to keep the type default.`;

export const AUDIT_SYSTEM_PROMPT = `Independently review a candidate Diagram DSL against all supplied sources. Return only JSON: {"confidence": number, "missing": [{"source": "request|document|image|template", "quote": string, "reason": string}], "unsupportedElementIds": string[]}. Identify diagram-relevant requirements omitted from the diagram and elements unsupported by the sources. For text, document, and JSON template, missing.quote must exactly occur in the source. For an image, quote should describe a specific visible item. Do not invent requirements. An empty missing array means you found no omission; it does not prove completeness.`;

/** Build the `user` content parts for a plan turn from prepared sources. */
export function planUserContent(sources: Array<{ kind: string; name: string; text?: string; dataUrl?: string }>): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: 'Create a Diagram DSL from these sources. Source names and kinds are authoritative.\n' }];
  for (const source of sources) {
    content.push({ type: 'text', text: `SOURCE ${source.kind} (${source.name}):\n${source.text ?? '[image follows]'}` });
    if (source.dataUrl) content.push({ type: 'image_url', image_url: { url: source.dataUrl, detail: 'high' } });
  }
  return content;
}

/** Additional user content for a revision turn: prior answer plus the problems to fix. */
export function reviseUserContent(previous: unknown, issues: unknown): Array<Record<string, unknown>> {
  return [{ type: 'text', text: `Revise the previous plan. Keep IDs for unchanged elements.\nPrevious: ${JSON.stringify(previous)}\nProblems: ${JSON.stringify(issues)}` }];
}

/** Additional user content for an audit turn. */
export function auditUserContent(candidate: unknown): Array<Record<string, unknown>> {
  return [{ type: 'text', text: `Candidate diagram: ${JSON.stringify(candidate)}` }];
}
