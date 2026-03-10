import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildGraph, layoutGraph, toReactFlowElements } from "../utils/graph";
import FixedLabelEdge from "./edges/FixedLabelEdge";
import "./DagFlowEditor.css";

const EDGE_COLOR_DEFAULT = "#5f7082";
const EDGE_COLOR_PARENT = "#d97706";
const EDGE_COLOR_CHILD = "#0f766e";

function DagNode({ data }) {
  const isVertical = data.layoutDirection === "TB" || data.layoutDirection === "BT";
  const targetHandlePosition = isVertical ? Position.Top : Position.Left;
  const sourceHandlePosition = isVertical ? Position.Bottom : Position.Right;

  return (
    <div
      className={`dag-node-shell ${data.nodeType} ${data.highlightRole || ""} ${
        data.isDimmed ? "dimmed-node" : ""
      } ${data.hasConditionalParent ? "conditional-child-node" : ""}`}
    >
      {data.nodeType === "page" && data.pageConditionValues?.length > 0 ? (
        <div className="dag-page-conditions">
          {data.pageConditionValues.map((conditionText, index) => (
            <span
              key={`${conditionText}-${index}`}
              className="dag-condition-pill"
              title={data.pageConditionLongValues?.[index] || conditionText}
            >
              {conditionText}
            </span>
          ))}
        </div>
      ) : null}
      <Handle type="target" position={targetHandlePosition} className="dag-handle" />
      <div className="dag-node-id">{data.id}</div>
      <div className="dag-node-label">{data.label}</div>
      <Handle type="source" position={sourceHandlePosition} className="dag-handle" />
    </div>
  );
}

function InspectorRow({ label, value }) {
  return (
    <div className="inspector-row">
      <span className="inspector-label">{label}</span>
      <span className="inspector-value">{value ?? "-"}</span>
    </div>
  );
}

