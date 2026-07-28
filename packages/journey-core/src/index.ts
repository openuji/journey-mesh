export interface JourneyOperation<K extends string = string> {
  readonly id: string;
  readonly sequence: number;
  readonly kind: K;
}

export interface JourneyPlan<
  TOperation extends JourneyOperation = JourneyOperation
> {
  readonly id: string;
  readonly operations: readonly TOperation[];
}
