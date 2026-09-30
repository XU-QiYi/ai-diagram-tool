import { createDiagram } from "../model/index.js";
import type { Diagram, Node } from "../model/types.js";

export type ArchitecturePreset =
  "layered" | "microservices" | "event-driven" | "cloud" | "deployment";

const ports = (id: string) => [
  { id: `${id}.in`, side: "WEST" as const },
  { id: `${id}.out`, side: "EAST" as const },
];
const node = (id: string, label: string, kind: string): Node => ({
  id,
  label,
  kind,
  ports: ports(id),
});

export function layeredArchitecture(
  title = "Layered Software Architecture",
): Diagram {
  return createDiagram({
    id: "architecture-layered",
    title,
    type: "system-architecture",
    direction: "LEFT_TO_RIGHT",
    routing: "ORTHOGONAL",
    theme: { name: "professional", showLegend: true },
    nodes: [
      { id: "node.user", label: "User", kind: "actor" },
      node("node.web", "Web Client", "frontend"),
      node("node.gateway", "API Gateway", "gateway"),
      node("node.service", "Application Service", "service"),
      node("node.repository", "Repository", "service"),
      node("node.cache", "Redis Cache", "cache"),
      node("node.database", "Primary Database", "database"),
      {
        id: "node.external",
        label: "External Service",
        kind: "external",
        ports: [{ id: "node.external.in", side: "WEST" }],
      },
    ],
    edges: [
      {
        id: "edge.user-web",
        source: "node.user",
        target: "node.web",
        targetPort: "node.web.in",
        label: "HTTPS",
        type: "uses",
      },
      {
        id: "edge.web-gateway",
        source: "node.web",
        sourcePort: "node.web.out",
        target: "node.gateway",
        targetPort: "node.gateway.in",
        type: "flow",
      },
      {
        id: "edge.gateway-service",
        source: "node.gateway",
        sourcePort: "node.gateway.out",
        target: "node.service",
        targetPort: "node.service.in",
        type: "flow",
      },
      {
        id: "edge.service-repository",
        source: "node.service",
        sourcePort: "node.service.out",
        target: "node.repository",
        targetPort: "node.repository.in",
        type: "uses",
      },
      {
        id: "edge.service-cache",
        source: "node.service",
        target: "node.cache",
        type: "uses",
      },
      {
        id: "edge.repository-database",
        source: "node.repository",
        sourcePort: "node.repository.out",
        target: "node.database",
        targetPort: "node.database.in",
        type: "uses",
      },
      {
        id: "edge.service-external",
        source: "node.service",
        target: "node.external",
        targetPort: "node.external.in",
        label: "REST",
        type: "dependency",
      },
    ],
    containers: [
      {
        id: "container.platform",
        label: "System Boundary",
        nodeIds: [],
        containerIds: [
          "container.presentation",
          "container.backend",
          "container.data",
        ],
        direction: "LEFT_TO_RIGHT",
        padding: 38,
      },
      {
        id: "container.presentation",
        label: "Presentation Layer",
        parentId: "container.platform",
        nodeIds: ["node.web"],
        direction: "TOP_TO_BOTTOM",
      },
      {
        id: "container.backend",
        label: "Application Layer",
        parentId: "container.platform",
        nodeIds: ["node.gateway", "node.service", "node.repository"],
        direction: "LEFT_TO_RIGHT",
      },
      {
        id: "container.data",
        label: "Data Layer",
        parentId: "container.platform",
        nodeIds: ["node.cache", "node.database"],
        direction: "TOP_TO_BOTTOM",
      },
    ],
    constraints: {
      placement: { "node.user": "FIRST", "node.external": "LAST" },
    },
  });
}

export function microservicesArchitecture(
  title = "Microservices Architecture",
): Diagram {
  return createDiagram({
    id: "architecture-microservices",
    title,
    type: "system-architecture",
    direction: "LEFT_TO_RIGHT",
    routing: "ORTHOGONAL",
    theme: { name: "professional", showLegend: true },
    nodes: [
      node("node.client", "Client", "frontend"),
      node("node.gateway", "API Gateway", "gateway"),
      node("node.identity", "Identity Service", "service"),
      node("node.order", "Order Service", "service"),
      node("node.payment", "Payment Service", "service"),
      node("node.bus", "Event Bus", "queue"),
      node("node.redis", "Redis", "cache"),
      node("node.order-db", "Order Database", "database"),
      {
        id: "node.payment-provider",
        label: "Payment Provider",
        kind: "external",
      },
    ],
    edges: [
      {
        id: "edge.client-gateway",
        source: "node.client",
        target: "node.gateway",
        type: "flow",
      },
      {
        id: "edge.gateway-identity",
        source: "node.gateway",
        target: "node.identity",
        type: "uses",
      },
      {
        id: "edge.gateway-order",
        source: "node.gateway",
        target: "node.order",
        type: "uses",
      },
      {
        id: "edge.order-payment",
        source: "node.order",
        target: "node.payment",
        type: "dependency",
      },
      {
        id: "edge.order-bus",
        source: "node.order",
        target: "node.bus",
        label: "OrderCreated",
        type: "flow",
      },
      {
        id: "edge.payment-bus",
        source: "node.bus",
        target: "node.payment",
        label: "event",
        type: "flow",
      },
      {
        id: "edge.order-cache",
        source: "node.order",
        target: "node.redis",
        type: "uses",
      },
      {
        id: "edge.order-db",
        source: "node.order",
        target: "node.order-db",
        type: "uses",
      },
      {
        id: "edge.payment-provider",
        source: "node.payment",
        target: "node.payment-provider",
        type: "dependency",
      },
    ],
    containers: [
      {
        id: "container.edge",
        label: "Edge",
        nodeIds: ["node.gateway"],
        direction: "TOP_TO_BOTTOM",
      },
      {
        id: "container.services",
        label: "Service Cluster",
        nodeIds: ["node.identity", "node.order", "node.payment", "node.bus"],
        direction: "TOP_TO_BOTTOM",
      },
      {
        id: "container.data",
        label: "Data Stores",
        nodeIds: ["node.redis", "node.order-db"],
        direction: "TOP_TO_BOTTOM",
      },
    ],
  });
}

