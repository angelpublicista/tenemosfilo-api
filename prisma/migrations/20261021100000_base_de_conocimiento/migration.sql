-- Base de conocimiento: articulos de ayuda escritos por el administrador.
-- Nacen como borrador (isPublished = false); audience vacio = visibles para todos.

CREATE TABLE "HelpArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "audience" "UserRole"[],
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpArticle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HelpArticle_slug_key" ON "HelpArticle"("slug");

CREATE INDEX "HelpArticle_category_position_idx" ON "HelpArticle"("category", "position");
