/**
 * Generates `docs/ERROR_CODES.md` from the source that actually emits the codes.
 *
 * Why a generator: a hand-written error-code table drifts the moment someone renames a
 * code or adds a check, and a stale table is worse than none because callers trust it.
 * Here the *code list* and the *severity-per-profile* columns come from source, and only
 * the prose (what it means / what to do) is curated, in `scripts/error-code-registry.ts`.
 *
 *   npm run error-codes            regenerate docs/ERROR_CODES.md
 *   npm run error-codes -- --check fail if the committed doc is stale (CI uses this)
 *   npm run error-codes -- --dump  print every code found in src/ with its emission sites
 *
 * Parity is enforced both directions: a code in src/ with no registry entry fails, and a
 * registry entry whose code no longer appears in src/ fails. Nothing is silently skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RELAYOUT_CODES, SPACING_FIXABLE } from '../src/layout/elk.js';
import { AESTHETIC_LAYOUT_CODES, AUTHOR_JUDGEMENT_CODES } from '../src/validate/policy.js';
import { UML_RULE_CODES } from '../src/validate/uml-rules.js';
import {
  type CodeCategory,
  ERROR_CODE_REGISTRY,
  type ErrorCodeEntry,
  NON_CODE_LITERALS,
} from './error-code-registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(root, 'src');
const DOC_PATH = path.join(root, 'docs', 'ERROR_CODES.md');

/** UPPER_SNAKE with at least two segments; single words are enum values, not codes. */
const CODE_SHAPE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
/** Both quote styles: src/ mixes single quotes with prettier-style double quotes. */
const STRING_LITERAL = /(['"])((?:[A-Z0-9]+_)+[A-Z0-9]+)\1/g;

interface Site {
  file: string;
  line: number;
  severity?: 'ERROR' | 'WARNING' | 'INFO';
  phase?: 'semantic' | 'layout' | 'render';
  /** True when the line constructs an issue rather than merely naming the code. */
  emits: boolean;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Each module has its own tiny emission helper, and the same helper name does not mean the
 * same phase everywhere: `issue()` is phase=semantic in ai/pipeline.ts but phase=render in
 * validate/render.ts. So the helper -> (severity, phase) reading is keyed by file. Inferring
 * it from the call site is the only way the doc's phase column can be trusted; a curated
 * phase would silently rot the first time someone moves a check between modules.
 */
const HELPER_SITES: Readonly<
  Record<
    string,
    Readonly<Record<string, { severity?: 'ERROR' | 'WARNING' | 'INFO'; phase: 'semantic' | 'layout' | 'render' }>>
  >
> = {
  'src/validate/index.ts': { add: { phase: 'layout' } },
  'src/validate/semantics.ts': {
    warning: { severity: 'WARNING', phase: 'semantic' },
    error: { severity: 'ERROR', phase: 'semantic' },
  },
  'src/validate/render.ts': { issue: { severity: 'ERROR', phase: 'render' } },
  'src/validate/uml-rules.ts': { finding: { severity: 'WARNING', phase: 'semantic' } },
  'src/ai/pipeline.ts': { issue: { severity: 'ERROR', phase: 'semantic' } },
};

/**
 * Reads severity/phase off the emission line. Object-literal emissions carry both fields
 * inline; helper calls are resolved through HELPER_SITES. Anything not mechanically
 * detectable is left undefined and the registry value stands — the doc never guesses.
 */
function inferEmission(line: string, file: string): Pick<Site, 'severity' | 'phase' | 'emits'> {
  const inlineSev = line.match(/severity:\s*'(ERROR|WARNING|INFO)'/)?.[1] as Site['severity'];
  const inlinePhase = line.match(/phase:\s*'(semantic|layout|render)'/)?.[1] as Site['phase'];
  if (inlineSev || inlinePhase) return { severity: inlineSev, phase: inlinePhase, emits: true };

  const visual = line.match(/visualIssue\(\s*'(ERROR|WARNING|INFO)'/);
  if (visual) return { severity: visual[1] as Site['severity'], phase: 'render', emits: true };

  // `add('ERROR', 'CODE'` — the severity is an argument, the phase comes from the file.
  const addCall = line.match(/\badd\(\s*'(ERROR|WARNING|INFO)'\s*,/);
  if (addCall)
    return { severity: addCall[1] as Site['severity'], phase: HELPER_SITES[file]?.add?.phase ?? 'layout', emits: true };

  for (const [helper, meta] of Object.entries(HELPER_SITES[file] ?? {})) {
    if (new RegExp(`\\b${helper}\\(\\s*['"]`).test(line)) {
      return { severity: meta.severity, phase: meta.phase, emits: true };
    }
  }

  if (/\b(?:ToolError|GeometryInputError)\(/.test(line) || /readonly code = '[A-Z_]+'/.test(line)) {
    return { emits: true };
  }
  // A bare `'CODE',` line is set/array membership: it references a code, it does not emit it.
  return { emits: false };
}

function scan(): Map<string, Site[]> {
  const found = new Map<string, Site[]>();
  for (const file of walk(SRC_DIR)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
    lines.forEach((text, index) => {
      STRING_LITERAL.lastIndex = 0;
      for (let match = STRING_LITERAL.exec(text); match; match = STRING_LITERAL.exec(text)) {
        const code = match[2];
        if (!CODE_SHAPE.test(code)) continue;
        const site: Site = { file: rel, line: index + 1, text: text.trim(), ...inferEmission(text, rel) };
        const sites = found.get(code) ?? [];
        sites.push(site);
        found.set(code, sites);
      }
    });
  }
  return found;
}

/** Codes that are set members rather than emissions still need documenting (UML rules). */
function registeredUmlCodes(): Set<string> {
  return new Set(UML_RULE_CODES);
}

interface Row extends ErrorCodeEntry {
  code: string;
  sites: Site[];
  aiLedSeverity: 'ERROR' | 'WARNING' | 'INFO' | '—';
  strictSeverity: 'ERROR' | 'WARNING' | 'INFO' | '—';
  relayout: boolean;
  spacingFixable: boolean;
}

/**
 * Mirrors `applyProfile` in src/validate/policy.ts by importing its actual sets, so the
 * ai-led column cannot disagree with the code that downgrades findings at runtime.
 */
function aiLedSeverityOf(entry: ErrorCodeEntry, code: string): Row['aiLedSeverity'] {
  const base = entry.severity;
  if (!base) return '—';
  if (entry.notProfiled) return base;
  const judged =
    (entry.phase === 'semantic' && base === 'WARNING') ||
    AESTHETIC_LAYOUT_CODES.has(code) ||
    AUTHOR_JUDGEMENT_CODES.has(code);
  return judged ? 'INFO' : base;
}

function buildRows(found: Map<string, Site[]>): Row[] {
  const rows: Row[] = [];
  for (const [code, entry] of Object.entries(ERROR_CODE_REGISTRY)) {
    const sites = found.get(code) ?? [];
    rows.push({
      code,
      ...entry,
      sites,
      strictSeverity: entry.severity ?? '—',
      aiLedSeverity: aiLedSeverityOf(entry, code),
      relayout: DEFAULT_RELAYOUT_CODES.has(code),
      spacingFixable: SPACING_FIXABLE.has(code),
    });
  }
  return rows;
}

const CATEGORY_ORDER: CodeCategory[] = ['semantic', 'uml', 'layout', 'engine', 'render', 'plan', 'visual', 'request'];

const CATEGORY_TITLES: Record<CodeCategory, string> = {
  semantic: '语义层：图的含义与引用完整性',
  uml: 'UML 记法：23 条规则',
  layout: '布局层：ELK 跑完后量出来的几何',
  engine: '引擎层：布局引擎自己做了什么、拒绝做什么',
  render: '渲染层：.drawio / .svg 产物完整性',
  plan: '计划闸门：调用方答案的证据、置信度与坐标禁令',
  visual: '视觉复核闸门：位图审查结论的处置',
  request: '请求级：MCP / CLI 直接拒绝这次调用',
};

const CATEGORY_INTRO: Record<CodeCategory, string> = {
  semantic:
    '`phase: "semantic"`，由 `src/validate/semantics.ts` 产生。检查各图类型的记法要求与专用元数据引用（State 复合状态、Activity 对象流与泳道、ER / Chen ER 节点引用、Deployment 制品挂载）。**引用悬空是 `ERROR` 并在两个档位下都阻断**；「该不该这么画」类发现在默认档降为 `INFO`。',
  uml: '`phase: "semantic"`。20 条来自 `src/validate/uml-rules.ts`（码是 `UML_RULE_CODES` 里的手写常量，不从提示语派生），另 3 条 `UML_CLASS_INVALID_EDGE_TYPE` / `UML_CLASS_MISSING_GENERALIZATION` / `UML_COMPONENT_INVALID_RELATIONSHIP` 来自 `src/validate/semantics.ts`。默认 `ai-led` 档下全部降为 `INFO`——工具不评判作者画得对不对题；`strict` 档下是 `WARNING`。',
  layout:
    '`phase: "layout"`，由 `src/validate/index.ts` 在 ELK 布局完成后测量。这一层是工具的核心承诺：**节点重叠、连线穿框、连线交叉、边未被路由、文字超出节点、画布溢出、节点落在容器外、断引用与重复 ID 在两个档位下都是 `ERROR`**，因为它们属于「工具自己失职」，不是品味问题。',
  engine:
    '布局引擎的行为记录与它的拒绝。`RELAYOUT_NOT_FIXABLE_BY_PREFERENCES` 是这里最重要的一条：重排回路发现剩下的问题拧间距根本修不动时**立刻停下**，把问题交回构图层，而不是耗满 5 次迭代把画布撑大。',
  render:
    '`phase: "render"`。写盘前对 Draw.io XML 与 SVG 做的结构检查，以及视觉复核产生的发现。严格渲染命令在这一层失败时返回非零退出码。',
  plan: '调用方提交的计划答案要过的闸门（`src/ai/pipeline.ts`）。默认 `ai-led` 档下只有「画得诚实」这一类拦下：几何禁令、稳定 ID、断引用、不支持的关系类型、结构不合法。证据是否逐字存在、置信度是否到 0.7、模型自报的 blocking 不确定，都只作 `INFO` 报告（它们在 `AUTHOR_JUDGEMENT_CODES` 里）。`strict` 档恢复旧行为。',
  visual:
    '视觉审查结论的处置记录（`src/validate/visual.ts`）。审查者只能提布局偏好：它返回的任何坐标、尺寸、边路由都在代码层丢弃，并由这里的码**如实记录丢弃了什么**，绝不伪造「已修复」。前 10 条是**提示规则码**——由审查者的自然语言匹配触发，严重度取自审查者那条 finding（经清洗与钳制），因此没有固定值；后 11 条是**处置码**，严重度固定。注意所有视觉发现在 issue 上带 `:visual` 后缀（如 `VISUAL_CROWDED:visual`），以便与同名的布局发现区分。',
  request:
    '不是校验发现，是这次调用被拒绝，因此绝大多数没有严重度与 phase。MCP 下以 `{ error: { code, message, hint } }` 返回（与「校验未通过」的 `isError` 应答是两条不同通道），CLI 下打印到 stderr 并返回非零退出码。唯一的例外是 `INVALID_MODEL`：它以结构化 issue 形式返回，所以带严重度。',
};

function severityLegend(): string {
  return [
    '| 严重度 | 含义 |',
    '|---|---|',
    '| `ERROR` | 阻断交付。`validate` / 严格 `render` 返回非零退出码；未通过闸门时不落盘 |',
    '| `WARNING` | 不阻断，但会写进质量报告，并可能触发自动重排（见下文「重排」列） |',
    '| `INFO` | 只报告，不阻断、不触发重排。默认 `ai-led` 档下「评判作者」的那一类发现都降到这一级 |',
    '| `—` | 没有固定严重度：请求级拒绝（不是校验发现），或视觉提示规则码（严重度取自审查者那条 finding，经清洗与钳制） |',
  ].join('\n');
}

function renderDoc(rows: Row[], found: Map<string, Site[]>): string {
  const out: string[] = [];
  out.push('# 错误码与校验码');
  out.push('');
  out.push(
    '> 本文件由 `scripts/generate-error-codes.ts` **生成**，不要手改。' +
      '码表与「严重度」两列来自源码，含义与处置建议来自 `scripts/error-code-registry.ts`。' +
      '改完代码跑 `npm run error-codes` 重新生成；CI 用 `--check` 保证它不会过期。',
  );
  out.push('');
  out.push(
    `共 ${rows.length} 个码。扫描 \`src/\` 得到 ${found.size} 个 UPPER_SNAKE 字面量，` +
      `其中 ${Object.keys(NON_CODE_LITERALS).length} 个是枚举值/环境变量名（在生成器的允许清单里逐个注明理由），` +
      `其余全部登记在下。两边不一致时生成器直接失败。`,
  );
  out.push('');
  out.push('## 严重度随档位变化');
  out.push('');
  out.push(
    '同一个码在两个档位下严重度可能不同。档位写在模型里（`"layout": { "profile": "strict" }`），' +
      '默认是 `ai-led`：**图的结构和记法归作者决定，工具只保证画出来的东西可信**。' +
      '降级的判定逻辑在 `src/validate/policy.ts`，下表 `ai-led` 列由生成器直接调用那份逻辑算出，不是抄的。',
  );
  out.push('');
  out.push(severityLegend());
  out.push('');
  out.push(
    '「重排」与「间距可修」两列分别来自 `src/layout/elk.ts` 的 `DEFAULT_RELAYOUT_CODES` 与 `SPACING_FIXABLE`，它们是**两道不同的闸**，读懂它们的差别就读懂了重排回路：',
  );
  out.push('');
  out.push(
    '1. `shouldRelayout()` 先看「重排」列：有非 INFO 的布局发现落在这个集合里，才值得再跑一次 ELK。\n' +
      '2. 真跑之前再看「间距可修」列：只有落在这个集合里的问题，加大 `nodeSpacing` / `layerSpacing` 才**实测**能清掉。\n' +
      '   一个都不剩时回路**立刻停下**并报 `RELAYOUT_NOT_FIXABLE_BY_PREFERENCES`，`status` 变为 `failed_composition_needed`——\n' +
      '   而不是耗满 5 次迭代把画布越撑越大。\n' +
      '3. `layout.algorithm` 选 `radial` / `mrtree` 时这些间距选项根本到不了引擎（`SPACING_INERT_ALGORITHMS`），第 2 步直接判定修不了。',
  );
  out.push('');
  out.push(
    '所以两列会出现「重排=是、间距可修=—」的组合（`EDGE_CROSSING`、`EDGE_LABEL_OVERLAP`）：它值得被考虑，但一考虑就发现没旋钮可拧，于是立即交回构图层。' +
      '另外注意第 1 步会**过滤掉 INFO**——默认 `ai-led` 档下被降级的发现（如 `EDGE_LABEL_OVERLAP`、`EXCESSIVE_DENSITY`）不再触发重排，这正是「不评判作者」的一部分。' +
      '作者显式写 `layout.relayoutTriggers` 时按作者要求跑满预算，绕过第 2 步的判断。',
  );
  out.push('');

  for (const category of CATEGORY_ORDER) {
    const group = rows.filter((row) => row.category === category);
    if (!group.length) continue;
    out.push(`## ${CATEGORY_TITLES[category]}`);
    out.push('');
    out.push(CATEGORY_INTRO[category]);
    out.push('');
    const hasSeverity = group.some((row) => row.severity);
    if (hasSeverity) {
      out.push('| 码 | `ai-led` | `strict` | 重排 | 间距可修 | 含义 | 怎么办 |');
      out.push('|---|---|---|---|---|---|---|');
      for (const row of group.sort(byCode)) {
        out.push(
          `| \`${row.code}\` | ${row.aiLedSeverity} | ${row.strictSeverity} | ${yn(row.relayout)} | ${yn(row.spacingFixable)} | ${row.summary} | ${row.fix} |`,
        );
      }
    } else {
      out.push('| 码 | 含义 | 怎么办 |');
      out.push('|---|---|---|');
      for (const row of group.sort(byCode)) {
        out.push(`| \`${row.code}\` | ${row.summary} | ${row.fix} |`);
      }
    }
    out.push('');
  }

  out.push('## 调用方怎么用这些码');
  out.push('');
  out.push(
    '- **按码分支，不要按提示语分支。** 提示语面向人读、会改措辞；码是手写常量（见 `AGENTS.md` §31）。\n' +
      '- 结构化报告在 `ValidationReport.issues[]`，每条含 `severity` / `code` / `phase` / `elementId` / 可选 `path`。\n' +
      '  旧脚本用的 `warnings[]` 仍然保留，但它是文本，只适合打印。\n' +
      '- 请求级错误（最后一节）不在 `issues[]` 里：MCP 返回 `{ error: { code, message, hint } }`，CLI 走 stderr + 非零退出码。\n' +
      '- 想知道某张图为什么没落盘，先看有没有 `ERROR`；`valid` 字段就是 `!issues.some(i => i.severity === "ERROR")`。',
  );
  out.push('');
  return `${out.join('\n')}\n`;
}

const byCode = (a: Row, b: Row) => a.code.localeCompare(b.code);
const yn = (value: boolean) => (value ? '是' : '—');

function parityProblems(found: Map<string, Site[]>): string[] {
  const problems: string[] = [];
  const registry = new Set(Object.keys(ERROR_CODE_REGISTRY));
  const allow = new Set(Object.keys(NON_CODE_LITERALS));

  for (const code of [...found.keys()].sort()) {
    if (registry.has(code) || allow.has(code)) continue;
    const site = found.get(code)![0];
    problems.push(
      `源码里有码但登记表没有：${code}（${site.file}:${site.line}）— 在 scripts/error-code-registry.ts 补一条，` +
        `或确认它不是错误码后加进 NON_CODE_LITERALS 并写明理由`,
    );
  }
  for (const code of [...registry].sort()) {
    if (!found.has(code)) {
      problems.push(`登记表里有但源码已找不到：${code} — 码被改名或删除了，请同步 scripts/error-code-registry.ts`);
    }
  }
  for (const code of [...allow].sort()) {
    if (!found.has(code)) {
      problems.push(`NON_CODE_LITERALS 里的 ${code} 在 src/ 已不存在 — 删掉这条允许项`);
    }
  }
  for (const [code, entry] of Object.entries(ERROR_CODE_REGISTRY)) {
    if (!entry.summary?.trim()) problems.push(`${code}: summary 为空`);
    if (!entry.fix?.trim()) problems.push(`${code}: fix 为空`);
    if (entry.summary && entry.summary.toUpperCase().replace(/\s+/g, '_') === code) {
      problems.push(`${code}: summary 只是把码名重抄了一遍，请写清触发条件`);
    }
    // Where the emission site is mechanically readable, the curated severity/phase must
    // agree with it. This is what stops the table from rotting when a check is retuned.
    const sites = found.get(code) ?? [];
    for (const site of sites) {
      if (!site.emits) continue;
      if (site.severity && entry.severity && site.severity !== entry.severity) {
        problems.push(
          `${code}: 登记表写 severity=${entry.severity}，但 ${site.file}:${site.line} 实际发射 ${site.severity}`,
        );
      }
      if (site.phase && entry.phase && site.phase !== entry.phase) {
        problems.push(`${code}: 登记表写 phase=${entry.phase}，但 ${site.file}:${site.line} 实际是 ${site.phase}`);
      }
      if (site.severity && !entry.severity) {
        problems.push(`${code}: ${site.file}:${site.line} 发射 severity=${site.severity}，登记表却没写 severity`);
      }
      if (site.phase && !entry.phase) {
        problems.push(`${code}: ${site.file}:${site.line} 发射 phase=${site.phase}，登记表却没写 phase`);
      }
    }
  }
  // UML codes are emitted through a constant table, not inline literals at the throw site,
  // so the scanner sees them only inside UML_RULE_CODES. Assert that table is fully covered.
  for (const code of registeredUmlCodes()) {
    if (!registry.has(code)) problems.push(`UML_RULE_CODES 里的 ${code} 没有登记`);
  }
  return problems;
}

function dump(found: Map<string, Site[]>): void {
  const codes = [...found.keys()].sort();
  process.stdout.write(`# ${codes.length} UPPER_SNAKE literals in src/\n\n`);
  for (const code of codes) {
    const sites = found.get(code)!;
    const emitting = sites.filter((s) => s.emits);
    const inferred = emitting.find((s) => s.severity);
    const phase = emitting.find((s) => s.phase)?.phase;
    process.stdout.write(
      `${code}\n` +
        `  severity: ${inferred?.severity ?? '?'}   phase: ${phase ?? '?'}   sites: ${sites.length} (emitting: ${emitting.length})\n` +
        sites
          .slice(0, 3)
          .map((s) => `    ${s.file}:${s.line}${s.emits ? '' : ' [ref]'}  ${s.text.slice(0, 110)}`)
          .join('\n') +
        '\n\n',
    );
  }
}

function scanSourceCodes(): Map<string, Site[]> {
  return scan();
}

function main(): void {
  const args = process.argv.slice(2);
  const found = scan();

  if (args.includes('--dump')) {
    dump(found);
    return;
  }

  const problems = parityProblems(found);
  if (problems.length) {
    process.stderr.write(
      `[error-codes] ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const doc = renderDoc(buildRows(found), found);
  if (args.includes('--check')) {
    const current = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, 'utf-8') : null;
    if (current !== doc) {
      process.stderr.write(
        '[error-codes] docs/ERROR_CODES.md is stale: a code, its severity or its prose changed.\n' +
          '  Run `npm run error-codes` and commit the result.\n',
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `[error-codes] docs/ERROR_CODES.md is up to date (${Object.keys(ERROR_CODE_REGISTRY).length} codes)\n`,
    );
    return;
  }

  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
  fs.writeFileSync(DOC_PATH, doc, 'utf-8');
  process.stdout.write(
    `[error-codes] wrote ${path.relative(root, DOC_PATH)} (${Object.keys(ERROR_CODE_REGISTRY).length} codes)\n`,
  );
}

// Exported for tests/error-codes.test.ts, which asserts parity without paying a tsx spawn.
export { buildRows, DOC_PATH, parityProblems, renderDoc, scanSourceCodes };

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