export function eventDrivenArchitecture(
  title = "Event-driven Architecture",
): Diagram {
  const diagram = microservicesArchitecture(title);
  return {
    ...diagram,
    id: "architecture-event-driven",
    nodes: diagram.nodes.map((n) =>
      n.id === "node.bus"
        ? { ...n, label: "Message Broker", kind: "queue" }
        : n,
    ),
    metadata: { preset: "event-driven" },
  };
}

export function cloudArchitecture(title = "Cloud Architecture"): Diagram {
  const diagram = layeredArchitecture(title);
  return {
    ...diagram,
    id: "architecture-cloud",
    nodes: diagram.nodes.map((n) =>
      n.id === "node.gateway"
        ? { ...n, label: "Cloud Load Balancer", kind: "gateway" }
        : n,
    ),
    containers: diagram.containers?.map((c) =>
      c.id === "container.platform" ? { ...c, label: "Cloud VPC" } : c,
    ),
    metadata: { preset: "cloud" },
  };
}

export function deploymentArchitecturePreset(
  title = "Production Deployment Architecture",
): Diagram {
  return createDiagram({
    id: "architecture-deployment",
    title,
    type: "deployment",
    direction: "LEFT_TO_RIGHT",
    routing: "ORTHOGONAL",
    theme: { name: "professional", showLegend: true },
    nodes: [
      { id: "device.client", label: "Client Device", kind: "device" },
      { id: "node.load-balancer", label: "Load Balancer", kind: "gateway" },
      { id: "node.app-a", label: "Application Node A", kind: "node" },
      { id: "node.app-b", label: "Application Node B", kind: "node" },
      { id: "node.cache", label: "Redis Node", kind: "cache" },
      { id: "node.database", label: "Database Node", kind: "database" },
    ],
    edges: [
      {
        id: "edge.client-lb",
        source: "device.client",
        target: "node.load-balancer",
        label: "HTTPS",
        type: "communication-path",
      },
      {
        id: "edge.lb-a",
        source: "node.load-balancer",
        target: "node.app-a",
        type: "communication-path",
      },
      {
        id: "edge.lb-b",
        source: "node.load-balancer",
        target: "node.app-b",
        type: "communication-path",
      },
      {
        id: "edge.a-cache",
        source: "node.app-a",
        target: "node.cache",
        type: "communication-path",
      },
      {
        id: "edge.b-cache",
        source: "node.app-b",
        target: "node.cache",
        type: "communication-path",
      },
      {
        id: "edge.cache-db",
        source: "node.cache",
        target: "node.database",
        type: "communication-path",
      },
    ],
    containers: [
      {
        id: "container.cluster",
        label: "Application Cluster",
        nodeIds: ["node.app-a", "node.app-b"],
        direction: "TOP_TO_BOTTOM",
      },
      {
        id: "container.data",
        label: "Data Network",
        nodeIds: ["node.cache", "node.database"],
        direction: "TOP_TO_BOTTOM",
      },
    ],
    deployment: {
      artifacts: [
        {
          id: "artifact.application-a",
          label: "application.jar",
          deployedOn: "node.app-a",
        },
        {
          id: "artifact.application-b",
          label: "application.jar",
          deployedOn: "node.app-b",
        },
      ],
    },
  });
}

export function architectureForRequest(request: string): Diagram {
  const s = request.toLowerCase();
  if (/微服务|microservice/.test(s)) return microservicesArchitecture(request);
  if (/事件驱动|消息队列|event.driven|event bus|kafka/.test(s))
    return eventDrivenArchitecture(request);
  if (/云架构|cloud|vpc|kubernetes|k8s/.test(s))
    return cloudArchitecture(request);
  return layeredArchitecture(request);
}

export const architecturePresets: Record<
  ArchitecturePreset,
  (title?: string) => Diagram
> = {
  layered: layeredArchitecture,
  microservices: microservicesArchitecture,
  "event-driven": eventDrivenArchitecture,
  cloud: cloudArchitecture,
  deployment: deploymentArchitecturePreset,
};
