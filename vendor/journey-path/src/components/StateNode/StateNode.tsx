import {
  StateMetricsFooter
} from "./StateMetricsFooter"
import type {
  StateNodeMetrics
} from "./StateMetricsFooter"
import styles from "./StateNode.module.css"

export type StateNodeProps = {
  block?: boolean;
  id: string;
  label: string;
  metrics?: StateNodeMetrics | null;
  selected?: boolean;
  touchpoint?: string;
}

const In = ({ nodeRef }: { nodeRef: React.Ref<HTMLDivElement> }) => (
  <div
    className={styles.in}
    ref={nodeRef}
  />
)
const Out = ({ nodeRef }: { nodeRef: React.Ref<HTMLDivElement> }) => (
  <div
    className={styles.out}
    ref={nodeRef}
  />
)

export function StateNode({ block = false, id, inRef, label, metrics, nodeRef, outRef }: StateNodeProps & {
  outRef?: React.Ref<HTMLDivElement>,
  inRef?: React.Ref<HTMLDivElement>,
  nodeRef?: React.Ref<HTMLDivElement>
}) {
  return (
    <div className={styles.wrapper} data-block={block ? "true" : "false"}>
      {inRef && <In nodeRef={inRef} />}
      <div className={styles.root} data-node-id={id} ref={nodeRef}>
        <div className={styles.content}>
          <span className={styles.dot} />
          <span className={styles.label}>{label}</span>
        </div>
       {metrics && <StateMetricsFooter metrics={metrics} />}
      </div>
      {outRef && <Out nodeRef={outRef} />}
    </div>
  )
}
