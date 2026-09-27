import type {
  LayoutResult,
  LayoutNode,
  RelationshipType,
} from "../model/types.js";
import { nodeTextLines } from "../utils/text.js";
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const labelLines = (s: string) => s.split(/\\n|\r?\n/).map(esc);
function erSvg(m?: string) {
  return m === "0..1"
    ? "erZeroOne"
    : m === "0..*"
      ? "erZeroMany"
      : m === "1..*"
        ? "erOneMany"
        : m === "1" || m === "1..1"
          ? "erOne"
          : "erMany";
}
function markers(
  type?: RelationshipType,
  sourceMultiplicity?: string,
  targetMultiplicity?: string,
) {
  if (type === "association" || type === "communication-path") return "";
  if (
    type === "inheritance" ||
    type === "generalization" ||
    type === "realization"
  )
    return 'marker-end="url(#triangle)"';
  if (type === "composition") return 'marker-start="url(#diamondFilled)"';
  if (type === "aggregation") return 'marker-start="url(#diamondOpen)"';
  if (type === "foreign-key")
    return `marker-start="url(#${erSvg(sourceMultiplicity)})" marker-end="url(#${erSvg(targetMultiplicity)})"`;
  return 'marker-end="url(#arrow)"';
}
export function renderSvg(layout: LayoutResult): string {
  if (layout.diagram.type === "sequence") return renderSequenceSvg(layout);
  const pad = layout.diagram.layout?.svgPad ?? 80,
    legend = layout.diagram.theme?.showLegend,
    legendWidth = legend ? 270 : 0;
  const artifactBounds = (layout.diagram.deployment?.artifacts ?? [])
    .map((a) => {
      const host = layout.nodes.find((n) => n.id === a.deployedOn);
      return host
        ? {
            ...a,
            x: host.x + pad + host.width - 35,
            y: host.y + pad + host.height + 20,
            width: 120,
            height: 45,
          }
        : undefined;
    })
    .filter(Boolean) as Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  const w = Math.ceil(
      Math.max(
        layout.width + pad * 2 + legendWidth,
        ...artifactBounds.map((a) => a.x + a.width + pad),
        0,
      ),
    ),
    h = Math.ceil(
      Math.max(
        layout.height + pad * 2,
        ...artifactBounds.map((a) => a.y + a.height + pad),
        0,
      ),
    );
  const theme = layout.diagram.theme?.name,
    defaults =
      theme === "monochrome"
        ? {
            fill: "#FFFFFF",
            stroke: "#334155",
            text: "#0F172A",
            container: "#F8FAFC",
            background: "#FFFFFF",
          }
        : theme === "blueprint"
          ? {
              fill: "#EAF2FF",
              stroke: "#315C9B",
              text: "#17345F",
              container: "#F4F8FF",
              background: "#F8FBFF",
            }
          : {
              fill: "#F5F7FA",
              stroke: "#64748B",
              text: "#1E293B",
              container: "#FFFFFF",
              background: "#FFFFFF",
            };
  const containers = layout.containers;
  const containerShapes = [...containers]
    .sort((a, b) => a.depth - b.depth)
    .map(
      (c) =>
        `<g><rect x="${c.x + pad}" y="${c.y + pad}" width="${c.width}" height="${c.height}" rx="4" fill="${c.style?.fill ?? defaults.container}" fill-opacity="0.72" stroke="${c.style?.stroke ?? defaults.stroke}"/><text x="${c.x + pad + 10}" y="${c.y + pad + 22}" font-family="Arial" font-size="14" font-weight="bold" fill="${c.style?.text ?? defaults.text}">${labelLines(c.label)[0] ?? ""}</text></g>`,
    )
    .join("");
  const nodes = layout.nodes
    .map((n) => {
      const lines = nodeTextLines(n, layout.diagram.type).map(esc);
      const lineHeight = n.style?.lineHeight ?? 18;
      const startY =
        n.y + pad + n.height / 2 - ((lines.length - 1) * lineHeight) / 2 + 5;
      const text = lines
        .map(
          (line, i) =>
            `<tspan x="${n.x + pad + n.width / 2}" dy="${i ? lineHeight : 0}">${line}</tspan>`,
        )
        .join("");
      const cx = n.x + pad + n.width / 2,
        cy = n.y + pad + n.height / 2;
      const roles = theme !== "monochrome" && theme !== "blueprint",
        fill =
          n.style?.fill ??
          (roles && n.kind === "database"
            ? "#E8F1FF"
            : roles && n.kind === "external"
              ? "#FFF4E5"
              : roles && n.kind === "cache"
                ? "#F0FDF4"
                : roles && n.kind === "queue"
                  ? "#FAF5FF"
                  : defaults.fill),
        stroke =
          n.style?.stroke ??
          (roles && n.kind === "database"
            ? "#3B82F6"
            : roles && n.kind === "external"
              ? "#F59E0B"
              : defaults.stroke);
      let shape: string;
      const activityOrState =
        layout.diagram.type === "state" ||
        layout.diagram.type === "state-machine" ||
        layout.diagram.type === "activity";
      if (n.kind === "start" && activityOrState)
        shape = `<circle cx="${cx}" cy="${cy}" r="12" fill="#1E293B"/>`;
      else if (n.kind === "end" && activityOrState)
        shape = `<circle cx="${cx}" cy="${cy}" r="17" fill="white" stroke="#1E293B" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="10" fill="#1E293B"/>`;
      else if (
        (n.kind === "fork" || n.kind === "join") &&
        layout.diagram.type === "activity"
      )
        shape = `<rect x="${n.x + pad}" y="${n.y + pad}" width="${n.width}" height="${n.height}" fill="#1E293B"/>`;
      else if (n.kind === "actor")
        shape = `<circle cx="${cx}" cy="${n.y + pad + 18}" r="10" fill="none" stroke="${stroke}"/><path d="M${cx} ${n.y + pad + 28}v28 M${cx - 18} ${n.y + pad + 38}h36 M${cx} ${n.y + pad + 56}l-14 24 M${cx} ${n.y + pad + 56}l14 24" fill="none" stroke="${stroke}"/>`;
      else if (layout.diagram.type === "chen-er" && (n.kind?.endsWith("attribute") || n.style?.shape?.includes("ellipse")))
        shape = `<ellipse cx="${cx}" cy="${cy}" rx="${n.width / 2}" ry="${n.height / 2}" fill="${fill}" stroke="${stroke}" ${n.kind === "derived-attribute" ? 'stroke-dasharray="6 4"' : ""}/>${n.kind === "multivalued-attribute" ? `<ellipse cx="${cx}" cy="${cy}" rx="${n.width / 2 - 5}" ry="${n.height / 2 - 5}" fill="none" stroke="${stroke}"/>` : ""}`;
      else if (layout.diagram.type === "chen-er" && ((n.kind?.endsWith("relationship") ?? false) || n.style?.shape?.includes("rhombus")))
        shape = `<polygon points="${cx},${n.y + pad} ${n.x + pad + n.width},${cy} ${cx},${n.y + pad + n.height} ${n.x + pad},${cy}" fill="${fill}" stroke="${stroke}"/>${n.kind === "identifying-relationship" ? `<polygon points="${cx},${n.y + pad + 6} ${n.x + pad + n.width - 9},${cy} ${cx},${n.y + pad + n.height - 6} ${n.x + pad + 9},${cy}" fill="none" stroke="${stroke}"/>` : ""}`;
      else if (layout.diagram.type === "chen-er" && ((n.kind?.endsWith("entity") ?? false) || n.style?.shape?.includes("rectangle")))
        shape = `<rect x="${n.x + pad}" y="${n.y + pad}" width="${n.width}" height="${n.height}" rx="0" fill="${fill}" stroke="${stroke}"/>${n.kind === "weak-entity" ? `<rect x="${n.x + pad + 5}" y="${n.y + pad + 5}" width="${n.width - 10}" height="${n.height - 10}" rx="0" fill="none" stroke="${stroke}"/>` : ""}`;
      else if (n.kind === "usecase" || layout.diagram.type === "uml-usecase")
        shape = `<ellipse cx="${cx}" cy="${cy}" rx="${n.width / 2}" ry="${n.height / 2}" fill="${fill}" stroke="${stroke}"/>`;
      else if (n.kind === "decision" || n.kind === "merge")
        shape = `<polygon points="${cx},${n.y + pad} ${n.x + pad + n.width},${cy} ${cx},${n.y + pad + n.height} ${n.x + pad},${cy}" fill="${fill}" stroke="${stroke}"/>`;
      else if ((n.kind === "start" || n.kind === "end") && layout.diagram.type === "flowchart")
        shape = `<ellipse cx="${cx}" cy="${cy}" rx="${n.width / 2}" ry="${n.height / 2}" fill="${fill}" stroke="${stroke}"/>`;
      else
        shape = `<rect x="${n.x + pad}" y="${n.y + pad}" width="${n.width}" height="${n.height}" rx="${layout.diagram.type === "uml-class" ? 0 : 8}" fill="${fill}" stroke="${stroke}"/>`;
      const hideText =
        (n.kind === "start" || n.kind === "end") && activityOrState;
      let renderedText = hideText ? "" : `<text x="${cx}" y="${startY}" text-anchor="middle" font-family="Arial" font-size="${n.style?.fontSize ?? 14}" fill="${n.style?.text ?? defaults.text}">${text}</text>`;
      if (n.kind === "actor")
        renderedText = `<text x="${cx}" y="${n.y + pad + n.height - 5}" text-anchor="middle" font-family="Arial" font-size="${n.style?.fontSize ?? 14}" fill="${n.style?.text ?? defaults.text}">${labelLines(n.label).join(" ")}</text>`;
      if (layout.diagram.type === "chen-er" && n.kind === "key-attribute")
        renderedText = `<text x="${cx}" y="${startY}" text-anchor="middle" text-decoration="underline" font-family="Arial" font-size="${n.style?.fontSize ?? 14}" fill="${n.style?.text ?? defaults.text}">${text}</text>`;
      if (layout.diagram.type === "uml-class" && n.classMeta) {
        const headerLines = [n.classMeta.stereotype ? `&lt;&lt;${esc(n.classMeta.stereotype)}&gt;&gt;` : "", `${esc(n.label)}${n.classMeta.typeParameters?.length ? `&lt;${esc(n.classMeta.typeParameters.join(", "))}&gt;` : ""}`].filter(Boolean);
        const attrs = (n.classMeta.attributes ?? []).map(a => `${a.visibility ?? ""}${esc(a.name)}${a.type ? `: ${esc(a.type)}` : ""}${a.multiplicity ? ` [${esc(a.multiplicity)}]` : ""}${a.defaultValue !== undefined ? ` = ${esc(a.defaultValue)}` : ""}`);
        const ops = (n.classMeta.operations ?? []).map(o => `${o.visibility ?? ""}${esc(o.name)}(${(o.parameters ?? []).map(p => `${esc(p.name)}${p.type ? `: ${esc(p.type)}` : ""}`).join(", ")}): ${esc(o.returnType ?? "void")}`);
        const headerBottom = n.y + pad + 10 + headerLines.length * lineHeight;
        const attrBottom = headerBottom + (attrs.length ? 10 + attrs.length * lineHeight : 0);
        const sectionText = (values: string[], y: number, anchor: "middle" | "start", x: number) => values.map((value, i) => `<text x="${x}" y="${y + i * lineHeight}" text-anchor="${anchor}" font-family="Arial" font-size="${n.style?.fontSize ?? 14}" fill="${n.style?.text ?? defaults.text}">${value}</text>`).join("");
        renderedText = `${sectionText(headerLines, n.y + pad + 19, "middle", cx)}${attrs.length || ops.length ? `<line x1="${n.x + pad}" y1="${headerBottom}" x2="${n.x + pad + n.width}" y2="${headerBottom}" stroke="${stroke}"/>` : ""}${sectionText(attrs, headerBottom + 18, "start", n.x + pad + 10)}${ops.length ? `<line x1="${n.x + pad}" y1="${attrBottom}" x2="${n.x + pad + n.width}" y2="${attrBottom}" stroke="${stroke}"/>` : ""}${sectionText(ops, attrBottom + 18, "start", n.x + pad + 10)}`;
      } else if ((layout.diagram.type === "state" || layout.diagram.type === "state-machine") && n.stateBehavior) {
        const stateLines = lines.slice(1);
        const dividerY = n.y + pad + 34;
        renderedText = `<text x="${cx}" y="${n.y + pad + 22}" text-anchor="middle" font-family="Arial" font-size="${n.style?.fontSize ?? 14}" font-weight="bold" fill="${n.style?.text ?? defaults.text}">${esc(n.label)}</text><line x1="${n.x + pad}" y1="${dividerY}" x2="${n.x + pad + n.width}" y2="${dividerY}" stroke="${stroke}"/>${stateLines.map((line, i) => `<text x="${n.x + pad + 10}" y="${dividerY + 20 + i * lineHeight}" font-family="Arial" font-size="${n.style?.fontSize ?? 14}" fill="${n.style?.text ?? defaults.text}">${line}</text>`).join("")}`;
      }
      return `<g>${shape}${renderedText}</g>`;
    })
    .join("");
  const portShapes = layout.nodes
    .flatMap((n) =>
      (n.layoutPorts ?? []).map((p) => {
        const cx = p.x + pad + p.width / 2,
          cy = p.y + pad + p.height / 2;
        return p.kind === "required"
          ? `<path d="M${cx + 5} ${cy - 6}A8 8 0 0 0 ${cx + 5} ${cy + 6}" fill="none" stroke="#334155"/>`
          : `<circle cx="${cx}" cy="${cy}" r="5" fill="white" stroke="#334155"/>`;
      }),
    )
    .join("");
  const nodeCenters = new Map(layout.nodes.map((n) => [n.id, { x: n.x + n.width / 2, y: n.y + n.height / 2 }]));
  const edges = layout.edges
    .map((e) => {
      const s = e.sections?.[0];
      const from = s?.startPoint ?? nodeCenters.get(e.source);
      const to = s?.endPoint ?? nodeCenters.get(e.target);
      if (!from || !to) return "";
      // An edge the engine never routed still has to appear: omitting it would make the
      // preview claim a relationship does not exist. validateLayout reports EDGE_UNROUTED.
      const pts = [from, ...(s?.bendPoints ?? []), to];
      const d = pts
        .map((p, i) => `${i ? "L" : "M"} ${p.x + pad} ${p.y + pad}`)
        .join(" ");
      const placedLabel = e.labels?.[0],
        lx = placedLabel ? placedLabel.x + placedLabel.width / 2 + pad : (from.x + to.x) / 2 + pad,
        ly = placedLabel ? placedLabel.y + placedLabel.height - 3 + pad : (from.y + to.y) / 2 + pad - 5;
      const stroke = e.style?.stroke ?? "#000000";
      const text = e.style?.text ?? "#000000";
      const edgeLabel = e.label ?? (e.type === "include" ? "<<include>>" : e.type === "extend" ? "<<extend>>" : undefined);
      return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.5" ${markers(e.type, e.sourceMultiplicity, e.targetMultiplicity)} ${e.type === "dependency" || e.type === "realization" || e.type === "include" || e.type === "extend" ? 'stroke-dasharray="6 4"' : ""}/>${edgeLabel ? `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="Arial" font-size="${layout.diagram.layout?.edgeLabelFontSize ?? 12}" fill="${text}" paint-order="stroke" stroke="white" stroke-width="4" stroke-linejoin="round">${esc(edgeLabel)}</text>` : ""}`;
    })
    .join("");
  const artifacts = artifactBounds
    .map(
      (a) =>
        `<g><path d="M${a.x} ${a.y}h${a.width - 16}l16 16v${a.height - 16}h-${a.width}z" fill="#FFF7ED" stroke="#C2410C"/><text x="${a.x + a.width / 2}" y="${a.y + 28}" text-anchor="middle" font-family="Arial" font-size="12">${esc(a.label)}</text></g>`,
    )
    .join("");
  const legendSvg = legend
    ? `<g><rect x="${layout.width + pad + 35}" y="${pad}" width="220" height="238" rx="5" fill="white" stroke="#94A3B8"/><text x="${layout.width + pad + 50}" y="${pad + 26}" font-family="Arial" font-size="15" font-weight="bold">Legend</text>${["Actor / User", "Service", "Gateway", "Cache", "Database", "External System"].map((x, i) => `<rect x="${layout.width + pad + 50}" y="${pad + 42 + i * 31}" width="24" height="18" rx="3" fill="${defaults.fill}" stroke="${defaults.stroke}"/><text x="${layout.width + pad + 84}" y="${pad + 56 + i * 31}" font-family="Arial" font-size="11">${x}</text>`).join("")}</g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L10,3 L0,6 z" fill="#000000"/></marker><marker id="triangle" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M0,0 L12,6 L0,12 z" fill="white" stroke="#000000"/></marker><marker id="diamondFilled" markerWidth="14" markerHeight="14" refX="7" refY="7" orient="auto"><path d="M0,7 L7,0 L14,7 L7,14 z" fill="#000000"/></marker><marker id="diamondOpen" markerWidth="14" markerHeight="14" refX="7" refY="7" orient="auto"><path d="M0,7 L7,0 L14,7 L7,14 z" fill="white" stroke="#000000"/></marker><marker id="erOne" markerWidth="12" markerHeight="14" refX="2" refY="7" orient="auto"><path d="M2,1V13 M6,1V13" stroke="#000"/></marker><marker id="erMany" markerWidth="14" markerHeight="14" refX="2" refY="7" orient="auto"><path d="M2,7L12,1 M2,7L12,7 M2,7L12,13" stroke="#000" fill="none"/></marker><marker id="erZeroOne" markerWidth="18" markerHeight="14" refX="2" refY="7" orient="auto"><circle cx="5" cy="7" r="3" fill="white" stroke="#000"/><path d="M11,1V13" stroke="#000"/></marker><marker id="erZeroMany" markerWidth="20" markerHeight="14" refX="2" refY="7" orient="auto"><circle cx="4" cy="7" r="3" fill="white" stroke="#000"/><path d="M9,7L19,1 M9,7L19,7 M9,7L19,13" stroke="#000" fill="none"/></marker><marker id="erOneMany" markerWidth="20" markerHeight="14" refX="2" refY="7" orient="auto"><path d="M3,1V13 M8,7L18,1 M8,7L18,7 M8,7L18,13" stroke="#000" fill="none"/></marker></defs><rect width="100%" height="100%" fill="${defaults.background}"/><text x="${pad}" y="32" font-family="Arial" font-size="20" font-weight="bold" fill="${defaults.text}">${esc(layout.diagram.title)}</text>${containerShapes}${edges}${nodes}${portShapes}${artifacts}${legendSvg}</svg>`;
}

