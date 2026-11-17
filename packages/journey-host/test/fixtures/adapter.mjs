import { appendFile } from "node:fs/promises";

export const journeyMeshPlugin = {
  kind: "adapter", automation: { id: "fixture" },
  parse(options) { if (!options.name || !options.log) throw new Error("Fixture adapter needs name and log"); return options; },
  create(options, context, dependencies) {
    const log = (event, item) => appendFile(context.resolvePath(options.log), JSON.stringify({ event, name: options.name, item }) + "\n");
    return {
      name: options.name,
      describeOperation(operation) {
        if (options.unsupported !== undefined && options.unsupported === operation.state?.id) throw new Error("Unsupported fixture operation");
        return { name: options.name };
      },
      createExecution({ context: execution }) {
        let closed = false;
        return {
          async start() {
            await log("start", execution.profile.id);
            if (options.startDelay) await new Promise((resolve) => setTimeout(resolve, options.startDelay));
            if (execution.signal?.aborted) { await log("late-resource-released"); execution.signal.throwIfAborted(); }
            if (options.failStart) throw new Error("Fixture startup failure");
          },
          openEntry(operation) { return log("entry", operation.segment); },
          async assertState(operation) {
            await log("state", operation.segment);
            if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
            execution.signal?.throwIfAborted();
            if (options.fail === operation.state.id) throw new Error("Fixture state failure");
          },
          performTransition() {}, recordControlFlow() {},
          async close() {
            if (closed) return; closed = true; await log("close");
            if (options.failClose) throw new Error("Fixture close failure");
          }
        };
      }
    };
  }
};
