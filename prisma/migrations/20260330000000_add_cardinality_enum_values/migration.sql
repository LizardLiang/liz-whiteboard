-- Migration: add_cardinality_enum_values
-- Adds ZERO_TO_ONE, ZERO_TO_MANY, and SELF_REFERENCING to the Cardinality enum.
--
-- NOTE: This migration was created manually because the project uses Prisma Accelerate
-- (prisma+postgres:// connection URL) which does not support `prisma migrate dev`.
-- The schema changes were applied to the database using `prisma db push`.
-- This file documents the equivalent DDL for audit and migration history purposes.

ALTER TYPE "Cardinality" ADD VALUE 'ZERO_TO_ONE';
ALTER TYPE "Cardinality" ADD VALUE 'ZERO_TO_MANY';
ALTER TYPE "Cardinality" ADD VALUE 'SELF_REFERENCING';
