export const ENV = {
  /** Secreto HMAC de las sesiones. Obligatorio: `assertAuthEnvReady()` aborta el
   *  arranque si falta o es corto, porque firmar con "" permitiria forjar sesiones. */
  cookieSecret: process.env.JWT_SECRET ?? "",
  /** Catalogo LLM incorporado de la plantilla Manus (`server/_core/llm.ts`), que usa
   *  el modo "real" de `aiDomain`. NO es el almacenamiento: los documentos viven en
   *  las `STORAGE_S3_*` de abajo. Antes este comentario decia "Forge / S3" y por eso
   *  parecia que borrar estas dos variables era parte de migrar el almacenamiento. */
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  /** Almacenamiento S3-compatible de los documentos del portal del candidato. El
   *  proveedor (Cloudflare R2, Backblaze B2, AWS S3, MinIO) es cuestion de estas
   *  variables, no de codigo: `server/storage.ts` habla S3 y nada mas.
   *
   *  Prefijo `STORAGE_S3_` a proposito y no `AWS_*`: el SDK recoge las `AWS_*` del
   *  entorno por su cuenta, y una credencial ambiental podria secuestrar en silencio
   *  el bucket configurado aqui.
   *
   *  Endpoint vacio = AWS S3 real (el SDK lo resuelve por region). Region "auto" es
   *  lo que exige R2. Ninguna se valida al arrancar: sin ellas solo cae el portal de
   *  candidatos, asi que el fallo es perezoso y `logStorageEnvStatus()` lo anuncia en
   *  el log de arranque. */
  storageEndpoint: process.env.STORAGE_S3_ENDPOINT ?? "",
  storageRegion: process.env.STORAGE_S3_REGION || "auto",
  storageBucket: process.env.STORAGE_S3_BUCKET ?? "",
  storageAccessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID ?? "",
  storageSecretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY ?? "",
  storageForcePathStyle: (process.env.STORAGE_S3_FORCE_PATH_STYLE ?? "") === "true",
};
