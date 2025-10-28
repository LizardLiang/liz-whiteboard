# Quickstart Guide: Collaborative ER Diagram Whiteboard

**Purpose**: Get developers up to speed quickly on the architecture, key concepts, and development workflow.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Client (Browser)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ React        │  │ Konva.js     │  │ Socket.IO       │  │
│  │ Components   │→ │ Canvas       │  │ Client          │  │
│  └──────────────┘  └──────────────┘  └─────────┬────────┘  │
└────────────────────────────────────────────────┼───────────┘
                                                  │ WebSocket
┌─────────────────────────────────────────────────┼───────────┐
│                TanStack Start Server            │           │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────▼────────┐  │
│  │ API Routes   │  │ Prisma ORM   │  │ Socket.IO       │  │
│  │ (SSR)        │→ │              │  │ Server          │  │
│  └──────────────┘  └──────┬───────┘  └──────────────────┘  │
└────────────────────────────┼────────────────────────────────┘
                             │
                ┌────────────▼──────────┐
                │   PostgreSQL          │
                │   Database            │
                └───────────────────────┘
```

### Key Layers

1. **UI Layer** (React + Konva): Interactive canvas, navigation tree, text editor
2. **API Layer** (TanStack Start): RESTful CRUD, WebSocket handlers
3. **Data Layer** (Prisma + PostgreSQL): Persistence, transactions
4. **Real-Time Layer** (Socket.IO): Collaborative editing events
5. **Computation Layer** (Web Worker): Graph layout algorithms

---

## Core Concepts

### 1. Hierarchical Organization

```
Project
├── Folder
│   ├── Folder (nested)
│   └── Whiteboard
└── Whiteboard (directly under project)
```

- **Project**: Top-level container
- **Folder**: Organizes whiteboards (supports nesting up to 10 levels)
- **Whiteboard**: Canvas with ER diagram

### 2. ER Diagram Structure

```
Whiteboard
├── DiagramTable
│   ├── Column (name, dataType, constraints)
│   └── Column
└── Relationship (sourceColumn → targetColumn, cardinality)
```

- **DiagramTable**: Visual representation of database table
- **Column**: Field with data type and constraints (PK, FK, unique, nullable)
- **Relationship**: Foreign key link between columns with cardinality

### 3. Dual Input Modes

**Visual Mode**: Drag-and-drop tables, click to create relationships
**Text Mode**: Type Mermaid-like syntax, real-time rendering

Example text syntax:

```
table Users {
  _id: int PK
  name: string
  email: string
}

table Orders {
  order_id: int PK
  user_id: int FK
}

Users._id --> Orders.user_id : "one to many"
```

### 4. Automatic Layout

Force-directed graph algorithm positions tables based on **relationship strength**:

```
strength(A, B) = directConnections(A, B) + 0.5 × sharedNeighbors(A, B)
```

Example: If A connects to B and C, and B also connects to C, then A-B has higher strength than A-C.

---

## Tech Stack Quick Reference

| Layer              | Technology               | Purpose                         |
| ------------------ | ------------------------ | ------------------------------- |
| Frontend Framework | React 19                 | UI components                   |
| Routing            | TanStack Router 1.132    | File-based routing              |
| Full-Stack         | TanStack Start 1.132     | SSR + API routes                |
| State Management   | TanStack Query 5.66      | Server state caching            |
| UI Components      | shadcn/ui                | Pre-built accessible components |
| Canvas Rendering   | Konva.js (react-konva)   | Interactive diagrams            |
| Database           | PostgreSQL + Prisma 6.16 | Data persistence                |
| Real-Time          | Socket.IO                | WebSocket collaboration         |
| Layout Engine      | D3-force                 | Graph layout algorithms         |
| Validation         | Zod 4.1                  | Runtime type checking           |
| Styling            | TailwindCSS 4.0          | Utility-first CSS               |
| Testing            | Vitest 3.0               | Unit/integration tests          |

---

## Project Structure

```
src/
├── routes/                      # TanStack Router pages
│   ├── __root.tsx              # App shell
│   ├── index.tsx               # Dashboard
│   ├── whiteboard/
│   │   └── $whiteboardId.tsx   # Whiteboard editor
│   └── api/                    # Server functions
│       ├── whiteboards.ts      # CRUD endpoints
│       └── collaboration.ts    # WebSocket handlers
├── components/
│   ├── whiteboard/             # Canvas components
│   │   ├── Canvas.tsx          # Konva Stage wrapper
│   │   ├── TableNode.tsx       # Table visual
│   │   └── RelationshipEdge.tsx # Arrow between tables
│   └── navigator/              # Project tree
├── lib/
│   ├── canvas/                 # Rendering logic
│   │   ├── renderer.ts         # Drawing primitives
│   │   └── layout-engine.ts    # D3-force layout
│   ├── parser/                 # Text syntax parser
│   └── collaboration/          # WebSocket client
├── hooks/
│   ├── use-diagram.ts          # Diagram state
│   └── use-collaboration.ts    # Real-time sync
└── data/
    ├── whiteboard.ts           # Data access layer
    └── schema.ts               # Zod validation schemas

