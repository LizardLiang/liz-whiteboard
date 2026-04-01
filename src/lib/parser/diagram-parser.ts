// src/lib/parser/diagram-parser.ts
// Diagram parser using Chevrotain
// Parses Mermaid-like text syntax into AST for ER diagrams

import { CstParser, Lexer, createToken } from 'chevrotain'
import type { IToken } from 'chevrotain'
import type {
  Cardinality,
  ColumnNode,
  DiagramAST,
  ParseError,
  ParseResult,
  RelationshipNode,
  TableNode,
} from './ast'
import type {
  CreateColumn,
  CreateRelationship,
  CreateTable,
} from '@/data/schema'

// ============================================================================
// Lexer Tokens
// ============================================================================

// Whitespace (skip)
const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t]+/,
  group: Lexer.SKIPPED,
})

// Newline
const NewLine = createToken({
  name: 'NewLine',
  pattern: /\r?\n/,
})

// Comments (skip)
const Comment = createToken({
  name: 'Comment',
  pattern: /#[^\n\r]*/,
  group: Lexer.SKIPPED,
})

// Keywords
const Table = createToken({ name: 'Table', pattern: /table/ })
const Pk = createToken({ name: 'Pk', pattern: /pk/ })
const Fk = createToken({ name: 'Fk', pattern: /fk/ })
const Unique = createToken({ name: 'Unique', pattern: /unique/ })
const Null = createToken({ name: 'Null', pattern: /null/ })

// Data types — longer/more-specific patterns MUST come before shorter prefix matches
// e.g. BigintType before IntType, SmallintType before IntType, DatetimeType before DateType, etc.
const BigintType = createToken({ name: 'BigintType', pattern: /bigint/ })
const SmallintType = createToken({ name: 'SmallintType', pattern: /smallint/ })
const IntType = createToken({ name: 'IntType', pattern: /int/ })
const DoubleType = createToken({ name: 'DoubleType', pattern: /double/ })
const DecimalType = createToken({ name: 'DecimalType', pattern: /decimal/ })
const FloatType = createToken({ name: 'FloatType', pattern: /float/ })
const SerialType = createToken({ name: 'SerialType', pattern: /serial/ })
const MoneyType = createToken({ name: 'MoneyType', pattern: /money/ })
const StringType = createToken({ name: 'StringType', pattern: /string/ })
const VarcharType = createToken({ name: 'VarcharType', pattern: /varchar/ })
const CharType = createToken({ name: 'CharType', pattern: /char/ })
const TextType = createToken({ name: 'TextType', pattern: /text/ })
const BooleanType = createToken({ name: 'BooleanType', pattern: /boolean/ })
const BitType = createToken({ name: 'BitType', pattern: /bit/ })
const DatetimeType = createToken({ name: 'DatetimeType', pattern: /datetime/ })
const TimestampType = createToken({ name: 'TimestampType', pattern: /timestamp/ })
const DateType = createToken({ name: 'DateType', pattern: /date/ })
const TimeType = createToken({ name: 'TimeType', pattern: /time/ })
const BinaryType = createToken({ name: 'BinaryType', pattern: /binary/ })
const BlobType = createToken({ name: 'BlobType', pattern: /blob/ })
const JsonType = createToken({ name: 'JsonType', pattern: /json/ })
const XmlType = createToken({ name: 'XmlType', pattern: /xml/ })
const ArrayType = createToken({ name: 'ArrayType', pattern: /array/ })
const EnumType = createToken({ name: 'EnumType', pattern: /enum/ })
const UuidType = createToken({ name: 'UuidType', pattern: /uuid/ })

