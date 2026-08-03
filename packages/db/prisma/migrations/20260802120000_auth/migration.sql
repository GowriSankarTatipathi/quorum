-- Phase 2: workspace, identity, session and authentication audit models.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ApprovalAuthority" AS ENUM ('INHERIT', 'GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AuthEventType" AS ENUM ('SIGN_IN', 'SIGN_OUT', 'SIGN_OUT_ALL', 'TOKEN_REFRESHED', 'TOKEN_REUSE_DETECTED', 'SESSION_REVOKED', 'ROLE_CHANGED', 'APPROVAL_AUTHORITY_CHANGED', 'ACCESS_DENIED', 'ACCOUNT_DISABLED');

-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxRunBudgetUsd" DECIMAL(10,4) NOT NULL DEFAULT 2.00,
    "requireApprovalAbove" INTEGER NOT NULL DEFAULT 3,
    "maxApprovalTrustLevel" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "approvalAuthority" "ApprovalAuthority" NOT NULL DEFAULT 'INHERIT',
    "maxApprovalTrustLevel" INTEGER,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL,
    "type" "AuthEventType" NOT NULL,
    "userId" TEXT,
    "orgId" TEXT,
    "actorUserId" TEXT,
    "provider" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Org_slug_key" ON "Org"("slug");
CREATE INDEX "Org_slug_idx" ON "Org"("slug");

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_orgId_idx" ON "User"("orgId");
CREATE INDEX "User_email_idx" ON "User"("email");

CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE UNIQUE INDEX "RefreshToken_replacedById_key" ON "RefreshToken"("replacedById");
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

CREATE INDEX "AuthEvent_userId_createdAt_idx" ON "AuthEvent"("userId", "createdAt" DESC);
CREATE INDEX "AuthEvent_orgId_createdAt_idx" ON "AuthEvent"("orgId", "createdAt" DESC);
CREATE INDEX "AuthEvent_type_idx" ON "AuthEvent"("type");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;
