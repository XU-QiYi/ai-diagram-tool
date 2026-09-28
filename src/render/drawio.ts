import type {
  LayoutResult,
  LayoutNode,
  LayoutContainer,
  RelationshipType,
} from "../model/types.js";
import { ALLOWED_SHAPES } from "../model/index.js";
import { keyMarker } from "../utils/text.js";

/**
 * The model layer accepts `style.shape` as either `cylinder` or `shape=cylinder`, but
 * Draw.io honors only the prefixed form — a bare legal name used to draw a plain
 * rectangle with no signal at all. Normalize so every legal value draws as itself.
 */
export function honorShapeFragment(shape: string | undefined): string | undefined {
  if (!shape) return undefined;
  const head = shape.split(';')[0] ?? '';
  if (head.startsWith('shape=') || head.startsWith('rounded=')) return shape;
  return ALLOWED_SHAPES.has(head) ? `shape=${head}${shape.slice(head.length)}` : shape;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
// Draw.io stores HTML labels inside XML attributes, so the <br> tag itself must be escaped.
const labelHtml = (s: string) =>
  s
    .split(/\\n|\r?\n/)
    .map(esc)
    .join("&lt;br&gt;");
function nodeLabel(n: LayoutNode, type: string) {
  if (type === "chen-er" && n.kind === "key-attribute") return `&lt;u&gt;${esc(n.label)}&lt;/u&gt;`;
  if ((type === "state" || type === "state-machine") && n.stateBehavior) {
    const rows = [
      n.stateBehavior.entry ? `entry / ${esc(n.stateBehavior.entry)}` : "",
      n.stateBehavior.do ? `do / ${esc(n.stateBehavior.do)}` : "",
      n.stateBehavior.exit ? `exit / ${esc(n.stateBehavior.exit)}` : "",
    ].filter(Boolean).join("&lt;br&gt;");
    return `&lt;div style=&quot;text-align:center;font-weight:bold;padding:7px 8px 8px&quot;&gt;${esc(n.label)}&lt;/div&gt;${rows ? `&lt;div style=&quot;border-top:1px solid #64748B;text-align:left;padding:7px 10px&quot;&gt;${rows}&lt;/div&gt;` : ""}`;
  }
  if (type !== "uml-class" || !n.classMeta) return labelHtml(n.label);
  const m = n.classMeta;

  // 属性渲染 - 添加静态下划线
  const attrs = (m.attributes ?? [])
    .map((a) => {
      const vis = a.visibility ?? "";
      const name = a.isStatic
        ? `&lt;u&gt;${esc(a.name)}&lt;/u&gt;`
        : esc(a.name);
      const type = a.type ? `: ${esc(a.type)}` : "";
      const mult = a.multiplicity ? ` [${esc(a.multiplicity)}]` : "";
      const defaultValue =
        a.defaultValue !== undefined ? ` = ${esc(a.defaultValue)}` : "";
      return `${keyMarker(a.key)}${vis}${name}${type}${mult}${defaultValue}`;
    })
    .join("&lt;br&gt;");

  // 方法渲染 - 添加抽象斜体和静态下划线
  const ops = (m.operations ?? [])
    .map((o) => {
      const vis = o.visibility ?? "";
      const params = (o.parameters ?? [])
        .map((p) => `${esc(p.name)}: ${esc(p.type ?? "")}`)
        .join(", ");
      let methodName = esc(o.name);

      // 静态方法用下划线
      if (o.isStatic) {
        methodName = `&lt;u&gt;${methodName}&lt;/u&gt;`;
      }
      // 抽象方法用斜体
      if (o.isAbstract) {
        methodName = `&lt;i&gt;${methodName}&lt;/i&gt;`;
      }

      return `${vis}${methodName}(${params}): ${esc(o.returnType ?? "void")}`;
    })
    .join("&lt;br&gt;");

  // Stereotype 处理
  const stereotype = m.stereotype
    ? `&lt;&lt;${esc(m.stereotype)}&gt;&gt;&lt;br&gt;`
    : "";

  // 类名 - 如果是抽象类或接口则斜体
  const className =
    m.stereotype === "interface" || m.stereotype === "abstract"
      ? `&lt;i&gt;${esc(n.label)}&lt;/i&gt;`
      : esc(n.label);

  const typeParams = m.typeParameters?.length
    ? `&lt;${esc(m.typeParameters.join(", "))}&gt;`
    : "";

  const header = `&lt;div style=&quot;text-align:center;padding:7px 8px 8px;line-height:1.35&quot;&gt;${stereotype}${className}${typeParams}&lt;/div&gt;`;
  const attributeBlock = attrs ? `&lt;div style=&quot;border-top:1px solid #64748B;text-align:left;padding:7px 10px;line-height:1.35&quot;&gt;${attrs}&lt;/div&gt;` : "";
  const operationBlock = ops ? `&lt;div style=&quot;border-top:1px solid #64748B;text-align:left;padding:7px 10px;line-height:1.35&quot;&gt;${ops}&lt;/div&gt;` : "";
  return `${header}${attributeBlock}${operationBlock}`;
}
function erMarker(multiplicity: string | undefined, fallback: string) {
  if (multiplicity === "0..1") return "ERzeroToOne";
  if (multiplicity === "1" || multiplicity === "1..1") return "ERone";
  if (
    multiplicity === "0..*" ||
    multiplicity === "0..n" ||
    multiplicity === "0..N"
  )
    return "ERzeroToMany";
  if (
    multiplicity === "1..*" ||
    multiplicity === "1..n" ||
    multiplicity === "1..N"
  )
    return "ERoneToMany";
  if (multiplicity === "*" || multiplicity === "many") return "ERmany";
  return fallback;
}
function edgeStyle(
  type?: RelationshipType,
  sourceMultiplicity?: string,
  targetMultiplicity?: string,
) {
  const base =
    "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;fontColor=#000000;";
  if (type === "inheritance") return base + "endArrow=block;endFill=0;";
  if (type === "generalization") return base + "endArrow=block;endFill=0;"; // Actor泛化（用例图）
  if (type === "dependency") return base + "dashed=1;endArrow=open;endFill=0;";
  if (type === "realization")
    return base + "dashed=1;endArrow=block;endFill=0;";
  if (type === "include" || type === "extend")
    return base + "dashed=1;endArrow=open;endFill=0;";
  if (type === "composition")
    return base + "startArrow=diamond;startFill=1;endArrow=none;";
  if (type === "aggregation")
    return base + "startArrow=diamond;startFill=0;endArrow=none;";
  if (type === "foreign-key")
    return (
      base +
      `startArrow=${erMarker(sourceMultiplicity, "ERone")};startFill=0;endArrow=${erMarker(targetMultiplicity, "ERmany")};endFill=0;`
    );
  if (type === "object-flow") return base + "endArrow=block;";
  if (type === "communication-path") return base + "endArrow=none;";
  if (type === "association") return base + "endArrow=none;";
  return base + "endArrow=block;";
}
function themeDefaults(name?: string) {
  if (name === "monochrome")
    return {
      fill: "#FFFFFF",
      stroke: "#334155",
      text: "#0F172A",
      container: "#F8FAFC",
    };
  if (name === "blueprint")
    return {
      fill: "#EAF2FF",
      stroke: "#315C9B",
      text: "#17345F",
      container: "#F4F8FF",
    };
  return {
    fill: "#F5F7FA",
    stroke: "#64748B",
    text: "#1E293B",
    container: "#FFFFFF",
  };
}
function nodeStyle(
  n: LayoutNode,
  type: string,
  themeName?: string,
  weakEntity = false,
) {
  // 状态图初始状态特殊处理 - 实心小圆点
  if (n.kind === "start" && (type === "state" || type === "state-machine")) {
    return "ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#1E293B;strokeColor=#1E293B;";
  }

  // 状态图终止状态特殊处理 - 双圆圈
  if (n.kind === "end" && (type === "state" || type === "state-machine" || type === "activity")) {
    return "shape=doubleEllipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#FFFFFF;strokeColor=#1E293B;strokeWidth=2;fontColor=#1E293B;";
  }
  if ((n.kind === "fork" || n.kind === "join") && type === "activity")
    return "shape=rectangle;whiteSpace=wrap;html=1;fillColor=#1E293B;strokeColor=#1E293B;rounded=0;";

  const theme = n.style ?? {},
    defaults = themeDefaults(themeName);
  const useRoles = themeName !== "monochrome" && themeName !== "blueprint";
  const fill =
    theme.fill ??
    (n.kind === "start"
      ? "#1E293B"
      : n.kind === "end"
        ? "#1E293B"
        : useRoles && n.kind === "database"
          ? "#E8F1FF"
          : useRoles && n.kind === "external"
            ? "#FFF4E5"
            : useRoles && n.kind === "cache"
              ? "#F0FDF4"
              : useRoles && n.kind === "queue"
                ? "#FAF5FF"
                : useRoles && n.kind === "gateway"
                  ? "#EFF6FF"
                  : defaults.fill);
  const stroke =
    theme.stroke ??
    (useRoles && n.kind === "database"
      ? "#3B82F6"
      : useRoles && n.kind === "external"
        ? "#F59E0B"
        : useRoles && n.kind === "cache"
          ? "#16A34A"
          : useRoles && n.kind === "queue"
            ? "#9333EA"
            : useRoles && n.kind === "gateway"
              ? "#2563EB"
              : defaults.stroke);
  const shape =
    honorShapeFragment(n.style?.shape) ??
    (weakEntity
      ? "shape=rectangle;double=1"
      : n.kind === "database"
        ? "shape=cylinder"
        : type === "chen-er" && (n.kind === "entity" || n.kind === "weak-entity")
          ? n.kind === "weak-entity" ? "shape=rectangle;rounded=0;double=1" : "shape=rectangle;rounded=0"
          : type === "chen-er" && n.kind === "multivalued-attribute"
            ? "shape=doubleEllipse"
            : type === "chen-er" && n.kind === "derived-attribute"
              ? "ellipse;dashed=1"
            : type === "chen-er" && (n.kind === "attribute" || n.kind === "key-attribute")
              ? "ellipse"
            : type === "chen-er" && (n.kind === "relationship" || n.kind === "identifying-relationship")
              ? n.kind === "identifying-relationship" ? "rhombus;double=1" : "rhombus"
        : n.kind === "actor"
          ? "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;labelPosition=center;align=center;spacingTop=8"
          : n.kind === "usecase" || type === "uml-usecase"
            ? "ellipse"
            : type === "uml-class"
              ? "shape=rectangle;rounded=0;verticalAlign=top;align=left;overflow=fill;spacing=0"
              : type === "uml-component"
                ? "shape=component"
                : n.kind === "decision" || n.kind === "merge"
                  ? "rhombus"
                  : n.kind === "object" && type === "activity"
                    ? "shape=rectangle"
                    : n.kind === "start"
                      ? "ellipse"
                      : n.kind === "end"
                        ? "ellipse"
                        : n.kind === "device" || type === "deployment"
                          ? "shape=cube"
                          : n.kind === "milestone"
                            ? "ellipse"
                            : "rounded=1");
  const extra =
    type === "uml-class"
      ? "fontStyle=0;"
      : type === "uml-usecase"
        ? "fontStyle=0;"
      : type === "state" || type === "state-machine"
          ? "arcSize=20;"
          : type === "mindmap" && n.kind === "root"
            ? "fontStyle=1;strokeWidth=2;"
            : "";
  const text =
    theme.text ??
    (n.kind === "start" || n.kind === "end" ? "#FFFFFF" : defaults.text);
  return `whiteSpace=wrap;html=1;${shape};${extra}fillColor=${fill};strokeColor=${stroke};fontColor=${text};fontSize=${theme.fontSize ?? 14};strokeWidth=${theme.strokeWidth ?? 1};spacing=8;${n.style?.dashed ? "dashed=1;" : ""}`;
}
export function renderDrawio(layout: LayoutResult): string {
  if (layout.diagram.type === "sequence") return renderSequenceDrawio(layout);
  const pad = 80;
  const containers = layout.containers;
  const defaults = themeDefaults(layout.diagram.theme?.name);
  const minX = Math.min(0, ...layout.nodes.map((n) => n.x)),
    minY = Math.min(0, ...layout.nodes.map((n) => n.y));
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const bounds = new Map(containers.map((c) => [c.id, c]));
  const parentOf = (c: LayoutContainer) =>
    c.parentId ?? containers.find((p) => p.containerIds?.includes(c.id))?.id;
  for (const c of [...containers].sort((a, b) => a.depth - b.depth)) {
    const parentId = parentOf(c);
    const parent = parentId ? bounds.get(parentId) : undefined;
    const x = parent ? c.x - parent.x : c.x - minX + pad,
      y = parent ? c.y - parent.y : c.y - minY + pad;
    const fill = c.style?.fill ?? defaults.container;
    const stroke = c.style?.stroke ?? defaults.stroke;
    const text = c.style?.text ?? defaults.text;
    cells.push(
      `<mxCell id="${esc(c.id)}" value="${labelHtml(c.label)}" style="swimlane;html=1;horizontal=1;startSize=30;fillColor=${fill};strokeColor=${stroke};fontColor=${text};fontStyle=1;collapsible=0;" vertex="1" parent="${esc(parentId ?? "1")}"><mxGeometry x="${x}" y="${y}" width="${c.width}" height="${c.height}" as="geometry"/></mxCell>`,
    );
  }
  for (const n of layout.nodes) {
    const containerId =
      n.containerId ?? containers.find((c) => c.nodeIds.includes(n.id))?.id;
    const container = containerId ? bounds.get(containerId) : undefined;
    const parent = container ? containerId! : "1";
    const x = container ? n.x - container.x : n.x - minX + pad;
    const y = container ? n.y - container.y : n.y - minY + pad;
    const pseudo =
      (layout.diagram.type === "state" || layout.diagram.type === "state-machine" || layout.diagram.type === "activity") &&
      (n.kind === "start" || n.kind === "end");
    const weak =
      layout.diagram.er?.entities?.some((e) => e.nodeId === n.id && e.weak) ??
      false;
    cells.push(
      `<mxCell id="${esc(n.id)}" value="${pseudo ? "" : nodeLabel(n, layout.diagram.type)}" style="${nodeStyle(n, layout.diagram.type, layout.diagram.theme?.name, weak)}" vertex="1" parent="${esc(parent)}"><mxGeometry x="${x}" y="${y}" width="${n.width}" height="${n.height}" as="geometry"/></mxCell>`,
    );
    for (const p of n.layoutPorts ?? []) {
      const rx = Math.max(0, Math.min(1, (p.x - n.x + p.width / 2) / n.width));
      const ry = Math.max(
        0,
        Math.min(1, (p.y - n.y + p.height / 2) / n.height),
      );
      const portShape =
        p.kind === "required"
          ? "shape=arc;startAngle=90;endAngle=270;fillColor=none"
          : p.kind === "provided"
            ? "ellipse;fillColor=#FFFFFF"
            : "ellipse;fillColor=#FFFFFF";
      cells.push(
        `<mxCell id="${esc(p.id)}" value="${labelHtml(p.label ?? "")}" style="${portShape};html=1;resizable=0;movable=0;strokeColor=#475569;" vertex="1" parent="${esc(n.id)}"><mxGeometry x="${rx}" y="${ry}" width="${p.width}" height="${p.height}" relative="1" as="geometry"><mxPoint x="${-p.width / 2}" y="${-p.height / 2}" as="offset"/></mxGeometry></mxCell>`,
      );
    }
  }
  for (const e of layout.edges) {
    const semanticLabel = e.label ?? (e.type === "include" ? "<<include>>" : e.type === "extend" ? "<<extend>>" : undefined);
    const label = semanticLabel ? ` value="${labelHtml(semanticLabel)}"` : "";
    const edgeText = e.style?.text ?? "#000000";
    const edgeStroke = e.style?.stroke ?? "#000000";
    const s = e.sections?.[0];
    let geometry = '<mxGeometry relative="1" as="geometry"/>';
    if (s) {
      const point = (p: { x: number; y: number }, as?: string) =>
        `<mxPoint x="${Math.round(p.x - minX + pad)}" y="${Math.round(p.y - minY + pad)}"${as ? ` as="${as}"` : ""}/>`;
      const bends = (s.bendPoints ?? []).map((p) => point(p)).join("");
      geometry = `<mxGeometry relative="1" as="geometry">${bends ? `<Array as="points">${bends}</Array>` : ""}${point(s.startPoint, "sourcePoint")}${point(s.endPoint, "targetPoint")}</mxGeometry>`;
    }
    const suffix = [e.guard, e.action].filter(Boolean).join(" / ");
    const renderedLabel = [
      semanticLabel,
      suffix && !semanticLabel?.includes(suffix) ? suffix : "",
    ]
      .filter(Boolean)
      .join("  ");
    const rendered = renderedLabel
      ? ` value="${labelHtml(renderedLabel)}"`
      : label;
    const identifying = layout.diagram.er?.entities?.find(
      (x) => x.nodeId === e.target,
    )?.identifying;
    const erStyle = identifying ? "dashed=0;strokeWidth=2;" : "";
    cells.push(
      `<mxCell id="${esc(e.id)}"${rendered} style="${edgeStyle(e.type, e.sourceMultiplicity, e.targetMultiplicity)}${erStyle}strokeColor=${edgeStroke};fontColor=${edgeText};" edge="1" parent="1" source="${esc(e.sourcePort ?? e.source)}" target="${esc(e.targetPort ?? e.target)}">${geometry}</mxCell>`,
    );
    if (e.sourceMultiplicity)
      cells.push(
        `<mxCell id="${esc(e.id)}.sourceMultiplicity" value="${esc(e.sourceMultiplicity)}" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];" vertex="1" connectable="0" parent="${esc(e.id)}"><mxGeometry x="-0.82" y="-1" relative="1" as="geometry"/></mxCell>`,
      );
    if (e.targetMultiplicity)
      cells.push(
        `<mxCell id="${esc(e.id)}.targetMultiplicity" value="${esc(e.targetMultiplicity)}" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];" vertex="1" connectable="0" parent="${esc(e.id)}"><mxGeometry x="0.82" y="-1" relative="1" as="geometry"/></mxCell>`,
      );
  }
  let extraMaxX = layout.width + pad,
    extraMaxY = layout.height + pad;
  if (layout.diagram.type === "deployment")
    for (const a of layout.diagram.deployment?.artifacts ?? []) {
      const host = layout.nodes.find((n) => n.id === a.deployedOn);
      if (host) {
        const x = host.x - minX + pad + host.width - 35,
          y = host.y - minY + pad + host.height + 20,
          width = 120,
          height = 45;
        cells.push(
          `<mxCell id="${esc(a.id)}" value="${labelHtml(a.label)}" style="shape=note;whiteSpace=wrap;html=1;fillColor=#FFF7ED;strokeColor=#C2410C;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/></mxCell>`,
        );
        extraMaxX = Math.max(extraMaxX, x + width);
        extraMaxY = Math.max(extraMaxY, y + height);
      }
    }
  if (layout.diagram.theme?.showLegend) {
    const entries = [
      ["Actor / User", "shape=umlActor"],
      ["Service", "rounded=1"],
      ["Gateway", "rounded=1;fillColor=#EFF6FF;strokeColor=#2563EB"],
      ["Cache", "rounded=1;fillColor=#F0FDF4;strokeColor=#16A34A"],
      ["Database", "shape=cylinder;fillColor=#E8F1FF;strokeColor=#3B82F6"],
      ["External System", "rounded=1;fillColor=#FFF4E5;strokeColor=#F59E0B"],
    ];
    const lx = layout.width - minX + pad + 40,
      ly = pad,
      lw = 210,
      lh = 42 + entries.length * 34;
    cells.push(
      `<mxCell id="legend" value="Legend" style="swimlane;html=1;horizontal=1;startSize=32;fillColor=#FFFFFF;strokeColor=#94A3B8;fontStyle=1;collapsible=0;" vertex="1" parent="1"><mxGeometry x="${lx}" y="${ly}" width="${lw}" height="${lh}" as="geometry"/></mxCell>`,
    );
    entries.forEach(([label, style], i) =>
      cells.push(
        `<mxCell id="legend.item.${i + 1}" value="${label}" style="${style};whiteSpace=wrap;html=1;fontSize=11;" vertex="1" parent="legend"><mxGeometry x="15" y="${42 + i * 34}" width="180" height="24" as="geometry"/></mxCell>`,
      ),
    );
    extraMaxX = Math.max(extraMaxX, lx + lw);
    extraMaxY = Math.max(extraMaxY, ly + lh);
  }
  const width = Math.ceil(Math.max(layout.width + pad * 2, extraMaxX + pad)),
    height = Math.ceil(Math.max(layout.height + pad * 2, extraMaxY + pad));
  return `<?xml version="1.0" encoding="UTF-8"?><mxfile host="app.diagrams.net"><diagram id="${esc(layout.diagram.id)}" name="${esc(layout.diagram.title)}"><mxGraphModel dx="${width}" dy="${height}" grid="1" gridSize="10" page="1" pageWidth="${width}" pageHeight="${height}"><root>${cells.join("")}</root></mxGraphModel></diagram></mxfile>`;
}

function renderSequenceDrawio(layout: LayoutResult): string {
  const pad = 80,
    headerY = 70,
    headerH = 50,
    messageGap = 70;
  const modelOrder = new Map(
    layout.diagram.nodes.map((node, index) => [node.id, index]),
  );
  const ordered = [...layout.nodes].sort(
    (a, b) => (modelOrder.get(a.id) ?? 0) - (modelOrder.get(b.id) ?? 0),
  );
  const xs = new Map(ordered.map((n, i) => [n.id, pad + i * 260]));
  const height = Math.max(420, 210 + layout.edges.length * messageGap),
    width = Math.max(
      500,
      pad * 2 + Math.max(0, ordered.length - 1) * 260 + 180,
    );
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  for (const n of ordered) {
    const x = xs.get(n.id)!;
    cells.push(
      `<mxCell id="${esc(n.id)}" value="${labelHtml(n.label)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#000000;fontColor=#000000;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="${headerY}" width="180" height="${headerH}" as="geometry"/></mxCell>`,
    );
    const cx = x + 90;
    cells.push(
      `<mxCell id="${esc(n.id)}.lifeline" style="edgeStyle=none;dashed=1;endArrow=none;strokeColor=#000000;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${cx}" y="${headerY + headerH}" as="sourcePoint"/><mxPoint x="${cx}" y="${height - 60}" as="targetPoint"/></mxGeometry></mxCell>`,
    );
  }

  layout.edges.forEach((e, i) => {
    const sx = (xs.get(e.source) ?? pad) + 90,
      tx = (xs.get(e.target) ?? pad) + 90,
      y = 170 + i * messageGap;
    const reverse = sx > tx;

    // 根据消息类型确定样式
    let style = "edgeStyle=none;html=1;rounded=0;fontColor=#000000;";

    if (e.messageKind === "return" || reverse) {
      // 返回消息 - 虚线 + 开放箭头
      style += "dashed=1;endArrow=open;endFill=0;strokeColor=#000000;";
    } else if (e.messageKind === "create") {
      // 创建消息 - 虚线 + 开放箭头 + 绿色
      style += "dashed=1;endArrow=open;endFill=0;strokeColor=#000000;";
    } else if (e.messageKind === "destroy") {
      // 销毁消息 - 叉号 + 红色
      style += "endArrow=cross;strokeColor=#000000;strokeWidth=2;";
    } else if (e.isAsync) {
      // 异步消息 - 开放箭头
      style += "endArrow=open;endFill=0;strokeColor=#000000;";
    } else {
      // 同步消息 - 实心箭头（默认）
      style += "endArrow=block;endFill=1;strokeColor=#000000;";
    }

    const numberedLabel = `${i + 1}. ${e.label ?? "message"}`;
    cells.push(
      `<mxCell id="${esc(e.id)}" value="${labelHtml(numberedLabel)}" style="${style}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${sx}" y="${y}" as="sourcePoint"/><mxPoint x="${tx}" y="${y}" as="targetPoint"/></mxGeometry></mxCell>`,
    );
  });

  for (const activation of layout.diagram.sequence?.activations ?? []) {
    const start = layout.edges.findIndex(
      (e) => e.id === activation.startMessageId,
    );
    const end = activation.endMessageId
      ? layout.edges.findIndex((e) => e.id === activation.endMessageId)
      : start;
    const x = (xs.get(activation.participantId) ?? pad) + 82,
      y = 165 + Math.max(0, start) * messageGap,
      h = Math.max(34, (end - start + 1) * messageGap);
    cells.push(
      `<mxCell id="${esc(activation.id)}" value="${labelHtml(activation.label ?? "")}" style="rounded=0;fillColor=#CBD5E1;strokeColor=#334155;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="16" height="${h}" as="geometry"/></mxCell>`,
    );
  }
  for (const fragment of layout.diagram.sequence?.fragments ?? []) {
    const indices = fragment.messageIds
      .map((id) => layout.edges.findIndex((e) => e.id === id))
      .filter((i) => i >= 0);
    if (!indices.length) continue;
    const y = 145 + Math.min(...indices) * messageGap,
      h = (Math.max(...indices) - Math.min(...indices) + 1) * messageGap + 45;
    const fragmentWidth = Math.max(
      500,
      pad * 2 + Math.max(0, ordered.length - 1) * 260 + 180,
    );
    cells.push(
      `<mxCell id="${esc(fragment.id)}" value="${esc(fragment.operator.toUpperCase())}${fragment.guard ? ` [${esc(fragment.guard)}]` : ""}" style="dashed=1;fillColor=none;strokeColor=#64748B;verticalAlign=top;align=left;spacingTop=4;" vertex="1" parent="1"><mxGeometry x="${pad - 20}" y="${y}" width="${fragmentWidth - 2 * pad + 40}" height="${h}" as="geometry"/></mxCell>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?><mxfile host="app.diagrams.net"><diagram id="${esc(layout.diagram.id)}" name="${esc(layout.diagram.title)}"><mxGraphModel dx="${width}" dy="${height}" grid="1" gridSize="10" page="1" pageWidth="${width}" pageHeight="${height}"><root>${cells.join("")}</root></mxGraphModel></diagram></mxfile>`;
}
