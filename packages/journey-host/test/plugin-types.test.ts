import assert from "node:assert/strict";
import test from "node:test";
import { contract, defineServicePlugin, startedService } from "@openuji/journey-plugin";

test("service helper infers required and optional contract values in constructor inputs", async () => {
  const checkout = contract<Readonly<{ directory: string }>>("typed-checkout");
  const plugin = defineServicePlugin({
    kind: "service", inputs: { source: checkout }, optionalInputs: { sibling: checkout },
    parse: () => ({}),
    create(_settings, _context, { inputs }) {
      const directory: string = inputs.source.directory;
      const sibling: string | undefined = inputs.sibling?.directory;
      if (false) {
        // @ts-expect-error values follow the declared contract, not unknown
        const invalid: number = inputs.source.directory;
        // @ts-expect-error resolved input bindings are read-only
        inputs.source = { directory: "/replacement" };
      }
      return { name: "typed", async start() { return startedService({ directory, sibling }); } };
    }
  });
  const service = await plugin.create({}, {} as never, { inputs: { source: { directory: "/source" } } });
  assert.deepEqual((await service.start({})).outputs, { directory: "/source", sibling: undefined });
});
