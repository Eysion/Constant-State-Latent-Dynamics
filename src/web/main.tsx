import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConstantStateModel } from '../model.js';
import './styles.css';

function App() {
  const [mode, setMode] = useState<'train' | 'test'>('train');
  const [steps, setSteps] = useState(2000);
  const [metrics, setMetrics] = useState<{ loss: number; norm: number; prediction: number; target: number } | null>(null);
  const run = () => {
    const model = new ConstantStateModel(); let loss = 0; let maxNorm = 0; const count = Math.max(1, Math.floor(steps));
    for (let t = 0; t < count; t += 1) { const item = model.step(Math.sin(t * 0.02), Math.sin((t + 1) * 0.02)); loss += item.squaredError; maxNorm = Math.max(maxNorm, model.stateNorm()); }
    const input = Math.sin(count * 0.02); const target = Math.sin((count + 1) * 0.02);
    setMetrics({ loss: loss / count, norm: maxNorm, prediction: mode === 'train' ? model.predict() : model.step(input, target).prediction, target });
  };
  return <main><header><p className="eyebrow">RESEARCH INTERFACE</p><h1>Constant-State Latent Dynamics</h1><p className="lede">Train and test a fixed-dimensional streaming state without retaining sample history.</p></header>
    <section className="panel controls"><div className="tabs"><button className={mode === 'train' ? 'active' : ''} onClick={() => setMode('train')}>Train model</button><button className={mode === 'test' ? 'active' : ''} onClick={() => setMode('test')}>Test model</button></div><label>Streaming steps<input type="number" min="1" step="100" value={steps} onChange={(e) => setSteps(Number(e.target.value))} /></label><button className="primary" onClick={run}>{mode === 'train' ? 'Run training' : 'Run test'}</button><p className="status">{metrics ? `Completed ${steps.toLocaleString()} streaming steps` : 'Ready for an in-memory run'}</p></section>
    <section className="metrics"><article><span>Mean squared error</span><strong>{metrics ? metrics.loss.toFixed(6) : '--'}</strong></article><article><span>Maximum state norm</span><strong>{metrics ? metrics.norm.toFixed(4) : '--'}</strong></article><article><span>Prediction / target</span><strong>{metrics ? `${metrics.prediction.toFixed(4)} / ${metrics.target.toFixed(4)}` : '--'}</strong></article></section><footer>Latent dimension: 8 · online update · no history buffer</footer></main>;
}
createRoot(document.getElementById('root')!).render(<App />);