// Cardinality — longer tokens must come before shorter ones that are prefixes
const ManyToZeroOrMany = createToken({
  name: 'ManyToZeroOrMany',
  pattern: /many-to-zero-or-many/,
})
const ManyToZeroOrOne = createToken({
  name: 'ManyToZeroOrOne',
  pattern: /many-to-zero-or-one/,
})
const ManyToMany = createToken({ name: 'ManyToMany', pattern: /many-to-many/ })
const ManyToOne = createToken({ name: 'ManyToOne', pattern: /many-to-one/ })
const ZeroOrManyToZeroOrMany = createToken({
  name: 'ZeroOrManyToZeroOrMany',
  pattern: /zero-or-many-to-zero-or-many/,
})
const ZeroOrManyToZeroOrOne = createToken({
  name: 'ZeroOrManyToZeroOrOne',
  pattern: /zero-or-many-to-zero-or-one/,
})
const ZeroOrManyToMany = createToken({
  name: 'ZeroOrManyToMany',
  pattern: /zero-or-many-to-many/,
})
const ZeroOrManyToOne = createToken({
  name: 'ZeroOrManyToOne',
  pattern: /zero-or-many-to-one/,
})
const ZeroOrOneToZeroOrMany = createToken({
  name: 'ZeroOrOneToZeroOrMany',
  pattern: /zero-or-one-to-zero-or-many/,
})
const ZeroOrOneToZeroOrOne = createToken({
  name: 'ZeroOrOneToZeroOrOne',
  pattern: /zero-or-one-to-zero-or-one/,
})
const ZeroOrOneToMany = createToken({
  name: 'ZeroOrOneToMany',
  pattern: /zero-or-one-to-many/,
})
const ZeroOrOneToOne = createToken({
  name: 'ZeroOrOneToOne',
  pattern: /zero-or-one-to-one/,
})
const ZeroToMany = createToken({ name: 'ZeroToMany', pattern: /zero-to-many/ })
const ZeroToOne = createToken({ name: 'ZeroToOne', pattern: /zero-to-one/ })
const OneToMany = createToken({ name: 'OneToMany', pattern: /one-to-many/ })
const OneToOne = createToken({ name: 'OneToOne', pattern: /one-to-one/ })
const SelfReferencing = createToken({
  name: 'SelfReferencing',
  pattern: /self-referencing/,
})

// Symbols
const LCurly = createToken({ name: 'LCurly', pattern: /{/ })
const RCurly = createToken({ name: 'RCurly', pattern: /}/ })
const LParen = createToken({ name: 'LParen', pattern: /\(/ })
const RParen = createToken({ name: 'RParen', pattern: /\)/ })
const Arrow = createToken({ name: 'Arrow', pattern: /->/ })
const Dot = createToken({ name: 'Dot', pattern: /\./ })

// Identifier (must be after keywords)
const Identifier = createToken({
  name: 'Identifier',
  pattern: /[a-zA-Z_][a-zA-Z0-9_]*/,
})

// String literal for descriptions/labels
const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"(?:[^\\"]|\\(?:[bfnrtv"\\/]|u[0-9a-fA-F]{4}))*"/,
})

// All tokens (order matters!)
const allTokens = [
  WhiteSpace,
  NewLine,
  Comment,
  // Keywords before Identifier
  Table,
  Pk,
  Fk,
  Unique,
  Null,
  // Cardinality tokens — longer patterns before shorter prefix matches
  ManyToZeroOrMany,
  ManyToZeroOrOne,
  ManyToMany,
  ManyToOne,
  ZeroOrManyToZeroOrMany,
  ZeroOrManyToZeroOrOne,
  ZeroOrManyToMany,
  ZeroOrManyToOne,
  ZeroOrOneToZeroOrMany,
  ZeroOrOneToZeroOrOne,
  ZeroOrOneToMany,
  ZeroOrOneToOne,
  ZeroToMany,
  ZeroToOne,
  OneToMany,
  OneToOne,
  SelfReferencing,
  // Data types — longer/more-specific patterns before shorter prefix matches
  BigintType,
  SmallintType,
  IntType,
  DoubleType,
  DecimalType,
  FloatType,
  SerialType,
  MoneyType,
  StringType,
  VarcharType,
  CharType,
  TextType,
  BooleanType,
  BitType,
  DatetimeType,
  TimestampType,
  DateType,
  TimeType,
  BinaryType,
  BlobType,
  JsonType,
  XmlType,
  ArrayType,
  EnumType,
  UuidType,
  // Symbols
  LCurly,
  RCurly,
  LParen,
  RParen,
  Arrow,
  Dot,
  // Identifier last
  StringLiteral,
  Identifier,
]

const DiagramLexer = new Lexer(allTokens)

// ============================================================================
// Parser
// ============================================================================

