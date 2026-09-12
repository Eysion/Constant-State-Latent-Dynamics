import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConstantStateModel } from "../model.js";
import "./styles.css";

type Metrics = {
  loss: number;
  norm: number;
  prediction: number;
  target: number;
};
type Point = { target: number; prediction: number };

function SignalChart({ points }: { points: Point[] }) {
  const width = 760;
  const height = 220;
  const values = points.flatMap((point) => [point.target, point.prediction]);
  const min = values.length ? Math.min(-1, ...values) : -1;
  const max = values.length ? Math.max(1, ...values) : 1;
  const path = (key: keyof Point) => points.map((point, index) => {
    const x = (index / Math.max(1, points.length - 1)) * width;
    const y = height - ((point[key] - min) / (max - min)) * height;
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <div className="chart-panel"><div className="chart-heading"><span>Target vs prediction</span><span className="legend"><i className="target-key" /> target <i className="prediction-key" /> prediction</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Target and prediction signal chart"><line x1="0" y1={height / 2} x2={width} y2={height / 2} className="zero-line" />{points.length > 1 && <><path d={path("target")} className="target-line" /><path d={path("prediction")} className="prediction-line" /></>}</svg></div>;
}

function App() {
  const [mode, setMode] = useState<"train" | "test">("train");
  const [steps, setSteps] = useState(2000);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const cancelled = useRef(false);
  const run = async () => {
    cancelled.current = false;
    setRunning(true);
    setMetrics(null);
    setPoints([]);
    const model = new ConstantStateModel();
    let loss = 0;
    let maxNorm = 0;
    const chart: Point[] = [];
    const count = Math.max(1, Math.floor(steps));
    const batchSize = 5000;
    for (
      let start = 0;
      start < count && !cancelled.current;
      start += batchSize
    ) {
      const end = Math.min(start + batchSize, count);
      for (let t = start; t < end; t += 1) {
        const item = model.step(Math.sin(t * 0.02), Math.sin((t + 1) * 0.02));
        loss += item.squaredError;
        maxNorm = Math.max(maxNorm, model.stateNorm());
        if (chart.length < 120 && (t % Math.max(1, Math.floor(count / 120)) === 0 || t === count - 1)) chart.push({ prediction: item.prediction, target: item.target });
      }
      setProgress(end / count);
      setPoints([...chart]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (cancelled.current) {
      setRunning(false);
      return;
    }
    const target = Math.sin((count + 1) * 0.02);
    const prediction =
      mode === "train"
        ? model.predict()
        : model.step(Math.sin(count * 0.02), target).prediction;
    setMetrics({ loss: loss / count, norm: maxNorm, prediction, target });
    setProgress(1);
    setRunning(false);
  };
  return (
    <main>
      <header>
        <p className="eyebrow">RESEARCH INTERFACE</p>
        <h1>Constant-State Latent Dynamics</h1>
        <p className="lede">
          Train and test a fixed-dimensional streaming state without retaining
          sample history.
        </p>
      </header>
      <section className="panel controls">
        <div className="tabs">
          <button
            disabled={running}
            className={mode === "train" ? "active" : ""}
            onClick={() => setMode("train")}
          >
            Train model
          </button>
          <button
            disabled={running}
            className={mode === "test" ? "active" : ""}
            onClick={() => setMode("test")}
          >
            Test model
          </button>
        </div>
        <label>
          Streaming steps
          <input
            disabled={running}
            type="number"
            min="1"
            step="100"
            value={steps}
            onChange={(e) => setSteps(Number(e.target.value))}
          />
        </label>
        {running ? (
          <button
            className="primary"
            onClick={() => {
              cancelled.current = true;
            }}
          >
            Stop run
          </button>
        ) : (
          <button className="primary" onClick={run}>
            {mode === "train" ? "Run training" : "Run test"}
          </button>
        )}
        <progress value={progress} max="1" />
        <p className="status">
          {running
            ? `${Math.round(progress * 100)}% complete`
            : metrics
              ? `Completed ${steps.toLocaleString()} streaming steps`
              : "Ready for an in-memory run"}
        </p>
      </section>
      <section className="metrics">
        <article>
          <span>Mean squared error</span>
          <strong>{metrics ? metrics.loss.toFixed(6) : "--"}</strong>
        </article>
        <article>
          <span>Maximum state norm</span>
          <strong>{metrics ? metrics.norm.toFixed(4) : "--"}</strong>
        </article>
        <article>
          <span>Prediction / target</span>
          <strong>
            {metrics
              ? `${metrics.prediction.toFixed(4)} / ${metrics.target.toFixed(4)}`
              : "--"}
          </strong>
        </article>
      </section>
      <SignalChart points={points} />
      <footer>Latent dimension: 8 · online update · no history buffer</footer>
      <a className="research-link" href="https://github.com/Eysion/Constant-State-Latent-Dynamics/blob/main/docs/compositional-discrete-memory.md" target="_blank" rel="noreferrer">Explore the next research topic: compositional discrete memory</a>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
