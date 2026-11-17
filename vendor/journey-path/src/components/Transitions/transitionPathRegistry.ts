import type React from "react"
import type { UJGGraphTransition } from "../../data/parser"
import type { EndpointRole } from "./BranchTransitionRuntime"
import {
  createTransitionPathId
} from "./transitionPathDescriptors"
import type {
  TransitionPathDescriptor,
  TransitionPathStatus
} from "./transitionPathDescriptors"

type Cleanup = () => void
type Listener = () => void

export interface EndpointRef {
  id: string;
  occurrenceId: string;
  role: EndpointRole;
  ref: React.RefCallback<HTMLDivElement>;
  current: HTMLDivElement | null;
}

export interface TransitionPathRegistration extends TransitionPathDescriptor {
  out: EndpointRef;
  in: EndpointRef;
  transitions: UJGGraphTransition[];
}

export interface TransitionPathRegistrySnapshot {
  version: number;
  paths: TransitionPathRegistration[];
  descriptors: TransitionPathDescriptor[];
}

interface RegisterPathInput {
  id?: string;
  out: EndpointRef;
  in: EndpointRef;
  status: TransitionPathStatus;
  transitions?: UJGGraphTransition[];
}

export interface TransitionPathRegistry {
  createEndpoint: (id: string, role: EndpointRole, occurrenceId?: string) => EndpointRef;
  registerPath: (path: RegisterPathInput) => Cleanup;
  subscribe: (listener: Listener) => Cleanup;
  getSnapshot: () => TransitionPathRegistrySnapshot;
}

class RuntimeTransitionPathRegistry implements TransitionPathRegistry {
  private readonly paths = new Map<string, TransitionPathRegistration>()
  private readonly listeners = new Set<Listener>()
  private snapshot: TransitionPathRegistrySnapshot = {
    version: 0,
    paths: [],
    descriptors: []
  }

  createEndpoint(id: string, role: EndpointRole, occurrenceId = id): EndpointRef {
    const endpoint: EndpointRef = {
      id,
      occurrenceId,
      role,
      current: null,
      ref: (element) => {
        if (endpoint.current === element) return

        endpoint.current = element
        this.emit()
      }
    }

    return endpoint
  }

  registerPath({ id, in: inEndpoint, out, status, transitions = [] }: RegisterPathInput) {
    const pathId = id ?? createTransitionPathId(out.occurrenceId, inEndpoint.occurrenceId)
    const path: TransitionPathRegistration = {
      id: pathId,
      sourceId: out.id,
      targetId: inEndpoint.id,
      status,
      out,
      in: inEndpoint,
      transitions
    }

    this.paths.set(pathId, path)
    this.emit()

    return () => {
      if (this.paths.get(pathId) !== path) return

      this.paths.delete(pathId)
      this.emit()
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot() {
    return this.snapshot
  }

  private emit() {
    this.snapshot = {
      version: this.snapshot.version + 1,
      paths: [...this.paths.values()],
      descriptors: [...this.paths.values()].map((path) => ({
        id: path.id,
        sourceId: path.sourceId,
        targetId: path.targetId,
        status: path.status
      }))
    }

    this.listeners.forEach((listener) => listener())
  }
}

export const createTransitionPathRegistry = (): TransitionPathRegistry => (
  new RuntimeTransitionPathRegistry()
)
