type DeploymentVariant = Readonly<{
  id: string;
  image: string;
  alicePort: number;
  bobPort: number;
  subnet: string;
}>;
export function comparisonEnvironment(defaults: string, variant: DeploymentVariant): string;
export function composeArguments(project: string, envFile: string, composeFile: string): string[];
export function comparisonProcessEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
  text: string,
  additions: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined>;
