-- Phase 3: the run-time domain — runs, steps, claims with provenance, verification,
-- human-control records, the append-only event log, cost accounting and artifacts.

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('CREATED', 'PLANNING', 'AWAITING_APPROVAL', 'EXECUTING', 'VERIFYING', 'CRITIQUE', 'RECOVERING', 'PAUSED', 'TAKEOVER', 'FORMATTING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "AutonomyMode" AS ENUM ('CAREFUL', 'BALANCED', 'AUTONOMOUS');
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'RUNNING', 'BLOCKED', 'DONE', 'FAILED', 'SKIPPED');
CREATE TYPE "ClaimStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'CONTRADICTED', 'UNSUPPORTED', 'AMBIGUOUS', 'SUPERSEDED', 'HUMAN_CORRECTED');
CREATE TYPE "CritiqueKind" AS ENUM ('UNIT_MISMATCH', 'OUTLIER', 'DUPLICATE', 'COVERAGE_GAP', 'STALENESS', 'CONTRADICTION', 'SUSPICIOUS_UNIFORMITY');
CREATE TYPE "Severity" AS ENUM ('BLOCKING', 'WARNING', 'NOTE');
CREATE TYPE "CritiqueResolution" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED', 'REMEDIED');
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'TIMEOUT');
CREATE TYPE "ApprovalScope" AS ENUM ('SINGLE', 'SIMILAR_IN_RUN');
CREATE TYPE "ArtifactKind" AS ENUM ('SCREENSHOT', 'DOM_SNAPSHOT', 'EXPORT_XLSX', 'EXPORT_CSV', 'EXPORT_JSON', 'EXPORT_PDF', 'RECORDING');

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goalTemplate" TEXT NOT NULL,
    "planTemplate" JSONB NOT NULL,
    "corrections" JSONB,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "successRate" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "recipeId" TEXT,
    "goal" TEXT NOT NULL,
    "mode" "AutonomyMode" NOT NULL DEFAULT 'BALANCED',
    "status" "RunStatus" NOT NULL DEFAULT 'CREATED',
    "machineState" JSONB,
    "blackboard" JSONB,
    "planHash" TEXT,
    "budgetUsd" DECIMAL(10,4) NOT NULL DEFAULT 0.50,
    "spentUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "browserSessionId" TEXT,
    "liveViewUrl" TEXT,
    "errorCode" TEXT,
    "errorDetail" JSONB,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Step" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "objective" TEXT NOT NULL,
    "targetUrl" TEXT,
    "agentPath" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outputSchema" JSONB,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "notes" TEXT,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "estimatedMs" INTEGER,
    "actualMs" INTEGER,
    "estimatedUsd" DECIMAL(10,4),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "unit" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceSelector" TEXT,
    "sourceText" TEXT,
    "screenshotKey" TEXT,
    "domSnapshotKey" TEXT,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractedBy" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "ambiguity" TEXT,
    "nullReason" TEXT,
    "supersedesId" TEXT,
    "correctedBy" TEXT,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verdict" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "verdict" "ClaimStatus" NOT NULL,
    "independentReading" JSONB,
    "rationale" TEXT,
    "confidence" DECIMAL(4,3) NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Critique" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "CritiqueKind" NOT NULL,
    "severity" "Severity" NOT NULL,
    "message" TEXT NOT NULL,
    "claimIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "remedy" JSONB NOT NULL,
    "resolution" "CritiqueResolution" NOT NULL DEFAULT 'OPEN',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Critique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "userId" TEXT,
    "trustLevel" INTEGER NOT NULL,
    "action" JSONB NOT NULL,
    "payload" JSONB,
    "editedPayload" JSONB,
    "screenshotKey" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "scope" "ApprovalScope" NOT NULL DEFAULT 'SINGLE',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryAttempt" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "errorCode" TEXT NOT NULL,
    "errorClass" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "rationale" TEXT,
    "expectedOutcome" TEXT,
    "succeeded" BOOLEAN,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UndoFrame" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "scrollY" INTEGER NOT NULL DEFAULT 0,
    "domSnapshotKey" TEXT NOT NULL,
    "screenshotKey" TEXT NOT NULL,
    "cookiesKey" TEXT,
    "reversible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UndoFrame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "agent" TEXT,
    "stepId" TEXT,
    "payload" JSONB NOT NULL,
    "causationId" TEXT,
    "correlationId" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT,
    "agent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "schemaViolation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "r2Key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_orgId_name_key" ON "Recipe"("orgId", "name");
