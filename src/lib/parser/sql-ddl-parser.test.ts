// src/lib/parser/sql-ddl-parser.test.ts
// Tests for the SQL DDL import parser — mirrors diagram-parser.test.ts's
// structure: golden CREATE TABLE samples per dialect, inline + table-level
// constraints, FK -> relationship + cardinality inference, skipped-statement
// warnings, and malformed input -> errors (not a crash).

import { describe, expect, it } from 'vitest'
import { parseSqlDdl } from './sql-ddl-parser'

describe('parseSqlDdl — Postgres', () => {
  it('parses a simple CREATE TABLE with inline constraints', () => {
    const sql = `
      CREATE TABLE Users (
        id UUID PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        bio TEXT
      );
    `
    const result = parseSqlDdl(sql, 'postgres')

    expect(result.success).toBe(true)
    expect(result.ast.tables).toHaveLength(1)
    const table = result.ast.tables[0]
    expect(table.name).toBe('Users')
    expect(table.columns).toHaveLength(3)

    const id = table.columns[0]
    expect(id.name).toBe('id')
    expect(id.dataType).toBe('uuid')
    expect(id.isPrimaryKey).toBe(true)
    expect(id.isNullable).toBe(false)

    const email = table.columns[1]
    expect(email.dataType).toBe('varchar')
    expect(email.isNullable).toBe(false)
    expect(email.isUnique).toBe(true)

    const bio = table.columns[2]
    expect(bio.dataType).toBe('text')
    expect(bio.isNullable).toBe(true)
  })

  it('parses inline REFERENCES into a many-to-one relationship', () => {
    const sql = `
      CREATE TABLE Users ( id UUID PRIMARY KEY );
      CREATE TABLE Orders (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES Users(id)
      );
    `
    const result = parseSqlDdl(sql, 'postgres')

    expect(result.success).toBe(true)
    expect(result.ast.tables).toHaveLength(2)
    expect(result.ast.relationships).toHaveLength(1)

    const rel = result.ast.relationships[0]
    expect(rel.sourceTable).toBe('Orders')
    expect(rel.sourceColumn).toBe('user_id')
    expect(rel.targetTable).toBe('Users')
    expect(rel.targetColumn).toBe('id')
    expect(rel.cardinality).toBe('many-to-one')

    const ordersTable = result.ast.tables.find((t) => t.name === 'Orders')!
    const userIdCol = ordersTable.columns.find((c) => c.name === 'user_id')!
    expect(userIdCol.isForeignKey).toBe(true)
  })

  it('infers one-to-one when the FK column is also UNIQUE', () => {
    const sql = `
      CREATE TABLE Users ( id UUID PRIMARY KEY );
      CREATE TABLE Profiles (
        id UUID PRIMARY KEY,
        user_id UUID UNIQUE REFERENCES Users(id)
      );
    `
    const result = parseSqlDdl(sql, 'postgres')

    expect(result.success).toBe(true)
    expect(result.ast.relationships).toHaveLength(1)
    expect(result.ast.relationships[0].cardinality).toBe('one-to-one')
  })

  it('infers self-referencing when the FK targets its own table', () => {
    const sql = `
      CREATE TABLE Employees (
        id UUID PRIMARY KEY,
        manager_id UUID REFERENCES Employees(id)
      );
    `
    const result = parseSqlDdl(sql, 'postgres')

    expect(result.success).toBe(true)
    expect(result.ast.relationships).toHaveLength(1)
    expect(result.ast.relationships[0].cardinality).toBe('self-referencing')
  })

  it('honors table-level PRIMARY KEY and FOREIGN KEY ... REFERENCES constraints', () => {
    const sql = `
      CREATE TABLE Users (
        id UUID,
        tenant_id UUID,
        PRIMARY KEY (id)
      );
      CREATE TABLE Orders (
        id UUID,
        user_id UUID,
        CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES Users(id)
      );
    `
    const result = parseSqlDdl(sql, 'postgres')

    expect(result.success).toBe(true)
    const users = result.ast.tables.find((t) => t.name === 'Users')!
    expect(users.columns.find((c) => c.name === 'id')!.isPrimaryKey).toBe(
      true,
    )

    const orders = result.ast.tables.find((t) => t.name === 'Orders')!
    expect(
      orders.columns.find((c) => c.name === 'user_id')!.isForeignKey,
    ).toBe(true)

    expect(result.ast.relationships).toHaveLength(1)
    expect(result.ast.relationships[0].sourceTable).toBe('Orders')
    expect(result.ast.relationships[0].targetTable).toBe('Users')
  })

  it('honors table-level UNIQUE constraints', () => {
    const sql = `
      CREATE TABLE Users (
        id UUID PRIMARY KEY,
        email VARCHAR(255),
        UNIQUE (email)
      );
    `
    const result = parseSqlDdl(sql, 'postgres')

    expect(result.success).toBe(true)
    const email = result.ast.tables[0].columns.find((c) => c.name === 'email')!
    expect(email.isUnique).toBe(true)
  })

  it('tolerates double-quoted identifiers and a DEFAULT clause', () => {
    const sql = `
      CREATE TABLE "Users" (
        "id" UUID PRIMARY KEY,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "is_active" BOOLEAN DEFAULT true
      );
    `
    const result = parseSqlDdl(sql, 'postgres')

    expect(result.success).toBe(true)
    expect(result.ast.tables[0].name).toBe('Users')
    expect(result.ast.tables[0].columns.map((c) => c.name)).toEqual([
      'id',
      'created_at',
      'is_active',
    ])
  })

  it('tolerates IF NOT EXISTS, schema-qualified names, and comments', () => {
    const sql = `
      -- users table
      CREATE TABLE IF NOT EXISTS public.Users (
        id UUID PRIMARY KEY, /* primary key */
        name VARCHAR(255)
      );
    `
    const result = parseSqlDdl(sql, 'postgres')

    expect(result.success).toBe(true)
    expect(result.ast.tables[0].name).toBe('Users')
  })

  it('skips unsupported statements with a warning and still imports the rest', () => {
    const sql = `
      CREATE INDEX idx_users_email ON Users(email);
      CREATE TABLE Users ( id UUID PRIMARY KEY );
    `
    const result = parseSqlDdl(sql, 'postgres')

    expect(result.success).toBe(true)
    expect(result.ast.tables).toHaveLength(1)
    expect(result.warnings.some((w) => w.includes('CREATE INDEX'))).toBe(true)
  })

  it('maps unrecognized column types to text with a warning', () => {
    const sql = `CREATE TABLE Weird ( id UUID PRIMARY KEY, blob_data FROBNICATE )`
    const result = parseSqlDdl(sql, 'postgres')

    expect(result.success).toBe(true)
    const col = result.ast.tables[0].columns.find((c) => c.name === 'blob_data')!
    expect(col.dataType).toBe('text')
    expect(result.warnings.some((w) => w.includes('FROBNICATE'))).toBe(true)
  })

  it('reports a malformed CREATE TABLE as an error, not a crash', () => {
    const sql = `CREATE TABLE Users ( id UUID PRIMARY KEY !!! )`

    expect(() => parseSqlDdl(sql, 'postgres')).not.toThrow()

    const result = parseSqlDdl(sql, 'postgres')
    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('imports the rest of the paste even when one statement is malformed (partial success)', () => {
    const sql = `
      CREATE TABLE Broken ( id UUID PRIMARY KEY !!! );
      CREATE TABLE Fine ( id UUID PRIMARY KEY );
    `
    const result = parseSqlDdl(sql, 'postgres')

    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.ast.tables.some((t) => t.name === 'Fine')).toBe(true)
  })

  it('returns an error for empty input', () => {
    const result = parseSqlDdl('   ', 'postgres')
    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.ast.tables).toHaveLength(0)
  })
})