class DiagramParser extends CstParser {
  constructor() {
    super(allTokens)
    this.performSelfAnalysis()
  }

  /**
   * Root rule: diagram = (table | relationship | newline)*
   */
  public diagram = this.RULE('diagram', () => {
    this.MANY(() => {
      this.OR([
        { ALT: () => this.SUBRULE(this.table) },
        { ALT: () => this.SUBRULE(this.relationship) },
        { ALT: () => this.CONSUME(NewLine) },
      ])
    })
  })

  /**
   * Table rule: table Identifier { column* }
   */
  private table = this.RULE('table', () => {
    this.CONSUME(Table)
    this.CONSUME(Identifier, { LABEL: 'tableName' })
    this.OPTION(() => {
      this.CONSUME(StringLiteral, { LABEL: 'tableDescription' })
    })
    this.CONSUME(LCurly)
    this.MANY(() => {
      this.OR([
        { ALT: () => this.SUBRULE(this.column) },
        { ALT: () => this.CONSUME(NewLine) },
      ])
    })
    this.CONSUME(RCurly)
    this.OPTION2(() => this.CONSUME2(NewLine))
  })

  /**
   * Column rule: Identifier DataType (pk | fk | unique | null)*
   */
  private column = this.RULE('column', () => {
    this.CONSUME(Identifier, { LABEL: 'columnName' })
    this.SUBRULE(this.dataType)
    this.MANY(() => {
      this.SUBRULE(this.columnConstraint)
    })
    this.OPTION(() => {
      this.CONSUME(StringLiteral, { LABEL: 'columnDescription' })
    })
    this.OPTION2(() => this.CONSUME(NewLine))
  })

  /**
   * Data type rule: all supported column data types
   */
  private dataType = this.RULE('dataType', () => {
    this.OR([
      { ALT: () => this.CONSUME(BigintType) },
      { ALT: () => this.CONSUME(SmallintType) },
      { ALT: () => this.CONSUME(IntType) },
      { ALT: () => this.CONSUME(DoubleType) },
      { ALT: () => this.CONSUME(DecimalType) },
      { ALT: () => this.CONSUME(FloatType) },
      { ALT: () => this.CONSUME(SerialType) },
      { ALT: () => this.CONSUME(MoneyType) },
      { ALT: () => this.CONSUME(StringType) },
      { ALT: () => this.CONSUME(VarcharType) },
      { ALT: () => this.CONSUME(CharType) },
      { ALT: () => this.CONSUME(TextType) },
      { ALT: () => this.CONSUME(BooleanType) },
      { ALT: () => this.CONSUME(BitType) },
      { ALT: () => this.CONSUME(DatetimeType) },
      { ALT: () => this.CONSUME(TimestampType) },
      { ALT: () => this.CONSUME(DateType) },
      { ALT: () => this.CONSUME(TimeType) },
      { ALT: () => this.CONSUME(BinaryType) },
      { ALT: () => this.CONSUME(BlobType) },
      { ALT: () => this.CONSUME(JsonType) },
      { ALT: () => this.CONSUME(XmlType) },
      { ALT: () => this.CONSUME(ArrayType) },
      { ALT: () => this.CONSUME(EnumType) },
      { ALT: () => this.CONSUME(UuidType) },
    ])
  })

  /**
   * Column constraint: pk | fk | unique | null
   */
  private columnConstraint = this.RULE('columnConstraint', () => {
    this.OR([
      { ALT: () => this.CONSUME(Pk) },
      { ALT: () => this.CONSUME(Fk) },
      { ALT: () => this.CONSUME(Unique) },
      { ALT: () => this.CONSUME(Null) },
    ])
  })

  /**
   * Relationship rule: Identifier.Identifier -> Identifier.Identifier (Cardinality) [StringLiteral]
   */
  private relationship = this.RULE('relationship', () => {
    this.CONSUME(Identifier, { LABEL: 'sourceTable' })
    this.CONSUME(Dot)
    this.CONSUME2(Identifier, { LABEL: 'sourceColumn' })
    this.CONSUME(Arrow)
    this.CONSUME3(Identifier, { LABEL: 'targetTable' })
    this.CONSUME2(Dot)
    this.CONSUME4(Identifier, { LABEL: 'targetColumn' })
    this.CONSUME(LParen)
    this.SUBRULE(this.cardinality)
    this.CONSUME(RParen)
    this.OPTION(() => {
      this.CONSUME(StringLiteral, { LABEL: 'relationshipLabel' })
    })
    this.OPTION2(() => this.CONSUME(NewLine))
  })

