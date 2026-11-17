import {
  cloneElement,
  useCallback,
  useSyncExternalStore
} from "react"
import type {
  ReactElement
} from "react"

type ResponsiveJourneyPathChildProps = {
  block?: boolean;
}

export type ResponsiveJourneyPathProps = {
  breakpoint: number;
  children: ReactElement<ResponsiveJourneyPathChildProps>;
}

const getMediaQuery = (breakpoint: number) => (
  `(max-width: ${breakpoint}px)`
)

const getMatches = (breakpoint: number) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }

  return window.matchMedia(getMediaQuery(breakpoint)).matches
}

export const ResponsiveJourneyPath = ({
  breakpoint,
  children
}: ResponsiveJourneyPathProps) => {
  const subscribe = useCallback((listener: () => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return () => undefined
    }

    const mediaQuery = window.matchMedia(getMediaQuery(breakpoint))

    mediaQuery.addEventListener("change", listener)

    return () => {
      mediaQuery.removeEventListener("change", listener)
    }
  }, [breakpoint])
  const getSnapshot = useCallback(() => getMatches(breakpoint), [breakpoint])
  const block = useSyncExternalStore(subscribe, getSnapshot, () => false)

  return cloneElement(children, {
    block
  })
}
