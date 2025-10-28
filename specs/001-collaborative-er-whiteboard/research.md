# Research: Collaborative ER Diagram Whiteboard

**Date**: 2025-10-28
**Phase**: 0 - Technical Research
**Purpose**: Resolve all NEEDS CLARIFICATION items from Technical Context

## Research Questions

### 1. WebSocket/Real-Time Sync Strategy

**Question**: What WebSocket library and sync strategy should we use for real-time collaboration?

**Decision**: Use **Socket.IO** with **Operational Transformation (OT)** or **CRDT** for conflict-free collaboration

**Rationale**:

- Socket.IO provides automatic reconnection, fallback transports (long-polling), and room-based messaging
- Well-integrated with Node.js/Express backends
- Large ecosystem and proven at scale
- For conflict resolution:
  - **Last Write Wins** (spec requirement) - simplest, acceptable for this use case
  - Consider **Yjs CRDT** for future enhancement if conflicts become problematic

**Alternatives Considered**:

- **Native WebSocket API**: More lightweight but requires manual reconnection logic, room management
- **Pusher/Ably**: Third-party managed services - adds cost dependency, vendor lock-in
- **tRPC subscriptions**: Emerging pattern but less mature for real-time collaboration

**Implementation Approach**:

- Socket.IO server integrated with TanStack Start
- Emit granular events: `table:created`, `table:moved`, `relationship:added`, etc.
- Room per whiteboard (namespace: `/whiteboard/:id`)
- Broadcast changes to all connected clients except sender
- Store operation history in PostgreSQL for reconnection sync

**Best Practices**:

- Throttle/debounce high-frequency events (table drag)
- Include version/timestamp with each operation
- Handle network partitions with eventual consistency
- Implement presence awareness (show active users)

---

### 2. Canvas Rendering Library Choice

**Question**: What library should we use for HTML5 Canvas rendering?

**Decision**: Use **Konva.js** (React wrapper: **react-konva**)

**Rationale**:

- React-first API - components map to canvas shapes
- Built-in event handling (click, drag, hover)
- Layer-based architecture (separation of tables, arrows, annotations)
- Excellent performance for interactive diagrams (handles 100s of elements)
- Built-in transformations (zoom, pan, rotate)
- Export to image/SVG capability

**Alternatives Considered**:

- **Fabric.js**: Rich feature set but less React-friendly, more imperative API
- **PixiJS**: Game-focused (WebGL), overkill for ER diagrams, harder to integrate
- **D3.js**: Excellent for data viz but uses SVG (performance issues at scale), not canvas-optimized
- **Raw Canvas API**: Maximum control but requires significant boilerplate for interactions

**Implementation Approach**:

- Konva `Stage` as root canvas container
- `Layer` for tables, separate `Layer` for relationship arrows
- Each table = Konva `Group` with `Rect` + `Text` nodes
- Each relationship = Konva `Arrow` or `Line` with custom arrow heads
- Use Konva transformers for zoom/pan

**Best Practices**:

- Use object pooling for frequently created/destroyed shapes
- Batch updates with `layer.batchDraw()`
- Offload heavy computations (layout) to Web Workers
- Cache complex shapes as images
- Implement virtual rendering (only render visible viewport)

---

### 3. Graph Layout Algorithm Selection

**Question**: Which graph layout algorithm for automatic diagram organization?

**Decision**: **Force-Directed Layout** (D3-force) with **relationship-strength weighting**

**Rationale**:

- Force-directed naturally clusters related nodes
- Easy to customize forces based on relationship strength (spec requirement)
- Smooth animated transitions
- Well-tested library (D3-force)
- Can run in Web Worker to avoid UI blocking

**Alternatives Considered**:

- **Hierarchical (Sugiyama)**: Good for DAGs but ER diagrams often have cycles
- **Circular**: Poor for relationship-based clustering
- **Grid-based**: Simple but doesn't minimize crossings or cluster related tables
- **GraphViz (Dagre)**: Excellent quality but large bundle size, limited customization

**Implementation Approach**:

- Use `d3-force` simulation
- Custom force functions:
  - **Link force**: Stronger links for tables with shared connections (spec: A↔B + B↔C makes A-B stronger)
  - **Charge force**: Repel unrelated tables
  - **Center force**: Keep diagram centered
  - **Collision force**: Prevent table overlap
- Relationship strength calculation:
  ```
  strength(A, B) = directConnections(A, B) + 0.5 * sharedNeighbors(A, B)
  ```
- Run simulation for fixed iterations or until energy threshold
- Apply layout in Web Worker, postMessage results to main thread

**Best Practices**:

- Provide manual override (user can disable auto-layout)
- Preserve aspect ratio of canvas
- Handle disconnected subgraphs separately
- Cache layouts for performance (re-compute only on schema changes)