  /**
   * Cardinality rule: all 17 cardinality types
   */
  private cardinality = this.RULE('cardinality', () => {
    this.OR([
      { ALT: () => this.CONSUME(ManyToZeroOrMany) },
      { ALT: () => this.CONSUME(ManyToZeroOrOne) },
      { ALT: () => this.CONSUME(ManyToMany) },
      { ALT: () => this.CONSUME(ManyToOne) },
      { ALT: () => this.CONSUME(ZeroOrManyToZeroOrMany) },
      { ALT: () => this.CONSUME(ZeroOrManyToZeroOrOne) },
      { ALT: () => this.CONSUME(ZeroOrManyToMany) },
      { ALT: () => this.CONSUME(ZeroOrManyToOne) },
      { ALT: () => this.CONSUME(ZeroOrOneToZeroOrMany) },
      { ALT: () => this.CONSUME(ZeroOrOneToZeroOrOne) },
      { ALT: () => this.CONSUME(ZeroOrOneToMany) },
      { ALT: () => this.CONSUME(ZeroOrOneToOne) },
      { ALT: () => this.CONSUME(ZeroToMany) },
      { ALT: () => this.CONSUME(ZeroToOne) },
      { ALT: () => this.CONSUME(OneToMany) },
      { ALT: () => this.CONSUME(OneToOne) },
      { ALT: () => this.CONSUME(SelfReferencing) },
    ])
  })
}

// Create singleton parser instance
const parserInstance = new DiagramParser()

// ============================================================================
// CST Visitor (converts CST to AST)
// ============================================================================

const BaseCstVisitor = parserInstance.getBaseCstVisitorConstructor()

class DiagramVisitor extends BaseCstVisitor {
  constructor() {
    super()
    this.validateVisitor()
  }

  diagram(ctx: any): DiagramAST {
    const tables: Array<TableNode> = []
    const relationships: Array<RelationshipNode> = []

    if (ctx.table) {
      for (const tableCtx of ctx.table) {
        tables.push(this.visit(tableCtx))
      }
    }

    if (ctx.relationship) {
      for (const relCtx of ctx.relationship) {
        relationships.push(this.visit(relCtx))
      }
    }

    return { tables, relationships }
  }

  table(ctx: any): TableNode {
    const name = ctx.tableName[0].image
    const description = ctx.tableDescription
      ? this.parseStringLiteral(ctx.tableDescription[0].image)
      : undefined

    const columns: Array<ColumnNode> = []
    if (ctx.column) {
      for (const colCtx of ctx.column) {
        columns.push(this.visit(colCtx))
      }
    }

    return {
      type: 'table',
      name,
      description,
      columns,
      position: this.getPosition(ctx.tableName[0]),
    }
  }

  column(ctx: any): ColumnNode {
    const name = ctx.columnName[0].image
    const dataType = this.visit(ctx.dataType)
    const description = ctx.columnDescription
      ? this.parseStringLiteral(ctx.columnDescription[0].image)
      : undefined

    let isPrimaryKey = false
    let isForeignKey = false
    let isUnique = false
    let isNullable = true

    if (ctx.columnConstraint) {
      for (const constraint of ctx.columnConstraint) {
        const constraintResult = this.visit(constraint)
        if (constraintResult === 'pk') isPrimaryKey = true
        if (constraintResult === 'fk') isForeignKey = true
        if (constraintResult === 'unique') isUnique = true
        if (constraintResult === 'null') isNullable = true
      }
    }

    // If no 'null' constraint specified, default to NOT NULL
    if (
      !ctx.columnConstraint ||
      !ctx.columnConstraint.some((c: any) => c.children.Null)
    ) {
      isNullable = false
    }

    return {
      type: 'column',
      name,
      dataType,
      isPrimaryKey,
      isForeignKey,
      isUnique,
      isNullable,
      description,
      position: this.getPosition(ctx.columnName[0]),
    }
  }

