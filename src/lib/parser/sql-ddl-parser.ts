// src/lib/parser/sql-ddl-parser.ts
//
// SQL DDL -> DiagramAST parser (import counterpart to ddl-generator.ts's
// export). Scope: `CREATE TABLE [IF NOT EXISTS] name ( colDefs, tableConstraints )`
// per dialect (Postgres/MySQL/MSSQL) — see the spec delta at
// .claude/feature/import-sql-ddl/spec-delta/import-sql-ddl.md.
//
// Design: the whole pasted script is split into top-level statements first
// (paren/quote-depth-aware, so semicolons inside strings/parens don't split
// incorrectly), comments stripped in a length-preserving way so absolute
// character offsets keep matching the original text for accurate error
// positions. Each statement is then either parsed (if it starts with
// `CREATE TABLE`) with the Chevrotain grammar below, or skipped with a
// warning — one broken or unsupported statement never fails the whole paste
// (see spec delta point 3 and the tactical plan's Risks section).
//
// Chevrotain lexer/CstParser/visitor structure mirrors diagram-parser.ts.

import { CstParser, Lexer, createToken } from 'chevrotain'
import { sqlTypeToDataType } from './sql-type-map'
import type { IToken } from 'chevrotain'
import type { Dialect } from '@/lib/ddl-generator'
import type { DataType } from '@/data/schema'
import type {
  Cardinality,
  ColumnNode,
  DiagramAST,
  ParseError,
  RelationshipNode,
  TableNode,
} from './ast'

// ============================================================================
// Public types
// ============================================================================

/**
 * Result of parsing a pasted SQL DDL script. Extends the shape of the
 * existing ER-text ParseResult with `warnings` for skipped-statement /
 * unmapped-type notices (see spec delta point 3).
 *
 * `success` is true only when zero statements produced a hard error.
 * `ast` is always populated with whatever DID parse successfully — even
 * when `success` is false — so a paste with one malformed table can still
 * import every other valid table in it (partial success, never a crash).
 */
export interface SqlParseResult {
  success: boolean
  ast: DiagramAST
  warnings: Array<string>
  errors: Array<ParseError>
}

// ============================================================================
// Preprocessing: comment stripping + top-level statement splitting
// ============================================================================

interface Statement {
  text: string
  /** Absolute character offset of `text[0]` within the original input. */
  startOffset: number
}

/**
 * Strips `--` line comments and `/* ... *\/` block comments, replacing their
 * characters with spaces (newlines inside block comments are preserved) so
 * the result has exactly the same length and newline positions as the
 * input — every downstream offset stays valid against the original text.
 * Comment-looking sequences inside a quoted string/identifier are left
 * alone (tracked via the same quote-state machine used for splitting below).
 */
function stripComments(sql: string): string {
  const n = sql.length
  const out: Array<string> = sql.split('')
  let i = 0
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inBracket = false

  while (i < n) {
    const c = sql[i]

    if (inSingle || inDouble || inBacktick || inBracket) {
      if (inSingle && c === "'") {
        if (sql[i + 1] === "'") {
          i += 2
          continue
        }
        inSingle = false
        i++
        continue
      }
      if (inDouble && c === '"') {
        if (sql[i + 1] === '"') {
          i += 2
          continue
        }
        inDouble = false
        i++
        continue
      }
      if (inBacktick && c === '`') {
        if (sql[i + 1] === '`') {
          i += 2
          continue
        }
        inBacktick = false
        i++
        continue
      }
      if (inBracket && c === ']') {
        if (sql[i + 1] === ']') {
          i += 2
          continue
        }
        inBracket = false
        i++
        continue
      }
      i++
      continue
    }

    if (c === "'") {
      inSingle = true
      i++
      continue
    }
    if (c === '"') {
      inDouble = true
      i++
      continue
    }
    if (c === '`') {
      inBacktick = true
      i++
      continue
    }
    if (c === '[') {
      inBracket = true
      i++
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      let j = i
      while (j < n && sql[j] !== '\n') {
        out[j] = ' '
        j++
      }
      i = j
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      let j = i
      while (j < n && !(sql[j] === '*' && sql[j + 1] === '/')) {
        out[j] = sql[j] === '\n' ? '\n' : ' '
        j++
      }
      if (j < n) {
        out[j] = ' '
        out[j + 1] = ' '
        j += 2
      }
      i = j
      continue
    }
    i++
  }

  return out.join('')
}

