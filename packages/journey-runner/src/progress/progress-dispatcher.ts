import type {
  JourneyProgressEvent,
  JourneyProgressSink
} from "./contracts.js";

/**
 * Sinks are awaited in registration order. Progress is best-effort, so sink
 * failures are ignored. Remote sinks should queue delivery internally.
 */
export class JourneyProgressDispatcher {
  constructor(private readonly sinks: readonly JourneyProgressSink[]) {}

  async publish(event: JourneyProgressEvent): Promise<void> {
    for (const sink of this.sinks) {
      try {
        await sink.publish(event);
      } catch {
        // Progress is best-effort.
      }
    }
  }
}
