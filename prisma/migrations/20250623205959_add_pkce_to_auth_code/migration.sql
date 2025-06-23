-- AlterTable
ALTER TABLE "AuthCode" ADD COLUMN     "codeChallenge" TEXT,
ADD COLUMN     "codeChallengeMethod" TEXT;
