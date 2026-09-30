#!/usr/bin/env node
/**
 * Golden-image regression gate: re-renders the baselines through the real renderer and
 * compares pixels.
 *
 *   npm run visual-gate                         check every baseline against the current renderers
 *   npm run visual-gate -- --accept             regenerate baselines that changed (and say why)
 *   npm run visual-gate -- --filter <pattern>   check only diagrams whose id matches
 *
 * How it works, and what it does NOT do:
 *   - Baselines are the committed PNGs under tests/visual-baseline/. Each one is produced
 *     by the **real** renderer (draw.io Desktop, resolved from DRAWIO_PATH or the standard
 *     install locations) — not by the SVG approximation, which draws fewer shapes than
 *     `.drawio` and is therefore not the truth.
 *   - Every check re-renders the *current* renderer output through the same backend and
 *     compares pixels with an anti-aliasing tolerance (`scripts/visual-diff.ts`). This is
 *     a real decoder, not a byte comparison, so a re-encode does not fail spuriously.
 *   - A size mismatch fails outright: the diagram changed shape, not just colour.
 *   - If the renderer is unavailable (no draw.io Desktop, e.g. in CI), the gate **skips
 *     loudly with the reason** instead of passing. A gate that passes because it could
 *     not run is worse than none.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_DIR = path.join(root, 'tests', 'visual-baseline');
const WORK_DIR = path.join(root, 'output', 'visual-gate');
const DRAWIO_EXE = process.env.DRAWIO_PATH?.trim() || 'C:\\Program Files\\draw.io\\draw.io.exe';

const args = process.argv.slice(2);
const accept = args.includes('--accept');
const filter = args.includes('--filter') ? args[args.indexOf('--filter') + 1] : undefined;

// Baselines are declared in one place so the manifest and the render loop cannot drift.
// Each entry names the committed baseline PNG and how to produce its diagram. `artifact`
// is the diagram id the CLI writes (usually the model id, which can differ from the type).
const BASELINES = [
  {
    id: 'system-architecture',
    artifact: 'system-architecture',
    source: 'examples/01-system-architecture/system-architecture.model.json',
  },
  { id: 'uml-class', artifact: 'uml-class', source: 'examples/02-uml-class/uml-class.model.json' },
  { id: 'uml-usecase', artifact: 'uml-usecase', source: 'examples/04-uml-usecase/uml-usecase.model.json' },
  { id: 'flowchart', artifact: 'flowchart', source: 'examples/05-flowchart/flowchart.model.json' },
  { id: 'er', artifact: 'er', source: 'examples/06-er/er.model.json' },
  {
    id: 'state-machine',
    artifact: 'generated-state-machine',
    source: 'examples/18-state-machine/generated-state-machine.model.json',
  },
];

const runCli = (script, cliArgs) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', script, ...cliArgs], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: result.status, stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '' };
};

function main() {
  if (!fs.existsSync(BASELINE_DIR)) {
    process.stdout.write('[visual-gate] no baseline directory yet — run with --accept to create one\n');
  }
  if (!fs.existsSync(DRAWIO_EXE)) {
    // Skip loudly, never silently pass: a gate that passes because it could not run
    // gives false confidence.
    process.stdout.write(
      `[visual-gate] SKIP: draw.io Desktop not found at ${DRAWIO_EXE}.\n` +
        '  The golden-image gate needs the real renderer; set DRAWIO_PATH to the executable.\n' +
        '  Structural verification is still covered by `npm test` (render honesty checks).\n',
    );
    return;
  }
  const { verifyPng } = requireVisualDiff();
  fs.mkdirSync(WORK_DIR, { recursive: true });

  let checked = 0,
    failed = 0,
    accepted = 0;
  for (const baseline of BASELINES) {
    if (filter && !baseline.id.includes(filter)) continue;
    const modelPath = path.join(root, baseline.source);
    if (!fs.existsSync(modelPath)) {
      process.stdout.write(`[visual-gate] FAIL ${baseline.id}: source model missing: ${baseline.source}\n`);
      failed++;
      continue;
    }
    const outDir = path.join(WORK_DIR, baseline.id);
    const rendered = runCli('render', [modelPath, '--out', outDir]);
    if (rendered.status !== 0) {
      process.stdout.write(`[visual-gate] FAIL ${baseline.id}: render failed\n${rendered.stderr}\n`);
      failed++;
      continue;
    }
    const drawioPath = path.join(outDir, `${baseline.artifact}.drawio`);
    if (!fs.existsSync(drawioPath)) {
      process.stdout.write(`[visual-gate] FAIL ${baseline.id}: renderer did not write ${baseline.artifact}.drawio\n`);
      failed++;
      continue;
    }

    const pngPath = path.join(WORK_DIR, `${baseline.id}.png`);
    const raster = spawnSync(DRAWIO_EXE, ['-x', '-f', 'png', '-s', '2', '-b', '10', '-o', pngPath, drawioPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 60_000,
      windowsHide: true,
    });
    if (raster.status !== 0 || !fs.existsSync(pngPath)) {
      process.stdout.write(
        `[visual-gate] FAIL ${baseline.id}: draw.io CLI failed (exit ${raster.status})\n${raster.stderr?.toString()}\n`,
      );
      failed++;
      continue;
    }

    const baselinePath = path.join(BASELINE_DIR, `${baseline.id}.png`);
    if (!fs.existsSync(baselinePath)) {
      if (accept) {
        fs.mkdirSync(BASELINE_DIR, { recursive: true });
        fs.copyFileSync(pngPath, baselinePath);
        process.stdout.write(`[visual-gate] ACCEPT ${baseline.id}: no baseline existed, created one\n`);
        accepted++;
      } else {
        process.stdout.write(
          `[visual-gate] FAIL ${baseline.id}: no baseline. Run --accept to create one from the current render.\n`,
        );
        failed++;
      }
      continue;
    }

    const diff = verifyPng(baselinePath, pngPath);
    if (diff.ok) {
      process.stdout.write(
        `[visual-gate] PASS ${baseline.id} (${diff.width}x${diff.height}, ${diff.differingPixels} px over tolerance)\n`,
      );
      checked++;
    } else if (accept) {
      fs.copyFileSync(pngPath, baselinePath);
      process.stdout.write(`[visual-gate] ACCEPT ${baseline.id}: baseline regenerated (${diff.reason})\n`);
      accepted++;
    } else {
      process.stdout.write(
        `[visual-gate] FAIL ${baseline.id}: ${diff.reason}\n  If the change is intended, run --accept to regenerate the baseline.\n`,
      );
      failed++;
    }
  }

  if (checked + failed + accepted === 0) {
    process.stdout.write('[visual-gate] no baseline matched the filter\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\n[visual-gate] ${checked} passed, ${accepted} accepted, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

// The diff module lives in scripts/, so it is loaded lazily and its absence is a loud error.
function requireVisualDiff() {
  const mod = requireVisualDiffModule();
  return {
    verifyPng: (baselinePath: string, actualPath: string) => {
      const { diffPng } = mod;
      try {
        const diff = diffPng(fs.readFileSync(baselinePath), fs.readFileSync(actualPath), 24);
        return {
          ok: diff.ratio <= 0.005,
          reason:
            diff.ratio <= 0.005
              ? ''
              : `${diff.differingPixels} px differ (${(diff.ratio * 100).toFixed(3)}%), max channel delta ${diff.maxDelta}`,
          ...diff,
        };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

function requireVisualDiffModule() {
  try {
    return require(path.join(root, 'scripts', 'visual-diff.ts')) as typeof import('./visual-diff.js');
  } catch (error) {
    process.stderr.write(
      `[visual-gate] could not load scripts/visual-diff.ts: ${error instanceof Error ? error.message : error}\n`,
    );
    process.exit(1);
  }
}

main();
