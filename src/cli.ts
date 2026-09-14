import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleDiagrams } from './diagram-types/examples.js';
import { createDiagramFromRequest } from './diagram-types/index.js';
import { layoutDiagram } from './layout/elk.js';
import { renderDrawio, renderSvg } from './render/index.js';
import type { Diagram } from './model/types.js';
import { splitLargeDiagram } from './pipeline/index.js';
import { applyDiagramPatch, type DiagramPatch } from './pipeline/index.js';
import { loadDiagramModel } from './model/io.js';
import { architecturePresets, type ArchitecturePreset } from './diagram-types/architecture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function writeSingle(diagram: Diagram, dir: string, fileBase = diagram.id) {
  const layout = await layoutDiagram(diagram);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${fileBase}.model.json`), JSON.stringify(diagram, null, 2));
  await fs.writeFile(path.join(dir, `${fileBase}.drawio`), renderDrawio(layout));
  await fs.writeFile(path.join(dir, `${fileBase}.svg`), renderSvg(layout));
  if (layout.warnings.length) console.warn(`[Layout Warning] ${diagram.id}: ${layout.warnings.join('; ')}`);
  console.log(`Generated ${diagram.id} (${layout.nodes.length} nodes, ${layout.edges.length} edges, ${layout.iterations} iteration(s))`);
}
async function writeDiagram(diagram: Diagram, dir: string) {
  const parts=splitLargeDiagram(diagram);
  for(const part of parts) await writeSingle(part.diagram,dir,parts.length===1?diagram.id:part.name);
  if(parts.length>1) console.log(`Split ${diagram.id} into ${parts.length} editable diagrams: ${parts.map(p=>p.name).join(', ')}`);
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--examples') || args.length === 0) {
    const names = ['01-system-architecture','02-uml-class','03-uml-component','04-uml-usecase','05-flowchart','06-er','07-sequence','08-state','09-activity','10-deployment','11-mindmap','12-timeline','13-network','14-microservices-architecture','15-event-driven-architecture','16-cloud-architecture','17-production-deployment','18-state-machine','19-chen-er'];
    for (let i = 0; i < exampleDiagrams.length; i++) await writeDiagram(exampleDiagrams[i](), path.join(root, 'examples', names[i]));
    return;
  }
  const inputIndex=args.indexOf('--input');
  if(inputIndex>=0){const file=args[inputIndex+1];if(!file)throw new Error('--input requires a .model.json path');const outIndex=args.indexOf('--out');const out=outIndex>=0&&args[outIndex+1]?path.resolve(args[outIndex+1]):path.join(root,'output');let diagram=await loadDiagramModel(path.resolve(file));const patchIndex=args.indexOf('--patch');if(patchIndex>=0){const patchFile=args[patchIndex+1];if(!patchFile)throw new Error('--patch requires a JSON patch path');const patch=JSON.parse(await fs.readFile(path.resolve(patchFile),'utf8')) as DiagramPatch;diagram=applyDiagramPatch(diagram,patch);}await writeDiagram(diagram,out);return;}
  const presetIndex=args.indexOf('--preset');
  if(presetIndex>=0){const name=args[presetIndex+1] as ArchitecturePreset;const factory=architecturePresets[name];if(!factory)throw new Error(`Unknown architecture preset: ${name}`);const titleIndex=args.indexOf('--title');await writeDiagram(factory(titleIndex>=0?args[titleIndex+1]:undefined),path.join(root,'output'));return;}
  const outIndex = args.indexOf('--out');
  const requestArgs = outIndex >= 0 ? args.filter((_, index) => index !== outIndex && index !== outIndex + 1) : args;
  const title = requestArgs.join(' ');
  const out = outIndex >= 0 && args[outIndex + 1] ? path.resolve(args[outIndex + 1]) : path.join(root, 'output');
  await writeDiagram(createDiagramFromRequest(title), out);
}
main().catch(err => { console.error(err); process.exitCode = 1; });
