-- El administrador puede apagar una plantilla de correo. Sin fila, se envía:
-- al desplegar nada cambia hasta que apague alguna.

CREATE TABLE "EmailTemplateSetting" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByEmail" TEXT,

    CONSTRAINT "EmailTemplateSetting_pkey" PRIMARY KEY ("key")
);
