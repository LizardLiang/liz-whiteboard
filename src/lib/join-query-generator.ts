import { quoteIdent, type Dialect } from './ddl-generator'

export interface JoinQueryColumn {
  id: string
  name: string
  order: number
}

export interface JoinQueryTable {
  id: string
  name: string
  position: { x: number; y: number }
  columns: Array<JoinQueryColumn>
  external?: boolean
  incompleteReason?: string
}

export interface JoinQueryRelationship {
  id: string
  sourceTableId: string
  targetTableId: string
  sourceColumnId: string
  targetColumnId: string
}

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'

export interface JoinQueryEdgeGroup {
  key: string
  tableIds: [string, string]
  relationships: Array<JoinQueryRelationship>
}

export interface JoinQueryComponent {
  id: string
  tableIds: Array<string>
  defaultRootTableId: string
  externalTableIds: Array<string>
  edgeGroups: Array<JoinQueryEdgeGroup>
  treeEdgeKeys: Array<string>
  omittedRelationshipIds: Array<string>
  ambiguousEdges: Array<{
    key: string
    tableIds: [string, string]
    relationshipIds: Array<string>
  }>
}

export interface JoinQueryPlan {
  tables: Array<JoinQueryTable>
  relationships: Array<JoinQueryRelationship>
  components: Array<JoinQueryComponent>
  skippedTables: Array<{ id: string; name: string; reason: string }>
  notices: Array<string>
}

export interface GenerateJoinQueryOptions {
  dialect: Dialect
  rootTableIds?: Record<string, string>
  joinTypes?: Record<string, JoinType>
  relationshipChoices?: Record<string, string>
  includedOmittedRelationshipIds?: Array<string>
}

const compareTables = (a: JoinQueryTable, b: JoinQueryTable) =>
  a.position.y - b.position.y ||
  a.position.x - b.position.x ||
  a.id.localeCompare(b.id)

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

function spanningTree(
  tableIds: Array<string>,
  groups: Array<JoinQueryEdgeGroup>,
  root: string,
  order: Map<string, number>,
): Array<JoinQueryEdgeGroup> {
  if (tableIds.length < 2) return []
  const visited = new Set([root])
  const tree: Array<JoinQueryEdgeGroup> = []
  while (visited.size < tableIds.length) {
    const candidates = groups
      .filter((group) => {
        const [a, b] = group.tableIds
        return visited.has(a) !== visited.has(b)
      })
      .sort((a, b) => {
        const aNext = visited.has(a.tableIds[0]) ? a.tableIds[1] : a.tableIds[0]
        const bNext = visited.has(b.tableIds[0]) ? b.tableIds[1] : b.tableIds[0]
        return (
          (order.get(aNext) ?? 0) - (order.get(bNext) ?? 0) ||
          a.key.localeCompare(b.key)
        )
      })
    const edge = candidates[0]
    if (!edge) break
    tree.push(edge)
    visited.add(edge.tableIds[0])
    visited.add(edge.tableIds[1])
  }
  return tree
}

