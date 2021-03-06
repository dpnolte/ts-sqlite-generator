import {
  InterfaceDeclaration,
  DeclaredType,
  isInterface,
  PropertyType,
  PropertyMap,
  PropertyDeclaration,
  RelationType,
  isComposite,
} from "./resolveModels";

export interface Tags {
  entry: string;
  primaryKey: string;
  index: string;
  unique: string;
  autoIncrement: string;
  real: string;
  numeric: string;
}

// @see https://www.sqlite.org/datatype3.html
export enum DataType {
  NULL = "NULL",
  INTEGER = "INTEGER",
  NUMERIC = "NUMERIC",
  REAL = "REAL",
  TEXT = "TEXT",
  BLOB = "BLOB",
}

interface ForeignKey {
  columnName: string;
  parentTableName: string;
  parentColumnName: string;
}

export enum ColumnKind {
  BasedOnProperty,
  ArrayIndex,
  PrimaryKeyFromParent,
  GeneratedPrimaryKey,
}

export interface Column {
  name: string; // same as property name
  type: DataType;
  notNull: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  unique: boolean;
  kind: ColumnKind;
}

export interface PropertyBasedColumn extends Column {
  kind: ColumnKind.BasedOnProperty;
  property: PropertyDeclaration;
}

export const isPropertyBasedColumn = (
  column: Column
): column is PropertyBasedColumn => column.kind === ColumnKind.BasedOnProperty;

interface Columns {
  [name: string]: Column | PropertyBasedColumn;
}

export enum TableType {
  Default,
  BasicArray,
  AdvancedArray,
}

export interface Index {
  unique: boolean;
  columnNames: string[];
}

interface BaseTable {
  name: string;
  columns: Columns;
  primaryKey?: string;
  declaredType: DeclaredType;
  foreignKeys: ForeignKey[];
  indices: Index[];
  type: TableType;
  parentTableName?: string;
  parentTablePrimaryKey?: string;
}

export interface DefaultTable extends BaseTable {
  type: TableType.Default;
  arrayTables: string[];
}

export interface BasicArrayTable extends BaseTable {
  property: PropertyDeclaration;
  type: TableType.BasicArray;
}
export interface AdvancedArrayTable extends BaseTable {
  type: TableType.AdvancedArray;
  arrayTables: string[];
}

export type Table = DefaultTable | BasicArrayTable | AdvancedArrayTable;

export const isBasicArrayTable = (table: Table): table is BasicArrayTable =>
  table.type === TableType.BasicArray;
export const isDefaultTable = (table: Table): table is DefaultTable =>
  table.type === TableType.Default;
export const isAdvancedArrayTable = (
  table: Table
): table is AdvancedArrayTable => table.type === TableType.AdvancedArray;

export interface TableMap {
  [tableName: string]: Table;
}

interface ParentTableEssentials {
  name: string;
  primaryKey?: string;
  relation: RelationType;
  isComposite: boolean;
}

export const COL_ARRAY_INDEX = "arrayIndex";
export const COL_ARRAY_VALUE = "value";
export const COL_ARRAY_VALUES = "values";

