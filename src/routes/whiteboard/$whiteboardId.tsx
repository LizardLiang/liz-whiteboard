// src/routes/whiteboard/$whiteboardId.tsx
// Whiteboard editor route - loads and renders full ER diagram

import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback, useEffect } from 'react';
import { Canvas } from '@/components/whiteboard/Canvas';
import { TableNode } from '@/components/whiteboard/TableNode';
import { RelationshipEdge } from '@/components/whiteboard/RelationshipEdge';
import { Toolbar } from '@/components/whiteboard/Toolbar';
import { useCollaboration } from '@/hooks/use-collaboration';
import type { CanvasViewport } from '@/components/whiteboard/Canvas';
import type { CreateTable, CreateRelationship } from '@/data/schema';
import {
  getWhiteboardWithDiagram,
  getWhiteboardRelationships,
  createTable as createTableFn,
  updateTablePosition as updateTablePositionFn,
  createRelationshipFn,
} from '@/lib/server-functions';

/**
 * Whiteboard editor page component
 * Loads whiteboard with full diagram and enables real-time collaboration
 */
export const Route = createFileRoute('/whiteboard/$whiteboardId')({
  component: WhiteboardEditor,
});

/**
 * Whiteboard Editor component
 */
function WhiteboardEditor() {
  const { whiteboardId } = Route.useParams();
  const queryClient = useQueryClient();

  // TODO: Get actual user ID from auth context
  const userId = 'temp-user-id';

  // State
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [canvasViewport, setCanvasViewport] = useState<CanvasViewport>({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });

  // Fetch whiteboard data with TanStack Query
  const { data: whiteboardData, isLoading } = useQuery({
    queryKey: ['whiteboard', whiteboardId],
    queryFn: async () => {
      // Fetch whiteboard with tables and relationships
      const whiteboard = await getWhiteboardWithDiagram({ data: whiteboardId });
      const relationships = await getWhiteboardRelationships({ data: whiteboardId });

      return {
        whiteboard,
        relationships,
      };
    },
  });

  // WebSocket collaboration - MUST be called before any early returns
  const { emit, on, off, connectionState } = useCollaboration(
    whiteboardId,
    userId
  );

  // Mutations
  const createTableMutation = useMutation({
    mutationFn: async (data: CreateTable) => {
      return await createTableFn({ data });
    },
    onMutate: async (newTable: CreateTable) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['whiteboard', whiteboardId] });

      const previousData = queryClient.getQueryData(['whiteboard', whiteboardId]);

      // Optimistically add table to cache
      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          whiteboard: {
            ...old.whiteboard,
            tables: [
              ...old.whiteboard.tables,
              {
                id: 'temp-' + Date.now(),
                ...newTable,
                columns: [],
                outgoingRelationships: [],
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          },
        };
      });

      return { previousData };
    },
    onSuccess: (createdTable) => {
      // Emit WebSocket event for other users
      emit('table:create', createdTable);

      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] });
    },
    onError: (err, newTable, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['whiteboard', whiteboardId], context.previousData);
      }
      console.error('Failed to create table:', err);
      alert('Failed to create table. Please try again.');
    },
  });

  const updateTablePositionMutation = useMutation({
    mutationFn: async (data: { id: string; positionX: number; positionY: number }) => {
      return await updateTablePositionFn({ data });
    },
    onSuccess: (updatedTable, variables) => {
      // Emit WebSocket event for other users
      emit('table:move', {
        tableId: variables.id,
        positionX: variables.positionX,
        positionY: variables.positionY,
      });

      // Update cache without full refetch
      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          whiteboard: {
            ...old.whiteboard,
            tables: old.whiteboard.tables.map((t: any) =>
              t.id === updatedTable.id
                ? { ...t, positionX: updatedTable.positionX, positionY: updatedTable.positionY }
                : t
            ),
          },
        };
      });
    },
    onError: (err) => {
      console.error('Failed to update table position:', err);
    },
  });

  const createRelationshipMutation = useMutation({
    mutationFn: async (data: CreateRelationship) => {
      return await createRelationshipFn({ data });
    },
    onSuccess: (createdRelationship) => {
      // Emit WebSocket event for other users
      emit('relationship:create', createdRelationship);

      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] });
    },
    onError: (err) => {
      console.error('Failed to create relationship:', err);
      alert('Failed to create relationship. Please try again.');
    },
  });

  // Event handlers
  const handleCreateTable = useCallback(
    (data: CreateTable) => {
      createTableMutation.mutate(data);
    },
    [createTableMutation]
  );

  const handleCreateRelationship = useCallback(
    (data: CreateRelationship) => {
      createRelationshipMutation.mutate(data);
    },
    [createRelationshipMutation]
  );

  const handleTableDragEnd = useCallback(
    (tableId: string, x: number, y: number) => {
      updateTablePositionMutation.mutate({
        id: tableId,
        positionX: x,
        positionY: y,
      });
    },
    [updateTablePositionMutation]
  );

  const handleCanvasViewportChange = useCallback(
    (viewport: CanvasViewport) => {
      setCanvasViewport(viewport);
      // TODO: Debounce and save to server
    },
    []
  );

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    const handleTableCreated = (table: any) => {
      console.log('Table created by another user:', table);
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] });
    };

    const handleTableMoved = (data: { tableId: string; positionX: number; positionY: number }) => {
      console.log('Table moved by another user:', data);
      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          whiteboard: {
            ...old.whiteboard,
            tables: old.whiteboard.tables.map((t: any) =>
              t.id === data.tableId
                ? { ...t, positionX: data.positionX, positionY: data.positionY }
                : t
            ),
          },
        };
      });
    };

    const handleRelationshipCreated = (relationship: any) => {
      console.log('Relationship created by another user:', relationship);
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] });
    };

    on('table:created', handleTableCreated);
    on('table:moved', handleTableMoved);
    on('relationship:created', handleRelationshipCreated);

    return () => {
      off('table:created', handleTableCreated);
      off('table:moved', handleTableMoved);
      off('relationship:created', handleRelationshipCreated);
    };
  }, [on, off, queryClient, whiteboardId]);

  // Early returns AFTER all hooks have been called
  if (isLoading || !whiteboardData) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-muted-foreground">Loading whiteboard...</p>
      </div>
    );
  }

  const { whiteboard, relationships } = whiteboardData;

  if (!whiteboard) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-muted-foreground">Whiteboard not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <h1 className="text-xl font-semibold">{whiteboard.name}</h1>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm ${
              connectionState === 'connected'
                ? 'text-green-600'
                : connectionState === 'connecting'
                  ? 'text-yellow-600'
                  : 'text-red-600'
            }`}
          >
            {connectionState === 'connected'
              ? 'Connected'
              : connectionState === 'connecting'
                ? 'Connecting...'
                : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <Toolbar
        whiteboardId={whiteboardId}
        tables={whiteboard.tables}
        onCreateTable={handleCreateTable}
        onCreateRelationship={handleCreateRelationship}
      />

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        <Canvas
          width={window.innerWidth}
          height={window.innerHeight - 120} // Subtract header and toolbar height
          initialViewport={canvasViewport}
          onViewportChange={handleCanvasViewportChange}
        >
          {/* Render all tables */}
          {whiteboard.tables.map((table) => (
            <TableNode
              key={table.id}
              table={table}
              isSelected={selectedTableId === table.id}
              onClick={setSelectedTableId}
              onDragEnd={handleTableDragEnd}
              theme="light"
            />
          ))}

          {/* Render all relationships */}
          {relationships.map((relationship) => {
            const sourceTable = whiteboard.tables.find(
              (t) => t.id === relationship.sourceTableId
            );
            const targetTable = whiteboard.tables.find(
              (t) => t.id === relationship.targetTableId
            );

            if (!sourceTable || !targetTable) {
              console.warn('Missing table for relationship:', relationship.id);
              return null;
            }

            return (
              <RelationshipEdge
                key={relationship.id}
                relationship={relationship}
                sourceTable={sourceTable}
                targetTable={targetTable}
                isSelected={selectedRelationshipId === relationship.id}
                onClick={setSelectedRelationshipId}
                theme="light"
              />
            );
          })}
        </Canvas>
      </div>
    </div>
  );
}
