// src/lib/parser/diagram-parser.test.ts
// Tests for diagram parser

import { describe, expect, it } from 'vitest'
import { astToEntities, entitiesToText, parseDiagram } from './diagram-parser'

describe('parseDiagram', () => {
  it('should parse a simple table', () => {
    const input = `
table Users {
  id uuid pk
  name string
  email string unique
}
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast).toBeDefined()
    expect(result.ast?.tables).toHaveLength(1)
    expect(result.ast?.tables[0].name).toBe('Users')
    expect(result.ast?.tables[0].columns).toHaveLength(3)
    expect(result.ast?.tables[0].columns[0].name).toBe('id')
    expect(result.ast?.tables[0].columns[0].dataType).toBe('uuid')
    expect(result.ast?.tables[0].columns[0].isPrimaryKey).toBe(true)
    expect(result.ast?.tables[0].columns[2].isUnique).toBe(true)
  })

  it('should parse multiple tables', () => {
    const input = `
table Users {
  id uuid pk
  name string
}

table Orders {
  id uuid pk
  user_id uuid fk
  total float
}
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.tables).toHaveLength(2)
    expect(result.ast?.tables[0].name).toBe('Users')
    expect(result.ast?.tables[1].name).toBe('Orders')
  })

  it('should parse relationships', () => {
    const input = `
table Users {
  id uuid pk
}

table Orders {
  id uuid pk
  user_id uuid fk
}

Users.id -> Orders.user_id (one-to-many)
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.relationships).toHaveLength(1)
    expect(result.ast?.relationships[0].sourceTable).toBe('Users')
    expect(result.ast?.relationships[0].sourceColumn).toBe('id')
    expect(result.ast?.relationships[0].targetTable).toBe('Orders')
    expect(result.ast?.relationships[0].targetColumn).toBe('user_id')
    expect(result.ast?.relationships[0].cardinality).toBe('one-to-many')
  })

  it('should parse relationship with label', () => {
    const input = `
Users.id -> Orders.user_id (one-to-many) "places"
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.relationships).toHaveLength(1)
    expect(result.ast?.relationships[0].label).toBe('places')
  })

  it('should parse table with description', () => {
    const input = `
table Users "User accounts" {
  id uuid pk
}
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.tables[0].description).toBe('User accounts')
  })

  it('should parse column with description', () => {
    const input = `
table Users {
  id uuid pk "Primary identifier"
}
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.tables[0].columns[0].description).toBe(
      'Primary identifier',
    )
  })

  it('should handle comments', () => {
    const input = `
# This is a comment
table Users {
  id uuid pk # Another comment
}
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.tables).toHaveLength(1)
  })

  it('should handle all original data types', () => {
    const input = `
table AllTypes {
  col_int int
  col_string string
  col_float float
  col_boolean boolean
  col_date date
  col_text text
  col_uuid uuid
  col_json json
}
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.tables[0].columns).toHaveLength(8)
    expect(result.ast?.tables[0].columns[0].dataType).toBe('int')
    expect(result.ast?.tables[0].columns[1].dataType).toBe('string')
    expect(result.ast?.tables[0].columns[2].dataType).toBe('float')
    expect(result.ast?.tables[0].columns[3].dataType).toBe('boolean')
    expect(result.ast?.tables[0].columns[4].dataType).toBe('date')
    expect(result.ast?.tables[0].columns[5].dataType).toBe('text')
    expect(result.ast?.tables[0].columns[6].dataType).toBe('uuid')
    expect(result.ast?.tables[0].columns[7].dataType).toBe('json')
  })

  it('should handle all new data types', () => {
    const input = `
table NewTypes {
  col_bigint bigint
  col_smallint smallint
  col_double double
  col_decimal decimal
  col_serial serial
  col_money money
  col_char char
  col_varchar varchar
  col_bit bit
  col_datetime datetime
  col_timestamp timestamp
  col_time time
  col_binary binary
  col_blob blob
  col_xml xml
  col_array array
  col_enum enum
}
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.tables[0].columns).toHaveLength(17)
    expect(result.ast?.tables[0].columns[0].dataType).toBe('bigint')
    expect(result.ast?.tables[0].columns[1].dataType).toBe('smallint')
    expect(result.ast?.tables[0].columns[2].dataType).toBe('double')
    expect(result.ast?.tables[0].columns[3].dataType).toBe('decimal')
    expect(result.ast?.tables[0].columns[4].dataType).toBe('serial')
    expect(result.ast?.tables[0].columns[5].dataType).toBe('money')
    expect(result.ast?.tables[0].columns[6].dataType).toBe('char')
    expect(result.ast?.tables[0].columns[7].dataType).toBe('varchar')
    expect(result.ast?.tables[0].columns[8].dataType).toBe('bit')
    expect(result.ast?.tables[0].columns[9].dataType).toBe('datetime')
    expect(result.ast?.tables[0].columns[10].dataType).toBe('timestamp')
    expect(result.ast?.tables[0].columns[11].dataType).toBe('time')
    expect(result.ast?.tables[0].columns[12].dataType).toBe('binary')
    expect(result.ast?.tables[0].columns[13].dataType).toBe('blob')
    expect(result.ast?.tables[0].columns[14].dataType).toBe('xml')
    expect(result.ast?.tables[0].columns[15].dataType).toBe('array')
    expect(result.ast?.tables[0].columns[16].dataType).toBe('enum')
  })

  it('should correctly distinguish bigint from int, smallint from int', () => {
    const input = `
table NumericTypes {
  a bigint
  b smallint
  c int
}
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.tables[0].columns[0].dataType).toBe('bigint')
    expect(result.ast?.tables[0].columns[1].dataType).toBe('smallint')
    expect(result.ast?.tables[0].columns[2].dataType).toBe('int')
  })

  it('should correctly distinguish datetime from date, timestamp from time', () => {
    const input = `
table DateTypes {
  a datetime
  b date
  c timestamp
  d time
}
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.tables[0].columns[0].dataType).toBe('datetime')
    expect(result.ast?.tables[0].columns[1].dataType).toBe('date')
    expect(result.ast?.tables[0].columns[2].dataType).toBe('timestamp')
    expect(result.ast?.tables[0].columns[3].dataType).toBe('time')
  })

  it('should correctly distinguish varchar from char', () => {
    const input = `
table StringTypes {
  a varchar
  b char
}
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.tables[0].columns[0].dataType).toBe('varchar')
    expect(result.ast?.tables[0].columns[1].dataType).toBe('char')
  })

  it('should handle all cardinalities', () => {
    const input = `
A.id -> B.id (one-to-one)
C.id -> D.id (one-to-many)
E.id -> F.id (many-to-one)
G.id -> H.id (many-to-many)
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.relationships).toHaveLength(4)
    expect(result.ast?.relationships[0].cardinality).toBe('one-to-one')
    expect(result.ast?.relationships[1].cardinality).toBe('one-to-many')
    expect(result.ast?.relationships[2].cardinality).toBe('many-to-one')
    expect(result.ast?.relationships[3].cardinality).toBe('many-to-many')
  })

  it('should detect syntax errors', () => {
    const input = `
table Users {
  id uuid pk
  # Missing closing brace
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should handle nullable columns', () => {
    const input = `
table Users {
  id uuid pk
  name string null
  email string
}
    `.trim()

    const result = parseDiagram(input)

    expect(result.success).toBe(true)
    expect(result.ast?.tables[0].columns[0].isNullable).toBe(false) // pk is not nullable
    expect(result.ast?.tables[0].columns[1].isNullable).toBe(true) // has null constraint
    expect(result.ast?.tables[0].columns[2].isNullable).toBe(false) // no null constraint
  })
})

