/** The raw audit of one operation, written as evidence during capture. */
export function auditJsonFileName(auditId: string): string {
  return `${auditId}.axe.json`;
}
