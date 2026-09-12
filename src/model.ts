export interface StepResult {
  prediction: number;
  target: number;
  squaredError: number;
}

export class ConstantStateModel {
  readonly state: Float64Array;
  private readonly input: Float64Array;
  private readonly readout: Float64Array;
  private bias = 0;

  constructor(
    readonly dim = 8,
    private readonly eta = 0.08,
    private readonly gamma = 0.02,
    private readonly learningRate = 0.01
  ) {
    this.state = new Float64Array(dim);
    this.input = Float64Array.from({ length: dim }, (_, i) => 0.15 * Math.sin(i + 1));
    this.readout = Float64Array.from({ length: dim }, (_, i) => 0.1 * Math.cos(i + 1));
  }

  predict(): number {
    let value = this.bias;
    for (let i = 0; i < this.dim; i += 1) value += this.readout[i] * this.state[i];
    return value;
  }

  step(input: number, target: number): StepResult {
    const previous = this.state.slice();
    for (let i = 0; i < this.dim; i += 1) {
      const stableDynamics = 0.82 * this.input[i] * input - previous[i];
      this.state[i] = previous[i] + this.eta * (stableDynamics - this.gamma * previous[i]);
    }
    const prediction = this.predict();
    const error = prediction - target;
    for (let i = 0; i < this.dim; i += 1) this.readout[i] -= this.learningRate * error * this.state[i];
    this.bias -= this.learningRate * error;
    return { prediction, target, squaredError: error * error };
  }

  stateNorm(): number { return Math.hypot(...this.state); }
}