---

## Technology Stack Summary

| Layer              | Technology                        | Purpose                                      |
| ------------------ | --------------------------------- | -------------------------------------------- |
| Frontend Framework | React 19.2 + TanStack Router      | UI components, routing                       |
| Backend Framework  | TanStack Start                    | SSR, API routes, server functions            |
| UI Components      | shadcn/ui                         | Pre-built accessible components              |
| Database           | PostgreSQL + Prisma ORM           | Persistent storage                           |
| Canvas Rendering   | Konva.js (react-konva)            | Interactive ER diagram visualization         |
| Layout Engine      | D3-force                          | Automatic graph layout                       |
| Real-time Sync     | Socket.IO                         | WebSocket collaboration                      |
| Text Parsing       | Custom parser (Chevrotain/PEG.js) | Mermaid-like diagram syntax                  |
| Validation         | Zod                               | Schema validation                            |
| Styling            | TailwindCSS 4.0                   | Utility-first CSS (foundation for shadcn/ui) |
| Testing            | Vitest + Testing Library          | Unit/integration tests                       |

---

## Additional Research Findings

### Text Diagram Parser

**Decision**: Use **Chevrotain** for building the Mermaid-like parser

**Rationale**:

- Lexer/parser generator for TypeScript
- Excellent error recovery and messages
- Fast performance
- No code generation - pure TS

**Syntax Design** (based on Mermaid ER syntax):

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

---

### UI Component Library

**Decision**: Use **shadcn/ui** for UI components

**Rationale**:

- Already configured in project (components.json exists)
- Built on TailwindCSS - provides beautiful, accessible components
- Copy-paste component model - no npm dependency, full ownership
- Customizable via CSS variables and TailwindCSS
- Excellent TypeScript support with type-safe props
- Includes dark mode support out of the box

**Components to Use**:

- Button, Dialog, Popover - for toolbar actions
- Select, Input, Textarea - for forms (create table, edit column)
- Sidebar, Collapsible - for project/folder navigation
- Tooltip - for canvas element hover information
- DropdownMenu - for context menus on tables/relationships
- Switch - for dark mode toggle
- Tabs - for switching between visual/text editor modes

**Custom Components Needed**:

- Canvas (Konva-based) - whiteboard rendering
- TableNode (Konva) - ER diagram table visual
- RelationshipEdge (Konva) - arrows between tables

---

### Dark Mode Implementation

**Decision**: Use shadcn/ui theme system with TailwindCSS dark mode

**Approach**:

- shadcn/ui provides built-in dark mode theming via CSS variables
- Use `next-themes` or similar for theme toggle (already common with shadcn)
- `dark:` variant for custom components
- Store preference in localStorage
- Apply to canvas via Konva shape fill/stroke colors (use CSS variable values)
- Theme context provider for global state

---

### Offline Support & PWA

**Status**: OUT OF SCOPE for MVP (spec doesn't require)

**Future Consideration**:

- Service Worker for offline canvas editing
- IndexedDB for local diagram cache
- Sync conflicts on reconnect

---

## Performance Optimization Strategies

1. **Canvas Rendering**:
   - Use `requestAnimationFrame` for smooth animations
   - Implement virtual viewport rendering (cull off-screen objects)
   - Cache rendered shapes as bitmaps
   - Use GPU-accelerated layers where possible

2. **WebSocket**:
   - Throttle high-frequency events (mouse move) to 60Hz
   - Delta compression for large payloads
   - Binary encoding (MessagePack) for non-text data

3. **Layout Computation**:
   - Run D3-force in Web Worker
   - Limit simulation iterations (max 300 ticks or convergence)
   - Debounce auto-layout trigger (500ms after last edit)

4. **Database**:
   - Index foreign keys (whiteboard_id, project_id, folder_id)
   - Paginate large folder listings
   - Use Prisma select to avoid over-fetching

---

## Security Considerations

1. **Authorization**:
   - Verify whiteboard ownership before allowing edits
   - Implement project-level permissions

2. **WebSocket Security**:
   - Authenticate socket connections (JWT in handshake)
   - Validate all incoming operations against schema

3. **Input Validation**:
   - Sanitize diagram text input (prevent XSS in labels)
   - Limit diagram complexity (max tables, max relationships)

---

## Dependencies to Add

```json
{
  "dependencies": {
    "socket.io": "^4.7.0",
    "socket.io-client": "^4.7.0",
    "konva": "^9.3.0",
    "react-konva": "^18.2.10",
    "d3-force": "^3.0.0",
    "chevrotain": "^11.0.0"
  },
  "devDependencies": {
    "@types/d3-force": "^3.0.0"
  }
}
```

---

## Conclusion

All NEEDS CLARIFICATION items resolved. Ready to proceed to Phase 1 (Design & Contracts).
