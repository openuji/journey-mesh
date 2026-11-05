import { appendFile } from "node:fs/promises";

export const journeyMeshPlugin = {
  apiVersion: 1, kind: "environment", validate() {},
  create(options, context) {
    const log = (event) => appendFile(context.resolvePath(options.log), JSON.stringify({ event }) + "\n");
    return {
      async setup(execution) {
        await log("setup");
        if (options.setupDelay) await new Promise((done, reject) => {
          const timer = setTimeout(done, options.setupDelay);
          const abort = () => { clearTimeout(timer); reject(execution.signal.reason); };
          execution.signal.addEventListener("abort", abort, { once: true });
          if (execution.signal.aborted) abort();
        });
      },
      async teardown() { await log("teardown"); if (options.failTeardown) throw new Error("Fixture teardown failure"); }
    };
  }
};
