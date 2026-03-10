import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";

function FixedLabelEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  label,
  data
}) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  });

  const hasLabel = typeof label === "string" && label.trim().length > 0;
  const labelTitle = (data?.conditionLongValues || []).join("\n");

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {hasLabel ? (
        <EdgeLabelRenderer>
          <div
            className="edge-condition-box nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
            }}
            title={labelTitle || label}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export default memo(FixedLabelEdge);
