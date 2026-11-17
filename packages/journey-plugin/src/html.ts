const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text and attribute values for reporters that render standalone HTML. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => entities[char]);
}