/**
 * Splits `cleaned` (already comment-stripped) into top-level statements on
 * `;`, tracking paren depth and quote/bracket state so semicolons inside
 * string literals, quoted identifiers, or nested parens never split
 * incorrectly. Empty (whitespace-only) statements are dropped.
 */
function splitStatements(cleaned: string): Array<Statement> {
  const n = cleaned.length
  const statements: Array<Statement> = []
  let depth = 0
  let start = 0
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inBracket = false

  for (let k = 0; k < n; k++) {
    const c = cleaned[k]

    if (inSingle || inDouble || inBacktick || inBracket) {
      if (inSingle && c === "'") {
        if (cleaned[k + 1] === "'") {
          k++
          continue
        }
        inSingle = false
        continue
      }
      if (inDouble && c === '"') {
        if (cleaned[k + 1] === '"') {
          k++
          continue
        }
        inDouble = false
        continue
      }
      if (inBacktick && c === '`') {
        if (cleaned[k + 1] === '`') {
          k++
          continue
        }
        inBacktick = false
        continue
      }
      if (inBracket && c === ']') {
        if (cleaned[k + 1] === ']') {
          k++
          continue
        }
        inBracket = false
        continue
      }
      continue
    }

    if (c === "'") {
      inSingle = true
      continue
    }
    if (c === '"') {
      inDouble = true
      continue
    }
    if (c === '`') {
      inBacktick = true
      continue
    }
    if (c === '[') {
      inBracket = true
      continue
    }
    if (c === '(') {
      depth++
      continue
    }
    if (c === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (c === ';' && depth === 0) {
      statements.push({ text: cleaned.slice(start, k), startOffset: start })
      start = k + 1
      continue
    }
  }

  if (start < n) {
    statements.push({ text: cleaned.slice(start), startOffset: start })
  }

  return statements.filter((s) => s.text.trim().length > 0)
}

/** 1-based line/column for `offset` within `text`. */
function offsetToLineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1
  let lastNewline = -1
  const end = Math.min(offset, text.length)
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++
      lastNewline = i
    }
  }
  return { line, column: offset - lastNewline }
}

/** Strips quoting delimiters from an identifier, unescaping doubled delimiters. */
function unquoteIdent(raw: string): string {
  if (raw.length >= 2) {
    if (raw[0] === '"' && raw[raw.length - 1] === '"') {
      return raw.slice(1, -1).replace(/""/g, '"')
    }
    if (raw[0] === '`' && raw[raw.length - 1] === '`') {
      return raw.slice(1, -1).replace(/``/g, '`')
    }
    if (raw[0] === '[' && raw[raw.length - 1] === ']') {
      return raw.slice(1, -1).replace(/\]\]/g, ']')
    }
  }
  return raw
}

// ============================================================================
// Lexer tokens
// ============================================================================

const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /\s+/,
  group: Lexer.SKIPPED,
})

// A statement-isolated trailing `;` (defensive — splitStatements already
// consumes top-level semicolons, but tolerate a stray one).
const Semicolon = createToken({
  name: 'Semicolon',
  pattern: /;/,
  group: Lexer.SKIPPED,
})

// Keywords — case-insensitive, word-bounded so they never swallow the
// leading characters of a longer identifier (e.g. "createdAt"). Must precede
// Identifier in the token list below.
const CreateKw = createToken({ name: 'CreateKw', pattern: /create\b/i })
const TableKw = createToken({ name: 'TableKw', pattern: /table\b/i })
const IfKw = createToken({ name: 'IfKw', pattern: /if\b/i })
const NotKw = createToken({ name: 'NotKw', pattern: /not\b/i })
const ExistsKw = createToken({ name: 'ExistsKw', pattern: /exists\b/i })
const PrimaryKw = createToken({ name: 'PrimaryKw', pattern: /primary\b/i })
const KeyKw = createToken({ name: 'KeyKw', pattern: /key\b/i })
const ForeignKw = createToken({ name: 'ForeignKw', pattern: /foreign\b/i })
const ReferencesKw = createToken({
  name: 'ReferencesKw',
  pattern: /references\b/i,
})
const UniqueKw = createToken({ name: 'UniqueKw', pattern: /unique\b/i })
const NullKw = createToken({ name: 'NullKw', pattern: /null\b/i })
const ConstraintKw = createToken({
  name: 'ConstraintKw',
  pattern: /constraint\b/i,
})
const DefaultKw = createToken({ name: 'DefaultKw', pattern: /default\b/i })
const OnKw = createToken({ name: 'OnKw', pattern: /on\b/i })

