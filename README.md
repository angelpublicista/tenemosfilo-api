# tenemosfilo-api

API REST para **tenemosfilo-front**. Reemplaza Sanity CMS como backend de datos.

## Stack

- **Node 20** + **TypeScript**
- **Express 4** (REST)
- **Prisma** + **Postgres (RDS)**
- **Zod** para validacion
- **NextAuth (en el front)** firma JWTs; el API los verifica con `jose`
- **bcrypt** para passwords
- **pino** para logging

## Estructura

```
src/
  server.ts          Bootstrap (escucha el puerto)
  app.ts             Configuracion Express + middlewares globales + rutas
  config/
    env.ts           Validacion de env vars con zod
    prisma.ts        Singleton del cliente Prisma
  middleware/
    auth.ts          Verifica el JWT de NextAuth
    error.ts         Error handler global
    validate.ts      Helper para validar req con zod
  lib/
    password.ts      Helpers bcrypt
  modules/
    auth/            login, register, oauth/google (consumido por NextAuth)
    users/           CRUD users (modulo de referencia)
    companies/       (esqueleto)
    crm-companies/   (esqueleto)
    contacts/        (esqueleto)
    opportunities/   (esqueleto)
    experiences/     (esqueleto)
    reservations/    (esqueleto)
    quotes/          (esqueleto)
    availabilities/  (esqueleto)
    locations/       (esqueleto)
    integrations/    (esqueleto)
    dashboard/       (esqueleto)
prisma/
  schema.prisma      Modelos + enums + tablas NextAuth
```

Cada modulo sigue el patron `routes.ts -> controller.ts -> service.ts -> schemas.ts`.

## Setup local

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar y completar variables de entorno
cp .env.example .env
# Editar .env con tu DATABASE_URL de RDS y NEXTAUTH_SECRET

# 3. Generar cliente Prisma
npm run prisma:generate

# 4. Crear las tablas en la base de datos
npm run prisma:migrate -- --name init

# 5. Levantar el servidor de desarrollo
npm run dev
```

El API queda en `http://localhost:4000`.

## Auth: como funciona con NextAuth

NextAuth vive en el front (`tenemosfilo-front/src/auth.ts`) y delega al API:

| NextAuth Provider | Llama al API                      | Que hace el API                                |
| ----------------- | --------------------------------- | ---------------------------------------------- |
| Credentials       | `POST /auth/login`                | Verifica email + password con bcrypt           |
| Google            | `POST /auth/oauth/google`         | Verifica id_token con Google, upsert User      |
| (registro)        | `POST /auth/register`             | Crea User con password bcrypt                  |

Una vez autenticado, NextAuth firma una sesion JWT con `NEXTAUTH_SECRET` y la guarda en cookie httpOnly. El front incluye ese token como `Authorization: Bearer <jwt>` al llamar al API. El middleware `auth.ts` del API verifica el JWT con el mismo `NEXTAUTH_SECRET` y popula `req.user`.

**Importante:** El `NEXTAUTH_SECRET` debe ser identico en el front y en el API.

## Convencion de respuestas

```jsonc
// Exito
{ "data": { ... } }

// Lista paginada
{ "data": [ ... ], "meta": { "total": 42, "page": 1, "pageSize": 20 } }

// Error
{ "error": { "code": "NOT_FOUND", "message": "..." } }
```

## Convencion de soft-delete

Casi todas las entidades tienen `deletedAt: DateTime?`. Los `findMany` filtran `deletedAt: null` por defecto. El borrado real solo lo hace un job de limpieza o admin.

## Estado actual del scaffolding

- [x] Bootstrap Express + middlewares globales
- [x] Schema Prisma completo (11 modelos + NextAuth)
- [x] Modulo `auth` (login, register, oauth/google)
- [x] Modulo `users` (CRUD completo, sirve como referencia)
- [ ] Modulos `companies`, `crm-companies`, `contacts`, `opportunities`, `experiences`, `reservations`, `quotes`, `availabilities`, `locations`, `integrations`, `dashboard` -> solo esqueleto, falta implementar

Los modulos en esqueleto exponen sus rutas pero devuelven `501 Not Implemented`. Se implementan iterativamente reemplazando los servicios homologos del front (`src/lib/sanity/*Service.ts`).