prisma/
└── schema.prisma               # Database schema
```

---

## Development Workflow

### 1. Setup Environment

```bash
# Clone repo
git clone <repo-url>
cd liz-whiteboard

# Install dependencies
npm install

# Setup database
cp .env.local.example .env.local
# Edit .env.local with your PostgreSQL connection string

# Run Prisma migrations
npm run db:push

# Seed sample data (optional)
npm run db:seed

# Start dev server
npm run dev
# App runs at http://localhost:3000
```

### 2. Database Development

```bash
# Generate Prisma client after schema changes
npm run db:generate

# Create migration
npm run db:migrate

# Open Prisma Studio (visual database editor)
npm run db:studio
```

### 3. Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm test -- --watch

# Coverage report
npm test -- --coverage
```

---

## Key Development Patterns

### 1. shadcn/ui Components

**Using Pre-built Components**:

shadcn/ui components are already available in `src/components/ui/`. Use them for all UI elements outside the canvas:

```typescript
import { Button } from '~/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';

function CreateTableDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="default">Add Table</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Table</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Table Name</Label>
            <Input id="name" placeholder="Users" />
          </div>
          <Button type="submit">Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Adding New Components**:

Use the shadcn CLI to add components as needed:

```bash
# Add a specific component
npx shadcn@latest add button
npx shadcn@latest add dialog
npx shadcn@latest add select

# Components are copied to src/components/ui/ for full customization
```

**Common Components for This Project**:

- `Button` - Toolbar actions, form submits
- `Dialog` - Create/edit modals
- `Popover` - Context menus, tooltips
- `Select`, `Input`, `Textarea` - Form fields
- `Sidebar`, `Collapsible` - Project navigation
- `Tabs` - Visual/text editor mode toggle
- `Switch` - Dark mode toggle
- `DropdownMenu` - Right-click context menus

---

### 2. Server Functions (TanStack Start)

**API Route Example** (`src/routes/api/whiteboards.ts`):

```typescript
import { createServerFn } from '@tanstack/start'
import { z } from 'zod'
import { db } from '~/db'

export const getWhiteboard = createServerFn(
  'GET',
  async (whiteboardId: string) => {
    const whiteboard = await db.whiteboard.findUnique({
      where: { id: whiteboardId },
      include: {
        tables: {
          include: {
            columns: { orderBy: { order: 'asc' } },
            outgoingRelationships: true,
          },
        },
      },
    })

    if (!whiteboard) {
      throw new Error('Whiteboard not found')
    }

    return whiteboard
  },
)
```

**Usage in Component**:

```typescript
import { useQuery } from '@tanstack/react-query';
import { getWhiteboard } from '~/routes/api/whiteboards';

function WhiteboardEditor({ whiteboardId }: { whiteboardId: string }) {
  const { data: whiteboard, isLoading } = useQuery({
    queryKey: ['whiteboard', whiteboardId],
    queryFn: () => getWhiteboard(whiteboardId),
  });

  if (isLoading) return <div>Loading...</div>;
  return <Canvas whiteboard={whiteboard} />;
}
```

### 3. Canvas Rendering (Konva)

**Table Component Example**:

```typescript
import { Group, Rect, Text } from 'react-konva';

interface TableNodeProps {
  table: DiagramTable;
  columns: Column[];
  onDragEnd: (x: number, y: number) => void;
}

