// Quick test script to verify field insert functionality
// This script manually creates test data and opens a whiteboard

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function createTestData() {
  try {
    // Clean up any existing test data
    await prisma.$transaction([
      prisma.relationship.deleteMany({ where: {} }),
      prisma.column.deleteMany({ where: {} }),
      prisma.table.deleteMany({ where: {} }),
      prisma.whiteboard.deleteMany({ where: {} }),
      prisma.project.deleteMany({ where: {} }),
      prisma.folder.deleteMany({ where: {} }),
    ])

    // Create test project and folder
    const project = await prisma.project.create({
      data: {
        id: 'test-project',
        name: 'Test Project',
        description: 'Test project for field insert bug fix',
        createdBy: 'test-user',
      },
    })

    const folder = await prisma.folder.create({
      data: {
        id: 'test-folder',
        name: 'Test Folder',
        projectId: project.id,
        createdBy: 'test-user',
      },
    })

    // Create test whiteboard
    const whiteboard = await prisma.whiteboard.create({
      data: {
        id: 'test-whiteboard',
        name: 'Test Whiteboard - Field Insert',
        description: 'Whiteboard to test field insert functionality',
        folderId: folder.id,
        projectId: project.id,
        createdBy: 'test-user',
        textSource: '',
      },
    })

    // Create a test table with one column
    const table = await prisma.table.create({
      data: {
        id: 'test-table',
        name: 'users',
        whiteboardId: whiteboard.id,
        positionX: 100,
        positionY: 100,
        width: 280,
        height: null,
        createdBy: 'test-user',
      },
    })

    // Create one initial column
    await prisma.column.create({
      data: {
        id: 'test-col-id',
        tableId: table.id,
        name: 'id',
        dataType: 'uuid',
        order: 0,
        isPrimaryKey: true,
        isForeignKey: false,
        isUnique: true,
        isNullable: false,
        description: 'Primary key',
        createdBy: 'test-user',
      },
    })

    console.log('✅ Test data created successfully!')
    console.log(`📊 Project: ${project.id}`)
    console.log(`📁 Folder: ${folder.id}`)
    console.log(`📋 Whiteboard: ${whiteboard.id}`)
    console.log(`🗂️ Table: ${table.id}`)
    console.log('')
    console.log(
      `🌐 Open in browser: http://localhost:3001/whiteboard/${whiteboard.id}`,
    )
    console.log('')
    console.log('Test the field insert by:')
    console.log('1. Click the "+" button in the users table')
    console.log('2. Enter a column name (e.g., "email")')
    console.log('3. Press Enter or click the checkmark')
    console.log('4. Verify the column is added successfully')
  } catch (error) {
    console.error('❌ Error creating test data:', error)
  } finally {
    await prisma.$disconnect()
  }
}

createTestData()
