# AI Diagram Pipeline Implementation Plan

1. Extend `src/model/types.ts` with per-element provenance and add `src/ai/types.ts`. Test planner validation with focused cases in `tests/ai-pipeline.test.ts`.
2. Add `src/ai/input.ts` for text, document, image, and template loading. Extract Markdown/TXT directly, PDF with pdfjs-dist, DOCX with mammoth; limit size and reject unsupported or empty files. Test adapters with temporary fixtures and input errors.
3. Add `src/ai/provider.ts` with OpenAI-compatible Chat Completions calls through `fetch`, a strict JSON response contract, and a provider interface injectable for tests. Read configuration from environment and fail before writing files when missing.
4. Add `src/ai/pipeline.ts` to check schema, per-element evidence, confidence, coordinates, and structural/semantic issues; run existing ELK and layout validator; send bounded feedback to the provider for at most three planning attempts. Keep model IDs stable through revisions and report unresolved layout errors.
5. Update `src/cli.ts`: make natural language use AI by default, add `--text`, `--document`, `--image`, `--template`, and explicit `--offline`; write `.quality.json` with diagram artifacts. Keep `--input`, `--preset`, `--examples`, `validate`, `layout`, and `render` behavior.
6. Update README with configuration, examples, output semantics, and limitations. Run `npm run build`, `npm test`, `npm run examples`, and `git diff --check`; inspect only scoped diffs.