function TableNode({ table, columns, onDragEnd }: TableNodeProps) {
  return (
    <Group
      x={table.positionX}
      y={table.positionY}
      draggable
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
    >
      {/* Table background */}
      <Rect
        width={table.width || 200}
        height={(columns.length + 1) * 25}
        fill="#fff"
        stroke="#333"
        strokeWidth={2}
      />

      {/* Table name */}
      <Text
        text={table.name}
        fontSize={16}
        fontStyle="bold"
        padding={5}
      />

      {/* Columns */}
      {columns.map((col, i) => (
        <Text
          key={col.id}
          y={(i + 1) * 25}
          text={`${col.name}: ${col.dataType}`}
          fontSize={14}
          padding={5}
        />
      ))}
    </Group>
  );
}
```

### 4. Real-Time Collaboration (Socket.IO)

**Setup Hook** (`src/hooks/use-collaboration.ts`):

```typescript
import { useEffect } from 'react'
import { io, Socket } from 'socket.io-client'

export function useCollaboration(whiteboardId: string, userId: string) {
  useEffect(() => {
    const socket = io(`/whiteboard/${whiteboardId}`, {
      auth: { userId },
    })

    // Listen for table creation by other users
    socket.on('table:created', (table) => {
      // Update local state (via React Query invalidation)
      queryClient.invalidateQueries(['whiteboard', whiteboardId])
    })

    // Send table creation event
    const createTable = (name: string, x: number, y: number) => {
      socket.emit('table:create', { name, positionX: x, positionY: y })
    }

    return () => {
      socket.disconnect()
    }
  }, [whiteboardId, userId])
}
```

### 5. Automatic Layout (D3-force)

**Layout Engine** (`src/lib/canvas/layout-engine.ts`):

```typescript
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
} from 'd3-force'

export function computeLayout(
  tables: DiagramTable[],
  relationships: Relationship[],
) {
  // Create nodes and links
  const nodes = tables.map((t) => ({
    id: t.id,
    x: t.positionX,
    y: t.positionY,
  }))
  const links = relationships.map((r) => ({
    source: r.sourceTableId,
    target: r.targetTableId,
    strength: calculateRelationshipStrength(r, relationships),
  }))

  // Run force simulation
  const simulation = forceSimulation(nodes)
    .force(
      'link',
      forceLink(links)
        .id((d: any) => d.id)
        .strength((l: any) => l.strength),
    )
    .force('charge', forceManyBody().strength(-300))
    .force('center', forceCenter(400, 300))

  // Run for 300 iterations
  simulation.tick(300)

  // Return new positions
  return nodes.map((n) => ({
    tableId: n.id,
    positionX: n.x,
    positionY: n.y,
  }))
}

function calculateRelationshipStrength(rel: Relationship, all: Relationship[]) {
  // Direct connection
  let strength = 1.0

  // Shared neighbors boost strength
  const sourceNeighbors = all.filter(
    (r) => r.sourceTableId === rel.sourceTableId,
  )
  const targetNeighbors = all.filter(
    (r) => r.sourceTableId === rel.targetTableId,
  )
  const sharedCount = sourceNeighbors.filter((s) =>
    targetNeighbors.some((t) => t.targetTableId === s.targetTableId),
  ).length

  strength += sharedCount * 0.5
  return strength
}
```

---

## Common Tasks

### Add a New Entity

1. **Update Prisma Schema** (`prisma/schema.prisma`):

   ```prisma
   model NewEntity {
     id        String   @id @default(uuid())
     name      String
     createdAt DateTime @default(now())
   }
   ```

2. **Run Migration**:

   ```bash
   npm run db:push
   ```

3. **Create Zod Schema** (`src/data/schema.ts`):

   ```typescript
   export const createNewEntitySchema = z.object({
     name: z.string().min(1).max(255),
   })
   ```

4. **Create API Route** (`src/routes/api/new-entity.ts`):

   ```typescript
   export const createNewEntity = createServerFn('POST', async (data) => {
     const validated = createNewEntitySchema.parse(data)
     return await db.newEntity.create({ data: validated })
   })
   ```

5. **Add to Component**: Use in React with TanStack Query

### Add a New Canvas Element Type

1. **Create Konva Component** (`src/components/whiteboard/NewShape.tsx`)
2. **Add to Canvas** (`src/components/whiteboard/Canvas.tsx`)
3. **Update Data Model** (if persistent)
4. **Add WebSocket Events** (for collaboration)

### Add a WebSocket Event

1. **Define Event** (`src/routes/api/collaboration.ts`):

   ```typescript
   socket.on('new:event', (data) => {
     // Validate
     const validated = newEventSchema.parse(data)

     // Persist to DB
     await db.newEntity.create({ data: validated })

     // Broadcast to others
     socket.broadcast.emit('new:broadcasted', validated)
   })
   ```

2. **Handle in Client** (`src/hooks/use-collaboration.ts`):
   ```typescript
   socket.on('new:broadcasted', (data) => {
     // Update local state
   })
   ```

---

## Testing Strategy

### Unit Tests

**Test canvas utilities**:

```typescript
// src/lib/canvas/layout-engine.test.ts
import { describe, it, expect } from 'vitest';
import { computeLayout } from './layout-engine';

