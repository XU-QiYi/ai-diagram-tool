import { createDiagram } from '../model/index.js';
import type { Diagram, Node } from '../model/types.js';

interface ParsedAttribute {
  entity: string;
  label: string;
  kind: 'attribute' | 'key-attribute' | 'multivalued-attribute' | 'derived-attribute';
}

interface ParsedRelationship {
  source: string;
  target: string;
  label: string;
  sourceCardinality?: string;
  targetCardinality?: string;
}

function stableId(label: string): string {
  return (
    [...label.trim().toLowerCase()]
      .map((char) => (/[a-z0-9]/.test(char) ? char : `u${char.codePointAt(0)!.toString(16)}`))
      .join('')
      .slice(0, 48) || 'unnamed'
  );
}

function cleanLabel(value: string): string {
  return value
    .trim()
    .replace(/^[“”‘’"'《》]+|[“”‘’"'《》]+$/g, '')
    .trim();
}

function splitList(value: string): string[] {
  return value
    .split(/[、,，]/)
    .map(cleanLabel)
    .filter(Boolean);
}

function parseAttribute(raw: string): Omit<ParsedAttribute, 'entity'> | undefined {
  let label = cleanLabel(raw);
  let kind: ParsedAttribute['kind'] = 'attribute';
  if (/^(?:PK|主键)\s*/i.test(label) || /[（([]\s*(?:PK|主键)\s*[）)\]]$/i.test(label)) kind = 'key-attribute';
  else if (/^(?:多值)\s*/.test(label) || /[（([]\s*多值\s*[）)\]]$/.test(label)) kind = 'multivalued-attribute';
  else if (/^(?:派生)\s*/.test(label) || /[（([]\s*派生\s*[）)\]]$/.test(label)) kind = 'derived-attribute';
  label = label
    .replace(/^(?:PK|主键|多值|派生)\s*/i, '')
    .replace(/[（([]\s*(?:PK|主键|多值|派生)\s*[）)\]]$/i, '')
    .trim();
  return label ? { label, kind } : undefined;
}

function normalizeCardinality(value: string): string {
  const normalized = value.trim().toUpperCase();
  return normalized === '*' ? 'N' : normalized;
}

function parseRelationship(raw: string, entityLabels: string[]): ParsedRelationship | undefined {
  let text = cleanLabel(raw)
    .replace(/^(?:联系|关系)\s*[:：]\s*/i, '')
    .trim();
  const cardinality = text.match(
    /(?:基数|关系为|为)?\s*(0\.\.1|0\.\.[*NM]|1\.\.[*NM]|1|M|N|\*)\s*[:：]\s*(0\.\.1|0\.\.[*NM]|1\.\.[*NM]|1|M|N|\*)\s*$/i,
  );
  const sourceCardinality = cardinality ? normalizeCardinality(cardinality[1]) : undefined;
  const targetCardinality = cardinality ? normalizeCardinality(cardinality[2]) : undefined;
  if (cardinality)
    text = text
      .slice(0, cardinality.index)
      .replace(/[，,、\s]+$/, '')
      .trim();

  const ordered = [...entityLabels].sort((a, b) => b.length - a.length);
  for (const source of ordered) {
    if (!text.startsWith(source)) continue;
    for (const target of ordered) {
      if (source === target || !text.endsWith(target)) continue;
      let label = text
        .slice(source.length, text.length - target.length)
        .replace(/^\s*(?:与|和|跟)\s*/, '')
        .replace(/^\s*通过\s*/, '')
        .replace(/\s*(?:联系|关联|之间的|的)?\s*(?:关系)?\s*$/i, '');
      label = cleanLabel(label);
      if (label) return { source, target, label, sourceCardinality, targetCardinality };
    }
  }

  const chain = text.match(/^(.+?)\s*[-—]\s*(.+?)\s*[-—]\s*(.+)$/);
  if (chain)
    return {
      source: cleanLabel(chain[1]),
      label: cleanLabel(chain[2]),
      target: cleanLabel(chain[3]),
      sourceCardinality,
      targetCardinality,
    };
  return undefined;
}

/**
 * Parses a conservative, semi-structured Chen ER request. Ambiguous prose is
 * intentionally left to the caller's fallback instead of inventing entities or cardinalities.
 */
export function parseChenErRequest(request: string): Diagram | undefined {
  const segments = request
    .split(/[\r\n；;。]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const entities: string[] = [];
  const attributes: ParsedAttribute[] = [];
  const relationshipTexts: string[] = [];
  let inRelationshipSection = false;

  const addEntity = (label: string) => {
    const clean = cleanLabel(label);
    if (clean && !entities.includes(clean)) entities.push(clean);
  };

  for (const segment of segments) {
    const entitySection = segment.match(/^(?:实体|entities?)\s*[:：]\s*(.+)$/i);
    if (entitySection) {
      splitList(entitySection[1]).forEach(addEntity);
      inRelationshipSection = false;
      continue;
    }
    const attributeSection = segment.match(/^(.{1,40}?)\s*属性\s*[:：]\s*(.+)$/i);
    if (attributeSection) {
      const entity = cleanLabel(attributeSection[1]);
      addEntity(entity);
      for (const raw of splitList(attributeSection[2])) {
        const attribute = parseAttribute(raw);
        if (attribute) attributes.push({ entity, ...attribute });
      }
      inRelationshipSection = false;
      continue;
    }
    const relationshipSection = segment.match(/^(?:联系|关系)\s*[:：]\s*(.+)$/i);
    if (relationshipSection) {
      relationshipTexts.push(
        ...relationshipSection[1]
          .split(/[、]/)
          .map((value) => value.trim())
          .filter(Boolean),
      );
      inRelationshipSection = true;
      continue;
    }
    if (inRelationshipSection) relationshipTexts.push(segment);
  }

  if (entities.length < 1) return undefined;
  const relationships = relationshipTexts
    .map((value) => parseRelationship(value, entities))
    .filter((value): value is ParsedRelationship => Boolean(value));
  if (!attributes.length && !relationships.length) return undefined;

  for (const relationship of relationships) {
    addEntity(relationship.source);
    addEntity(relationship.target);
  }
  const entityId = new Map<string, string>();
  const nodes: Node[] = [];
  const edges: Diagram['edges'] = [];
  const usedNodeIds = new Set<string>();
  const uniqueNodeId = (base: string) => {
    let id = base;
    for (let index = 2; usedNodeIds.has(id); index++) id = `${base}-${index}`;
    usedNodeIds.add(id);
    return id;
  };
  for (const label of entities) {
    const id = uniqueNodeId(`entity.${stableId(label)}`);
    entityId.set(label, id);
    nodes.push({ id, label, kind: 'entity', width: 150, height: 64 });
  }

  for (const attribute of attributes) {
    const ownerId = entityId.get(attribute.entity)!;
    const id = uniqueNodeId(`attribute.${stableId(attribute.entity)}.${stableId(attribute.label)}`);
    nodes.push({ id, label: attribute.label, kind: attribute.kind });
    edges.push({
      id: `chen.attribute.${stableId(attribute.entity)}.${stableId(attribute.label)}.${edges.length + 1}`,
      source: ownerId,
      target: id,
      type: 'association',
    });
  }
  for (const relationship of relationships) {
    const id = uniqueNodeId(`relationship.${stableId(relationship.label)}`);
    nodes.push({ id, label: relationship.label, kind: 'relationship', width: 110, height: 64 });
    edges.push(
      {
        id: `chen.relationship.${stableId(relationship.label)}.source.${edges.length + 1}`,
        source: entityId.get(relationship.source)!,
        target: id,
        label: relationship.sourceCardinality,
        type: 'association',
      },
      {
        id: `chen.relationship.${stableId(relationship.label)}.target.${edges.length + 2}`,
        source: entityId.get(relationship.target)!,
        target: id,
        label: relationship.targetCardinality,
        type: 'association',
      },
    );
  }

  return createDiagram({
    id: 'generated-chen-er',
    title: `${entities.slice(0, 3).join('、')}${entities.length > 3 ? '等' : ''} Chen ER 图`,
    type: 'chen-er',
    direction: 'LEFT_TO_RIGHT',
    layout: { density: 'compact', nodeSpacing: 28, layerSpacing: 36, targetAspectRatio: 1.25 },
    nodes,
    edges,
    metadata: { request },
    chenEr: {
      entityIds: nodes.filter((node) => node.kind === 'entity').map((node) => node.id),
      attributeIds: nodes.filter((node) => node.kind?.endsWith('attribute')).map((node) => node.id),
      relationshipIds: nodes.filter((node) => node.kind === 'relationship').map((node) => node.id),
    },
  });
}
