import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Review rasterization for the visual gate (spec B §2).
// Backend order: draw.io Desktop CLI (fidelity) -> sharp SVG rasterizer (fallback).
// The selected backend is always reported so a reviewer knows what produced the bitmap.

export type RasterBackend = 'drawio-cli' | 'sharp-svg';

export interface RasterizeInput {
  /** .drawio file for the preferred drawio-cli backend. */
  drawioPath?: string;
  /** .svg file for the sharp-svg fallback backend. */
  svgPath?: string;
  /** Explicit output PNG path; otherwise outDir (or the system temp dir) is used. */
  outPath?: string;
  outDir?: string;
  /** draw.io `-s` scale factor; also the conceptual raster scale. Default 2. */
  scale?: number;
  /**
   * 1-based page number for a multi-page `.drawio`. draw.io exports page 0 when it
   * is omitted, which would silently rasterize the wrong page of every figure.
   */
  page?: number;
  /** draw.io CLI timeout in milliseconds. Default 60000. */
  timeoutMs?: number;
}

export interface RasterResult {
  pngPath: string;
  backend: RasterBackend;
  width: number;
  height: number;
}

/** sharp's callable surface; typed loosely because sharp is resolved at runtime and ships no local dependency entry. */
export type SharpFactory = (input: Buffer, options?: { density?: number }) => {
  flatten(options?: { background?: string }): {
    png(): { toFile(target: string): Promise<{ width: number; height: number }> };
  };
};

export interface RasterizeDeps {
  env?: NodeJS.ProcessEnv;
  /** Existence probe used only for executable resolution (inputs are checked with the real fs). */
  executableExists?: (target: string) => Promise<boolean>;
  /** Argument-array spawn of the draw.io CLI; tests inject a fake to assert argv shape without an install. */
  runDrawioCli?: (exe: string, args: string[], timeoutMs: number) => Promise<void>;
  loadSharp?: (env: NodeJS.ProcessEnv) => Promise<SharpFactory>;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function defaultExecutableExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export type DrawioResolution =
  | { kind: 'resolved'; exe: string; via: 'DRAWIO_PATH' | 'common-path' }
  | { kind: 'env-missing'; exe: string }
  | { kind: 'unavailable'; checked: string[] };

/** Windows paths come from AGENTS-style install locations; PATH scanning and the macOS bundle are best-effort extras. */
/**
 * Windows install roots. `ProgramFiles` and friends are NOT guaranteed to exist in a
 * spawned tool process (they were absent under `npx tsx` on this machine), so the stock
 * locations are probed as literals too; deriving candidates only from env vars made the
 * gate silently fall back to sharp-svg and never review the real Draw.io renderer.
 */
const WINDOWS_PROGRAM_ROOTS = ['C:\\Program Files', 'C:\\Program Files (x86)'];

export function drawioCandidatePaths(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string[] {
  const candidates: string[] = [];
  if (platform === 'win32') {
    for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], ...WINDOWS_PROGRAM_ROOTS]) {
      if (root) candidates.push(path.win32.join(root, 'draw.io', 'draw.io.exe'));
    }
    if (env.LOCALAPPDATA) candidates.push(path.win32.join(env.LOCALAPPDATA, 'Programs', 'draw.io', 'draw.io.exe'));
  } else {
    candidates.push('/Applications/draw.io.app/Contents/MacOS/draw.io');
  }
  candidates.push('/usr/bin/drawio', '/usr/local/bin/drawio', '/snap/bin/drawio');
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir.trim()) continue;
    candidates.push(path.join(dir, 'drawio'), path.join(dir, 'drawio.exe'), path.join(dir, 'draw.io.exe'));
  }
  return [...new Set(candidates)];
}

export async function resolveDrawioExecutable(
  env: NodeJS.ProcessEnv,
  exists: (target: string) => Promise<boolean> = defaultExecutableExists,
): Promise<DrawioResolution> {
  const configured = env.DRAWIO_PATH?.trim();
  if (configured) {
    return (await exists(configured))
      ? { kind: 'resolved', exe: configured, via: 'DRAWIO_PATH' }
      : { kind: 'env-missing', exe: configured };
  }
  const checked: string[] = [];
  for (const candidate of drawioCandidatePaths(env)) {
    checked.push(candidate);
    if (await exists(candidate)) return { kind: 'resolved', exe: candidate, via: 'common-path' };
  }
  return { kind: 'unavailable', checked };
}

export interface PngMeta { width: number; height: number }

export function pngDimensions(bytes: Buffer): PngMeta {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('[render:png] produced file is not a PNG (missing signature); the raster backend wrote an unexpected format');
  }
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('[render:png] PNG IHDR chunk not found; cannot read image dimensions');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Exact argv for the draw.io CLI. Array form only — never a shell string (§23).
 * `-p` is 1-based and verified against a real two-page file: omitted and `-p 1`
 * produce byte-identical PNGs, `-p 2` produces a different image. Omitting it
 * would silently rasterize page 1 of every multi-page `.drawio`.
 */
export function buildDrawioArgs(drawioPath: string, outPath: string, scale: number, page?: number): string[] {
  const args = ['-x', '-f', 'png', '-s', String(scale), '-b', '10', '-o', outPath];
  if (page !== undefined) args.push('-p', String(page));
  args.push(drawioPath);
  return args;
}