describe('astToEntities', () => {
  it('should convert AST to entity objects', () => {
    const input = `
table Users {
  id uuid pk
  name string
}

table Orders {
  id uuid pk
  user_id uuid fk
}

Users.id -> Orders.user_id (one-to-many)
    `.trim()

    const result = parseDiagram(input)
    expect(result.success).toBe(true)

    const entities = astToEntities(result.ast!, 'test-whiteboard-id')

    expect(entities.tables).toHaveLength(2)
    expect(entities.tables[0].table.name).toBe('Users')
    expect(entities.tables[0].columns).toHaveLength(2)
    expect(entities.tables[0].columns[0].isPrimaryKey).toBe(true)

    expect(entities.relationships).toHaveLength(1)
    expect(entities.relationships[0].sourceTable).toBe('Users')
    expect(entities.relationships[0].cardinality).toBe('ONE_TO_MANY')
  })

  it('should arrange tables in a grid layout', () => {
    const input = `
table A { id uuid pk }
table B { id uuid pk }
table C { id uuid pk }
table D { id uuid pk }
    `.trim()

    const result = parseDiagram(input)
    const entities = astToEntities(result.ast!, 'test-whiteboard-id')

    // First row
    expect(entities.tables[0].table.positionX).toBe(100)
    expect(entities.tables[0].table.positionY).toBe(100)

    expect(entities.tables[1].table.positionX).toBe(450)
    expect(entities.tables[1].table.positionY).toBe(100)

    expect(entities.tables[2].table.positionX).toBe(800)
    expect(entities.tables[2].table.positionY).toBe(100)

    // Second row
    expect(entities.tables[3].table.positionX).toBe(100)
    expect(entities.tables[3].table.positionY).toBe(500)
  })
})

