export const QueryExports = new Set<string>();

export const generateExports = () => {
  const names = Array.from(QueryExports).join(",\n  ");
  return `export const Queries = {
  ${names}
};\n`;
};
