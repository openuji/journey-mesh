import { invalid, UjgCompileError, type UjgVersionCompiler } from "../document.js";

/** An immutable registry: adding a version never changes another version's implementation. */
export function compilerRegistry(compilers: readonly UjgVersionCompiler[]) {
  const versions = new Map(compilers.map((compiler) => [compiler.version, compiler]));
  if (versions.size !== compilers.length) throw new Error("Duplicate UJG compiler version");
  return Object.freeze({
    select(value: unknown): UjgVersionCompiler {
      if (!value || typeof value !== "object" || Array.isArray(value)) invalid("UJG document must be an object");
      const context = (value as Record<string, unknown>)["@context"];
      const contexts = typeof context === "string" ? [context] : context;
      if (!Array.isArray(contexts) || !contexts.length) invalid("UJG document must declare frozen @context URLs");
      if (contexts.some((entry) => typeof entry !== "string")) {
        throw new UjgCompileError("unsupported-feature", "Inline contexts, aliases, and scoped context overrides are not supported");
      }
      const declared = new Set((contexts as string[]).map((url) => {
        const match = /^https:\/\/ujg\.specs\.openuji\.org\/tr\/([^/]+)\/ns\/[^/?#]+\.jsonld$/.exec(url);
        if (!match) throw new UjgCompileError("unsupported-version", `Not a supported frozen UJG context: ${url}`);
        return match[1];
      }));
      if (declared.size !== 1) throw new UjgCompileError("unsupported-version", `Mixed UJG versions: ${[...declared].join(", ")}`);
      const version = [...declared][0];
      const compiler = versions.get(version);
      if (!compiler) throw new UjgCompileError("unsupported-version", `No UJG compiler for ${version}`);
      return compiler;
    }
  });
}
