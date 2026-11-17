import {
  renderToString
} from "react-dom/server"
import {
  describe,
  expect,
  it
} from "vitest"
import oidcYaml from "../../fixtures/3touchpoints.v6.ujg.yaml?raw"
import filesharingYaml from "../../fixtures/filesharing.ujg.yaml?raw"
import type {
  JourneyPathPreviewData
} from "./JourneyPath"
import {
  JourneyPathYaml
} from "./JourneyPath"
import {
  ResponsiveJourneyPath
} from "./ResponsiveJourneyPath"
import {
  getStatePreviewPosition
} from "./StateScreenshotHoverCard"

const aliceFilesReadyScreenshot = "./artifacts/standard-000-alice-files-ready.source.playwright-screenshot.png"

describe("JourneyPathYaml", () => {
  it("places a portrait preview beside its host when the left side fits", () => {
    const position = getStatePreviewPosition({
      hostRect: {
        bottom: 510,
        height: 110,
        left: 300,
        right: 620,
        top: 400,
        width: 320
      },
      portrait: true,
      previewRect: {
        height: 490,
        width: 226
      },
      viewportHeight: 900,
      viewportWidth: 1440
    })

    expect(position.side).toBe("left")
    expect(position.left + 226).toBeLessThanOrEqual(292)
  })

  it("moves a portrait preview to the right rather than covering its host", () => {
    const position = getStatePreviewPosition({
      hostRect: {
        bottom: 510,
        height: 110,
        left: 100,
        right: 420,
        top: 400,
        width: 320
      },
      portrait: true,
      previewRect: {
        height: 490,
        width: 226
      },
      viewportHeight: 900,
      viewportWidth: 1440
    })

    expect(position.side).toBe("right")
    expect(position.left).toBeGreaterThanOrEqual(428)
  })

  it("keeps a landscape preview below its host when there is room", () => {
    const position = getStatePreviewPosition({
      hostRect: {
        bottom: 210,
        height: 110,
        left: 300,
        right: 620,
        top: 100,
        width: 320
      },
      portrait: false,
      previewRect: {
        height: 253,
        width: 442
      },
      viewportHeight: 900,
      viewportWidth: 1440
    })

    expect(position.side).toBe("bottom")
    expect(position.top).toBeGreaterThanOrEqual(218)
  })

  it("renders journey labels from a YAML source", () => {
    const markup = renderToString(<JourneyPathYaml source={oidcYaml} />)

    expect(markup).toContain("Start app auth")
    expect(markup).toContain("Sign-in required")
  })

  it("does not render screenshot previews when no accessibility document is provided", () => {
    const markup = renderToString(<JourneyPathYaml source={filesharingYaml} />)

    expect(markup).not.toContain(aliceFilesReadyScreenshot)
    expect(markup).not.toContain("<img")
    expect(markup).not.toContain("metricsFooter")
  })

  it("renders a hidden screenshot preview for matching state accessibility document", () => {
    const accessibilityDocument = {
      states: {
        "urn:state:alice-files-ready": {
          sourceScreenshotHref: aliceFilesReadyScreenshot
        }
      }
    } satisfies JourneyPathPreviewData
    const markup = renderToString(
      <JourneyPathYaml
        accessibilityDocument={accessibilityDocument}
        source={filesharingYaml}
      />
    )

    expect(markup).toContain(aliceFilesReadyScreenshot)
    expect(markup).toContain('loading="lazy"')
    expect(markup).toContain('decoding="async"')
  })

  it("replaces a touchpoint chip with a supplied journey control", () => {
    const markup = renderToString(
      <JourneyPathYaml
        source={filesharingYaml}
        touchpointControls={{
          "urn:touchpoint:nextcloud-b": (
            <div aria-label="Bob journey client" role="group">
              <button aria-pressed="false" type="button">Web</button>
              <button aria-pressed="true" type="button">Android</button>
            </div>
          )
        }}
      />
    )

    expect(markup).toContain("Bob journey client")
    expect(markup).toContain("Android")
    expect(markup).toContain("Nextcloud A")
    expect(markup).not.toContain(">Nextcloud B<")
  })

  it("renders state accessibility metrics in node footers", () => {
    const accessibilityDocument = {
      states: {
        "urn:state:alice-files-ready": {
          metrics: {
            pageState: {
              violations: 3,
              incomplete: 3,
              passes: 30,
              inapplicable: 32
            },
            matchedSurface: {
              violations: 0,
              incomplete: 0,
              passes: 12,
              inapplicable: 50
            }
          }
        }
      }
    } satisfies JourneyPathPreviewData
    const markup = renderToString(
      <JourneyPathYaml
        accessibilityDocument={accessibilityDocument}
        source={filesharingYaml}
      />
    )

    expect(markup).toContain("P")
    expect(markup).toMatch(/3(?:<!-- -->)?V/)
    expect(markup).toMatch(/3(?:<!-- -->)?I/)
    expect(markup).toContain("S")
    expect(markup).toContain("CLEAN")
    expect(markup).toContain("Page state audit: 3 violations, 3 incomplete checks, 30 passes, 32 inapplicable checks")
    expect(markup).toContain('data-metric-kind="axe"')
    expect(markup).toContain('data-columns="2"')
  })

  it("renders native finding and pass metrics with explicit accessible labels", () => {
    const accessibilityDocument = {
      states: {
        "urn:state:bob-incoming-share-visible": {
          metrics: {
            kind: "native",
            findings: 1,
            passes: 11
          }
        }
      }
    } satisfies JourneyPathPreviewData
    const markup = renderToString(
      <JourneyPathYaml
        accessibilityDocument={accessibilityDocument}
        source={filesharingYaml}
      />
    )

    expect(markup).toContain('data-metric-kind="native"')
    expect(markup).toContain('data-columns="2"')
    expect(markup).toContain("Native findings: 1")
    expect(markup).toContain("Native passed checks: 11")
  })

  it("renders unified finding, review, and pass metrics in three columns", () => {
    const accessibilityDocument = {
      states: {
        "urn:state:alice-files-ready": {
          metrics: {
            kind: "unified",
            findings: 3,
            review: 2,
            passes: 30
          }
        }
      }
    } satisfies JourneyPathPreviewData
    const markup = renderToString(
      <JourneyPathYaml
        accessibilityDocument={accessibilityDocument}
        source={filesharingYaml}
      />
    )

    expect(markup).toContain('data-metric-kind="unified"')
    expect(markup).toContain('data-columns="3"')
    expect(markup).toContain("Findings: 3")
    expect(markup).toContain("Checks needing review: 2")
    expect(markup).toContain("Passed checks: 30")
  })

  it("renders skipped state metrics with an accessible status", () => {
    const accessibilityDocument = {
      states: {
        "urn:state:bob-incoming-share-visible": {
          status: "skipped"
        }
      }
    } satisfies JourneyPathPreviewData
    const markup = renderToString(
      <JourneyPathYaml
        accessibilityDocument={accessibilityDocument}
        source={filesharingYaml}
      />
    )

    expect(markup).toContain('data-metric-kind="skipped"')
    expect(markup).toContain('data-columns="1"')
    expect(markup).toContain("Accessibility checks skipped")
    expect(markup).toContain("SKIPPED")
  })

  it("does not render screenshot previews for missing or null screenshot hrefs", () => {
    const missingScreenshot = "./artifacts/missing-state.png"
    const accessibilityDocument = {
      states: {
        "urn:state:alice-files-ready": {
          sourceScreenshotHref: null
        },
        "urn:state:not-rendered": {
          sourceScreenshotHref: missingScreenshot
        }
      }
    } satisfies JourneyPathPreviewData
    const markup = renderToString(
      <JourneyPathYaml
        accessibilityDocument={accessibilityDocument}
        source={filesharingYaml}
      />
    )

    expect(markup).not.toContain(aliceFilesReadyScreenshot)
    expect(markup).not.toContain(missingScreenshot)
    expect(markup).not.toContain("<img")
  })

  it("renders horizontal state nodes by default", () => {
    const markup = renderToString(<JourneyPathYaml source={filesharingYaml} />)

    expect(markup).toContain('data-block="false"')
    expect(markup).not.toContain('data-block="true"')
    expect(markup).toContain("phaseLane")
    expect(markup).toContain("laneSteps")
  })

  it("renders vertical state nodes and omits lanes when block is true", () => {
    const markup = renderToString(<JourneyPathYaml block source={filesharingYaml} />)

    expect(markup).toContain('data-block="true"')
    expect(markup).not.toContain("phaseLane")
    expect(markup).not.toContain("laneSteps")
    expect(markup).toContain("Alice files app is ready")
  })

  it("renders responsive wrapper as horizontal on the server", () => {
    const markup = renderToString(
      <ResponsiveJourneyPath breakpoint={900}>
        <JourneyPathYaml source={filesharingYaml} />
      </ResponsiveJourneyPath>
    )

    expect(markup).toContain('data-block="false"')
    expect(markup).not.toContain('data-block="true"')
    expect(markup).toContain("Alice files app is ready")
  })
})
