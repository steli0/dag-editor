import { MarkerType } from "@xyflow/react";
import dagre from "dagre";

export function buildGraph(data, selectedPageId = null) {
  const nodes = [];
  const links = [];
  const nodeIndex = new Map();

  const addNode = (id, type, label, extras = {}) => {
    if (!nodeIndex.has(id)) {
      nodeIndex.set(id, nodes.length);
      nodes.push({ id, type, label, ...extras });
      return;
    }

    const nodePosition = nodeIndex.get(id);
    const current = nodes[nodePosition];
    nodes[nodePosition] = { ...current, ...extras };
  };

  const pages = data.pages || [];
  const questionsById = new Map((data.questions || []).map((q) => [q.id, q]));
  const edgesById = new Map((data.edges || []).map((e) => [e.id, e]));
  const conditionsById = new Map((data.conditions || []).map((c) => [c.id, c]));

  const formatValue = (value, compact = false) => {
    if (Array.isArray(value)) {
      const mapped = value.map((item) => formatValue(item, compact));
      if (compact) {
        if (mapped.length === 0) return "[]";
        if (mapped.length <= 2) return `[${mapped.join(", ")}]`;
        return `[${mapped[0]}, ${mapped[1]}, +${mapped.length - 2}]`;
      }
      return `[${mapped.join(", ")}]`;
    }

    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) return "{}";
      const mapped = entries.map(([key, nested]) => `${key}: ${formatValue(nested, compact)}`);
      return `{ ${mapped.join(", ")} }`;
    }

    if (typeof value === "string") return value;
    return String(value);
  };

  const describeCondition = (conditionId) => {
    const condition = conditionsById.get(conditionId);
    if (!condition) {
      return {
        id: conditionId,
        shortText: conditionId,
        longText: `Condition not found for id ${conditionId}`
      };
    }

    if (condition.metadata && typeof condition.metadata === "object") {
      const metadataEntries = Object.entries(condition.metadata);
      const shortText =
        metadataEntries.length > 0
          ? metadataEntries.map(([key, value]) => `${key}=${formatValue(value, true)}`).join(", ")
          : "metadata";
      const longText =
        metadataEntries.length > 0
          ? metadataEntries.map(([key, value]) => `${key}: ${formatValue(value, false)}`).join("; ")
          : "metadata: {}";

      return { id: condition.id, shortText, longText };
    }

    if (condition.linkedQuestion || condition.value !== undefined) {
      const linkedQuestion = condition.linkedQuestion || "-";
      const value = condition.value !== undefined ? formatValue(condition.value, false) : "-";
      return {
        id: condition.id,
        shortText: `${linkedQuestion}=${value}`,
        longText: `linkedQuestion: ${linkedQuestion}; value: ${value}`
      };
    }

    const otherEntries = Object.entries(condition).filter(([key]) => key !== "id");
    if (otherEntries.length > 0) {
      const text = otherEntries.map(([key, value]) => `${key}: ${formatValue(value, false)}`).join("; ");
      return { id: condition.id, shortText: text, longText: text };
    }

    return { id: condition.id, shortText: condition.id, longText: condition.id };
  };

  const resolveConditions = (conditionIds) => {
    const ids = Array.isArray(conditionIds) ? conditionIds : [];
    const details = ids.map((conditionId) => describeCondition(conditionId));
    return {
      ids,
      shortTexts: details.map((detail) => detail.shortText),
      longTexts: details.map((detail) => detail.longText),
      details
    };
  };

  const buildPageFlow = (page) => {
    const pageConditions = resolveConditions(page.condition);
    addNode(page.id, "page", page.description || page.id, {
      pageConditionIds: pageConditions.ids,
      pageConditionValues: pageConditions.shortTexts,
      pageConditionLongValues: pageConditions.longTexts,
      pageConditionDetails: pageConditions.details
    });

    const startQuestionId = page.questions?.[0];
    if (!startQuestionId) return;

    const orderedQuestionIds = page.questions || [];
    const orderedQuestionSet = new Set(orderedQuestionIds);
    const orderedQuestionIndex = new Map(orderedQuestionIds.map((questionId, index) => [questionId, index]));
    for (const questionId of orderedQuestionIds) {
      const question = questionsById.get(questionId);
      addNode(questionId, "question", question?.description || questionId);
    }

    links.push({
      source: page.id,
      target: startQuestionId,
      kind: "pageStart",
      edgeId: null,
      conditionIds: [],
      conditionValues: [],
      conditionLongValues: [],
      conditionDetails: []
    });

    const queued = new Set();
    const queue = [];
    const enqueue = (questionId) => {
      if (!queued.has(questionId)) {
        queued.add(questionId);
        queue.push(questionId);
      }
    };

    for (const questionId of orderedQuestionIds) {
      enqueue(questionId);
    }

    for (let index = 0; index < queue.length; index++) {
      const questionId = queue[index];
      const question = questionsById.get(questionId);
      const questionEdgeIds = question?.edges || [];

      if (orderedQuestionSet.has(questionId)) {
        const currentIndex = orderedQuestionIndex.get(questionId);
        const isLast = currentIndex === orderedQuestionIds.length - 1;
        const nextQuestionId = !isLast ? orderedQuestionIds[currentIndex + 1] : null;

        if (questionEdgeIds.length === 0 && nextQuestionId) {
          const nextQuestion = questionsById.get(nextQuestionId);
          addNode(nextQuestionId, "question", nextQuestion?.description || nextQuestionId);
          links.push({
            source: questionId,
            target: nextQuestionId,
            kind: "implicitNext",
            edgeId: null,
            conditionIds: [],
            conditionValues: [],
            conditionLongValues: [],
            conditionDetails: []
          });
          enqueue(nextQuestionId);
        }
      }

      for (const edgeId of questionEdgeIds) {
        const edge = edgesById.get(edgeId);
        if (!edge?.child) continue;
        const edgeConditions = resolveConditions(edge.condition);
        const child = questionsById.get(edge.child);
        addNode(
          edge.child,
          "question",
          child?.description || edge.child,
          edgeConditions.ids.length > 0 ? { hasConditionalParent: true } : {}
        );
        links.push({
          source: question.id,
          target: edge.child,
          kind: "questionEdge",
          edgeId: edge.id,
          conditionIds: edgeConditions.ids,
          conditionValues: edgeConditions.shortTexts,
          conditionLongValues: edgeConditions.longTexts,
          conditionDetails: edgeConditions.details
        });

        enqueue(edge.child);
      }
    }
  };

  if (selectedPageId) {
    const selectedPage = pages.find((page) => page.id === selectedPageId);
    if (!selectedPage) {
      return { nodes: [], links: [] };
    }
    buildPageFlow(selectedPage);
  } else {
    for (const page of pages) {
      buildPageFlow(page);
    }
  }

  const unique = new Set();
  const dedupedLinks = links.filter((link) => {
    const key = `${link.source}->${link.target}|${link.kind || ""}|${link.edgeId || ""}|${
      (link.conditionIds || []).join(",")
    }`;
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });

  return { nodes, links: dedupedLinks };
}