function renderSequenceSvg(layout: LayoutResult): string {
  const pad = 80,
    headerY = 70,
    gap = 70,
    modelOrder = new Map(
      layout.diagram.nodes.map((node, index) => [node.id, index]),
    ),
    ordered = [...layout.nodes].sort(
      (a, b) => (modelOrder.get(a.id) ?? 0) - (modelOrder.get(b.id) ?? 0),
    ),
    width = Math.max(
      500,
      pad * 2 + Math.max(0, ordered.length - 1) * 260 + 180,
    ),
    height = Math.max(420, 210 + layout.edges.length * gap);
  const xs = new Map(ordered.map((n, i) => [n.id, pad + i * 260]));
  const participants = ordered
    .map((n) => {
      const x = xs.get(n.id)!;
      const cx = x + 90;
      return `<rect x="${x}" y="${headerY}" width="180" height="50" fill="#FFFFFF" stroke="#000000"/><text x="${cx}" y="${headerY + 30}" text-anchor="middle" font-family="Arial" font-size="14" fill="#000000">${labelLines(n.label)[0] ?? ""}</text><line x1="${cx}" y1="${headerY + 50}" x2="${cx}" y2="${height - 50}" stroke="#000000" stroke-dasharray="6 4"/>`;
    })
    .join("");
  const messages = layout.edges
    .map((e, i) => {
      const sx = (xs.get(e.source) ?? pad) + 90,
        tx = (xs.get(e.target) ?? pad) + 90,
        y = 170 + i * gap,
        dashed = e.messageKind === "return" || sx > tx;
      return `<line x1="${sx}" y1="${y}" x2="${tx}" y2="${y}" stroke="#000000" marker-end="url(#arrow)" ${dashed ? 'stroke-dasharray="6 4"' : ""}/><text x="${(sx + tx) / 2}" y="${y - 8}" text-anchor="middle" font-family="Arial" font-size="12" fill="#000000">${i + 1}. ${esc(e.label ?? "message")}</text>`;
    })
    .join("");
  const activations = (layout.diagram.sequence?.activations ?? [])
    .map((a) => {
      const start = layout.edges.findIndex((e) => e.id === a.startMessageId),
        end = a.endMessageId
          ? layout.edges.findIndex((e) => e.id === a.endMessageId)
          : start,
        x = (xs.get(a.participantId) ?? pad) + 82,
        y = 165 + Math.max(0, start) * gap,
        h = Math.max(34, (Math.max(start, end) - start + 1) * gap);
      return `<rect x="${x}" y="${y}" width="16" height="${h}" fill="#CBD5E1" stroke="#334155"/>`;
    })
    .join("");
  const fragments = (layout.diagram.sequence?.fragments ?? [])
    .map((f) => {
      const indices = f.messageIds
        .map((id) => layout.edges.findIndex((e) => e.id === id))
        .filter((i) => i >= 0);
      if (!indices.length) return "";
      const y = 145 + Math.min(...indices) * gap,
        h = (Math.max(...indices) - Math.min(...indices) + 1) * gap + 45;
      return `<g><rect x="${pad - 20}" y="${y}" width="${width - 2 * pad + 40}" height="${h}" fill="none" stroke="#64748B" stroke-dasharray="6 4"/><path d="M${pad - 20} ${y + 24}h120l12-12v-12" fill="none" stroke="#64748B"/><text x="${pad - 12}" y="${y + 18}" font-family="Arial" font-size="12" font-weight="bold">${esc(f.operator.toUpperCase())}${f.guard ? ` [${esc(f.guard)}]` : ""}</text></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L10,3 L0,6 z" fill="#000000"/></marker></defs><rect width="100%" height="100%" fill="white"/><text x="${pad}" y="32" font-family="Arial" font-size="20" font-weight="bold" fill="#000000">${esc(layout.diagram.title)}</text>${fragments}${participants}${messages}${activations}</svg>`;
}
