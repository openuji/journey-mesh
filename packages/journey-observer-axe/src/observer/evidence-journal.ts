import { immutableSnapshot } from "../shared/immutable.js";
import type { AxeEvidence } from "./evidence.js";

/** The append boundary owns storage; reading a snapshot never creates or changes facts. */
export class AxeEvidenceJournal {
  private facts: readonly AxeEvidence[] = Object.freeze([]);

  append(fact: AxeEvidence): void {
    this.facts = Object.freeze([...this.facts, immutableSnapshot(fact)]);
  }

  snapshot(): readonly AxeEvidence[] {
    return this.facts;
  }
}
