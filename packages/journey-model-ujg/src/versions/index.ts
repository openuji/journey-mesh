import { compilerRegistry } from "./registry.js";
import { rc4Compiler } from "./1.0-rc4/index.js";
export const registry = compilerRegistry([rc4Compiler]);
