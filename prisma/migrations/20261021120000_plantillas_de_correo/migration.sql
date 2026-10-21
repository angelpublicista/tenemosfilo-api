-- Plantillas de correo editables por el administrador. Sin fila se usa el texto
-- por defecto del codigo, asi que la tabla nace vacia y nada cambia al migrar.

CREATE TABLE "EmailTemplate" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "buttonText" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByEmail" TEXT,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("key")
);
