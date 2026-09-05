// Fabrica de la aplicacion Express: todo lo que comparten desarrollo y produccion.
//
// Antes el arranque vivia entero en `index.ts`, mezclado con el servidor de Vite y
// con el escaneo de puertos de desarrollo, y el bundle de produccion terminaba
// dependiendo de devDependencies. Ahora `index.ts` (produccion) y `dev.ts`
// (desarrollo) llaman a `createApp()` y cada uno monta lo suyo despues. Lo que
// NO va aqui, a proposito: escuchar en un puerto, servir estaticos y Vite. Todo
// eso es del entorno, no de la aplicacion.
//
// El orden de registro es contrato: `trust proxy` y `/healthz` primero, luego los
// body parsers, luego tRPC. Quien llame a `createApp()` debe montar el comodin
// del SPA (`serveStatic` o `setupVite`) EN ULTIMO LUGAR, porque ambos cierran con
// `app.use("*")` y nada registrado despues es alcanzable.
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { assertAuthEnvReady } from "../auth";
import { logStorageEnvStatus } from "../storage";
import { appRouter } from "../routers";
import { createContext } from "./context";

export function createApp() {
  // Antes que nada: sin un JWT_SECRET valido las sesiones se firmarian con cadena
  // vacia y cualquiera podria forjar una para cualquier usuario.
  assertAuthEnvReady();

  // Deja constancia del estado del almacenamiento. A proposito NO aborta: sin el, el
  // portal del candidato deja de funcionar, pero login, empresas y usuarios siguen
  // sirviendo, y abortar tumbaria ademas el health check y dejaria a la plataforma
  // reintentando el arranque en bucle. Existe porque el fallo anterior era mudo: las
  // credenciales no estaban declaradas en render.yaml y nadie se entero hasta que un
  // candidato intento subir un archivo.
  logStorageEnvStatus();

  const app = express();
  const server = createServer(app);

  // Detras del balanceador de la plataforma la IP del socket es siempre la del
  // proxy. Sin esto `req.ip` era identica para todos y el limitador de intentos
  // de contrasena (server/auth.ts, clave IP+correo) dejaba de distinguir
  // origenes. `1` y no `true`: con `true` se confia en toda la cadena
  // X-Forwarded-For y un cliente podria falsificarla para reiniciar su cubo; con
  // `1` se toma solo el ultimo salto, el que anade el propio proxy. En local no
  // hay proxy y no cambia nada.
  app.set("trust proxy", 1);

  // Sonda de vida para el health check de la plataforma. A proposito NO consulta
  // la base de datos: si lo hiciera, un hipo de TiDB haria que la plataforma
  // reiniciara el servicio en bucle en vez de servir la pantalla de login con un
  // error puntual. Va antes del comodin del SPA, que devolveria index.html.
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Limite del body. La unica ruta que recibe archivos es `hiring.portal.upload`,
  // que manda el documento en base64 dentro del JSON: MAX_FILE_BYTES (10 MB) por
  // 4/3 son ~13.4 MB mas el envoltorio. 20 MB lo cubre con margen y cualquier
  // archivo que el dominio aceptaria sigue llegando a su validacion (y a su
  // mensaje de error). Antes era 50 MB: cualquier peticion sin sesion podia
  // obligar a Express a bufferizar 50 MB, y ocho a la vez agotaban los 512 MB
  // del contenedor.
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ limit: "20mb", extended: true }));

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  return { app, server };
}
