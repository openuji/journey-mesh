export type JourneyRunError = {
  name: string;
  message: string;
  stack?: string;
};

export function errorToJourneyRunError(error: unknown): JourneyRunError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    };
  }

  if (isJourneyRunError(error)) {
    return {
      name: error.name,
      message: error.message,
      ...(typeof error.stack === "string" ? { stack: error.stack } : {})
    };
  }

  return {
    name: "Error",
    message: String(error)
  };
}

function isJourneyRunError(value: unknown): value is JourneyRunError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as JourneyRunError).name === "string" &&
    typeof (value as JourneyRunError).message === "string"
  );
}
