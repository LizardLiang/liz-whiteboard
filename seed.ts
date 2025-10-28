import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Clear existing data (in order to respect foreign key constraints)
  await prisma.relationship.deleteMany()
  await prisma.column.deleteMany()
  await prisma.diagramTable.deleteMany()
  await prisma.whiteboard.deleteMany()
  await prisma.folder.deleteMany()
  await prisma.project.deleteMany()

  // Create a sample project
  const project = await prisma.project.create({
    data: {
      name: 'E-commerce Platform',
      description: 'Database schema for an e-commerce application',
    },
  })
  console.log(`✅ Created project: ${project.name}`)

  // Create a whiteboard
  const whiteboard = await prisma.whiteboard.create({
    data: {
      name: 'User & Product Schema',
      projectId: project.id,
      canvasState: { zoom: 1, offsetX: 0, offsetY: 0 },
    },
  })
  console.log(`✅ Created whiteboard: ${whiteboard.name}`)

  // Create Users table
  const usersTable = await prisma.diagramTable.create({
    data: {
      whiteboardId: whiteboard.id,
      name: 'Users',
      description: 'User accounts and authentication',
      positionX: 100,
      positionY: 100,
      width: 250,
      height: null,
    },
  })

  // Create columns for Users table
  const userIdColumn = await prisma.column.create({
    data: {
      tableId: usersTable.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isNullable: false,
      order: 0,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: usersTable.id,
        name: 'email',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: false,
        order: 1,
      },
      {
        tableId: usersTable.id,
        name: 'name',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: false,
        order: 2,
      },
      {
        tableId: usersTable.id,
        name: 'created_at',
        dataType: 'date',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: false,
        order: 3,
      },
    ],
  })
  console.log(`✅ Created Users table with columns`)

  // Create Products table
  const productsTable = await prisma.diagramTable.create({
    data: {
      whiteboardId: whiteboard.id,
      name: 'Products',
      description: 'Product catalog',
      positionX: 500,
      positionY: 100,
      width: 250,
      height: null,
    },
  })

  // Create columns for Products table
  const productIdColumn = await prisma.column.create({
    data: {
      tableId: productsTable.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isNullable: false,
      order: 0,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: productsTable.id,
        name: 'name',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: false,
        order: 1,
      },
      {
        tableId: productsTable.id,
        name: 'price',
        dataType: 'float',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: false,
        order: 2,
      },
      {
        tableId: productsTable.id,
        name: 'description',
        dataType: 'text',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: true,
        order: 3,
      },
    ],
  })
  console.log(`✅ Created Products table with columns`)

  // Create Orders table
  const ordersTable = await prisma.diagramTable.create({
    data: {
      whiteboardId: whiteboard.id,
      name: 'Orders',
      description: 'Customer orders',
      positionX: 300,
      positionY: 400,
      width: 250,
      height: null,
    },
  })

  // Create columns for Orders table
  const orderIdColumn = await prisma.column.create({
    data: {
      tableId: ordersTable.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isNullable: false,
      order: 0,
    },
  })

  const orderUserIdColumn = await prisma.column.create({
    data: {
      tableId: ordersTable.id,
      name: 'user_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isNullable: false,
      order: 1,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: ordersTable.id,
        name: 'total_amount',
        dataType: 'float',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: false,
        order: 2,
      },
      {
        tableId: ordersTable.id,
        name: 'status',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: false,
        order: 3,
      },
      {
        tableId: ordersTable.id,
        name: 'created_at',
        dataType: 'date',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: false,
        order: 4,
      },
    ],
  })
  console.log(`✅ Created Orders table with columns`)

  // Create relationship: Users -> Orders (ONE_TO_MANY)
  await prisma.relationship.create({
    data: {
      whiteboardId: whiteboard.id,
      sourceTableId: usersTable.id,
      targetTableId: ordersTable.id,
      sourceColumnId: userIdColumn.id,
      targetColumnId: orderUserIdColumn.id,
      cardinality: 'ONE_TO_MANY',
      label: 'places',
    },
  })
  console.log(`✅ Created relationship: Users -> Orders`)

  console.log('🎉 Database seeded successfully!')
  console.log(`   Project ID: ${project.id}`)
  console.log(`   Whiteboard ID: ${whiteboard.id}`)
  console.log(`   Open: http://localhost:3000/whiteboard/${whiteboard.id}`)
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