  dataType(ctx: any): ColumnNode['dataType'] {
    if (ctx.BigintType) return 'bigint'
    if (ctx.SmallintType) return 'smallint'
    if (ctx.IntType) return 'int'
    if (ctx.DoubleType) return 'double'
    if (ctx.DecimalType) return 'decimal'
    if (ctx.FloatType) return 'float'
    if (ctx.SerialType) return 'serial'
    if (ctx.MoneyType) return 'money'
    if (ctx.StringType) return 'string'
    if (ctx.VarcharType) return 'varchar'
    if (ctx.CharType) return 'char'
    if (ctx.TextType) return 'text'
    if (ctx.BooleanType) return 'boolean'
    if (ctx.BitType) return 'bit'
    if (ctx.DatetimeType) return 'datetime'
    if (ctx.TimestampType) return 'timestamp'
    if (ctx.DateType) return 'date'
    if (ctx.TimeType) return 'time'
    if (ctx.BinaryType) return 'binary'
    if (ctx.BlobType) return 'blob'
    if (ctx.JsonType) return 'json'
    if (ctx.XmlType) return 'xml'
    if (ctx.ArrayType) return 'array'
    if (ctx.EnumType) return 'enum'
    if (ctx.UuidType) return 'uuid'
    throw new Error('Unknown data type')
  }

  columnConstraint(ctx: any): string {
    if (ctx.Pk) return 'pk'
    if (ctx.Fk) return 'fk'
    if (ctx.Unique) return 'unique'
    if (ctx.Null) return 'null'
    throw new Error('Unknown column constraint')
  }

  relationship(ctx: any): RelationshipNode {
    const sourceTable = ctx.sourceTable[0].image
    const sourceColumn = ctx.sourceColumn[0].image
    const targetTable = ctx.targetTable[0].image
    const targetColumn = ctx.targetColumn[0].image
    const cardinality = this.visit(ctx.cardinality)
    const label = ctx.relationshipLabel
      ? this.parseStringLiteral(ctx.relationshipLabel[0].image)
      : undefined

    return {
      type: 'relationship',
      sourceTable,
      sourceColumn,
      targetTable,
      targetColumn,
      cardinality,
      label,
      position: this.getPosition(ctx.sourceTable[0]),
    }
  }

  cardinality(ctx: any): Cardinality {
    if (ctx.OneToOne) return 'one-to-one'
    if (ctx.OneToMany) return 'one-to-many'
    if (ctx.ManyToOne) return 'many-to-one'
    if (ctx.ManyToMany) return 'many-to-many'
    if (ctx.ZeroToOne) return 'zero-to-one'
    if (ctx.ZeroToMany) return 'zero-to-many'
    if (ctx.SelfReferencing) return 'self-referencing'
    if (ctx.ManyToZeroOrOne) return 'many-to-zero-or-one'
    if (ctx.ManyToZeroOrMany) return 'many-to-zero-or-many'
    if (ctx.ZeroOrOneToOne) return 'zero-or-one-to-one'
    if (ctx.ZeroOrOneToMany) return 'zero-or-one-to-many'
    if (ctx.ZeroOrOneToZeroOrOne) return 'zero-or-one-to-zero-or-one'
    if (ctx.ZeroOrOneToZeroOrMany) return 'zero-or-one-to-zero-or-many'
    if (ctx.ZeroOrManyToOne) return 'zero-or-many-to-one'
    if (ctx.ZeroOrManyToMany) return 'zero-or-many-to-many'
    if (ctx.ZeroOrManyToZeroOrOne) return 'zero-or-many-to-zero-or-one'
    if (ctx.ZeroOrManyToZeroOrMany) return 'zero-or-many-to-zero-or-many'
    throw new Error('Unknown cardinality')
  }

