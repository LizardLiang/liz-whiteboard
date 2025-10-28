// src/lib/server-functions.ts
// Server functions for whiteboard operations using TanStack Start

import { createServerFn } from '@tanstack/react-start';
import {
  findWhiteboardByIdWithDiagram,
  type WhiteboardWithDiagram,
} from '@/data/whiteboard';
import {
  createDiagramTable,
  updateDiagramTablePosition,
  type CreateTable,
} from '@/data/diagram-table';
import {
  createRelationship,
  findRelationshipsByWhiteboardId,
  type CreateRelationship,
} from '@/data/relationship';
import type { Relationship } from '@prisma/client';

/**
 * Server function to fetch whiteboard with full diagram data
 */
export const getWhiteboardWithDiagram = createServerFn({
  method: 'GET',
})
  .inputValidator((whiteboardId: string) => whiteboardId)
  .handler(async ({ data: whiteboardId }): Promise<WhiteboardWithDiagram | null> => {
    try {
      const whiteboard = await findWhiteboardByIdWithDiagram(whiteboardId);
      return whiteboard;
    } catch (error) {
      console.error('Error fetching whiteboard:', error);
      throw error;
    }
  });

/**
 * Server function to fetch relationships for a whiteboard
 */
export const getWhiteboardRelationships = createServerFn({
  method: 'GET',
})
  .inputValidator((whiteboardId: string) => whiteboardId)
  .handler(async ({ data: whiteboardId }): Promise<Relationship[]> => {
    try {
      const relationships = await findRelationshipsByWhiteboardId(whiteboardId);
      return relationships;
    } catch (error) {
      console.error('Error fetching relationships:', error);
      throw error;
    }
  });

/**
 * Server function to create a new table
 */
export const createTable = createServerFn({
  method: 'POST',
})
  .inputValidator((data: CreateTable) => data)
  .handler(async ({ data }) => {
    try {
      const table = await createDiagramTable(data);
      return table;
    } catch (error) {
      console.error('Error creating table:', error);
      throw error;
    }
  });

/**
 * Server function to update table position
 */
export const updateTablePosition = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { id: string; positionX: number; positionY: number }) => data)
  .handler(async ({ data }) => {
    try {
      const table = await updateDiagramTablePosition(
        data.id,
        data.positionX,
        data.positionY
      );
      return table;
    } catch (error) {
      console.error('Error updating table position:', error);
      throw error;
    }
  });

/**
 * Server function to create a new relationship
 */
export const createRelationshipFn = createServerFn({
  method: 'POST',
})
  .inputValidator((data: CreateRelationship) => data)
  .handler(async ({ data }) => {
    try {
      const relationship = await createRelationship(data);
      return relationship;
    } catch (error) {
      console.error('Error creating relationship:', error);
      throw error;
    }
  });
