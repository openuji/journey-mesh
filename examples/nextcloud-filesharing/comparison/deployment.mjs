/** Pure deployment composition. No host discovery, environment mutation, or I/O. */
export function comparisonEnvironment(defaults, variant) {
  if (!/^[a-z0-9-]+$/.test(variant.id))
    throw new Error("Invalid comparison variant ID");
  if (variant.alicePort === variant.bobPort)
    throw new Error("Comparison service ports must differ");
  return (
    defaults
      .replaceAll("18081", String(variant.alicePort))
      .replaceAll("18082", String(variant.bobPort)) +
    `\nNEXTCLOUD_IMAGE=${variant.image}\nNEXTCLOUD_STACK_PROJECT=journey-comparison-${variant.id}\nNEXTCLOUD_STACK_SUBNET=${variant.subnet}\n`
  );
}

export function composeArguments(project, envFile, composeFile) {
  return [
    "compose",
    "--project-name",
    project,
    "--env-file",
    envFile,
    "-f",
    composeFile,
  ];
}

/** Explicit stack values override unrelated ambient service values. */
export function comparisonProcessEnvironment(parent, text, additions) {
  const values = Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    return match ? [[match[1], match[2]]] : [];
  }));
  return { ...parent, ...values, ...additions };
}
