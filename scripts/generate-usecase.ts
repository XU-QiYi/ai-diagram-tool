import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutDiagram } from '../src/layout/elk.js';
import type { Diagram } from '../src/model/types.js';
import { renderDrawio, renderSvg } from '../src/render/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const modelPath = path.join(root, 'examples/usecase-toolshare/usecase-toolshare.model.json');
  const modelJson = await fs.readFile(modelPath, 'utf-8');
  const diagram: Diagram = JSON.parse(modelJson);

  const layout = await layoutDiagram(diagram);
  const outputDir = path.join(root, 'examples/usecase-toolshare');

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, `${diagram.id}.drawio`), renderDrawio(layout));
  await fs.writeFile(path.join(outputDir, `${diagram.id}.svg`), renderSvg(layout));

  if (layout.warnings.length) {
    console.warn(`[Layout Warning] ${diagram.id}: ${layout.warnings.join('; ')}`);
  }

  console.log(
    `Generated ${diagram.id} (${layout.nodes.length} nodes, ${layout.edges.length} edges, ${layout.iterations} iteration(s))`,
  );
  console.log(`Output files:`);
  console.log(`  - ${path.join(outputDir, `${diagram.id}.drawio`)}`);
  console.log(`  - ${path.join(outputDir, `${diagram.id}.svg`)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