export function layoutGraph(graph, options = {}) {
  const {
    spacingX = 520,
    spacingY = 210,
    offsetX = 80,
    offsetY = 80,
    minWidth = 1800,
    minHeight = 1100,
    widthPadding = 420,
    heightPadding = 340,
    dagreDirection = "TB",
    dagreRanker = "network-simplex",
    dagreAlign = "UL",
    pageStartMinlen = 2,
    questionEdgeMinlen = 2,
    implicitNextMinlen = 1,
    defaultMinlen = 1,
    edgeWeightExplicit = 2,
    edgeWeightImplicitNext = 6,
    edgeWeightDefault = 2
  } = options;

  const dag = new dagre.graphlib.Graph();
  dag.setDefaultEdgeLabel(() => ({}));
  dag.setGraph({
    rankdir: dagreDirection,
    align: dagreAlign,
    ranker: dagreRanker,
    ranksep: Math.max(120, spacingX),
    nodesep: Math.max(80, spacingY * 0.7),
    edgesep: Math.max(40, spacingY * 0.35),
    marginx: offsetX,
    marginy: offsetY
  });

  const nodeSizeById = new Map();
  for (const node of graph.nodes) {
    const width = node.type === "page" ? 300 : 270;
    const height = node.type === "page" ? 130 : node.hasConditionalParent ? 108 : 96;
    nodeSizeById.set(node.id, { width, height });
    dag.setNode(node.id, { width, height });
  }

  for (const link of graph.links) {
    let minlen = defaultMinlen;
    if (link.kind === "pageStart") minlen = pageStartMinlen;
    if (link.kind === "implicitNext") minlen = implicitNextMinlen;
    if (link.kind === "questionEdge") minlen = questionEdgeMinlen;

    let weight = edgeWeightDefault;
    if (link.kind === "implicitNext") weight = edgeWeightImplicitNext;
    if (link.kind === "questionEdge") weight = edgeWeightExplicit;

    dag.setEdge(link.source, link.target, {
      minlen,
      weight
    });
  }

  dagre.layout(dag);

  const positionedNodes = graph.nodes.map((node) => {
    const nodeLayout = dag.node(node.id);
    const size = nodeSizeById.get(node.id) || { width: 260, height: 96 };
    return {
      ...node,
      x: (nodeLayout?.x || 0) - size.width / 2,
      y: (nodeLayout?.y || 0) - size.height / 2
    };
  });

  const byId = new Map(positionedNodes.map((n) => [n.id, n]));
  const maxX = Math.max(0, ...positionedNodes.map((n) => n.x + (nodeSizeById.get(n.id)?.width || 260)));
  const maxY = Math.max(0, ...positionedNodes.map((n) => n.y + (nodeSizeById.get(n.id)?.height || 96)));

  const width = Math.max(minWidth, maxX + widthPadding);
  const height = Math.max(minHeight, maxY + heightPadding);

  return { nodes: positionedNodes, links: graph.links, byId, width, height };
}

