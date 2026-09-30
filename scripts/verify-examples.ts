/**
 * Compares two example directories file by file and fails on any difference.
 *
 * Used by CI as the "examples match committed artifacts" gate: `npm run examples`
 * regenerates 19 example directories, and this script asserts the regenerated artifacts
 * are byte-identical to what the repository commits. A diff means someone changed
 * generation code without regenerating the examples — which would silently invalidate
 * them as regression baselines and as documentation.
 *
 *   npx tsx scripts/verify-examples.ts <fresh-output-dir> <committed-dir>
 *
 * Verifies every file in the committed dir exists in the fresh one with identical bytes,
 * and reports files the fresh run produced but the committed dir lacks (a symptom of a
 * renamed diagram type or a dropped example).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * Files in the committed examples tree that `npm run examples` does not generate. Each
 * needs a reason: an unexplained entry is how a genuinely stale artifact gets skipped
 * later. These are hand-written fixtures that live next to the generated examples so the
 * README can point at a single place.
 */
const HAND_WRITTEN: Readonly<Record<string, string>> = {
  'patch-add-redis.json': 'README 的 `--patch` 示例，手写 fixture，不是生成产物',
};

function walk(dir: string, prefix = '', out: Map<string, string> = new Map()): Map<string, string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel, out);
    else out.set(rel, sha256(path.join(dir, entry.name)));
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    process.stderr.write('usage: tsx scripts/verify-examples.ts <fresh-dir> <committed-dir>\n');
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resolve = (dir: string): string => (path.isAbsolute(dir) ? dir : path.join(root, dir));
  const [freshDir, committedDir] = args.map(resolve);

  for (const dir of [freshDir, committedDir]) {
    if (!fs.existsSync(dir)) {
      process.stderr.write(`[verify-examples] missing directory: ${dir}\n`);
      process.exitCode = 1;
      return;
    }
  }

  const fresh = walk(freshDir);
  const committed = walk(committedDir);
  const problems: string[] = [];

  for (const [rel, hash] of [...committed].sort(([a], [b]) => a.localeCompare(b))) {
    if (HAND_WRITTEN[rel] !== undefined) continue;
    const got = fresh.get(rel);
    if (got === undefined) problems.push(`重新生成的目录里缺文件：${rel}`);
    else if (got !== hash) problems.push(`与仓库内已提交版本不一致：${rel}`);
  }
  for (const rel of [...fresh.keys()].sort()) {
    if (!committed.has(rel)) problems.push(`重新生成多出的文件：${rel}（示例类型被改名或删除了？）`);
  }
  for (const rel of Object.keys(HAND_WRITTEN)) {
    if (!committed.has(rel)) problems.push(`HAND_WRITTEN 里的 ${rel} 在 committed 目录已不存在 — 删掉这条允许项`);
  }

  if (problems.length) {
    process.stderr.write(`[verify-examples] ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.stderr.write('  Fix: run `npm run examples` and commit the regenerated artifacts.\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`[verify-examples] ${committed.size} artifacts identical between the fresh run and the committed tree\n`);
}

main();
