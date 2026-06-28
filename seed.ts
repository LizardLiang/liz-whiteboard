// seed.ts
// Seeds the SQLite database with a small deterministic ER diagram.
// Uses the raw-SQLite data layer (no ORM). Run with: bun seed.ts
import { db } from '@/db'
import { createProject } from '@/data/project'
import { createWhiteboard } from '@/data/whiteboard'
import { createDiagramTable } from '@/data/diagram-table'
import { createColumn, createColumns } from '@/data/column'
import { createRelationship } from '@/data/relationship'

async function main() {
  console.log('🌱 Seeding database...')

  // Clear existing diagram data (FK cascade order). Importing `@/db` above has
  // already ensured the schema exists.
  db.exec(
    'DELETE FROM "Relationship"; DELETE FROM "Column"; DELETE FROM "DiagramTable"; DELETE FROM "Whiteboard"; DELETE FROM "Folder"; DELETE FROM "Project";',
  )

  const project = await createProject({
    name: 'E-commerce Platform',
    description: 'Database schema for an e-commerce application',
  })
  console.log(`✅ Created project: ${project.name}`)

  const whiteboard = await createWhiteboard({
    name: 'User & Product Schema',
    projectId: project.id,
    canvasState: { zoom: 1, offsetX: 0, offsetY: 0 },
  })
  console.log(`✅ Created whiteboard: ${whiteboard.name}`)

  // Users table
  const usersTable = await createDiagramTable({
    whiteboardId: whiteboard.id,
    name: 'Users',
    description: 'User accounts and authentication',
    positionX: 100,
    positionY: 100,
    width: 250,
  })
  const userIdColumn = await createColumn({
    tableId: usersTable.id,
    name: 'id',
    dataType: 'uuid',
    isPrimaryKey: true,
    order: 0,
  })
  await createColumns([
    { tableId: usersTable.id, name: 'email', dataType: 'string', order: 1 },
    { tableId: usersTable.id, name: 'name', dataType: 'string', order: 2 },
    { tableId: usersTable.id, name: 'created_at', dataType: 'date', order: 3 },
  ])
  console.log('✅ Created Users table with columns')

  // Products table
  const productsTable = await createDiagramTable({
    whiteboardId: whiteboard.id,
    name: 'Products',
    description: 'Product catalog',
    positionX: 500,
    positionY: 100,
    width: 250,
  })
  await createColumn({
    tableId: productsTable.id,
    name: 'id',
    dataType: 'uuid',
    isPrimaryKey: true,
    order: 0,
  })
  await createColumns([
    { tableId: productsTable.id, name: 'name', dataType: 'string', order: 1 },
    { tableId: productsTable.id, name: 'price', dataType: 'float', order: 2 },
    {
      tableId: productsTable.id,
      name: 'description',
      dataType: 'text',
      isNullable: true,
      order: 3,
    },
  ])
  console.log('✅ Created Products table with columns')

  // Orders table
  const ordersTable = await createDiagramTable({
    whiteboardId: whiteboard.id,
    name: 'Orders',
    description: 'Customer orders',
    positionX: 300,
    positionY: 400,
    width: 250,
  })
  await createColumn({
    tableId: ordersTable.id,
    name: 'id',
    dataType: 'uuid',
    isPrimaryKey: true,
    order: 0,
  })
  const orderUserIdColumn = await createColumn({
    tableId: ordersTable.id,
    name: 'user_id',
    dataType: 'uuid',
    isForeignKey: true,
    order: 1,
  })
  await createColumns([
    {
      tableId: ordersTable.id,
      name: 'total_amount',
      dataType: 'float',
      order: 2,
    },
    { tableId: ordersTable.id, name: 'status', dataType: 'string', order: 3 },
    { tableId: ordersTable.id, name: 'created_at', dataType: 'date', order: 4 },
  ])
  console.log('✅ Created Orders table with columns')

  // Relationship: Users -> Orders (ONE_TO_MANY)
  await createRelationship({
    whiteboardId: whiteboard.id,
    sourceTableId: usersTable.id,
    targetTableId: ordersTable.id,
    sourceColumnId: userIdColumn.id,
    targetColumnId: orderUserIdColumn.id,
    cardinality: 'ONE_TO_MANY',
    label: 'places',
  })
  console.log('✅ Created relationship: Users -> Orders')

  console.log('🎉 Database seeded successfully!')
  console.log(`   Project ID: ${project.id}`)
  console.log(`   Whiteboard ID: ${whiteboard.id}`)
  console.log(`   Open: http://localhost:3000/whiteboard/${whiteboard.id}`)
}

main().catch((e) => {
  console.error('❌ Error seeding database:', e)
  process.exit(1)
})