export function toReactFlowElements(layoutedGraph) {
  const nodes = layoutedGraph.nodes.map((node) => ({
    id: node.id,
    type: "dag",
    data: {
      id: node.id,
      label: node.label,
      nodeType: node.type,
      hasConditionalParent: Boolean(node.hasConditionalParent),
      pageConditionIds: node.pageConditionIds || [],
      pageConditionValues: node.pageConditionValues || [],
      pageConditionLongValues: node.pageConditionLongValues || [],
      pageConditionDetails: node.pageConditionDetails || []
    },
    position: {
      x: node.x,
      y: node.y
    }
  }));

  const edges = layoutedGraph.links.map((link, index) => ({
    id: `${link.source}-${link.target}-${link.edgeId || link.kind || index}`,
    source: link.source,
    target: link.target,
    label: (link.conditionValues || []).join(" && "),
    data: {
      kind: link.kind || "questionEdge",
      configEdgeId: link.edgeId || null,
      conditionIds: link.conditionIds || [],
      conditionValues: link.conditionValues || [],
      conditionLongValues: link.conditionLongValues || [],
      conditionDetails: link.conditionDetails || []
    },
    type: "fixedLabelEdge",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
      color: (link.conditionValues || []).length > 0 ? "#b45309" : "#5f7082"
    },
    style: {
      stroke: (link.conditionValues || []).length > 0 ? "#b45309" : "#5f7082",
      strokeWidth: (link.conditionValues || []).length > 0 ? 2.6 : 2
    },
    labelStyle:
      (link.conditionValues || []).length > 0 ? { fontSize: 11, fontWeight: 700, fill: "#7c2d12" } : {}
  }));

  return { nodes, edges };
}
