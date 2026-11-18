-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "entry_type" AS ENUM ('ip', 'email', 'domain');

-- CreateTable
CREATE TABLE "entries" (
    "type" "entry_type" NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("type","value")
);