export function buildJoinQueryPlan(
  selectedTables: Array<JoinQueryTable>,
  relationships: Array<JoinQueryRelationship>,
): JoinQueryPlan {
  const skippedTables = selectedTables
    .filter((table) => table.incompleteReason)
    .map((table) => ({
      id: table.id,
      name: table.name,
      reason: table.incompleteReason!,
    }))
  const tables = selectedTables
    .filter((table) => !table.incompleteReason)
    .sort(compareTables)
  const tableById = new Map(tables.map((table) => [table.id, table]))
  const columns = new Set(
    tables.flatMap((table) => table.columns.map((c) => c.id)),
  )
  const notices: Array<string> = []
  const validRelationships = relationships
    .filter((relationship) => {
      if (
        !tableById.has(relationship.sourceTableId) ||
        !tableById.has(relationship.targetTableId) ||
        relationship.sourceTableId === relationship.targetTableId
      ) {
        return false
      }
      if (
        !columns.has(relationship.sourceColumnId) ||
        !columns.has(relationship.targetColumnId)
      ) {
        notices.push(
          `Relationship ${relationship.id} was skipped because a column is missing.`,
        )
        return false
      }
      return true
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  const grouped = new Map<string, JoinQueryEdgeGroup>()
  for (const relationship of validRelationships) {
    const key = pairKey(relationship.sourceTableId, relationship.targetTableId)
    const existing = grouped.get(key)
    if (existing) existing.relationships.push(relationship)
    else {
      const ids = key.split('|') as [string, string]
      grouped.set(key, { key, tableIds: ids, relationships: [relationship] })
    }
  }
  const groups = [...grouped.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  )
  const adjacency = new Map(
    tables.map((table) => [table.id, new Set<string>()]),
  )
  for (const group of groups) {
    adjacency.get(group.tableIds[0])?.add(group.tableIds[1])
    adjacency.get(group.tableIds[1])?.add(group.tableIds[0])
  }

  const order = new Map(tables.map((table, index) => [table.id, index]))
  const unseen = new Set(tables.map((table) => table.id))
  const components: Array<JoinQueryComponent> = []
  for (const start of tables.map((table) => table.id)) {
    if (!unseen.has(start)) continue
    const queue = [start]
    unseen.delete(start)
    const tableIds: Array<string> = []
    while (queue.length > 0) {
      const current = queue.shift()!
      tableIds.push(current)
      const neighbors = [...(adjacency.get(current) ?? [])].sort(
        (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
      )
      for (const neighbor of neighbors) {
        if (!unseen.delete(neighbor)) continue
        queue.push(neighbor)
      }
    }
    tableIds.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    const componentGroups = groups.filter((group) =>
      tableIds.includes(group.tableIds[0]),
    )
    const root = tableIds[0]
    const tree = spanningTree(tableIds, componentGroups, root, order)
    const treeKeys = new Set(tree.map((edge) => edge.key))
    components.push({
      id: tableIds.join('|'),
      tableIds,
      defaultRootTableId: root,
      externalTableIds: tableIds.filter((id) => tableById.get(id)?.external),
      edgeGroups: componentGroups,
      treeEdgeKeys: tree.map((edge) => edge.key),
      omittedRelationshipIds: componentGroups
        .filter((edge) => !treeKeys.has(edge.key))
        .flatMap((edge) =>
          edge.relationships.map((relationship) => relationship.id),
        ),
      ambiguousEdges: tree
        .filter((edge) => edge.relationships.length > 1)
        .map((edge) => ({
          key: edge.key,
          tableIds: edge.tableIds,
          relationshipIds: edge.relationships.map(
            (relationship) => relationship.id,
          ),
        })),
    })
  }

  return {
    tables,
    relationships: validRelationships,
    components,
    skippedTables,
    notices,
  }
}

function aliasesFor(tables: Array<JoinQueryTable>): Map<string, string> {
  const aliases = new Map<string, string>()
  const used = new Set<string>()
  for (const table of tables) {
    const words = table.name.match(/[\p{L}\p{N}]+/gu) ?? []
    const base =
      (words.length > 1
        ? words.map((word) => word[0]).join('')
        : words[0]?.slice(0, 1)
      )?.toLowerCase() || 't'
    let alias = base
    let suffix = 2
    while (used.has(alias)) alias = `${base}${suffix++}`
    used.add(alias)
    aliases.set(table.id, alias)
  }
  return aliases
}

export function generateJoinQuerySql(
  plan: JoinQueryPlan,
  options: GenerateJoinQueryOptions,
): string {
  const tableById = new Map(plan.tables.map((table) => [table.id, table]))
  const columnById = new Map(
    plan.tables.flatMap((table) =>
      table.columns.map((column) => [column.id, column] as const),
    ),
  )
  const aliases = aliasesFor(plan.tables)
  const order = new Map(plan.tables.map((table, index) => [table.id, index]))
  const included = new Set(options.includedOmittedRelationshipIds ?? [])
  const blocks: Array<string> = []

  const renderColumn = (tableId: string, columnId: string) => {
    const alias = aliases.get(tableId)!
    const column = columnById.get(columnId)!
    return `${quoteIdent(options.dialect, alias)}.${quoteIdent(options.dialect, column.name)}`
  }
  const renderPredicate = (relationship: JoinQueryRelationship) =>
    `${renderColumn(relationship.sourceTableId, relationship.sourceColumnId)} = ${renderColumn(relationship.targetTableId, relationship.targetColumnId)}`

  for (const component of plan.components) {
    const tables = component.tableIds.map((id) => tableById.get(id)!)
    const projections = tables.flatMap((table) => {
      const alias = aliases.get(table.id)!
      return [...table.columns]
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .map(
          (column) =>
            `  ${quoteIdent(options.dialect, alias)}.${quoteIdent(options.dialect, column.name)} AS ${quoteIdent(options.dialect, `${alias}_${column.name}`)}`,
        )
    })
    const root =
      options.rootTableIds?.[component.id] ?? component.defaultRootTableId
    if (!component.tableIds.includes(root)) {
      throw new Error(
        `Root table ${root} is not part of component ${component.id}.`,
      )
    }
    const rootTable = tableById.get(root)!
    const rootAlias = aliases.get(root)!
    const externalComments = component.externalTableIds.map(
      (id) =>
        `-- external table: ${quoteIdent(options.dialect, tableById.get(id)!.name)}`,
    )
    const lines = [
      ...externalComments,
      'SELECT',
      projections.join(',\n'),
      `FROM ${quoteIdent(options.dialect, rootTable.name)} AS ${quoteIdent(options.dialect, rootAlias)}`,
    ]
    if (component.tableIds.length > 1) {
      const tree = spanningTree(
        component.tableIds,
        component.edgeGroups,
        root,
        order,
      )
      const visited = new Set([root])
      for (const group of tree) {
        const chosenId = options.relationshipChoices?.[group.key]
        if (group.relationships.length > 1 && !chosenId) {
          throw new Error(`Choose a relationship for ${group.key}.`)
        }
        const relationship =
          group.relationships.find((candidate) => candidate.id === chosenId) ??
          group.relationships[0]
        if (chosenId && relationship.id !== chosenId) {
          throw new Error(
            `Relationship ${chosenId} is not valid for ${group.key}.`,
          )
        }
        const nextId = visited.has(group.tableIds[0])
          ? group.tableIds[1]
          : group.tableIds[0]
        visited.add(nextId)
        const joinType = options.joinTypes?.[relationship.id] ?? 'INNER'
        if (options.dialect === 'mysql' && joinType === 'FULL') {
          throw new Error('FULL OUTER JOIN is not supported by MySQL.')
        }
        const keyword =
          joinType === 'FULL' ? 'FULL OUTER JOIN' : `${joinType} JOIN`
        const nextTable = tableById.get(nextId)!
        lines.push(
          `${keyword} ${quoteIdent(options.dialect, nextTable.name)} AS ${quoteIdent(options.dialect, aliases.get(nextId)!)} ON ${renderPredicate(relationship)}`,
        )
      }
      const treeIds = new Set(
        tree.flatMap((group) => group.relationships.map((r) => r.id)),
      )
      const predicates = plan.relationships
        .filter(
          (relationship) =>
            included.has(relationship.id) && !treeIds.has(relationship.id),
        )
        .map(renderPredicate)
      if (predicates.length > 0)
        lines.push(`WHERE ${predicates.join('\n  AND ')}`)
    }
    blocks.push(`${lines.join('\n')};`)
  }
  return blocks.join('\n\n')
}

/**
 * Recomputes the deterministic tree from a caller-selected root. The dialog
 * uses this rather than the component's default-root tree so it exposes every
 * JOIN control and parallel relationship choice that the generated query uses.
 */
export function getJoinQueryTree(
  plan: JoinQueryPlan,
  component: JoinQueryComponent,
  rootTableId: string,
): Array<JoinQueryEdgeGroup> {
  if (!component.tableIds.includes(rootTableId)) {
    throw new Error(
      `Root table ${rootTableId} is not part of component ${component.id}.`,
    )
  }
  const order = new Map(plan.tables.map((table, index) => [table.id, index]))
  return spanningTree(
    component.tableIds,
    component.edgeGroups,
    rootTableId,
    order,
  )
}
