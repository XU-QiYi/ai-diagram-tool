import fs from 'node:fs/promises';
import { createDiagram } from './index.js';
import type { Diagram } from './types.js';

export async function loadDiagramModel(file: string): Promise<Diagram> {
  return createDiagram(JSON.parse(await fs.readFile(file, 'utf8')));
}
export async function saveDiagramModel(file: string, diagram: Diagram): Promise<void> {
  await fs.writeFile(file, JSON.stringify(diagram, null, 2), 'utf8');
}
