import styles from "./StateNode.module.css"

export type StateMetricCounts = {
  violations: number;
  incomplete: number;
  passes: number;
  inapplicable: number;
}

export type AxeStateNodeMetrics = {
  kind?: "axe";
  matchedSurface?: StateMetricCounts;
  pageState?: StateMetricCounts;
  skipped?: boolean;
}

export type NativeStateNodeMetrics = {
  kind: "native";
  findings: number;
  passes: number;
}

export type UnifiedStateNodeMetrics = {
  kind: "unified";
  findings: number;
  review: number;
  passes: number;
}

export type SkippedStateNodeMetrics = {
  kind: "skipped";
}

export type StateNodeMetrics =
  | AxeStateNodeMetrics
  | NativeStateNodeMetrics
  | SkippedStateNodeMetrics
  | UnifiedStateNodeMetrics

type MetricFooterItemProps = {
  accessibleLabel: string;
  counts?: StateMetricCounts;
  label: string;
}

const isClean = (counts: StateMetricCounts) => (
  counts.violations === 0 && counts.incomplete === 0
)

const MetricFooterItem = ({
  accessibleLabel,
  counts,
  label
}: MetricFooterItemProps) => (
  <span aria-label={accessibleLabel} className={styles.metricGroup} role="group">
    <span aria-hidden="true" className={styles.metricLabel}>{label}</span>
    {counts ? (
      isClean(counts) ? (
        <span aria-hidden="true" className={styles.metricClean}>
          <span>✓</span>
          <span>CLEAN</span>
        </span>
      ) : (
        <span aria-hidden="true" className={styles.metricValue}>
          {counts.violations}V <span aria-hidden="true">·</span> {counts.incomplete}I
        </span>
      )
    ) : (
      <span aria-hidden="true" className={styles.metricPlaceholder}></span>
    )}
  </span>
)

const CounterMetricFooterItem = ({
  accessibleLabel,
  label,
  tone,
  value
}: {
  accessibleLabel: string;
  label: string;
  tone?: "danger" | "pass" | "review";
  value: number;
}) => (
  <span aria-label={accessibleLabel} className={styles.metricGroup} role="group">
    <span aria-hidden="true" className={styles.metricLabel}>{label}</span>
    <span
      aria-hidden="true"
      className={`${styles.metricValue} ${tone ? styles[`metricTone${tone.charAt(0).toUpperCase()}${tone.slice(1)}`] : ""}`.trim()}
    >
      {value}
    </span>
  </span>
)

const axeAccessibleLabel = (label: string, counts?: StateMetricCounts) => counts
  ? `${label}: ${counts.violations} violations, ${counts.incomplete} incomplete checks, ${counts.passes} passes, ${counts.inapplicable} inapplicable checks`
  : `${label}: no metrics recorded`

export const StateMetricsFooter = ({
  metrics
}: {
  metrics?: StateNodeMetrics | null;
}) => {
  if (!metrics) return null

  if (metrics.kind === "skipped" || (metrics.kind === undefined && metrics.skipped)) {
    return (
      <div className={styles.metricsFooter} data-columns="1" data-metric-kind="skipped">
        <span aria-label="Accessibility checks skipped" className={styles.metricGroup} role="group">
          <span aria-hidden="true" className={styles.metricLabel}>SKIPPED</span>
        </span>
      </div>
    )
  }

  if (metrics.kind === "native") {
    return (
      <div className={styles.metricsFooter} data-columns="2" data-metric-kind="native">
        <CounterMetricFooterItem
          accessibleLabel={`Native findings: ${metrics.findings}`}
          label="F"
          tone="review"
          value={metrics.findings}
        />
        <CounterMetricFooterItem
          accessibleLabel={`Native passed checks: ${metrics.passes}`}
          label="P"
          tone="pass"
          value={metrics.passes}
        />
      </div>
    )
  }

  if (metrics.kind === "unified") {
    return (
      <div className={styles.metricsFooter} data-columns="3" data-metric-kind="unified">
        <CounterMetricFooterItem
          accessibleLabel={`Findings: ${metrics.findings}`}
          label="F"
          tone="danger"
          value={metrics.findings}
        />
        <CounterMetricFooterItem
          accessibleLabel={`Checks needing review: ${metrics.review}`}
          label="R"
          tone="review"
          value={metrics.review}
        />
        <CounterMetricFooterItem
          accessibleLabel={`Passed checks: ${metrics.passes}`}
          label="P"
          tone="pass"
          value={metrics.passes}
        />
      </div>
    )
  }

  return (
    <div className={styles.metricsFooter} data-columns="2" data-metric-kind="axe">
      <MetricFooterItem
        accessibleLabel={axeAccessibleLabel("Page state audit", metrics.pageState)}
        counts={metrics.pageState}
        label="P"
      />
      <MetricFooterItem
        accessibleLabel={axeAccessibleLabel("Matched surface audit", metrics.matchedSurface)}
        counts={metrics.matchedSurface}
        label="S"
      />
    </div>
  )
}
