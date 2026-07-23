/**
 * JSON string literals are valid YAML double-quoted scalars. Using the
 * platform serializer keeps quotes, backslashes, control characters, and
 * line breaks from changing the surrounding frontmatter structure.
 */
export function quoteYamlString(value: string): string {
  return JSON.stringify(value)
}