async function runDrawioCliDefault(exe: string, args: string[], timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stderr = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: timeoutMs, windowsHide: true });
    } catch (error) {
      reject(new Error(`failed to spawn ${exe}: ${messageOf(error)} — DRAWIO_PATH must point at the draw.io Desktop executable itself, not a shell wrapper`));
      return;
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000);
    });
    child.once('error', (error: Error) => reject(new Error(`spawn error for ${exe}: ${messageOf(error)}`)));
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) resolve();
      else reject(new Error(`exit code ${code}${signal ? ` (signal ${signal})` : ' — the CLI may have timed out'}${stderr ? `; stderr: ${stderr}` : ''}`));
    });
  });
}

/** Mirrors scripts/generate-database-report-diagrams.ts: project require first, then MIMO_NODE_MODULES shared runtime. */
export async function loadSharpDefault(env: NodeJS.ProcessEnv): Promise<SharpFactory> {
  const require = createRequire(import.meta.url);
  try {
    return require('sharp') as SharpFactory;
  } catch (firstError) {
    const modules = env.MIMO_NODE_MODULES;
    if (!modules) {
      throw new Error(`[render:png] sharp-svg backend unavailable: require('sharp') failed (${messageOf(firstError)}) and MIMO_NODE_MODULES is not set — solution: point MIMO_NODE_MODULES at a node_modules directory that contains sharp (the MiMo Desktop shared runtime ships one) or install sharp locally`);
    }
    try {
      return require(path.join(modules, 'sharp')) as SharpFactory;
    } catch (secondError) {
      throw new Error(`[render:png] sharp-svg backend unavailable: sharp could not be loaded from MIMO_NODE_MODULES=${modules} (${messageOf(secondError)}) — solution: verify the shared runtime still contains sharp, or provide drawioPath with draw.io installed for the drawio-cli backend`);
    }
  }
}

async function requireExisting(target: string, label: string): Promise<void> {
  try {
    await fs.access(target);
  } catch {
    throw new Error(`[render:png] rasterizeForReview received ${label}="${target}" but the file does not exist — solution: render the diagram artifact first, then rasterize its path`);
  }
}

async function resolveOutPath(input: RasterizeInput): Promise<string> {
  const outPath = input.outPath ?? path.join(input.outDir ?? path.join(os.tmpdir(), 'ai-diagram-reviews'), `review-${Date.now()}-${process.pid}.png`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  return outPath;
}

export async function rasterizeForReview(input: RasterizeInput, deps: RasterizeDeps = {}): Promise<RasterResult> {
  if (!input.drawioPath && !input.svgPath) {
    throw new Error('[render:png] rasterizeForReview needs at least one of drawioPath (for the drawio-cli backend) or svgPath (for the sharp-svg fallback); refusing to silently produce nothing');
  }
  const env = deps.env ?? process.env;
  const outPath = await resolveOutPath(input);

  let drawioUnavailableNote = '';
  if (input.drawioPath) {
    const resolution = await resolveDrawioExecutable(env, deps.executableExists ?? defaultExecutableExists);
    if (resolution.kind === 'env-missing') {
      throw new Error(`[render:png] DRAWIO_PATH points to a missing executable: "${resolution.exe}" — solution: fix DRAWIO_PATH to a real draw.io Desktop binary, or unset it to auto-detect, or rerun with only svgPath to use the sharp-svg fallback backend`);
    }
    if (resolution.kind === 'resolved') {
      await requireExisting(input.drawioPath, 'drawioPath');
      const args = buildDrawioArgs(input.drawioPath, outPath, input.scale ?? 2, input.page);
      try {
        await (deps.runDrawioCli ?? runDrawioCliDefault)(resolution.exe, args, input.timeoutMs ?? 60_000);
      } catch (error) {
        throw new Error(`[render:png] the draw.io CLI (backend drawio-cli, resolved via ${resolution.via}) failed to convert ${input.drawioPath} -> ${outPath}: ${messageOf(error)} — solution: check that draw.io Desktop runs standalone, raise timeoutMs, or fall back to the sharp-svg backend by passing svgPath only (sharp must be loadable)`);
      }
      const meta = pngDimensions(await fs.readFile(outPath));
      return { pngPath: outPath, backend: 'drawio-cli', ...meta };
    }
    drawioUnavailableNote = `draw.io executable not found (checked: ${resolution.checked.join(', ')}; set DRAWIO_PATH to override)`;
  }

  if (!input.svgPath) {
    throw new Error(`[render:png] no raster backend available: ${drawioUnavailableNote} — solution: install draw.io Desktop, set DRAWIO_PATH, or pass svgPath so the sharp-svg fallback backend can be used (requires sharp via MIMO_NODE_MODULES)`);
  }
  await requireExisting(input.svgPath, 'svgPath');
  const sharp = await (deps.loadSharp ?? loadSharpDefault)(env);
  const svg = await fs.readFile(input.svgPath);
  let info: { width: number; height: number };
  try {
    info = await sharp(Buffer.from(svg), { density: 216 }).flatten({ background: '#FFFFFF' }).png().toFile(outPath);
  } catch (error) {
    throw new Error(`[render:png] the sharp-svg backend failed to rasterize ${input.svgPath} -> ${outPath}: ${messageOf(error)} — solution: check the SVG is well-formed, or use the drawio-cli backend with a .drawio file`);
  }
  return { pngPath: outPath, backend: 'sharp-svg', ...info };
}
