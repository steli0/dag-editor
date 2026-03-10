# DAG Editor

CRA-style React project scaffold with a React Flow DAG editor for JSON implementation.

## Run

1. `npm install`
2. `npm start`

The app runs at `http://localhost:3000` by default.

To add another DAG file to the dropdown:
1. Put the JSON file in `public/`
2. Add an entry in `public/dag-files.json`

## Current Editor Features

- Loads `Selected file` and maps it to React Flow nodes/edges
- Drag nodes to reposition
- Create new edges by connecting node handles
- Delete selected nodes/edges with `Delete` or `Backspace`
- `Auto Layout` button to restore calculated layout from JSON
- `Reload selected` button to reload the source file
- File dropdown to switch between DAG JSON files
- Page dropdown (per selected file) to view one page DAG at a time
- Right-side inspector panel for selected node/edge details
- Condition-aware visuals:
- Page conditions rendered as pills on page nodes
- Edge conditions rendered in styled labels over connections
- Child questions reached by conditional edges are styled differently
- Inspector allows editing selected page/question/configured edge fields
- Quick graph growth actions in inspector:
- Add Start Question on a page
- Add Parent Question / Add Child Question on a question
- Delete selected question/configured edge with data-consistent updates
- Export current edited DAG as JSON (`*-edited.json`)
- Layout preset selector (`Balanced`, `Tree`, `Compact`) powered by Dagre
- Orientation selector (`Vertical` / `Horizontal`) with matching edge handle direction

## Structure

- `public/dag.json`: DAG source used by the viewer
- `public/dag-files.json`: list of selectable DAG files for the dropdown
- `src/components/DagFlowEditor.js`: React Flow editor canvas
- `src/utils/graph.js`: JSON-to-graph mapping and layout helpers
