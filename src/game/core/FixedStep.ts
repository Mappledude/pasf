export class FixedStep {
  private accumulator = 0;

  constructor(private readonly dt = 1 / 60) {}

  tick(elapsed: number, step: (dt: number) => void) {
    this.accumulator += elapsed;
    while (this.accumulator >= this.dt) {
      step(this.dt);
      this.accumulator -= this.dt;
    }
  }
}
