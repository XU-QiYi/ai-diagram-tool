#!/usr/bin/env node
/**
 * One command for the full "natural language -> your model -> tool" loop.
 *
 *   npm run demo
 *   npm run demo -- "画一个 UML 用例图：普通用户可以登录、浏览工具、提交租借申请"
 *   npm run demo -- --real   (uses DIAGRAM_ADAPTER_API_KEY / BASE_URL / MODEL if set)
 *
 * Three steps, exactly the three the README documents:
 *   1. --emit-plan   the tool asks for semantics; it never calls a model itself
 *   2. adapter       YOUR model answers (OpenAI-compatible HTTP), or a deterministic
 *                    offline mock when no key is set so this always runs
 *   3. --plan        the tool gates the answer, lays it out and writes .drawio/.svg
 *
 * Everything lands in output/demo/ and never escapes the project.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(root, 'output', 'demo');
const taskFile = path.join(outDir, 'task.json');
const answerFile = path.join(outDir, 'answer.json');
const request = process.argv.slice(2).filter((arg) => arg !== '--real').join(' ') ||
  '画一个 UML 用例图：普通用户可以登录、浏览工具、提交租借申请';

const run = (label, args) => {
  process.stdout.write(`\n$ node --import tsx ${args.join(' ')}\n`);
  // No shell, no npm: args carry the user's request text verbatim, and npm.cmd on Windows
  // can only be started through a shell, where the request would be concatenated unescaped
  // (command injection, Node DEP0190). Calling the CLI through node --import tsx keeps
  // every argument a separate argv entry.
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`\n[demo] could not start node: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`\n[demo] step failed with exit code ${result.status}: ${label}\n`);
    process.exit(result.status ?? 1);
  }
};

const real = process.argv.includes('--real') || Boolean(process.env.DIAGRAM_ADAPTER_API_KEY);
const adapter = path.join(root, 'examples', 'adapter', 'adapter.mjs');

await fs.mkdir(outDir, { recursive: true });
await fs.rm(answerFile, { force: true });

const step = process.argv.includes('--real') ? 'answer with your model (OpenAI-compatible)' : 'answer with the offline mock (set DIAGRAM_ADAPTER_API_KEY for a real model)';
run('ask for semantics (the tool never calls a model)', ['generate', '--emit-plan', taskFile, '--text', request]);

process.stdout.write(`\n$ node ${adapter} ${path.relative(root, taskFile)} ${path.relative(root, answerFile)}\n`);
const answered = spawnSync(process.execPath, [adapter, taskFile, answerFile], { cwd: root, stdio: 'inherit' });
if (answered.error || answered.status !== 0) {
  process.stderr.write(`\n[demo] step failed: ${step}\n`);
  process.exit(answered.status ?? 1);
}

run('gate the answer and lay it out', ['generate', '--plan', answerFile, '--text', request, '--out', outDir]);

process.stdout.write(`\n[demo] done. Artifacts in ${path.relative(root, outDir)}/\n`);
