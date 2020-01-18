import {
  InterfaceDeclaration,
  DeclaredType,
  isInterface,
  PropertyType,
  PropertyMap,
  PropertyDeclaration,
  RelationType
} from "./resolveModels";

export interface Tags {
  model: string;
  primaryKey: string;
  index: string;
  unique: string;
  autoIncrement: string;
  real: string;
  numeric: string;
}

// @see https://www.sqlite.org/datatype3.html
enum DataType {
  NULL = "NULL",
  INTEGER = "INTEGER",
  NUMERIC = "NUMERIC",
  REAL = "REAL",
  TEXT = "TEXT",
  BLOB = "BLOB"
}

interface ForeignKey {
  columnName: string;
  parentTableName: string;
  parentColumnName: string;
}

export enum ColumnKind {
  BasedOnProperty,
  ArrayIndex,
  PrimaryKeyFromParent
}

interface Column {
  name: string; // same as property name
  type: DataType;
  notNull: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  unique: boolean;
  kind: ColumnKind;
}

interface PropertyBasedColumn extends Column {
  kind: ColumnKind.BasedOnProperty;
  property: PropertyDeclaration;
}

interface Columns {
  [name: string]: Column | PropertyBasedColumn;
}

enum TableType {
  Default,
  Array
}

interface BaseTable {
  name: string;
  columns: Columns;
  primaryKey?: string;
  declaredType: DeclaredType;
  foreignKeys: ForeignKey[];
  indices: string[]; // column names
  type: TableType;
}

interface Table extends BaseTable {
  type: TableType.Default;
}

interface ArrayTable extends BaseTable {
  property: PropertyDeclaration;
  type: TableType.Array;
}

export interface TableMap {
  [tableName: string]: Table | ArrayTable;
}

interface ParentTableEssentials {
  name: string;
  primaryKey?: string;
  relation: RelationType;
}

export const resolveTables = (
  rootTypes: InterfaceDeclaration[],
  tags: Tags
): TableMap => {
  const tables: TableMap = {};

  rootTypes.forEach(rootType => {
    visitNode(rootType, tags, tables);
  });
  return tables;
};

const visitNode = (
  declaredType: DeclaredType,
  tags: Tags,
  tables: TableMap,
  parent?: ParentTableEssentials
) => {
  const properties = getProperties(declaredType);
  const primaryKey = resolvePrimaryKey(declaredType, properties, tags);

  // resolve children first so that we can have its primary key
  declaredType.children.forEach(relation => {
    const nextParent: ParentTableEssentials = {
      primaryKey,
      name: declaredType.name,
      relation: relation.type
    };
    visitNode(relation.child, tags, tables, nextParent);
  });

  const columns = resolveColumns(properties, tags, parent);
  const foreignKeys = resolveForeignKeys(columns, parent);
  const indices = resolveIndices(properties, tags);

  tables[declaredType.name] = {
    name: declaredType.name,
    primaryKey,
    declaredType,
    columns,
    foreignKeys,
    indices,
    type: TableType.Default
  };

  const arrayTables = resolveArrayTables(
    declaredType,
    properties,
    tags,
    primaryKey
  );

  arrayTables.forEach(arrayTable => {
    tables[arrayTable.name] = arrayTable;
  });
};

const resolvePrimaryKey = (
  declaredType: DeclaredType,
  properties: PropertyMap,
  tags: Tags
) => {
  const propertyList = Object.values(properties);
  const propertiesWithDocTag = propertyList.filter(property =>
    property.tags.some(tag => tag === tags.primaryKey)
  );
  if (propertiesWithDocTag.length === 1) {
    return propertiesWithDocTag[0].name;
  }
  if (propertiesWithDocTag.length > 1) {
    throw Error(
      `Interface ${declaredType.name} has multiple properties with primary key tag ${tags.primaryKey}`
    );
  }
  const propertiesEndingWithId = propertyList.filter(
    property =>
      property.type === PropertyType.Number && property.name.endsWith("Id")
  );

  if (propertiesEndingWithId.length === 1) {
    return propertiesEndingWithId[0].name;
  }
  // need to have primary key when it is referenced by children
  if (
    declaredType.children.length > 0 ||
    propertyList.some(property => property.isArray)
  ) {
    const prefix = `${declaredType.name[0].toLowerCase()}${declaredType.name.substr(
      1
    )}Id`;
    let primaryKey = prefix;
    let counter = 1;
    while (properties[primaryKey]) {
      counter += 1;
      primaryKey = `${prefix}_${counter}`;
    }

    return primaryKey;
  }

  return undefined;
};

const getProperties = (declaredType: DeclaredType): PropertyMap => {
  if (isInterface(declaredType)) {
    return declaredType.properties;
  }
  return declaredType.interfaces.reduce((props, interfaceDecl) => {
    return {
      ...props,
      ...interfaceDecl.properties
    };
  }, {} as PropertyMap);
};