  private parseStringLiteral(str: string): string {
    // Remove quotes and unescape
    return str.slice(1, -1).replace(/\\"/g, '"')
  }

  private getPosition(token: IToken) {
    return {
      line: token.startLine ?? 0,
      column: token.startColumn ?? 0,
      offset: token.startOffset,
    }
  }
}

const visitor = new DiagramVisitor()

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse diagram text into AST
 * @param text - Text-based diagram syntax
 * @returns Parse result with AST or errors
 */
export function parseDiagram(text: string): ParseResult {
  // Tokenize
  const lexResult = DiagramLexer.tokenize(text)

  if (lexResult.errors.length > 0) {
    return {
      success: false,
      errors: lexResult.errors.map((err) => ({
        message: err.message,
        line: err.line ?? 0,
        column: err.column ?? 0,
        offset: err.offset,
        length: err.length,
      })),
    }
  }

  // Parse
  parserInstance.input = lexResult.tokens
  const cst = parserInstance.diagram()

  if (parserInstance.errors.length > 0) {
    return {
      success: false,
      errors: parserInstance.errors.map((err) => ({
        message: err.message,
        line: err.token.startLine ?? 0,
        column: err.token.startColumn ?? 0,
        offset: err.token.startOffset,
        length: err.token.image.length,
      })),
    }
  }

  // Convert CST to AST
  try {
    const ast = visitor.visit(cst)
    return {
      success: true,
      ast,
      errors: [],
    }
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          message:
            error instanceof Error
              ? error.message
              : 'Unknown error during AST conversion',
          line: 0,
          column: 0,
          offset: 0,
        },
      ],
    }
  }
}

/**
 * Convert AST to database entities
 * Maps Cardinality enum values from text syntax to Prisma enum
 */
type PrismaCardinality =
  | 'ONE_TO_ONE'
  | 'ONE_TO_MANY'
  | 'MANY_TO_ONE'
  | 'MANY_TO_MANY'
  | 'ZERO_TO_ONE'
  | 'ZERO_TO_MANY'
  | 'SELF_REFERENCING'
  | 'MANY_TO_ZERO_OR_ONE'
  | 'MANY_TO_ZERO_OR_MANY'
  | 'ZERO_OR_ONE_TO_ONE'
  | 'ZERO_OR_ONE_TO_MANY'
  | 'ZERO_OR_ONE_TO_ZERO_OR_ONE'
  | 'ZERO_OR_ONE_TO_ZERO_OR_MANY'
  | 'ZERO_OR_MANY_TO_ONE'
  | 'ZERO_OR_MANY_TO_MANY'
  | 'ZERO_OR_MANY_TO_ZERO_OR_ONE'
  | 'ZERO_OR_MANY_TO_ZERO_OR_MANY'

function mapCardinality(cardinality: Cardinality): PrismaCardinality {
  const mapping: Record<Cardinality, PrismaCardinality> = {
    'one-to-one': 'ONE_TO_ONE',
    'one-to-many': 'ONE_TO_MANY',
    'many-to-one': 'MANY_TO_ONE',
    'many-to-many': 'MANY_TO_MANY',
    'zero-to-one': 'ZERO_TO_ONE',
    'zero-to-many': 'ZERO_TO_MANY',
    'self-referencing': 'SELF_REFERENCING',
    'many-to-zero-or-one': 'MANY_TO_ZERO_OR_ONE',
    'many-to-zero-or-many': 'MANY_TO_ZERO_OR_MANY',
    'zero-or-one-to-one': 'ZERO_OR_ONE_TO_ONE',
    'zero-or-one-to-many': 'ZERO_OR_ONE_TO_MANY',
    'zero-or-one-to-zero-or-one': 'ZERO_OR_ONE_TO_ZERO_OR_ONE',
    'zero-or-one-to-zero-or-many': 'ZERO_OR_ONE_TO_ZERO_OR_MANY',
    'zero-or-many-to-one': 'ZERO_OR_MANY_TO_ONE',
    'zero-or-many-to-many': 'ZERO_OR_MANY_TO_MANY',
    'zero-or-many-to-zero-or-one': 'ZERO_OR_MANY_TO_ZERO_OR_ONE',
    'zero-or-many-to-zero-or-many': 'ZERO_OR_MANY_TO_ZERO_OR_MANY',
  }
  return mapping[cardinality]
}

/**
 * Convert parsed AST to entities that can be created in database
 * @param ast - Parsed diagram AST
 * @param whiteboardId - Whiteboard UUID to associate entities with
 * @returns Object containing tables and relationships with metadata
 */