export const resolveTables = (
  rootTypes: InterfaceDeclaration[],
  tags: Tags
): TableMap => {
  const tables: TableMap = {};

  rootTypes.forEach((rootType) => {
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
  if (parent?.isComposite) {
    throw Error(
      `Children for composite types are not supported. Parent: ${parent.name}, Child: ${declaredType.name}`
    );
  }
  // check if table is already processed
  if (tables[declaredType.name]) {
    resolveExistingTable(declaredType, tables, parent);
    return; // table already resolved one way or another
  }

  const properties = getProperties(declaredType);
  const primaryKey = resolvePrimaryKey(declaredType, properties, tags);

  // resolve children first so that we can have its primary key
  declaredType.children.forEach((relation) => {
    const nextParent: ParentTableEssentials = {
      primaryKey,
      name: declaredType.name,
      relation: relation.type,
      isComposite: isComposite(declaredType),
    };
    visitNode(relation.child, tags, tables, nextParent);
  });

  const columns = resolveColumns(
    declaredType,
    properties,
    primaryKey,
    tags,
    parent
  );
  const foreignKeys = resolveForeignKeys(columns, parent);
  const indices = resolveIndices(properties, foreignKeys, tags, parent);
  const arrayTables = resolveArrayTables(
    declaredType,
    properties,
    tags,
    primaryKey
  );

  tables[declaredType.name] = {
    name: declaredType.name,
    primaryKey,
    declaredType,
    columns,
    foreignKeys,
    indices,
    type:
      parent?.relation === RelationType.OneToMany
        ? TableType.AdvancedArray
        : TableType.Default,
    arrayTables: arrayTables.map((t) => t.name),
    parentTableName: parent?.name,
    parentTablePrimaryKey: parent?.primaryKey,
  };

  arrayTables.forEach((arrayTable) => {
    tables[arrayTable.name] = arrayTable;
  });
};

const resolvePrimaryKey = (
  declaredType: DeclaredType,
  properties: PropertyMap,
  tags: Tags
) => {
  const propertyList = Object.values(properties);
  const propertiesWithDocTag = propertyList.filter((property) =>
    property.tags.some((tag) => tag === tags.primaryKey)
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
    (property) =>
      property.type === PropertyType.Number && property.name.endsWith("Id")
  );

  if (propertiesEndingWithId.length === 1) {
    return propertiesEndingWithId[0].name;
  }
  // always have primary key unless composite type (where we don't have a primary key if no id shared among all types)
  if (!isComposite(declaredType)) {
    const defaultPrimaryKey = `${declaredType.name[0].toLowerCase()}${declaredType.name.substr(
      1
    )}Id`;

    const property = properties[defaultPrimaryKey];
    if (
      property &&
      property.type === PropertyType.Number &&
      !property.isOptional
    ) {
      return defaultPrimaryKey;
    }

    let primaryKey = defaultPrimaryKey;
    let counter = 1;
    while (properties[primaryKey]) {
      counter += 1;
      primaryKey = `${defaultPrimaryKey}_${counter}`;
    }

    return primaryKey;
  }

  return undefined;
};

export const getProperties = (declaredType: DeclaredType): PropertyMap => {
  if (isInterface(declaredType)) {
    return declaredType.properties;
  }
  return declaredType.interfaces.reduce((props, interfaceDecl) => {
    return {
      ...props,
      ...interfaceDecl.properties,
    };
  }, {} as PropertyMap);
};

const resolveColumns = (
  declaredType: DeclaredType,
  properties: PropertyMap,
  primaryKey: string | undefined,
  tags: Tags,
  parent?: ParentTableEssentials
) => {
  const columns: Columns = {};

  Object.values(properties).forEach((property) => {
    if (!property.isArray) {
      const column = resolvePropertyToColumn(declaredType, property, tags);
      if (column) {
        columns[column.name] = column;
      }
    }
  });

  addColumnsForRelationship(columns, parent);

  // ensure primary key is added as column
  if (primaryKey && !columns[primaryKey]) {
    columns[primaryKey] = {
      name: primaryKey,
      primaryKey: true,
      notNull: true,
      kind: ColumnKind.GeneratedPrimaryKey,
      autoIncrement: false,
      unique: false,
      type: DataType.INTEGER,
    };
  }

  return columns;
};

const addColumnsForRelationship = (
  columns: Columns,
  parent?: ParentTableEssentials
) => {
  if (parent?.primaryKey && !columns[parent.primaryKey]) {
    // create column to reference parent
    columns[parent.primaryKey] = {
      name: parent.primaryKey,
      type: DataType.INTEGER,
      primaryKey: true,
      notNull: true,
      autoIncrement: false,
      unique: false,
      kind: ColumnKind.PrimaryKeyFromParent,
    };
  }

  // array type, add index column
  if (parent?.relation === RelationType.OneToMany) {
    if (!columns[COL_ARRAY_INDEX]) {
      columns[COL_ARRAY_INDEX] = {
        name: COL_ARRAY_INDEX,
        type: DataType.INTEGER,
        primaryKey: false,
        notNull: true,
        autoIncrement: false,
        unique: false,
        kind: ColumnKind.ArrayIndex,
      };
    }
  }
};

const getDefaultColumnProps = (
  declaredType: DeclaredType,
  property: PropertyDeclaration,
  tags: Tags,
  primaryKey?: string
) => {
  return {
    name: property.name,
    notNull: isInterface(declaredType) && !property.isOptional,
    primaryKey: primaryKey === property.name,
    autoIncrement:
      primaryKey === property.name ||
      property.tags.some((tag) => tag === tags.autoIncrement),
    unique: property.tags.some((tag) => tag === tags.unique),
  };
};

const resolvePropertyToColumn = (
  declaredType: DeclaredType,
  property: PropertyDeclaration,
  tags: Tags
): PropertyBasedColumn | null => {
  // dont create columns for arrays, we will create a table for it
  const columnDefaultProps: Omit<PropertyBasedColumn, "type"> = {
    ...getDefaultColumnProps(declaredType, property, tags),
    kind: ColumnKind.BasedOnProperty,
    property,
  };
  switch (property.type) {
    case PropertyType.Boolean:
      return {
        ...columnDefaultProps,
        type: DataType.NUMERIC,
      };
    case PropertyType.Number:
      if (property.tags.some((tag) => tag === tags.real)) {
        return {
          ...columnDefaultProps,
          type: DataType.REAL,
        };
      } else if (property.tags.some((tag) => tag === tags.numeric)) {
        return {
          ...columnDefaultProps,
          type: DataType.NUMERIC,
        };
      } else {
        return {
          ...columnDefaultProps,
          type: DataType.INTEGER,
        };
      }
      break;
    case PropertyType.String:
    case PropertyType.Date:
      return {
        ...columnDefaultProps,
        type: DataType.TEXT,
      };
      break;
    default:
      // do nothing (it is a relation type property)
      return null;
  }
};

const resolveArrayTables = (
  declaredType: DeclaredType,
  properties: PropertyMap,
  tags: Tags,
  primaryKey?: string
): BasicArrayTable[] => {
  const tables: BasicArrayTable[] = [];
  if (!primaryKey) {
    return tables;
  }
  Object.values(properties).forEach((property) => {
    if (property.isArray && property.isBasicType) {
      const columnDefaultProps = getDefaultColumnProps(
        declaredType,
        property,
        tags,
        primaryKey
      );
      const valueColumn = resolvePropertyToColumn(declaredType, property, tags);
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
        [COL_ARRAY_INDEX]: {
          ...columnDefaultProps,
          name: COL_ARRAY_INDEX,
          type: DataType.INTEGER,
          kind: ColumnKind.ArrayIndex,
        },
        value: {
          ...valueColumn,
          name: "value",
        },
        [primaryKey]: {
          ...columnDefaultProps,
          name: primaryKey,
          type: DataType.INTEGER,
          kind: ColumnKind.PrimaryKeyFromParent,
        },
      };

      tables.push({
        name: tableName,
        declaredType,
        columns,
        foreignKeys: [
          {
            columnName: primaryKey,
            parentTableName: declaredType.name,
            parentColumnName: primaryKey,
          },
        ],
        indices: [
          {
            unique: true,
            columnNames: [primaryKey, COL_ARRAY_INDEX],
          },
        ],
        type: TableType.BasicArray,
        property,
        parentTableName: declaredType.name,
        parentTablePrimaryKey: primaryKey,
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
      parentColumnName: parent.primaryKey,
    });
  }

  return foreignKeys;
};

const resolveIndices = (
  properties: PropertyMap,
  foreignKeys: ForeignKey[],
  tags: Tags,
  parent?: ParentTableEssentials
): Index[] => {
  const indices: Index[] = [];
  Object.values(properties).forEach((property) => {
    if (property.tags.some((tag) => tag === tags.index)) {
      indices.push({
        columnNames: [property.name],
        unique: false,
      });
    }
  });
  foreignKeys.forEach((foreignKey) => {
    indices.push({
      columnNames: [foreignKey.columnName],
      unique: false,
    });
  });
  // add unique constraint for index and parent primary key
  if (
    parent &&
    parent.primaryKey &&
    parent.relation === RelationType.OneToMany
  ) {
    indices.push({
      columnNames: [parent.primaryKey, COL_ARRAY_INDEX],
      unique: true,
    });
  }

  return indices;
};

const resolveExistingTable = (
  declaredType: DeclaredType,
  tables: TableMap,
  parent?: ParentTableEssentials
) => {
  // it already exists, check if declared type is an entry
  const existingTable = tables[declaredType.name];
  if (existingTable.declaredType.isEntry || declaredType.isEntry) {
    // ensure that we have fk  and any array index
    addColumnsForRelationship(existingTable.columns, parent);
    // ensure that we parent info
    existingTable.parentTableName =
      existingTable.parentTableName ?? parent?.name;
    existingTable.parentTablePrimaryKey =
      existingTable.parentTablePrimaryKey ?? parent?.primaryKey;
    existingTable.foreignKeys = [
      ...existingTable.foreignKeys,
      ...resolveForeignKeys(existingTable.columns, parent),
    ];
    if (
      isDefaultTable(existingTable) &&
      parent?.relation === RelationType.OneToMany
    ) {
      (existingTable as Table).type = TableType.AdvancedArray;
    }

    // since existing table is an entry, add nullable FK / array index
    existingTable.foreignKeys.forEach((fk) => {
      const column = existingTable.columns[fk.columnName];
      column.notNull = false;
      if (isPropertyBasedColumn(column)) {
        column.property.isOptional = true;
      }
    });
    const arrayIndexCol = existingTable.columns[COL_ARRAY_INDEX];
    if (arrayIndexCol) {
      arrayIndexCol.notNull = false;
    }

    // add unique constraint for one to many relationship
    if (
      existingTable.parentTablePrimaryKey &&
      parent?.relation === RelationType.OneToMany
    ) {
      existingTable.indices.push({
        unique: true,
        columnNames: [existingTable.parentTablePrimaryKey, COL_ARRAY_INDEX],
      });
    }
  }
};
