import { prisma } from './src/db'

async function testDB() {
  try {
    console.log('Testing database connection...')
    const projects = await prisma.project.findMany()
    console.log('Projects in database:', projects)
    console.log('Total projects:', projects.length)
  } catch (error) {
    console.error('Database error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testDB()