const resolveColumns = (
  properties: PropertyMap,
  tags: Tags,
  parent?: ParentTableEssentials
) => {
  const columns: Columns = {};

  Object.values(properties).forEach(property => {
    if (!property.isArray) {
      const column = resolvePropertyToColumn(property, tags);
      if (column) {
        columns[column.name] = column;
      }
    }
  });
  if (parent?.primaryKey && !columns[parent.primaryKey]) {
    // create column to reference parent
    columns[parent.primaryKey] = {
      name: parent.primaryKey,
      type: DataType.INTEGER,
      primaryKey: true,
      notNull: true,
      autoIncrement: false,
      unique: false,
      kind: ColumnKind.PrimaryKeyFromParent
    };
  }

  return columns;
};

const getDefaultColumnProps = (
  property: PropertyDeclaration,
  tags: Tags,
  primaryKey?: string
) => {
  return {
    name: property.name,
    notNull: !property.isOptional,
    primaryKey: primaryKey === property.name,
    autoIncrement:
      primaryKey === property.name ||
      property.tags.some(tag => tag === tags.autoIncrement),
    unique: property.tags.some(tag => tag === tags.unique)
  };
};

const resolvePropertyToColumn = (
  property: PropertyDeclaration,
  tags: Tags
): PropertyBasedColumn | null => {
  // dont create columns for arrays, we will create a table for it
  const columnDefaultProps: Omit<PropertyBasedColumn, "type"> = {
    ...getDefaultColumnProps(property, tags),
    kind: ColumnKind.BasedOnProperty,
    property
  };
  switch (property.type) {
    case PropertyType.Boolean:
      return {
        ...columnDefaultProps,
        type: DataType.NUMERIC
      };
    case PropertyType.Number:
      if (property.tags.some(tag => tag === tags.real)) {
        return {
          ...columnDefaultProps,
          type: DataType.REAL
        };
      } else if (property.tags.some(tag => tag === tags.numeric)) {
        return {
          ...columnDefaultProps,
          type: DataType.NUMERIC
        };
      } else {
        return {
          ...columnDefaultProps,
          type: DataType.INTEGER
        };
      }
      break;
    case PropertyType.String:
    case PropertyType.Date:
      return {
        ...columnDefaultProps,
        type: DataType.TEXT
      };
      break;
    default:
      // do nothing (it is a relation type property)
      return null;
  }

  return null;
};

const resolveArrayTables = (
  declaredType: DeclaredType,
  properties: PropertyMap,
  tags: Tags,
  primaryKey?: string
): ArrayTable[] => {
  const tables: ArrayTable[] = [];
  if (!primaryKey) {
    return tables;
  }
  Object.values(properties).forEach(property => {
    if (property.isArray && property.isBasicType) {
      const columnDefaultProps = getDefaultColumnProps(
        property,
        tags,
        primaryKey
      );
      const valueColumn = resolvePropertyToColumn(property, tags);
      if (!valueColumn) {
        throw Error(
          `Could not create value column ${property.name} for basic array table ${declaredType.name}`
        );
      }

      const tableName =
        declaredType.name +
        property.name[0].toUpperCase() +
        property.name.substr(1);

      const columns: Columns = {
        arrayIndex: {
          ...columnDefaultProps,
          name: "arrayIndex",
          type: DataType.INTEGER,
          kind: ColumnKind.ArrayIndex
        },
        value: {
          ...valueColumn,
          name: "value"
        },
        [primaryKey]: {
          ...columnDefaultProps,
          name: primaryKey,
          type: DataType.INTEGER,
          kind: ColumnKind.PrimaryKeyFromParent
        }
      };

      tables.push({
        name: tableName,
        declaredType,
        columns,
        foreignKeys: [
          {
            columnName: primaryKey,
            parentTableName: declaredType.name,
            parentColumnName: primaryKey
          }
        ],
        indices: [],
        type: TableType.Array,
        property
      });
    }
  });

  return tables;
};

const resolveForeignKeys = (
  columns: Columns,
  parent?: ParentTableEssentials
): ForeignKey[] => {
  const foreignKeys: ForeignKey[] = [];

  if (parent && parent.primaryKey) {
    // column created in resolveColumns
    const columnName = parent.primaryKey; // same name
    foreignKeys.push({
      columnName,
      parentTableName: parent.name,
      parentColumnName: parent.primaryKey
    });
  }

  return foreignKeys;
};

const resolveIndices = (properties: PropertyMap, tags: Tags): string[] => {
  return Object.values(properties).reduce((indices, property) => {
    if (property.tags.some(tag => tag === tags.index)) {
      indices.push(property.name);
    }
    return indices;
  }, [] as string[]);
};