// Symbols
const LParen = createToken({ name: 'LParen', pattern: /\(/ })
const RParen = createToken({ name: 'RParen', pattern: /\)/ })
const Comma = createToken({ name: 'Comma', pattern: /,/ })
const Dot = createToken({ name: 'Dot', pattern: /\./ })

// Quoted identifiers — all three accepted regardless of dialect (lenient;
// real-world pastes don't always match their own dialect's convention).
const DoubleQuotedIdent = createToken({
  name: 'DoubleQuotedIdent',
  pattern: /"(?:[^"]|"")*"/,
})
const BacktickIdent = createToken({
  name: 'BacktickIdent',
  pattern: /`(?:[^`]|``)*`/,
})
const BracketIdent = createToken({
  name: 'BracketIdent',
  pattern: /\[(?:[^\]]|\]\])*\]/,
})

const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /'(?:[^']|'')*'/,
})
const NumberLiteral = createToken({
  name: 'NumberLiteral',
  pattern: /\d+(\.\d+)?/,
})

// Bare identifier — must be last so every keyword above gets first refusal.
const Identifier = createToken({
  name: 'Identifier',
  pattern: /[A-Za-z_][A-Za-z0-9_$]*/,
})

const allTokens = [
  WhiteSpace,
  Semicolon,
  CreateKw,
  TableKw,
  IfKw,
  NotKw,
  ExistsKw,
  PrimaryKw,
  KeyKw,
  ForeignKw,
  ReferencesKw,
  UniqueKw,
  NullKw,
  ConstraintKw,
  DefaultKw,
  OnKw,
  LParen,
  RParen,
  Comma,
  Dot,
  DoubleQuotedIdent,
  BacktickIdent,
  BracketIdent,
  StringLiteral,
  NumberLiteral,
  Identifier,
]

const DdlLexer = new Lexer(allTokens)

// ============================================================================
// Parser
// ============================================================================

class DdlParser extends CstParser {
  constructor() {
    super(allTokens)
    this.performSelfAnalysis()
  }

  /** `[schema.]identifier` — the ident() rule accepts bare or quoted forms. */
  public ident = this.RULE('ident', () => {
    this.OR([
      { ALT: () => this.CONSUME(Identifier) },
      { ALT: () => this.CONSUME(DoubleQuotedIdent) },
      { ALT: () => this.CONSUME(BacktickIdent) },
      { ALT: () => this.CONSUME(BracketIdent) },
    ])
  })

  public qualifiedName = this.RULE('qualifiedName', () => {
    this.SUBRULE(this.ident)
    this.MANY(() => {
      this.CONSUME(Dot)
      this.SUBRULE2(this.ident)
    })
  })

  public colList = this.RULE('colList', () => {
    this.SUBRULE(this.ident)
    this.MANY(() => {
      this.CONSUME(Comma)
      this.SUBRULE2(this.ident)
    })
  })

  /** Base type word(s) + an optional single parameter group, e.g.
   * "VARCHAR(255)", "DOUBLE PRECISION", "INT AUTO_INCREMENT", "NVARCHAR(MAX)". */
  public dataType = this.RULE('dataType', () => {
    this.CONSUME(Identifier, { LABEL: 'typeWord' })
    this.OPTION(() => this.CONSUME2(Identifier, { LABEL: 'typeWord' }))
    this.OPTION2(() => {
      this.CONSUME(LParen)
      this.OR([
        { ALT: () => this.CONSUME(NumberLiteral, { LABEL: 'typeParam' }) },
        { ALT: () => this.CONSUME3(Identifier, { LABEL: 'typeParam' }) },
      ])
      this.MANY(() => {
        this.CONSUME(Comma)
        this.CONSUME2(NumberLiteral, { LABEL: 'typeParam' })
      })
      this.CONSUME(RParen)
    })
  })

  /** Lenient `ON DELETE|UPDATE CASCADE|RESTRICT|SET NULL|SET DEFAULT|NO ACTION`
   * tolerance — consumed and discarded (referential actions aren't part of
   * the diagram model). */
  public onAction = this.RULE('onAction', () => {
    this.CONSUME(OnKw)
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(Identifier) },
        { ALT: () => this.CONSUME(NullKw) },
      ])
    })
  })

  /** Lenient DEFAULT value — a literal, keyword, or a simple (no-comma-arg)
   * function call. Not persisted (Column model has no default field); only
   * consumed so it doesn't break the rest of the column/table parse. */
  public defaultValue = this.RULE('defaultValue', () => {
    this.OR([
      { ALT: () => this.CONSUME(StringLiteral) },
      { ALT: () => this.CONSUME(NumberLiteral) },
      { ALT: () => this.CONSUME(NullKw) },
      {
        ALT: () => {
          this.CONSUME(Identifier)
          this.OPTION(() => {
            this.CONSUME(LParen)
            this.OPTION2(() => {
              this.OR2([
                { ALT: () => this.CONSUME2(StringLiteral) },
                { ALT: () => this.CONSUME2(NumberLiteral) },
                { ALT: () => this.CONSUME2(Identifier) },
              ])
            })
            this.CONSUME(RParen)
          })
        },
      },
    ])
  })

  public columnConstraint = this.RULE('columnConstraint', () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(PrimaryKw)
          this.CONSUME(KeyKw)
        },
      },
      {
        ALT: () => {
          this.CONSUME(NotKw)
          this.CONSUME(NullKw)
        },
      },
      { ALT: () => this.CONSUME2(NullKw) },
      { ALT: () => this.CONSUME(UniqueKw) },
      {
        ALT: () => {
          this.CONSUME(ReferencesKw)
          this.SUBRULE(this.qualifiedName, { LABEL: 'refTable' })
          this.CONSUME(LParen)
          this.SUBRULE(this.ident, { LABEL: 'refColumn' })
          this.CONSUME(RParen)
          this.MANY(() => this.SUBRULE(this.onAction))
        },
      },
      {
        ALT: () => {
          this.CONSUME(DefaultKw)
          this.SUBRULE(this.defaultValue)
        },
      },
    ])
  })

  public columnDef = this.RULE('columnDef', () => {
    this.SUBRULE(this.ident, { LABEL: 'columnName' })
    this.SUBRULE(this.dataType)
    this.MANY(() => this.SUBRULE(this.columnConstraint))
  })

  public tableConstraint = this.RULE('tableConstraint', () => {
    this.OPTION(() => {
      this.CONSUME(ConstraintKw)
      this.SUBRULE(this.ident, { LABEL: 'constraintName' })
    })
    this.OR([
      {
        ALT: () => {
          this.CONSUME(PrimaryKw)
          this.CONSUME(KeyKw)
          this.CONSUME(LParen)
          this.SUBRULE(this.colList, { LABEL: 'pkCols' })
          this.CONSUME(RParen)
        },
      },
      {
        ALT: () => {
          this.CONSUME(ForeignKw)
          this.CONSUME2(KeyKw)
          this.CONSUME2(LParen)
          this.SUBRULE2(this.colList, { LABEL: 'fkCols' })
          this.CONSUME2(RParen)
          this.CONSUME(ReferencesKw)
          this.SUBRULE(this.qualifiedName, { LABEL: 'refTable' })
          this.CONSUME3(LParen)
          this.SUBRULE3(this.colList, { LABEL: 'refCols' })
          this.CONSUME3(RParen)
          this.MANY(() => this.SUBRULE(this.onAction))
        },
      },
      {
        ALT: () => {
          this.CONSUME(UniqueKw)
          this.CONSUME4(LParen)
          this.SUBRULE4(this.colList, { LABEL: 'uniqueCols' })
          this.CONSUME4(RParen)
        },
      },
    ])
  })

  public tableElement = this.RULE('tableElement', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.tableConstraint) },
      { ALT: () => this.SUBRULE(this.columnDef) },
    ])
  })

  public createTableStatement = this.RULE('createTableStatement', () => {
    this.CONSUME(CreateKw)
    this.CONSUME(TableKw)
    this.OPTION(() => {
      this.CONSUME(IfKw)
      this.CONSUME(NotKw)
      this.CONSUME(ExistsKw)
    })
    this.SUBRULE(this.qualifiedName, { LABEL: 'tableName' })
    this.CONSUME(LParen)
    this.SUBRULE(this.tableElement, { LABEL: 'elements' })
    this.MANY(() => {
      this.CONSUME(Comma)
      this.SUBRULE2(this.tableElement, { LABEL: 'elements' })
    })
    this.CONSUME(RParen)
  })
}

const parserInstance = new DdlParser()

// ============================================================================
// CST Visitor (converts CST to intermediate structures)
// ============================================================================

type ColumnConstraintResult =
  | { kind: 'pk' }
  | { kind: 'notNull' }
  | { kind: 'null' }
  | { kind: 'unique' }
  | { kind: 'default' }
  | { kind: 'references'; targetTable: string; targetColumn: string }

type TableConstraintResult =
  | { kind: 'pk'; columns: Array<string> }
  | { kind: 'unique'; columns: Array<string> }
  | {
      kind: 'fk'
      columns: Array<string>
      refTable: string
      refColumns: Array<string>
    }

interface ColumnDefResult {
  kind: 'column'
  column: ColumnNode
  reference?: { targetTable: string; targetColumn: string }
}

interface CreateTableResult {
  tableName: string
  columns: Array<ColumnNode>
  inlineRefs: Array<{
    sourceColumn: string
    targetTable: string
    targetColumn: string
  }>
  tableConstraints: Array<TableConstraintResult>
}

const BaseCstVisitor = parserInstance.getBaseCstVisitorConstructor()

class DdlVisitor extends BaseCstVisitor {
  private statementText = ''
  private dialect: Dialect = 'postgres'
  private warnings: Array<string> = []

  constructor() {
    super()
    this.validateVisitor()
  }

  /** Must be called before every `.visit()` — this visitor instance is a
   * reused singleton (mirrors diagram-parser.ts), so per-parse state (the
   * source text for raw-type-span slicing, the active dialect, and the
   * accumulated type-mapping warnings) is reset here rather than threaded
   * through every visitor method's return value. */
  configure(statementText: string, dialect: Dialect): void {
    this.statementText = statementText
    this.dialect = dialect
    this.warnings = []
  }

  takeWarnings(): Array<string> {
    const w = this.warnings
    this.warnings = []
    return w
  }

  ident(ctx: any): string {
    const tok: IToken = (
      ctx.Identifier ??
      ctx.DoubleQuotedIdent ??
      ctx.BacktickIdent ??
      ctx.BracketIdent
    )[0]
    return unquoteIdent(tok.image)
  }

  qualifiedName(ctx: any): string {
    const parts: Array<string> = ctx.ident.map((c: any) => this.visit(c))
    return parts[parts.length - 1]
  }

  colList(ctx: any): Array<string> {
    return ctx.ident.map((c: any) => this.visit(c))
  }

  dataType(ctx: any): { dataType: DataType; raw: string } {
    const tokens: Array<IToken> = []
    for (const key of Object.keys(ctx)) {
      for (const tok of ctx[key]) tokens.push(tok)
    }
    const start = Math.min(...tokens.map((t) => t.startOffset))
    const end = Math.max(...tokens.map((t) => t.endOffset ?? t.startOffset))
    const raw = this.statementText.slice(start, end + 1)
    const result = sqlTypeToDataType(raw, this.dialect)
    if (result.warning) this.warnings.push(result.warning)
    return { dataType: result.dataType, raw }
  }

  onAction(_ctx: any): void {
    // Intentionally discarded — referential actions aren't part of the
    // diagram model; this rule exists purely so the parser tolerates them.
  }

  defaultValue(_ctx: any): void {
    // Intentionally discarded — see the `defaultValue` RULE doc comment.
  }

  columnConstraint(ctx: any): ColumnConstraintResult {
    if (ctx.PrimaryKw) return { kind: 'pk' }
    if (ctx.NotKw) return { kind: 'notNull' }
    if (ctx.UniqueKw) return { kind: 'unique' }
    if (ctx.DefaultKw) return { kind: 'default' }
    if (ctx.ReferencesKw) {
      return {
        kind: 'references',
        targetTable: this.visit(ctx.refTable[0]),
        targetColumn: this.visit(ctx.refColumn[0]),
      }
    }
    return { kind: 'null' }
  }

  columnDef(ctx: any): ColumnDefResult {
    const name = this.visit(ctx.columnName[0])
    const dt = this.visit(ctx.dataType[0])

    let isPrimaryKey = false
    let isUnique = false
    let isForeignKey = false
    let sawNotNull = false
    let reference: { targetTable: string; targetColumn: string } | undefined

    if (ctx.columnConstraint) {
      for (const c of ctx.columnConstraint) {
        const r: ColumnConstraintResult = this.visit(c)
        if (r.kind === 'pk') isPrimaryKey = true
        else if (r.kind === 'notNull') sawNotNull = true
        else if (r.kind === 'unique') isUnique = true
        else if (r.kind === 'references') {
          isForeignKey = true
          reference = { targetTable: r.targetTable, targetColumn: r.targetColumn }
        }
        // 'null' and 'default' need no flag — SQL columns are nullable by
        // default, and DEFAULT values aren't represented in the Column model.
      }
    }

    const isNullable = !(sawNotNull || isPrimaryKey)

    return {
      kind: 'column',
      column: {
        type: 'column',
        name,
        dataType: dt.dataType,
        isPrimaryKey,
        isForeignKey,
        isUnique,
        isNullable,
      },
      reference,
    }
  }

  tableConstraint(ctx: any): TableConstraintResult {
    if (ctx.pkCols) {
      return { kind: 'pk', columns: this.visit(ctx.pkCols[0]) }
    }
    if (ctx.fkCols) {
      return {
        kind: 'fk',
        columns: this.visit(ctx.fkCols[0]),
        refTable: this.visit(ctx.refTable[0]),
        refColumns: this.visit(ctx.refCols[0]),
      }
    }
    return { kind: 'unique', columns: this.visit(ctx.uniqueCols[0]) }
  }

  tableElement(ctx: any): ColumnDefResult | TableConstraintResult {
    if (ctx.columnDef) return this.visit(ctx.columnDef[0])
    return this.visit(ctx.tableConstraint[0])
  }

  createTableStatement(ctx: any): CreateTableResult {
    const tableName = this.visit(ctx.tableName[0])
    const columns: Array<ColumnNode> = []
    const inlineRefs: CreateTableResult['inlineRefs'] = []
    const tableConstraints: Array<TableConstraintResult> = []

    for (const elCst of ctx.elements) {
      const el: ColumnDefResult | TableConstraintResult = this.visit(elCst)
      if (el.kind === 'column') {
        columns.push(el.column)
        if (el.reference) {
          inlineRefs.push({ sourceColumn: el.column.name, ...el.reference })
        }
      } else {
        tableConstraints.push(el)
      }
    }

    return { tableName, columns, inlineRefs, tableConstraints }
  }
}

const visitor = new DdlVisitor()

// ============================================================================
// Cardinality inference (spec delta point 5)
// ============================================================================

function inferCardinality(
  childTable: string,
  fkColumn: ColumnNode,
  parentTable: string,
): Cardinality {
  if (childTable === parentTable) return 'self-referencing'
  if (fkColumn.isUnique || fkColumn.isPrimaryKey) return 'one-to-one'
  return 'many-to-one'
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parses a pasted block of SQL DDL (one or more statements) into a
 * DiagramAST. Only `CREATE TABLE` statements are parsed; every other
 * top-level statement (CREATE INDEX, ALTER TABLE, comments-only text, etc.)
 * is skipped with a warning. A malformed CREATE TABLE statement is recorded
 * as an error but does not stop the rest of the paste from importing.
 */
export function parseSqlDdl(sql: string, dialect: Dialect): SqlParseResult {
  const warnings: Array<string> = []
  const errors: Array<ParseError> = []
  const tables: Array<TableNode> = []
  const relationships: Array<RelationshipNode> = []

  if (!sql.trim()) {
    return {
      success: false,
      ast: { tables, relationships },
      warnings,
      errors: [{ message: 'No SQL provided', line: 0, column: 0, offset: 0 }],
    }
  }

  const cleaned = stripComments(sql)
  const statements = splitStatements(cleaned)

  for (const statement of statements) {
    const trimmed = statement.text.trim()
    if (!/^CREATE\s+TABLE\b/i.test(trimmed)) {
      const leadingWs = statement.text.length - statement.text.trimStart().length
      const { line } = offsetToLineColumn(sql, statement.startOffset + leadingWs)
      const snippet = trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed
      warnings.push(
        `Skipped unsupported statement at line ${line}: "${snippet}"`,
      )
      continue
    }

    const lexResult = DdlLexer.tokenize(statement.text)
    if (lexResult.errors.length > 0) {
      for (const err of lexResult.errors) {
        const { line, column } = offsetToLineColumn(
          sql,
          statement.startOffset + err.offset,
        )
        errors.push({
          message: err.message,
          line,
          column,
          offset: statement.startOffset + err.offset,
          length: err.length,
        })
      }
      continue
    }

    parserInstance.input = lexResult.tokens
    const cst = parserInstance.createTableStatement()

    if (parserInstance.errors.length > 0) {
      for (const err of parserInstance.errors) {
        const absOffset = statement.startOffset + err.token.startOffset
        const { line, column } = offsetToLineColumn(sql, absOffset)
        errors.push({
          message: err.message,
          line,
          column,
          offset: absOffset,
          length: err.token.image.length,
        })
      }
      continue
    }

    let result: CreateTableResult
    try {
      visitor.configure(statement.text, dialect)
      result = visitor.visit(cst)
    } catch (error) {
      const { line, column } = offsetToLineColumn(sql, statement.startOffset)
      errors.push({
        message:
          error instanceof Error
            ? error.message
            : 'Unknown error while converting CREATE TABLE statement',
        line,
        column,
        offset: statement.startOffset,
      })
      continue
    }
    warnings.push(...visitor.takeWarnings())

    const columnByName = new Map(result.columns.map((c) => [c.name, c]))

    // Apply table-level constraints (mark column flags; composite (>1 column)
    // constraints can't be represented as a single relationship or a single
    // column flag pair, so they're flagged individually with a warning).
    for (const tc of result.tableConstraints) {
      if (tc.kind === 'pk') {
        for (const name of tc.columns) {
          const col = columnByName.get(name)
          if (col) col.isPrimaryKey = true
        }
        if (tc.columns.length > 1) {
          warnings.push(
            `Composite PRIMARY KEY on "${result.tableName}" (${tc.columns.join(', ')}) — each column flagged individually; composite key semantics aren't represented in the diagram model.`,
          )
        }
      } else if (tc.kind === 'unique') {
        for (const name of tc.columns) {
          const col = columnByName.get(name)
          if (col) col.isUnique = true
        }
        if (tc.columns.length > 1) {
          warnings.push(
            `Composite UNIQUE constraint on "${result.tableName}" (${tc.columns.join(', ')}) — each column flagged individually; composite uniqueness isn't represented in the diagram model.`,
          )
        }
      } else {
        for (const name of tc.columns) {
          const col = columnByName.get(name)
          if (col) col.isForeignKey = true
        }
        if (tc.columns.length === 1 && tc.refColumns.length === 1) {
          const fkCol = columnByName.get(tc.columns[0])
          if (fkCol) {
            relationships.push({
              type: 'relationship',
              sourceTable: result.tableName,
              sourceColumn: fkCol.name,
              targetTable: tc.refTable,
              targetColumn: tc.refColumns[0],
              cardinality: inferCardinality(
                result.tableName,
                fkCol,
                tc.refTable,
              ),
            })
          }
        } else {
          warnings.push(
            `Composite FOREIGN KEY on "${result.tableName}" (${tc.columns.join(', ')}) — columns flagged as foreign keys, but no relationship was generated (composite foreign keys aren't representable in the diagram model).`,
          )
        }
      }
    }

    // Inline REFERENCES clauses (single column by construction — the grammar
    // only accepts one column inside `REFERENCES tbl(col)`).
    for (const ref of result.inlineRefs) {
      const fkCol = columnByName.get(ref.sourceColumn)
      if (!fkCol) continue
      relationships.push({
        type: 'relationship',
        sourceTable: result.tableName,
        sourceColumn: fkCol.name,
        targetTable: ref.targetTable,
        targetColumn: ref.targetColumn,
        cardinality: inferCardinality(result.tableName, fkCol, ref.targetTable),
      })
    }

    tables.push({
      type: 'table',
      name: result.tableName,
      columns: result.columns,
    })
  }

  return {
    success: errors.length === 0,
    ast: { tables, relationships },
    warnings,
    errors,
  }
}