function InspectorList({ title, items, emptyText = "None" }) {
  return (
    <section className="inspector-list-block">
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p className="inspector-empty">{emptyText}</p>
      ) : (
        <ul className="inspector-list">
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatListInput(values) {
  return (values || []).join("\n");
}

function parseListInput(text) {
  return [...new Set((text || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

function removeConfigEdgesFromData(data, edgeIdsToDelete) {
  if (!data || edgeIdsToDelete.size === 0) return data;

  const nextEdges = (data.edges || []).filter((edge) => !edgeIdsToDelete.has(edge.id));
  const nextQuestions = (data.questions || []).map((question) => ({
    ...question,
    edges: (question.edges || []).filter((edgeId) => !edgeIdsToDelete.has(edgeId))
  }));

  return {
    ...data,
    edges: nextEdges,
    questions: nextQuestions
  };
}

function removeQuestionsFromData(data, questionIdsToDelete) {
  if (!data || questionIdsToDelete.size === 0) return data;

  const questionsData = data.questions || [];
  const edgesData = data.edges || [];

  const outgoingEdgeIds = new Set();
  for (const question of questionsData) {
    if (questionIdsToDelete.has(question.id)) {
      for (const edgeId of question.edges || []) {
        outgoingEdgeIds.add(edgeId);
      }
    }
  }

  const incomingEdgeIds = new Set(
    edgesData.filter((edge) => questionIdsToDelete.has(edge.child)).map((edge) => edge.id)
  );

  const edgeIdsToDelete = new Set([...outgoingEdgeIds, ...incomingEdgeIds]);
  const withoutEdges = removeConfigEdgesFromData(data, edgeIdsToDelete);

  return {
    ...withoutEdges,
    questions: (withoutEdges.questions || []).filter((question) => !questionIdsToDelete.has(question.id)),
    pages: (withoutEdges.pages || []).map((page) => ({
      ...page,
      questions: (page.questions || []).filter((questionId) => !questionIdsToDelete.has(questionId))
    }))
  };
}

function normalizeIdToken(value) {
  const normalized = (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "item";
}

function createUniqueId(base, existingIds) {
  const normalizedBase = normalizeIdToken(base);
  let candidate = normalizedBase;
  let index = 1;
  while (existingIds.has(candidate)) {
    candidate = `${normalizedBase}_${index}`;
    index += 1;
  }
  return candidate;
}

function InspectorPanel({
  selection,
  nodes,
  edges,
  sourceData,
  lookups,
  onUpdatePage,
  onUpdateQuestion,
  onUpdateConfigEdge,
  onAddParentQuestion,
  onAddChildQuestion,
  onAddStartQuestion,
  onDeleteQuestion,
  onDeleteConfigEdge
}) {
  const selectedNode = selection?.kind === "node" ? nodes.find((item) => item.id === selection.id) : null;
  const selectedEdge = selection?.kind === "edge" ? edges.find((item) => item.id === selection.id) : null;

  const page = selectedNode ? lookups.pagesById.get(selectedNode.id) : null;
  const question = selectedNode ? lookups.questionsById.get(selectedNode.id) : null;
  const edgeKind = selectedEdge?.data?.kind || "questionEdge";
  const configEdgeId = selectedEdge?.data?.configEdgeId || null;
  const configEdge = configEdgeId ? lookups.edgesById.get(configEdgeId) : null;

  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (selection?.kind === "node" && page) {
      setDraft({
        kind: "page",
        description: page.description || "",
        dependsOnText: formatListInput(page.dependsOn),
        questionsText: formatListInput(page.questions)
      });
      return;
    }

    if (selection?.kind === "node" && question) {
      setDraft({
        kind: "question",
        description: question.description || "",
        field: question.field || "",
        edgesText: formatListInput(question.edges)
      });
      return;
    }

    if (selection?.kind === "edge" && configEdge) {
      setDraft({
        kind: "edge",
        child: configEdge.child || "",
        conditionIdsText: formatListInput(configEdge.condition)
      });
      return;
    }

    setDraft(null);
  }, [selection, page, question, configEdge]);

  if (!selection) {
    return (
      <aside className="dag-inspector">
        <h3>Inspector</h3>
        <p className="inspector-empty">Select a node or edge to inspect details.</p>
      </aside>
    );
  }

  if (selection.kind === "node") {
    if (!selectedNode) {
      return (
        <aside className="dag-inspector">
          <h3>Inspector</h3>
          <p className="inspector-empty">Selected node no longer exists.</p>
        </aside>
      );
    }

    const incoming = edges.filter((edge) => edge.target === selection.id).map((edge) => edge.source);
    const outgoing = edges.filter((edge) => edge.source === selection.id).map((edge) => edge.target);

    if (page) {
      const pageConditionIds = selectedNode.data?.pageConditionIds || [];
      const pageConditionDetails = (selectedNode.data?.pageConditionDetails || []).map(
        (detail) => `${detail.id}: ${detail.longText}`
      );

      return (
        <aside className="dag-inspector">
          <h3>Page</h3>
          <InspectorRow label="ID" value={page.id} />
          <InspectorRow label="Description" value={page.description} />
          <InspectorRow label="Type" value="page" />
          <InspectorList
            title="Page Condition IDs"
            items={pageConditionIds}
            emptyText="No page conditions on this page."
          />
          <InspectorList title="Page Condition Details" items={pageConditionDetails} />
          <InspectorList title="Depends On" items={page.dependsOn || []} />
          <InspectorList title="Start Questions" items={page.questions || []} />
          <InspectorList title="Incoming Nodes" items={incoming} />
          <InspectorList title="Outgoing Nodes" items={outgoing} />
          <div className="inspector-actions">
            <button type="button" className="inspector-save-btn" onClick={() => onAddStartQuestion(page.id)}>
              Add Start Question
            </button>
          </div>
          <section className="inspector-edit-block">
            <h4>Edit Page</h4>
            <label className="inspector-field-label" htmlFor="edit-page-description">
              Description
            </label>
            <input
              id="edit-page-description"
              className="inspector-input"
              type="text"
              value={draft?.description || ""}
              onChange={(event) =>
                setDraft((current) => ({ ...(current || { kind: "page" }), description: event.target.value }))
              }
            />
            <label className="inspector-field-label" htmlFor="edit-page-depends">
              Depends On (comma/new line)
            </label>
            <textarea
              id="edit-page-depends"
              className="inspector-textarea"
              value={draft?.dependsOnText || ""}
              onChange={(event) =>
                setDraft((current) => ({ ...(current || { kind: "page" }), dependsOnText: event.target.value }))
              }
            />
            <label className="inspector-field-label" htmlFor="edit-page-questions">
              Questions Order (comma/new line)
            </label>
            <textarea
              id="edit-page-questions"
              className="inspector-textarea"
              value={draft?.questionsText || ""}
              onChange={(event) =>
                setDraft((current) => ({ ...(current || { kind: "page" }), questionsText: event.target.value }))
              }
            />
            <div className="inspector-actions">
              <button
                type="button"
                className="inspector-save-btn"
                onClick={() =>
                  onUpdatePage(page.id, {
                    description: draft?.description || "",
                    dependsOn: parseListInput(draft?.dependsOnText),
                    questions: parseListInput(draft?.questionsText)
                  })
                }
              >
                Save Page
              </button>
            </div>
          </section>
        </aside>
      );
    }

    if (question) {
      const field = lookups.fieldsById.get(question.field);
      const optionSet = field ? lookups.optionsByName.get(field.options) : null;
      const choices = optionSet?.choices?.map((choice) => choice.name) || [];

      return (
        <aside className="dag-inspector">
          <h3>Question</h3>
          <InspectorRow label="ID" value={question.id} />
          <InspectorRow label="Description" value={question.description} />
          <InspectorRow label="Type" value="question" />
          <InspectorRow label="Field ID" value={question.field} />
          <InspectorRow label="Field Type" value={field?.type} />
          <InspectorRow label="Options Group" value={field?.options} />
          <InspectorList title="Question Edge IDs" items={question.edges || []} />
          <InspectorList title="Incoming Nodes" items={incoming} />
          <InspectorList title="Outgoing Nodes" items={outgoing} />
          <InspectorList title="Option Choices" items={choices} emptyText="No options found for this field." />
          <div className="inspector-actions">
            <button type="button" className="inspector-save-btn" onClick={() => onAddParentQuestion(question.id)}>
              Add Parent Question
            </button>
            <button type="button" className="inspector-save-btn" onClick={() => onAddChildQuestion(question.id)}>
              Add Child Question
            </button>
            <button
              type="button"
              className="inspector-delete-btn"
              onClick={() => onDeleteQuestion(question.id)}
            >
              Delete Question
            </button>
          </div>
          <section className="inspector-edit-block">
            <h4>Edit Question</h4>
            <label className="inspector-field-label" htmlFor="edit-question-description">
              Description
            </label>
            <input
              id="edit-question-description"
              className="inspector-input"
              type="text"
              value={draft?.description || ""}
              onChange={(event) =>
                setDraft((current) => ({ ...(current || { kind: "question" }), description: event.target.value }))
              }
            />
            <label className="inspector-field-label" htmlFor="edit-question-field">
              Field ID
            </label>
            <input
              id="edit-question-field"
              className="inspector-input"
              type="text"
              value={draft?.field || ""}
              onChange={(event) =>
                setDraft((current) => ({ ...(current || { kind: "question" }), field: event.target.value }))
              }
            />
            <label className="inspector-field-label" htmlFor="edit-question-edges">
              Edge IDs (comma/new line)
            </label>
            <textarea
              id="edit-question-edges"
              className="inspector-textarea"
              value={draft?.edgesText || ""}
              onChange={(event) =>
                setDraft((current) => ({ ...(current || { kind: "question" }), edgesText: event.target.value }))
              }
            />
            <div className="inspector-actions">
              <button
                type="button"
                className="inspector-save-btn"
                onClick={() =>
                  onUpdateQuestion(question.id, {
                    description: draft?.description || "",
                    field: draft?.field || "",
                    edges: parseListInput(draft?.edgesText)
                  })
                }
              >
                Save Question
              </button>
            </div>
          </section>
        </aside>
      );
    }

    return (
      <aside className="dag-inspector">
        <h3>Node</h3>
        <InspectorRow label="ID" value={selectedNode.id} />
        <InspectorRow label="Label" value={selectedNode.data?.label} />
        <InspectorRow label="Type" value={selectedNode.data?.nodeType} />
      </aside>
    );
  }

  if (!selectedEdge) {
    return (
      <aside className="dag-inspector">
        <h3>Inspector</h3>
        <p className="inspector-empty">Selected edge no longer exists.</p>
      </aside>
    );
  }

  const conditionIds =
    selectedEdge.data?.conditionIds?.length ? selectedEdge.data.conditionIds : configEdge?.condition || [];
  const conditionDetails =
    selectedEdge.data?.conditionDetails?.length > 0
      ? selectedEdge.data.conditionDetails.map((detail) => `${detail.id}: ${detail.longText}`)
      : conditionIds
          .map((conditionId) => lookups.conditionsById.get(conditionId))
          .filter(Boolean)
          .map((condition) => {
            if (condition.metadata) return `${condition.id}: metadata`;
            if (condition.linkedQuestion || condition.value !== undefined) {
              const valueText =
                condition.value && typeof condition.value === "object"
                  ? JSON.stringify(condition.value)
                  : condition.value ?? "-";
              return `${condition.id}: linkedQuestion: ${condition.linkedQuestion || "-"}; value: ${
                valueText
              }`;
            }
            return condition.id;
          });

  const type =
    edgeKind === "pageStart"
      ? "page-start"
      : edgeKind === "implicitNext"
      ? "implicit-next"
      : edgeKind === "manual"
      ? "manual"
      : configEdge
      ? "configured-question-edge"
      : "question-edge";

  return (
    <aside className="dag-inspector">
      <h3>Edge</h3>
      <InspectorRow label="ID" value={selectedEdge.id} />
      <InspectorRow label="Type" value={type} />
      <InspectorRow label="Source" value={selectedEdge.source} />
      <InspectorRow label="Target" value={selectedEdge.target} />
      <InspectorRow label="Config Edge ID" value={configEdge?.id || configEdgeId} />
      <InspectorRow label="Config Child" value={configEdge?.child} />
      <InspectorList title="Condition IDs" items={conditionIds} />
      <InspectorList title="Condition Details" items={conditionDetails} emptyText="No conditions for this edge." />
      <InspectorRow label="Total Source Pages" value={String(sourceData.pages?.length || 0)} />
      <InspectorRow label="Total Questions" value={String(sourceData.questions?.length || 0)} />
      {configEdge ? (
        <section className="inspector-edit-block">
          <h4>Edit Edge</h4>
          <label className="inspector-field-label" htmlFor="edit-edge-child">
            Child Question ID
          </label>
          <input
            id="edit-edge-child"
            className="inspector-input"
            type="text"
            value={draft?.child || ""}
            onChange={(event) =>
              setDraft((current) => ({ ...(current || { kind: "edge" }), child: event.target.value }))
            }
          />
          <label className="inspector-field-label" htmlFor="edit-edge-conditions">
            Condition IDs (comma/new line)
          </label>
          <textarea
            id="edit-edge-conditions"
            className="inspector-textarea"
            value={draft?.conditionIdsText || ""}
            onChange={(event) =>
              setDraft((current) => ({ ...(current || { kind: "edge" }), conditionIdsText: event.target.value }))
            }
          />
          <div className="inspector-actions">
            <button
              type="button"
              className="inspector-save-btn"
              onClick={() =>
                onUpdateConfigEdge(configEdge.id, {
                  child: draft?.child || "",
                  condition: parseListInput(draft?.conditionIdsText)
                })
              }
            >
              Save Edge
            </button>
            <button
              type="button"
              className="inspector-delete-btn"
              onClick={() => onDeleteConfigEdge(configEdge.id)}
            >
              Delete Edge
            </button>
          </div>
        </section>
      ) : (
        <p className="inspector-note">This edge is derived (page start/order) or manual and is not directly editable.</p>
      )}
    </aside>
  );
}

function DagFlowEditor() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sourceData, setSourceData] = useState(null);
  const [availableFiles, setAvailableFiles] = useState([
    { value: "dag.json", label: "dag.json" }
  ]);
  const [selectedFile, setSelectedFile] = useState("dag.json");
  const [selectedPageId, setSelectedPageId] = useState("");
  const [layoutPreset, setLayoutPreset] = useState("balanced");
  const [layoutDirection, setLayoutDirection] = useState("vertical");
  const [layoutScale, setLayoutScale] = useState(100);
  const [selection, setSelection] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const manualEdgeCounter = useRef(0);

  const nodeTypes = useMemo(() => ({ dag: DagNode }), []);
  const edgeTypes = useMemo(() => ({ fixedLabelEdge: FixedLabelEdge }), []);

  const edgeStyles = useMemo(
    () => ({
      type: "fixedLabelEdge",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: "#5f7082"
      },
      style: {
        stroke: "#5f7082",
        strokeWidth: 2
      },
      labelStyle: {
        fontSize: 11
      }
    }),
    []
  );

  const layoutPresets = useMemo(
    () => ({
      balanced: {
        label: "Balanced",
        dagreRanker: "network-simplex",
        spreadX: 1,
        spreadY: 1,
        pageStartMinlen: 2,
        questionEdgeMinlen: 2,
        implicitNextMinlen: 1,
        edgeWeightExplicit: 2,
        edgeWeightImplicitNext: 6
      },
      tree: {
        label: "Tree",
        dagreRanker: "tight-tree",
        spreadX: 1.2,
        spreadY: 1.12,
        pageStartMinlen: 3,
        questionEdgeMinlen: 2,
        implicitNextMinlen: 1,
        edgeWeightExplicit: 3,
        edgeWeightImplicitNext: 8
      },
      compact: {
        label: "Compact",
        dagreRanker: "network-simplex",
        spreadX: 0.85,
        spreadY: 0.85,
        pageStartMinlen: 2,
        questionEdgeMinlen: 1,
        implicitNextMinlen: 1,
        edgeWeightExplicit: 2,
        edgeWeightImplicitNext: 5
      }
    }),
    []
  );

  const layoutOptions = useMemo(() => {
    const preset = layoutPresets[layoutPreset] || layoutPresets.balanced;
    const factor = layoutScale / 100;
    const spreadX = factor * preset.spreadX;
    const spreadY = factor * preset.spreadY;
    const dagreDirection = layoutDirection === "vertical" ? "TB" : "LR";
    return {
      spacingX: Math.round(520 * spreadX),
      spacingY: Math.round(210 * spreadY),
      minWidth: Math.round(1800 * Math.max(0.8, spreadX)),
      minHeight: Math.round(1100 * Math.max(0.8, spreadY)),
      widthPadding: Math.round(420 * spreadX),
      heightPadding: Math.round(340 * spreadY),
      offsetX: 80,
      offsetY: 80,
      dagreRanker: preset.dagreRanker,
      dagreDirection,
      pageStartMinlen: preset.pageStartMinlen,
      questionEdgeMinlen: preset.questionEdgeMinlen,
      implicitNextMinlen: preset.implicitNextMinlen,
      edgeWeightExplicit: preset.edgeWeightExplicit,
      edgeWeightImplicitNext: preset.edgeWeightImplicitNext
    };
  }, [layoutDirection, layoutPreset, layoutPresets, layoutScale]);

  const buildElements = useCallback(
    (json, pageId = "") => {
      const graph = layoutGraph(buildGraph(json, pageId || null), layoutOptions);
      const elements = toReactFlowElements(graph);
      return {
        nodes: elements.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            layoutDirection: layoutOptions.dagreDirection
          }
        })),
        edges: elements.edges.map((edge) => ({
          ...edge,
          type: edge.type || edgeStyles.type,
          markerEnd: edge.markerEnd || edgeStyles.markerEnd,
          style: { ...edgeStyles.style, ...(edge.style || {}) },
          labelStyle: { ...edgeStyles.labelStyle, ...(edge.labelStyle || {}) }
        }))
      };
    },
    [edgeStyles, layoutOptions]
  );

  const lookups = useMemo(() => {
    if (!sourceData) {
      return {
        pagesById: new Map(),
        questionsById: new Map(),
        edgesById: new Map(),
        conditionsById: new Map(),
        fieldsById: new Map(),
        optionsByName: new Map()
      };
    }

    return {
      pagesById: new Map((sourceData.pages || []).map((item) => [item.id, item])),
      questionsById: new Map((sourceData.questions || []).map((item) => [item.id, item])),
      edgesById: new Map((sourceData.edges || []).map((item) => [item.id, item])),
      conditionsById: new Map((sourceData.conditions || []).map((item) => [item.id, item])),
      fieldsById: new Map((sourceData.fields || []).map((item) => [item.id, item])),
      optionsByName: new Map((sourceData.options || []).map((item) => [item.name, item]))
    };
  }, [sourceData]);

  const pages = useMemo(() => sourceData?.pages || [], [sourceData]);

  const onUpdatePage = useCallback((pageId, changes) => {
    setSourceData((current) => {
      if (!current) return current;
      return {
        ...current,
        pages: (current.pages || []).map((page) => (page.id === pageId ? { ...page, ...changes } : page))
      };
    });
  }, []);

  const onUpdateQuestion = useCallback((questionId, changes) => {
    setSourceData((current) => {
      if (!current) return current;
      return {
        ...current,
        questions: (current.questions || []).map((question) =>
          question.id === questionId ? { ...question, ...changes } : question
        )
      };
    });
  }, []);

  const onUpdateConfigEdge = useCallback((edgeId, changes) => {
    setSourceData((current) => {
      if (!current) return current;
      return {
        ...current,
        edges: (current.edges || []).map((edge) => (edge.id === edgeId ? { ...edge, ...changes } : edge))
      };
    });
  }, []);

  const onDeleteQuestion = useCallback((questionId) => {
    setSourceData((current) => {
      if (!current) return current;
      return removeQuestionsFromData(current, new Set([questionId]));
    });
    setSelection(null);
  }, []);

  const onDeleteConfigEdge = useCallback((edgeId) => {
    setSourceData((current) => {
      if (!current) return current;
      return removeConfigEdgesFromData(current, new Set([edgeId]));
    });
    setSelection(null);
  }, []);

  const onExportJson = useCallback(() => {
    if (!sourceData) return;

    const pretty = JSON.stringify(sourceData, null, 2);
    const blob = new Blob([pretty], { type: "application/json;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const suffix = selectedFile.toLowerCase().endsWith(".json") ? "-edited.json" : ".json";
    const exportName = selectedFile.toLowerCase().endsWith(".json")
      ? `${selectedFile.slice(0, -5)}${suffix}`
      : `${selectedFile}${suffix}`;

    link.href = objectUrl;
    link.download = exportName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }, [selectedFile, sourceData]);

  const onAddStartQuestion = useCallback((pageId) => {
    let createdQuestionId = null;
    setSourceData((current) => {
      if (!current) return current;

      const pagesData = current.pages || [];
      const targetPage = pagesData.find((page) => page.id === pageId);
      if (!targetPage) return current;

      const existingQuestionIds = new Set((current.questions || []).map((question) => question.id));
      const newQuestionId = createUniqueId(`${pageId}_question`, existingQuestionIds);
      createdQuestionId = newQuestionId;

      const newQuestion = {
        id: newQuestionId,
        description: "New Question",
        edges: [],
        field: ""
      };

      return {
        ...current,
        pages: pagesData.map((page) =>
          page.id === pageId
            ? {
                ...page,
                questions: [newQuestionId, ...(page.questions || [])]
              }
            : page
        ),
        questions: [...(current.questions || []), newQuestion]
      };
    });

    if (createdQuestionId) {
      setSelection({ kind: "node", id: createdQuestionId });
    }
  }, []);

  const onAddRelativeQuestion = useCallback(
    (anchorQuestionId, direction) => {
      let createdQuestionId = null;

      setSourceData((current) => {
        if (!current) return current;

        const pagesData = current.pages || [];
        const questionsData = current.questions || [];
        const edgesData = current.edges || [];

        const anchorQuestion = questionsData.find((question) => question.id === anchorQuestionId);
        if (!anchorQuestion) return current;

        const pageId =
          selectedPageId && pagesData.some((page) => page.id === selectedPageId)
            ? selectedPageId
            : pagesData.find((page) => (page.questions || []).includes(anchorQuestionId))?.id;

        if (!pageId) return current;

        const targetPage = pagesData.find((page) => page.id === pageId);
        if (!targetPage) return current;

        const orderedQuestions = [...(targetPage.questions || [])];
        const anchorIndex = orderedQuestions.indexOf(anchorQuestionId);
        if (anchorIndex < 0) return current;

        const existingQuestionIds = new Set(questionsData.map((question) => question.id));
        const existingEdgeIds = new Set(edgesData.map((edge) => edge.id));

        const newQuestionId = createUniqueId(`${anchorQuestionId}_${direction}`, existingQuestionIds);
        const newEdgeId = createUniqueId(`${anchorQuestionId}_${direction}_edge`, existingEdgeIds);
        createdQuestionId = newQuestionId;

        const newQuestion = {
          id: newQuestionId,
          description: "New Question",
          edges: direction === "parent" ? [newEdgeId] : [],
          field: anchorQuestion.field || ""
        };

        const updatedQuestions = questionsData.map((question) => {
          if (direction === "child" && question.id === anchorQuestionId) {
            return {
              ...question,
              edges: [...new Set([...(question.edges || []), newEdgeId])]
            };
          }
          return question;
        });

        const insertIndex = direction === "parent" ? anchorIndex : anchorIndex + 1;
        const nextPageQuestions = [
          ...orderedQuestions.slice(0, insertIndex),
          newQuestionId,
          ...orderedQuestions.slice(insertIndex)
        ];

        const childQuestionId = direction === "child" ? newQuestionId : anchorQuestionId;
        const newEdge = {
          id: newEdgeId,
          child: childQuestionId,
          condition: []
        };

        return {
          ...current,
          pages: pagesData.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  questions: nextPageQuestions
                }
              : page
          ),
          questions: [...updatedQuestions, newQuestion],
          edges: [...edgesData, newEdge]
        };
      });

      if (createdQuestionId) {
        setSelection({ kind: "node", id: createdQuestionId });
      }
    },
    [selectedPageId]
  );

  const onAddParentQuestion = useCallback(
    (questionId) => onAddRelativeQuestion(questionId, "parent"),
    [onAddRelativeQuestion]
  );

  const onAddChildQuestion = useCallback(
    (questionId) => onAddRelativeQuestion(questionId, "child"),
    [onAddRelativeQuestion]
  );

  const loadGraph = useCallback(
    (fileName = selectedFile) => {
      setLoading(true);
      setError("");

      fetch(`/${encodeURIComponent(fileName)}`)
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Could not load ${fileName} (${res.status})`);
          }
          return res.json();
        })
        .then((json) => {
          setSourceData(json);
          const nextPages = json.pages || [];
          const fallbackPageId = nextPages[0]?.id || "";
          setSelectedPageId((current) =>
            nextPages.some((page) => page.id === current) ? current : fallbackPageId
          );
          setSelection(null);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    },
    [selectedFile]
  );

  useEffect(() => {
    fetch("/dag-files.json")
      .then((res) => {
        if (!res.ok) {
          throw new Error("Could not load dag-files.json");
        }
        return res.json();
      })
      .then((json) => {
        if (!Array.isArray(json) || json.length === 0) return;

        const normalized = json
          .filter((item) => typeof item.value === "string" && item.value.trim().length > 0)
          .map((item) => ({
            value: item.value.trim(),
            label: (typeof item.label === "string" && item.label.trim()) || item.value.trim()
          }));

        if (normalized.length === 0) return;

        setAvailableFiles(normalized);
        setSelectedFile((current) =>
          normalized.some((item) => item.value === current) ? current : normalized[0].value
        );
      })
      .catch(() => {
        // Keep fallback list if manifest is missing.
      });
  }, []);

  useEffect(() => {
    loadGraph(selectedFile);
  }, [loadGraph, selectedFile]);

  useEffect(() => {
    if (!sourceData) return;

    const hasSelectedPage = pages.some((page) => page.id === selectedPageId);
    const targetPageId = hasSelectedPage ? selectedPageId : pages[0]?.id || "";

    if (!hasSelectedPage && targetPageId) {
      setSelectedPageId(targetPageId);
    }

    const elements = buildElements(sourceData, targetPageId);
    setNodes(elements.nodes);
    setEdges(elements.edges);
  }, [buildElements, pages, selectedPageId, setEdges, setNodes, sourceData]);

  const onConnect = useCallback(
    (connection) => {
      let persistedEdgeGraphId = null;
      setSourceData((current) => {
        if (!current || !connection.source || !connection.target) return current;

        const sourceQuestion = (current.questions || []).find((question) => question.id === connection.source);
        const targetQuestion = (current.questions || []).find((question) => question.id === connection.target);

        if (!sourceQuestion || !targetQuestion) {
          return current;
        }

        const edgesData = current.edges || [];
        const edgeById = new Map(edgesData.map((edge) => [edge.id, edge]));
        const hasExistingLink = (sourceQuestion.edges || []).some(
          (edgeId) => edgeById.get(edgeId)?.child === connection.target
        );
        if (hasExistingLink) {
          return current;
        }

        const existingEdgeIds = new Set(edgesData.map((edge) => edge.id));
        const newEdgeId = createUniqueId(`${connection.source}_to_${connection.target}_edge`, existingEdgeIds);
        persistedEdgeGraphId = `${connection.source}-${connection.target}-${newEdgeId}`;

        return {
          ...current,
          questions: (current.questions || []).map((question) =>
            question.id === connection.source
              ? {
                  ...question,
                  edges: [...new Set([...(question.edges || []), newEdgeId])]
                }
              : question
          ),
          edges: [
            ...edgesData,
            {
              id: newEdgeId,
              child: connection.target,
              condition: []
            }
          ]
        };
      });

      if (persistedEdgeGraphId) {
        setSelection({ kind: "edge", id: persistedEdgeGraphId });
        return;
      }

      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            id: `manual-${manualEdgeCounter.current++}`,
            data: {
              kind: "manual",
              configEdgeId: null,
              conditionIds: [],
              conditionValues: [],
              conditionLongValues: [],
              conditionDetails: []
            },
            ...edgeStyles
          },
          currentEdges
        )
      );
    },
    [edgeStyles, setEdges]
  );

  const onNodesDelete = useCallback((deletedNodes) => {
    const questionIdsToDelete = new Set(
      (deletedNodes || [])
        .filter((node) => node?.data?.nodeType === "question")
        .map((node) => node.id)
    );

    setSourceData((current) => {
      if (!current) return current;
      if (questionIdsToDelete.size === 0) return { ...current };
      return removeQuestionsFromData(current, questionIdsToDelete);
    });
    setSelection(null);
  }, []);

  const onEdgesDelete = useCallback((deletedEdges) => {
    const configEdgeIdsToDelete = new Set(
      (deletedEdges || [])
        .map((edge) => edge?.data?.configEdgeId)
        .filter((edgeId) => typeof edgeId === "string" && edgeId.length > 0)
    );

    setSourceData((current) => {
      if (!current) return current;
      if (configEdgeIdsToDelete.size === 0) return { ...current };
      return removeConfigEdgesFromData(current, configEdgeIdsToDelete);
    });
    setSelection(null);
  }, []);

  const onResetLayout = useCallback(() => {
    if (!sourceData) return;
    const targetPageId = selectedPageId || pages[0]?.id || "";
    const elements = buildElements(sourceData, targetPageId);
    setNodes(elements.nodes);
    setEdges(elements.edges);
  }, [buildElements, pages, selectedPageId, setEdges, setNodes, sourceData]);

  const onNodeClick = useCallback((_, node) => {
    setSelection({ kind: "node", id: node.id });
  }, []);

  const onEdgeClick = useCallback((_, edge) => {
    setSelection({ kind: "edge", id: edge.id });
  }, []);

  const onPaneClick = useCallback(() => {
    setSelection(null);
  }, []);

  const onSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }) => {
    if (selectedNodes.length > 0) {
      setSelection({ kind: "node", id: selectedNodes[0].id });
      return;
    }

    if (selectedEdges.length > 0) {
      setSelection({ kind: "edge", id: selectedEdges[0].id });
      return;
    }

    setSelection(null);
  }, []);

  useEffect(() => {
    if (!selection) return;

    if (selection.kind === "node" && !nodes.some((node) => node.id === selection.id)) {
      setSelection(null);
      return;
    }

    if (selection.kind === "edge" && !edges.some((edge) => edge.id === selection.id)) {
      setSelection(null);
    }
  }, [selection, nodes, edges]);

  const decoratedGraph = useMemo(() => {
    if (!selection || selection.kind !== "node") {
      return { nodes, edges };
    }

    const selectedNodeId = selection.id;
    const parentNodeIds = new Set();
    const childNodeIds = new Set();

    const highlightedEdges = edges.map((edge) => {
      if (edge.target === selectedNodeId) {
        parentNodeIds.add(edge.source);
        return {
          ...edge,
          style: {
            ...(edge.style || {}),
            stroke: EDGE_COLOR_PARENT,
            strokeWidth: 3,
            opacity: 1
          },
          markerEnd: {
            ...(edge.markerEnd || {}),
            type: MarkerType.ArrowClosed,
            color: EDGE_COLOR_PARENT
          }
        };
      }

      if (edge.source === selectedNodeId) {
        childNodeIds.add(edge.target);
        return {
          ...edge,
          style: {
            ...(edge.style || {}),
            stroke: EDGE_COLOR_CHILD,
            strokeWidth: 3,
            opacity: 1
          },
          markerEnd: {
            ...(edge.markerEnd || {}),
            type: MarkerType.ArrowClosed,
            color: EDGE_COLOR_CHILD
          }
        };
      }

      return {
        ...edge,
        style: {
          ...(edge.style || {}),
          stroke: EDGE_COLOR_DEFAULT,
          strokeWidth: 2,
          opacity: 0.16
        },
        markerEnd: {
          ...(edge.markerEnd || {}),
          type: MarkerType.ArrowClosed,
          color: EDGE_COLOR_DEFAULT
        }
      };
    });

    const highlightedNodes = nodes.map((node) => {
      let highlightRole = "";
      if (node.id === selectedNodeId) {
        highlightRole = "selected-node";
      } else if (parentNodeIds.has(node.id) && childNodeIds.has(node.id)) {
        highlightRole = "both-connection";
      } else if (parentNodeIds.has(node.id)) {
        highlightRole = "parent-connection";
      } else if (childNodeIds.has(node.id)) {
        highlightRole = "child-connection";
      }

      const isConnectedNode =
        node.id === selectedNodeId || parentNodeIds.has(node.id) || childNodeIds.has(node.id);

      return {
        ...node,
        data: {
          ...node.data,
          highlightRole,
          isDimmed: !isConnectedNode
        }
      };
    });

    return { nodes: highlightedNodes, edges: highlightedEdges };
  }, [edges, nodes, selection]);

  if (error) {
    return (
      <section className="dag-editor">
        <p className="error">{error}</p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="dag-editor">
        <p>Loading graph...</p>
      </section>
    );
  }

  return (
    <section className="dag-editor">
      <div className="dag-toolbar">
        <span>Nodes: {nodes.length}</span>
        <span>Edges: {edges.length}</span>
        <label htmlFor="dag-file-select" className="dag-file-label">
          File:
        </label>
        <select
          id="dag-file-select"
          className="dag-file-select"
          value={selectedFile}
          onChange={(event) => setSelectedFile(event.target.value)}
        >
          {availableFiles.map((file) => (
            <option key={file.value} value={file.value}>
              {file.label}
            </option>
          ))}
        </select>
        {pages.length > 0 ? (
          <>
            <label htmlFor="dag-page-select" className="dag-file-label">
              Page:
            </label>
            <select
              id="dag-page-select"
              className="dag-file-select"
              value={selectedPageId}
              onChange={(event) => setSelectedPageId(event.target.value)}
            >
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.description ? `${page.description} (${page.id})` : page.id}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <button type="button" onClick={onResetLayout}>
          Auto Layout
        </button>
        <button type="button" onClick={() => loadGraph(selectedFile)}>
          Reload selected
        </button>
        <button type="button" onClick={onExportJson}>
          Export JSON
        </button>
        <label htmlFor="layout-preset-select" className="dag-file-label">
          Layout:
        </label>
        <select
          id="layout-preset-select"
          className="dag-file-select"
          value={layoutPreset}
          onChange={(event) => setLayoutPreset(event.target.value)}
        >
          {Object.entries(layoutPresets).map(([presetKey, preset]) => (
            <option key={presetKey} value={presetKey}>
              {preset.label}
            </option>
          ))}
        </select>
        <label htmlFor="layout-direction-select" className="dag-file-label">
          Orientation:
        </label>
        <select
          id="layout-direction-select"
          className="dag-file-select"
          value={layoutDirection}
          onChange={(event) => setLayoutDirection(event.target.value)}
        >
          <option value="vertical">Vertical</option>
          <option value="horizontal">Horizontal</option>
        </select>
        <label htmlFor="layout-scale-range" className="dag-file-label">
          Spacing: {layoutScale}%
        </label>
        <input
          id="layout-scale-range"
          className="dag-spacing-range"
          type="range"
          min="70"
          max="190"
          step="5"
          value={layoutScale}
          onChange={(event) => setLayoutScale(Number(event.target.value))}
        />
      </div>

      <div className="dag-workspace">
        <div className="dag-canvas">
          <ReactFlow
            fitView
            minZoom={0.005}
            fitViewOptions={{ padding: 0.3, minZoom: 0.005 }}
            nodes={decoratedGraph.nodes}
            edges={decoratedGraph.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onSelectionChange={onSelectionChange}
            deleteKeyCode={["Backspace", "Delete"]}
            defaultEdgeOptions={edgeStyles}
            connectionLineStyle={{ stroke: "#5f7082", strokeWidth: 2 }}
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap pannable zoomable />
            <Controls />
            <Background color="#d5dce5" gap={18} />
          </ReactFlow>
        </div>
        <InspectorPanel
          selection={selection}
          nodes={nodes}
          edges={edges}
          sourceData={sourceData}
          lookups={lookups}
          onUpdatePage={onUpdatePage}
          onUpdateQuestion={onUpdateQuestion}
          onUpdateConfigEdge={onUpdateConfigEdge}
          onAddParentQuestion={onAddParentQuestion}
          onAddChildQuestion={onAddChildQuestion}
          onAddStartQuestion={onAddStartQuestion}
          onDeleteQuestion={onDeleteQuestion}
          onDeleteConfigEdge={onDeleteConfigEdge}
        />
      </div>
    </section>
  );
}

export default DagFlowEditor;