describe('computeLayout', () => {
  it('positions strongly connected tables closer together', () => {
    const tables = [{ id: 'A', ... }, { id: 'B', ... }, { id: 'C', ... }];
    const relationships = [
      { sourceTableId: 'A', targetTableId: 'B' },
      { sourceTableId: 'A', targetTableId: 'C' },
      { sourceTableId: 'B', targetTableId: 'C' },
    ];

    const positions = computeLayout(tables, relationships);

    // A-B distance should be less than A-C distance
    const distAB = distance(positions.A, positions.B);
    const distAC = distance(positions.A, positions.C);
    expect(distAB).toBeLessThan(distAC);
  });
});
```

### Integration Tests

**Test full whiteboard workflow**:

```typescript
// tests/integration/whiteboard.test.ts
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WhiteboardEditor } from '~/routes/whiteboard/$whiteboardId';

describe('Whiteboard Editor', () => {
  it('creates a table and displays on canvas', async () => {
    render(<WhiteboardEditor whiteboardId="test-id" />);

    // Click "Add Table" button
    fireEvent.click(screen.getByText('Add Table'));

    // Fill form
    fireEvent.change(screen.getByLabelText('Table Name'), {
      target: { value: 'Users' },
    });
    fireEvent.click(screen.getByText('Create'));

    // Verify table appears
    await screen.findByText('Users');
    expect(screen.getByText('Users')).toBeInTheDocument();
  });
});
```

---

## Performance Tips

1. **Canvas Optimization**:
   - Use `layer.batchDraw()` for multiple updates
   - Implement virtual rendering (only render visible viewport)
   - Cache complex shapes

2. **Database Queries**:
   - Use Prisma `select` to avoid over-fetching
   - Add indexes on foreign keys
   - Paginate large lists

3. **WebSocket**:
   - Throttle high-frequency events (cursor, drag)
   - Debounce text input updates
   - Use binary encoding (MessagePack) for positions

4. **Layout Computation**:
   - Run D3-force in Web Worker
   - Limit simulation iterations (max 300)
   - Cache layouts, recompute only on schema changes

---

## Debugging

### Enable Debug Logging

```typescript
// Socket.IO debug
localStorage.setItem('debug', 'socket.io-client:*')

// D3-force visualization
import { forceSimulation } from 'd3-force'
const simulation = forceSimulation(nodes)
simulation.on('tick', () => {
  console.log('Tick:', nodes)
})
```

### Common Issues

**Problem**: Tables not appearing on canvas
**Solution**: Check Konva Stage size, ensure Layer is added to Stage

**Problem**: WebSocket not connecting
**Solution**: Verify Socket.IO namespace matches, check CORS settings

**Problem**: Layout positions tables off-screen
**Solution**: Add `forceCenter()` to simulation, adjust canvas viewport

---

## Next Steps

1. **Read Spec**: Review `specs/001-collaborative-er-whiteboard/spec.md` for full requirements
2. **Explore Contracts**: Check `specs/001-collaborative-er-whiteboard/contracts/` for API details
3. **Run Tasks**: Use `/speckit.tasks` to generate implementation tasks
4. **Start Coding**: Pick a P1 user story and begin implementation

---

## Resources

- [TanStack Start Docs](https://tanstack.com/start/latest)
- [Konva.js API](https://konvajs.org/api/)
- [Prisma Docs](https://www.prisma.io/docs)
- [Socket.IO Docs](https://socket.io/docs/v4/)
- [D3-force Examples](https://d3js.org/d3-force)
- [React Konva Tutorial](https://konvajs.org/docs/react/)

---

**Questions?** Review the spec, data model, and contracts. Still stuck? Check existing tests for examples.
