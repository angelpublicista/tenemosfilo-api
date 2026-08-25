-- Notificaciones dirigidas a una persona.
--
-- Hasta ahora la campana y la bandeja del panel se alimentaban de un stub
-- que devolvia lista vacia: nadie recibia aviso de nada.
CREATE TYPE "NotificationType" AS ENUM (
  'NEW_RESERVATION',
  'RESERVATION_CONFIRMED',
  'RESERVATION_CANCELLED',
  'RESERVATION_RESCHEDULED',
  'PAYMENT_RECEIVED',
  'REVIEW_RECEIVED',
  'SYSTEM'
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- Al borrar la cuenta se van sus avisos: no le sirven a nadie mas.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