export function astToEntities(
  ast: DiagramAST,
  whiteboardId: string,
): {
  tables: Array<{
    table: Omit<CreateTable, 'whiteboardId'>
    columns: Array<Omit<CreateColumn, 'tableId'>>
  }>
  relationships: Array<{
    sourceTable: string
    sourceColumn: string
    targetTable: string
    targetColumn: string
    cardinality: PrismaCardinality
    label?: string
  }>
} {
  const tables = ast.tables.map((tableNode, index) => ({
    table: {
      name: tableNode.name,
      description: tableNode.description,
      positionX: 100 + (index % 3) * 350, // Arrange in grid
      positionY: 100 + Math.floor(index / 3) * 400,
    },
    columns: tableNode.columns.map((columnNode, colIndex) => ({
      name: columnNode.name,
      dataType: columnNode.dataType,
      isPrimaryKey: columnNode.isPrimaryKey,
      isForeignKey: columnNode.isForeignKey,
      isUnique: columnNode.isUnique,
      isNullable: columnNode.isNullable,
      description: columnNode.description,
      order: colIndex,
    })),
  }))

  const relationships = ast.relationships.map((relNode) => ({
    sourceTable: relNode.sourceTable,
    sourceColumn: relNode.sourceColumn,
    targetTable: relNode.targetTable,
    targetColumn: relNode.targetColumn,
    cardinality: mapCardinality(relNode.cardinality),
    label: relNode.label,
  }))

  return { tables, relationships }
}

/**
 * Generate text source from database entities
 * Used for bidirectional sync (canvas → text)
 * @param tables - Array of tables with columns
 * @param relationships - Array of relationships
 * @returns Text-based diagram syntax
 */
export function entitiesToText(
  tables: Array<{
    id?: string
    name: string
    description?: string | null
    columns: Array<{
      id?: string
      name: string
      dataType: string
      isPrimaryKey: boolean
      isForeignKey: boolean
      isUnique: boolean
      isNullable: boolean
      description?: string | null
    }>
  }>,
  relationships: Array<{
    id?: string
    sourceTableId?: string
    targetTableId?: string
    sourceColumnId?: string
    targetColumnId?: string
    sourceTable?: { name: string } | { id: string; name: string }
    targetTable?: { name: string } | { id: string; name: string }
    sourceColumn?: { name: string } | { id: string; name: string }
    targetColumn?: { name: string } | { id: string; name: string }
    cardinality: string
    label?: string | null
  }>,
): string {
  // Handle empty case
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!tables || tables.length === 0) {
    return '# ER Diagram\n\n# No tables defined yet\n'
  }

  let text = '# ER Diagram\n\n'

  // Generate table definitions
  for (const table of tables) {
    text += `table ${table.name}`
    if (table.description) {
      text += ` "${table.description}"`
    }
    text += ' {\n'

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (table.columns && table.columns.length > 0) {
      for (const column of table.columns) {
        text += `  ${column.name} ${column.dataType}`
        if (column.isPrimaryKey) text += ' pk'
        if (column.isForeignKey) text += ' fk'
        if (column.isUnique) text += ' unique'
        if (column.isNullable) text += ' null'
        if (column.description) {
          text += ` "${column.description}"`
        }
        text += '\n'
      }
    }

    text += '}\n\n'
  }

  // Generate relationship definitions
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (relationships && relationships.length > 0) {
    for (const rel of relationships) {
      // Handle both nested objects and IDs
      const sourceTableName = rel.sourceTable?.name
      const targetTableName = rel.targetTable?.name
      const sourceColumnName = rel.sourceColumn?.name
      const targetColumnName = rel.targetColumn?.name

      // Skip relationships with missing data
      if (
        !sourceTableName ||
        !targetTableName ||
        !sourceColumnName ||
        !targetColumnName
      ) {
        console.warn('Skipping relationship with missing data:', rel)
        continue
      }

      const cardinality = rel.cardinality.toLowerCase().replace(/_/g, '-')
      text += `${sourceTableName}.${sourceColumnName} -> ${targetTableName}.${targetColumnName} (${cardinality})`
      if (rel.label) {
        text += ` "${rel.label}"`
      }
      text += '\n'
    }
  }

  return text
}