describe('entitiesToText', () => {
  it('should convert entities to text syntax', () => {
    const tables = [
      {
        id: 'table-1',
        name: 'Users',
        description: 'User accounts',
        columns: [
          {
            id: 'col-1',
            name: 'id',
            dataType: 'uuid',
            isPrimaryKey: true,
            isForeignKey: false,
            isUnique: false,
            isNullable: false,
          },
          {
            id: 'col-2',
            name: 'email',
            dataType: 'string',
            isPrimaryKey: false,
            isForeignKey: false,
            isUnique: true,
            isNullable: false,
          },
        ],
      },
    ]

    const relationships = [
      {
        id: 'rel-1',
        sourceTable: { name: 'Users' },
        targetTable: { name: 'Orders' },
        sourceColumn: { name: 'id' },
        targetColumn: { name: 'user_id' },
        cardinality: 'ONE_TO_MANY',
        label: 'places',
      },
    ]

    const text = entitiesToText(tables, relationships)

    expect(text).toContain('table Users "User accounts" {')
    expect(text).toContain('id uuid pk')
    expect(text).toContain('email string unique')
    expect(text).toContain('Users.id -> Orders.user_id (one-to-many) "places"')
  })

  it('should handle empty tables', () => {
    const text = entitiesToText([], [])
    expect(text).toContain('# ER Diagram')
    expect(text).toContain('# No tables defined yet')
  })

  it('should handle nullable columns', () => {
    const tables = [
      {
        name: 'Users',
        columns: [
          {
            name: 'name',
            dataType: 'string',
            isPrimaryKey: false,
            isForeignKey: false,
            isUnique: false,
            isNullable: true,
          },
        ],
      },
    ]

    const text = entitiesToText(tables, [])
    expect(text).toContain('name string null')
  })

  it('should skip relationships with missing data', () => {
    const tables = [{ name: 'Users', columns: [] }]
    const relationships = [
      {
        id: 'rel-1',
        cardinality: 'ONE_TO_MANY',
        // Missing sourceTable, targetTable, etc.
      },
    ]

    const text = entitiesToText(tables, relationships as any)
    expect(text).not.toContain('->')
  })
})

describe('round-trip conversion', () => {
  it('should parse and regenerate identical syntax', () => {
    const input = `
table Users {
  id uuid pk
  name string
  email string unique
}

table Orders {
  id uuid pk
  user_id uuid fk
  total float
}

Users.id -> Orders.user_id (one-to-many)
    `.trim()

    const parseResult = parseDiagram(input)
    expect(parseResult.success).toBe(true)

    const entities = astToEntities(parseResult.ast!, 'test-whiteboard-id')

    // Convert entities back to the format expected by entitiesToText
    const tables = entities.tables.map((t) => ({
      name: t.table.name,
      description: t.table.description,
      columns: t.columns,
    }))

    const relationships = entities.relationships.map((r) => ({
      sourceTable: { name: r.sourceTable },
      targetTable: { name: r.targetTable },
      sourceColumn: { name: r.sourceColumn },
      targetColumn: { name: r.targetColumn },
      cardinality: r.cardinality,
      label: r.label,
    }))

    const regenerated = entitiesToText(tables, relationships)

    // Parse the regenerated text
    const reparsed = parseDiagram(regenerated)
    expect(reparsed.success).toBe(true)

    // Verify structure matches
    expect(reparsed.ast?.tables).toHaveLength(2)
    expect(reparsed.ast?.relationships).toHaveLength(1)
  })
})