describe('parseSqlDdl — MySQL', () => {
  it('parses backtick identifiers, AUTO_INCREMENT, and inline FK', () => {
    const sql = `
      CREATE TABLE \`users\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`email\` VARCHAR(255) NOT NULL
      );
      CREATE TABLE \`orders\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT,
        FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      );
    `
    const result = parseSqlDdl(sql, 'mysql')

    expect(result.success).toBe(true)
    const users = result.ast.tables.find((t) => t.name === 'users')!
    expect(users.columns[0].dataType).toBe('serial')

    expect(result.ast.relationships).toHaveLength(1)
    expect(result.ast.relationships[0].sourceTable).toBe('orders')
    expect(result.ast.relationships[0].targetTable).toBe('users')
    expect(result.ast.relationships[0].cardinality).toBe('many-to-one')
  })

  it('maps TINYINT(1) to boolean and CHAR(36) to uuid', () => {
    const sql = `
      CREATE TABLE t (
        id CHAR(36) PRIMARY KEY,
        active TINYINT(1) NOT NULL
      );
    `
    const result = parseSqlDdl(sql, 'mysql')

    expect(result.success).toBe(true)
    expect(result.ast.tables[0].columns[0].dataType).toBe('uuid')
    expect(result.ast.tables[0].columns[1].dataType).toBe('boolean')
  })
})

describe('parseSqlDdl — MSSQL', () => {
  it('parses bracket identifiers, IDENTITY, and table-level FK', () => {
    const sql = `
      CREATE TABLE [Users] (
        [Id] INT IDENTITY(1,1) PRIMARY KEY,
        [Email] NVARCHAR(255) NOT NULL
      );
      CREATE TABLE [Orders] (
        [Id] INT IDENTITY(1,1) PRIMARY KEY,
        [UserId] INT NOT NULL,
        CONSTRAINT [FK_Orders_Users] FOREIGN KEY ([UserId]) REFERENCES [Users]([Id])
      );
    `
    const result = parseSqlDdl(sql, 'mssql')

    expect(result.success).toBe(true)
    const users = result.ast.tables.find((t) => t.name === 'Users')!
    expect(users.columns[0].dataType).toBe('serial')
    expect(users.columns[1].dataType).toBe('varchar')

    expect(result.ast.relationships).toHaveLength(1)
    expect(result.ast.relationships[0].sourceTable).toBe('Orders')
    expect(result.ast.relationships[0].targetTable).toBe('Users')
  })

  it('maps NVARCHAR(MAX) to text and bare BIT to boolean', () => {
    const sql = `
      CREATE TABLE t (
        id UNIQUEIDENTIFIER PRIMARY KEY,
        notes NVARCHAR(MAX),
        active BIT
      );
    `
    const result = parseSqlDdl(sql, 'mssql')

    expect(result.success).toBe(true)
    expect(result.ast.tables[0].columns[0].dataType).toBe('uuid')
    expect(result.ast.tables[0].columns[1].dataType).toBe('text')
    expect(result.ast.tables[0].columns[2].dataType).toBe('boolean')
  })
})
