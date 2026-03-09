import "./App.css";
import DagFlowEditor from "./components/DagFlowEditor";

function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>DAG Editor</h1>
        <p>React Flow canvas and inspector mapped from DAG in JSON</p>
      </header>
      <DagFlowEditor />
    </main>
  );
}

export default App;
