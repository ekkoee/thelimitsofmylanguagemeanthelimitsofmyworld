// Concurrency-limited async queue. Used so a freshly loaded Reddit feed does
// not fire dozens of API calls at once and blow up cost / rate limits.

export class TaskQueue {
  private running = 0;
  private readonly pending: Array<() => void> = [];

  constructor(private readonly concurrency = 3) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const exec = () => {
        this.running++;
        task().then(resolve, reject).finally(() => {
          this.running--;
          const next = this.pending.shift();
          if (next) next();
        });
      };
      if (this.running < this.concurrency) exec();
      else this.pending.push(exec);
    });
  }
}
