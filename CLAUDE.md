# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

El resto de este archivo esta en espanol, igual que los comentarios, los docs y los commits del repo.

## Comandos

Se requiere **pnpm**: hay un parche (`patches/wouter@3.7.1.patch`) y un `overrides` de `nanoid`
declarados en `package.json`; con npm o yarn el parche no se aplica.

| Comando        | Que hace                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`     | `tsx watch server/_core/dev.ts` — Express con Vite en middleware, puerto 3000 (escanea hasta 3019 si esta ocupado) |
| `pnpm build`   | `vite build` → `dist/public` + esbuild del server → `dist`                                                         |
| `pnpm start`   | Produccion: `node dist/index.js`                                                                                   |
| `pnpm check`   | `tsc --noEmit`                                                                                                     |
| `pnpm test`    | `vitest run`                                                                                                       |
| `pnpm format`  | `prettier --write .`                                                                                               |
| `pnpm db:push` | `drizzle-kit generate` + `drizzle-kit migrate`                                                                     |

Test individual:

```bash
pnpm vitest run server/auth.test.ts              # un archivo
pnpm vitest run server/auth.test.ts -t "signIn"  # un caso o describe
```

Cosas que no se deducen del `package.json`:

- **No hay linter** (ni ESLint ni Biome) y **no hay CI** — `.github/` no existe. La puerta de calidad
  es manual: `pnpm check && pnpm test && pnpm build`.
- `vitest.config.ts:17` incluye **solo** `server/**/*.test.ts`. El codigo de `client/` no tiene
  ninguna ruta de cobertura; por eso `server/statusFormatters.test.ts` cruza la frontera para probar
  un modulo de cliente.
- `tsconfig.json` excluye `**/*.test.ts`, asi que `pnpm check` no tipa los tests.
- El server no arranca sin `JWT_SECRET` de >=32 chars: `assertAuthEnvReady()` es lo primero que corre
  en `createApp()` (`server/_core/app.ts`), y `server/auth.ts:77` mantiene en lista negra el placeholder publicado
  `super_secret_local_jwt_key_123456`. Generar con `openssl rand -hex 32`.
- `server/seed.ts` exporta `seedDemoData()` pero **nadie la llama** y no existe script `db:seed`.
- **Dos entradas del servidor.** `server/_core/dev.ts` (`pnpm dev`: Vite en middleware + escaneo de
  puertos) e `index.ts` (`pnpm build`/`start`: solo `serveStatic`). Comparten `createApp()` en `app.ts`.
  `index.ts` no puede importar `./vite`: lo garantiza el grafo de modulos y lo vigila
  `server/deploy.contract.test.ts`. Antes una sola entrada arrastraba vite y sus plugins
  (devDependencies) al bundle de produccion.
- `render.yaml` despliega en Render Free contra TiDB Cloud. El health check es `GET /healthz` (en
  `app.ts`, a proposito sin tocar la base). Ver los comentarios del propio archivo.

## Arquitectura

**No es Next.js. No hay Supabase, ni RLS, ni server actions.** Es una SPA de Vite + React 19 (router
`wouter`) contra un monolito Express 4 que expone **un unico router tRPC v11** en `/api/trpc`, con
Drizzle ORM sobre **MySQL / TiDB**.

```
client/src/pages/*.tsx
  → trpc.<ns>.<proc>              (client/src/lib/trpc.ts; httpBatchLink + superjson en main.tsx)
  → server/routers.ts             ← TODO el arbol de procedures, un solo archivo
  → server/{orgDomain,hrDomain,aiDomain}.ts
  → server/db.ts (drizzle)        → MySQL
```

| Ruta                             | Responsabilidad                                                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/routers.ts`              | Router unico + validacion zod **inline**. No hay carpeta `schemas/`.                                                                                                                                                                                                                  |
| `server/authorization.ts`        | Matrices RBAC (`ROLE_PERMISSIONS`, `INVITABLE_ROLES`) y los asserts.                                                                                                                                                                                                                  |
| `server/db.ts`                   | Singleton de drizzle + helpers de consulta.                                                                                                                                                                                                                                           |
| `drizzle/schema.ts`              | **Fuente de verdad** del esquema _y_ de los tipos, incluido `RoleKey`. No hay `database.types.ts` que regenerar: editar este archivo actualiza ambos lados.                                                                                                                           |
| `shared/extensions.ts`           | Puertos (`AIProvider`, `LlmProvider`, `TenantContext`). No hay puerto de almacenamiento: `server/storage.ts` habla S3 directamente y el proveedor se elige con variables de entorno.                                                                                                                                                                                                        |
| `client/src/components/ui/`      | shadcn/ui — no editar a mano.                                                                                                                                                                                                                                                         |
| `server/_core/`, `shared/_core/` | Andamiaje vendido de la plantilla Manus. `heartbeat.ts`, `map.ts`, `imageGeneration.ts`, `voiceTranscription.ts` no se usan. **No tomarlo como convencion del proyecto.** Excepcion: `app.ts`, `dev.ts`, `index.ts` y `static.ts` son el arranque propio del proyecto (ver Comandos). |

Aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*`. **No existe alias para `server/` ni
`drizzle/`**, de ahi los imports relativos largos desde el cliente.

## Multi-tenancy y autorizacion

Es la parte mas facil de romper. El aislamiento entre empresas **vive enteramente en codigo de
aplicacion**: no hay RLS ni foreign keys en la base. Toda procedure de negocio empieza con el mismo
preambulo, copiado a mano:

```ts
const access = await resolveAccess(ctx.user); // server/routers.ts:19
assertRole(access, ["COMPANY_ADMIN", "HR"]); // server/authorization.ts:42
assertCompanyScope(access, input.companyId); // server/authorization.ts:48
```

`resolveAccess` aparece 49 veces y `assertCompanyScope` 47 en `server/routers.ts`. **No existe un
`companyProcedure` que lo haga por ti**, y nada falla si lo omites: queda un agujero silencioso entre
tenants. Ademas, la funcion de dominio debe recibir `companyId` como primer parametro y meterlo en el
`WHERE` (defensa en profundidad).

Las dos unicas procedures que saltan `assertCompanyScope` a proposito: `ai.models` (no toca datos de
tenant) y `company.setActive` (cambiar de empresa es por definicion salir del scope; la pertenencia
se valida dentro de `switchActiveCompany`).

**Dos sistemas de roles ortogonales.** Confundirlos ya causo un bug real, documentado en un comentario
de `client/src/components/DashboardLayout.tsx`:

- `users.role: 'user' | 'admin'` — de la plantilla. Solo gobierna `adminProcedure` en `_core`, y es el
  fallback que convierte a alguien en `SUPER_ADMIN` cuando no tiene perfil.
- `app_profiles.role: SUPER_ADMIN | COMPANY_ADMIN | HR | FINANCE | MANAGER | EMPLOYEE` — el rol real,
  **por empresa**. Es el que usa toda la autorizacion de negocio.

Otros detalles:

- Sesion JWT (jose, HS256) en cookie httpOnly `app_session_id`; revocacion comparando
  `users.sessionVersion` en cada peticion.
- Rate limit en memoria compartido a proposito entre `signIn` y `acceptInvite`, via
  `passwordAttemptKey(ip, email)`.
- Techo de rol al invitar: `INVITABLE_ROLES`. `SUPER_ADMIN` no lo concede nadie (solo por base de
  datos); `HR` solo puede crear `MANAGER` / `EMPLOYEE`.
- La suspension funciona porque `getAppProfile` (`server/db.ts:128`) filtra `status = 'active'`. Ese
  filtro **es** el mecanismo de revocacion (commit `f6de484`).
- Los guards del cliente (`ProtectedRoute`, `DashboardLayout`) son cosmeticos. No hay `middleware.ts`.
- Nunca hardcodear `companyId`. La empresa activa se obtiene de `access.me` /
  `client/src/hooks/useCompanyId.ts`; las queries deben usar `enabled: ready` porque zod exige entero
  positivo y `0` seria error de validacion.

## Convenciones no evidentes

- **Todo en espanol**: comentarios, mensajes de error, copy y rutas (`/invitacion/:token`,
  `/company/usuarios`). Identificadores mezclados, sin acentos en codigo y con acentos en la UI.
  **No hay libreria de i18n**; los strings estan hardcodeados.
- **Los comentarios son la documentacion de diseno.** Casi toda funcion no trivial lleva un bloque en
  espanol que explica el bug que previene ("Antes..., ahora..."). Codifican invariantes que los tests
  no cubren: leerlos antes de tocar.
- `ensureSchema()` (`server/db.ts:17`) aplica `ALTER TABLE` idempotentes en la primera conexion, cada
  uno en un `try/catch` que se traga el error; `drizzle/0007_premium_zuras.sql` documenta que el DDL
  equivalente se borro a mano de la migracion. **Consecuencia: `drizzle/*.sql` por si solo no
  reproduce una base funcional.**
- `getDb()` devuelve `undefined` / `[]` sin base, `requireDb()` (`server/db.ts:91`) lanza. Elegir
  segun el caso: una lectura vacia silenciosa es aceptable en un listado y catastrofica en un alta.
  Sin base, los usuarios salen _no autenticados_ en vez de con error (`server/_core/context.ts`).
- `server/phase4.ui-contract.test.ts` hace assertions sobre el **texto fuente del JSX** con
  `readFileSync`. Renombrar un boton en `HiringDetailPage.tsx` rompe tests por motivos que parecen no
  relacionados.
- El cliente importa `server/authorization.ts` **en runtime**, no solo tipos. Anadirle cualquier
  import de Node rompe el build del cliente.
- Manejo de errores con dos escaleras: los modulos de auth lanzan `AuthError` con codigo cerrado y
  `toTrpc()` (`server/routers.ts:51`) los traduce, tragandose todo lo demas en un
  `INTERNAL_SERVER_ERROR` generico (tRPC envia `message` al cliente incluso en produccion, y estas
  procedures son publicas). `hrDomain` / `aiDomain` lanzan `Error` en espanol que llega literal.
- Sin proveedor de email: invitaciones y links de candidato son copiar-pegar (`CopyableLink`), los
  correos son borradores `mailto:` (`server/emailService.ts`), y el OTP devuelve
  `status: "not_configured"`.
- Las procedures de IA llevan `mode: "demo" | "real"`. Los providers viven detras de los puertos de
  `shared/extensions.ts`: **nunca importar un SDK de IA dentro de un modulo de dominio**.
- Descargas solo por `hiring.documentUrl` + URL firmada (300 s), tras `assertRole` +
  `assertCompanyScope`. El proxy publico `/manus-storage/{key}` se elimino por filtrar documentos
  personales (`e79bb3a`): no reintroducirlo. Ademas de no validar permisos, servia los documentos
  desde el dominio de la aplicacion; las URLs firmadas viven en el host del proveedor, y esa
  separacion de origen es lo que impide que un PDF malicioso alcance la cookie de sesion.
- `server/storage.ts` es todo el almacenamiento: S3 generico sobre `@aws-sdk/client-s3`, valido para
  R2, B2, S3 o MinIO segun las `STORAGE_S3_*`. Carga el SDK con `await import()` porque importar el
  modulo no debe tener efectos ni pagar ~2.5 s de arranque, y envuelve todo error del proveedor: el
  `message` del SDK lleva bucket y endpoint, y `toTrpc()` lo entregaria a una procedure publica.
- `docs/ARCHITECTURE.md` es de la Fase 1 y **sigue desactualizado en autenticacion**: describe el
  login como Manus OAuth, retirado en `69d9888`. Su guia de multi-tenancy si es fiable; la
  recomendacion de fijar `companyId = 4` que tenia ya se corrigio.

## Variables de entorno

Declaradas en `.env.example` y centralizadas en `server/_core/env.ts`: `NODE_ENV`, `PORT`,
`DATABASE_URL` (MySQL/TiDB; local `mysql://root:root@localhost:3306/people_ai`), `JWT_SECRET`,
`BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` (catalogo LLM de `_core/llm.ts`, solo el modo IA
"real" -- pese al nombre no tienen nada que ver con el almacenamiento), `REMINDER_COOLDOWN_HOURS`, y
las `STORAGE_S3_*` (`ENDPOINT`, `REGION`, `BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`,
`FORCE_PATH_STYLE`) del almacenamiento de documentos. Sin estas ultimas el servidor arranca igual y
solo cae el portal del candidato; `logStorageEnvStatus()` lo anuncia en el log de arranque, y
`server/deploy.contract.test.ts` verifica que toda variable leida en `server/` este declarada en
`render.yaml` -- el hueco por el que el almacenamiento llego roto a produccion.

Hay deriva: el `.env` local usa ademas `VITE_APP_ID` y `OWNER_OPEN_ID`, que no estan en
`.env.example`. Rotar `JWT_SECRET` cierra la sesion de todo el mundo.