CREATE INDEX "Recipe_orgId_idx" ON "Recipe"("orgId");

CREATE INDEX "Run_userId_createdAt_idx" ON "Run"("userId", "createdAt" DESC);
CREATE INDEX "Run_orgId_createdAt_idx" ON "Run"("orgId", "createdAt" DESC);
CREATE INDEX "Run_status_idx" ON "Run"("status");

CREATE UNIQUE INDEX "Step_runId_index_key" ON "Step"("runId", "index");
CREATE INDEX "Step_runId_status_idx" ON "Step"("runId", "status");

CREATE UNIQUE INDEX "Claim_supersedesId_key" ON "Claim"("supersedesId");
CREATE INDEX "Claim_stepId_idx" ON "Claim"("stepId");
CREATE INDEX "Claim_entity_field_idx" ON "Claim"("entity", "field");
CREATE INDEX "Claim_status_idx" ON "Claim"("status");

CREATE INDEX "Verdict_claimId_idx" ON "Verdict"("claimId");

CREATE INDEX "Critique_runId_severity_idx" ON "Critique"("runId", "severity");
CREATE INDEX "Critique_runId_resolution_idx" ON "Critique"("runId", "resolution");

CREATE INDEX "Approval_stepId_status_idx" ON "Approval"("stepId", "status");
CREATE INDEX "Approval_userId_idx" ON "Approval"("userId");

CREATE INDEX "RecoveryAttempt_stepId_idx" ON "RecoveryAttempt"("stepId");
CREATE INDEX "RecoveryAttempt_errorClass_idx" ON "RecoveryAttempt"("errorClass");

CREATE UNIQUE INDEX "UndoFrame_stepId_seq_key" ON "UndoFrame"("stepId", "seq");
CREATE INDEX "UndoFrame_stepId_idx" ON "UndoFrame"("stepId");

CREATE UNIQUE INDEX "Event_runId_seq_key" ON "Event"("runId", "seq");
CREATE INDEX "Event_runId_seq_idx" ON "Event"("runId", "seq");
CREATE INDEX "Event_runId_type_idx" ON "Event"("runId", "type");

CREATE INDEX "LlmCall_runId_idx" ON "LlmCall"("runId");
CREATE INDEX "LlmCall_agent_model_promptVersion_idx" ON "LlmCall"("agent", "model", "promptVersion");
CREATE INDEX "LlmCall_createdAt_idx" ON "LlmCall"("createdAt");

CREATE INDEX "Artifact_runId_kind_idx" ON "Artifact"("runId", "kind");

CREATE UNIQUE INDEX "ShareLink_tokenHash_key" ON "ShareLink"("tokenHash");
CREATE INDEX "ShareLink_runId_idx" ON "ShareLink"("runId");
CREATE INDEX "ShareLink_expiresAt_idx" ON "ShareLink"("expiresAt");

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Step" ADD CONSTRAINT "Step_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Verdict" ADD CONSTRAINT "Verdict_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Critique" ADD CONSTRAINT "Critique_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecoveryAttempt" ADD CONSTRAINT "RecoveryAttempt_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UndoFrame" ADD CONSTRAINT "UndoFrame_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The audit trail must be append-only at the database level, not only by convention.
-- Application code holds INSERT and SELECT here; UPDATE and DELETE are withheld so a
-- future bug or a compromised credential cannot quietly rewrite history.
-- Applied by the operator once the runtime role exists:
--   REVOKE UPDATE, DELETE ON "Event", "Approval", "AuthEvent", "Verdict" FROM quorum_app;
