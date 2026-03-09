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
import "./DagFlowEditor.css";

const EDGE_COLOR_DEFAULT = "#5f7082";
const EDGE_COLOR_PARENT = "#d97706";
const EDGE_COLOR_CHILD = "#0f766e";

function DagNode({ data }) {
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
      <Handle type="target" position={Position.Left} className="dag-handle" />
      <div className="dag-node-id">{data.id}</div>
      <div className="dag-node-label">{data.label}</div>
      <Handle type="source" position={Position.Right} className="dag-handle" />
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

function InspectorPanel({ selection, nodes, edges, sourceData, lookups }) {
  if (!selection) {
    return (
      <aside className="dag-inspector">
        <h3>Inspector</h3>
        <p className="inspector-empty">Select a node or edge to inspect details.</p>
      </aside>
    );
  }

  if (selection.kind === "node") {
    const node = nodes.find((item) => item.id === selection.id);
    if (!node) {
      return (
        <aside className="dag-inspector">
          <h3>Inspector</h3>
          <p className="inspector-empty">Selected node no longer exists.</p>
        </aside>
      );
    }

    const page = lookups.pagesById.get(selection.id);
    const question = lookups.questionsById.get(selection.id);
    const incoming = edges.filter((edge) => edge.target === selection.id).map((edge) => edge.source);
    const outgoing = edges.filter((edge) => edge.source === selection.id).map((edge) => edge.target);

    if (page) {
      const pageConditionIds = node.data?.pageConditionIds || [];
      const pageConditionDetails = (node.data?.pageConditionDetails || []).map(
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
        </aside>
      );
    }

    return (
      <aside className="dag-inspector">
        <h3>Node</h3>
        <InspectorRow label="ID" value={node.id} />
        <InspectorRow label="Label" value={node.data?.label} />
        <InspectorRow label="Type" value={node.data?.nodeType} />
      </aside>
    );
  }

  const edge = edges.find((item) => item.id === selection.id);
  if (!edge) {
    return (
      <aside className="dag-inspector">
        <h3>Inspector</h3>
        <p className="inspector-empty">Selected edge no longer exists.</p>
      </aside>
    );
  }

  const edgeKind = edge.data?.kind || "questionEdge";
  const configEdgeId = edge.data?.configEdgeId || null;
  const configEdge = configEdgeId ? lookups.edgesById.get(configEdgeId) : null;
  const conditionIds = edge.data?.conditionIds?.length ? edge.data.conditionIds : configEdge?.condition || [];
  const conditionDetails =
    edge.data?.conditionDetails?.length > 0
      ? edge.data.conditionDetails.map((detail) => `${detail.id}: ${detail.longText}`)
      : conditionIds
          .map((conditionId) => lookups.conditionsById.get(conditionId))
          .filter(Boolean)
          .map((condition) => {
            if (condition.metadata) return `${condition.id}: metadata`;
            if (condition.linkedQuestion || condition.value !== undefined) {
              return `${condition.id}: linkedQuestion: ${condition.linkedQuestion || "-"}; value: ${
                condition.value ?? "-"
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
      <InspectorRow label="ID" value={edge.id} />
      <InspectorRow label="Type" value={type} />
      <InspectorRow label="Source" value={edge.source} />
      <InspectorRow label="Target" value={edge.target} />
      <InspectorRow label="Config Edge ID" value={configEdge?.id || configEdgeId} />
      <InspectorRow label="Config Child" value={configEdge?.child} />
      <InspectorList title="Condition IDs" items={conditionIds} />
      <InspectorList title="Condition Details" items={conditionDetails} emptyText="No conditions for this edge." />
      <InspectorRow label="Total Source Pages" value={String(sourceData.pages?.length || 0)} />
      <InspectorRow label="Total Questions" value={String(sourceData.questions?.length || 0)} />
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
  const [layoutScale, setLayoutScale] = useState(100);
  const [selection, setSelection] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const manualEdgeCounter = useRef(0);

  const nodeTypes = useMemo(() => ({ dag: DagNode }), []);

  const edgeStyles = useMemo(
    () => ({
      type: "smoothstep",
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

  const layoutOptions = useMemo(() => {
    const factor = layoutScale / 100;
    return {
      spacingX: Math.round(520 * factor),
      spacingY: Math.round(210 * factor),
      minWidth: Math.round(1800 * Math.max(0.8, factor)),
      minHeight: Math.round(1100 * Math.max(0.8, factor)),
      widthPadding: Math.round(420 * factor),
      heightPadding: Math.round(340 * factor),
      offsetX: 80,
      offsetY: 80
    };
  }, [layoutScale]);

  const buildElements = useCallback(
    (json, pageId = "") => {
      const graph = layoutGraph(buildGraph(json, pageId || null), layoutOptions);
      const elements = toReactFlowElements(graph);
      return {
        nodes: elements.nodes,
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

  const onResetLayout = useCallback(() => {
    if (!sourceData) return;
    const targetPageId = selectedPageId || pages[0]?.id || "";
    const elements = buildElements(sourceData, targetPageId);
    setNodes(elements.nodes);
    setEdges(elements.edges);
    setSelection(null);
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
            fitViewOptions={{ padding: 0.25, minZoom: 0.05 }}
            nodes={decoratedGraph.nodes}
            edges={decoratedGraph.edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
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
        />
      </div>
    </section>
  );
}

export default DagFlowEditor;
