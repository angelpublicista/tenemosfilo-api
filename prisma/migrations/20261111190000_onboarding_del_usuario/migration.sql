-- Estado del recorrido de primeros pasos de cada usuario. Nulo hasta que lo use.

ALTER TABLE "User" ADD COLUMN "onboarding" JSONB;
