import path from "path";
import { DeclarationTypeMinimal } from "./resolveModels";

export interface Import {
  path: string;
  defaultImport?: string;
  namedImports: Set<string>;
}

export interface ImportMap {
  [path: string]: Import;
}

export const generateImports = (imports: ImportMap) => {
  let content = "";
  Object.values(imports).forEach(importStmt => {
    content += "import ";
    if (importStmt.defaultImport) {
      content += `${importStmt.defaultImport} `;
    }
    const namedImports = Array.from(importStmt.namedImports);
    if (namedImports.length > 0) {
      content += `{ ${namedImports.join(", ")} } `;
    }
    content += `from '${importStmt.path}';\n`;
  });
  return content;
};

export const addNamedImport = (
  declaredType: DeclarationTypeMinimal,
  imports: ImportMap,
  targetDir: string
) => {
  let importPath = path.join(
    path.relative(targetDir, path.dirname(declaredType.path)),
    path.parse(declaredType.path).name
  );
  if (!importPath.startsWith(".")) {
    importPath = `./${importPath}`;
  }

  if (!imports[importPath]) {
    imports[importPath] = {
      path: importPath,
      namedImports: new Set()
    };
  }
  imports[importPath].namedImports.add(declaredType.name);
};
