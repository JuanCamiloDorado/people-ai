// Almacenamiento de documentos sobre cualquier proveedor con API S3 (Cloudflare R2,
// Backblaze B2, AWS S3, MinIO). El proveedor concreto es cuestion de las variables
// STORAGE_S3_* (ver server/_core/env.ts), no de codigo: aqui no hay ninguna rama por
// proveedor. Antes este modulo hablaba con la API "Forge" de Manus, que ademas exigia
// un round-trip HTTP por cada URL firmada; con el SDK, firmar es un HMAC local.
//
// Cuatro invariantes que sostienen este archivo. Romper cualquiera reabre un bug real:
//
// 1. IMPORTAR ESTE MODULO NO DEBE TENER EFECTOS NI CARGAR EL SDK. `hrDomain.ts` lo
//    importa de forma estatica y `hrDomain.test.ts` importa `hrDomain`, asi que un
//    `new S3Client(...)` a nivel de modulo romperia el arranque y los tests cuando no
//    hay credenciales. Ademas el SDK cuesta ~2.5 s y ~25 MB de RSS al cargarse, caro
//    en los arranques en frio de Render Free para algo que solo hace falta al subir o
//    descargar. De ahi el `await import()` perezoso de `getSdk()`.
//
// 2. EL MENSAJE DEL SDK NO PUEDE SALIR DEL SERVIDOR. `toTrpc()` (routers.ts) solo
//    traduce `AuthError`; el resto viaja al cliente con su `message` intacto, y el
//    portal del candidato lo muestra en un toast. Un `AccessDenied` o un
//    `NoSuchBucket` llevan dentro el bucket y el endpoint, y `candidatePortal.upload`
//    es una procedure publica. Por eso todo pasa por `fallo()`.
//
// 3. LAS DESCARGAS SON SIEMPRE URL FIRMADA Y CORTA, tras validar rol y empresa (ver
//    `hiring.documentUrl` en routers.ts). Existio ademas una ruta publica
//    `/manus-storage/{key}` que prefirmaba cualquier clave sin sesion: se elimino
//    porque exponia documentos personales. No reintroducirla.
//
// 4. LOS DOCUMENTOS NUNCA SE SIRVEN DESDE EL DOMINIO DE LA APLICACION. Las URLs
//    firmadas viven en el host del proveedor, un origen distinto, y por eso un PDF
//    malicioso abierto `inline` no alcanza la cookie de sesion. Esa separacion de
//    origen -- y no solo la falta de validacion de permisos -- es lo que hacia
//    peligroso a `/manus-storage`.

import type { S3Client } from "@aws-sdk/client-s3";
import { ENV } from "./_core/env";

type S3Module = typeof import("@aws-sdk/client-s3");

type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

const MENSAJE_USUARIO =
  "El almacenamiento de documentos no esta disponible en este momento. Intentalo de nuevo o avisa al equipo de Talento Humano.";

/** Vida de las URLs firmadas. Los tres consumidores (portal, ficha del analista y
 *  ZIP) abren la URL de inmediato, asi que cinco minutos sobran; `aiDomain` pide
 *  explicitamente mas porque se la entrega a un LLM que la descarga despues. */
const TTL_FIRMA_SEGUNDOS = 300;

/** Solo estas tres impiden funcionar. `STORAGE_S3_ENDPOINT` vacio significa AWS S3
 *  real, y region y path-style tienen valores por defecto validos. */
const VARIABLES_OBLIGATORIAS = [
  ["STORAGE_S3_BUCKET", () => ENV.storageBucket],
  ["STORAGE_S3_ACCESS_KEY_ID", () => ENV.storageAccessKeyId],
  ["STORAGE_S3_SECRET_ACCESS_KEY", () => ENV.storageSecretAccessKey],
] as const;

function variablesQueFaltan(): string[] {
  return VARIABLES_OBLIGATORIAS.filter(([, leer]) => !leer()).map(
    ([nombre]) => nombre
  );
}

function getStorageConfig(): StorageConfig {
  const faltan = variablesQueFaltan();
  if (faltan.length) {
    // Este texto NUNCA llega al cliente: `fallo()` lo registra y lo sustituye por
    // `MENSAJE_USUARIO`. Un candidato anonimo no tiene por que leer nombres de
    // variables de infraestructura, pero quien mire el log necesita exactamente esto.
    throw new Error(
      `Configuracion de almacenamiento incompleta. Faltan: ${faltan.join(", ")}.`
    );
  }
  return {
    endpoint: ENV.storageEndpoint.replace(/\/+$/, ""),
    region: ENV.storageRegion,
    bucket: ENV.storageBucket,
    accessKeyId: ENV.storageAccessKeyId,
    secretAccessKey: ENV.storageSecretAccessKey,
    forcePathStyle: ENV.storageForcePathStyle,
  };
}

let sdkPromise: Promise<{ client: S3Client; mod: S3Module }> | null = null;

async function getSdk() {
  // Validar ANTES de memoizar: si la configuracion esta incompleta no queremos dejar
  // cacheada una promesa rechazada que sobreviva a arreglar el `.env`.
  getStorageConfig();
  if (!sdkPromise) {
    sdkPromise = (async () => {
      const mod = await import("@aws-sdk/client-s3");
      const cfg = getStorageConfig();
      const client = new mod.S3Client({
        region: cfg.region,
        // Omitido cuando esta vacio para que el SDK resuelva el endpoint de AWS por
        // region; pasar `undefined` explicito rompe esa resolucion.
        ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
        forcePathStyle: cfg.forcePathStyle,
        // Credenciales explicitas a proposito: sin ellas el SDK recorre su cadena por
        // defecto y acaba consultando el metadata de EC2 con timeout, y unas AWS_*
        // ambientales podrian secuestrar el bucket configurado aqui.
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
        // Sin esto no hay limite de tiempo: un proveedor colgado retendria una
        // peticion de Express indefinidamente. `requestTimeout` es inactividad del
        // socket y no plazo total, asi que no corta una subida de 10 MB en curso.
        // La forma abreviada (objeto en vez de `new NodeHttpHandler`) existe desde el
        // SDK v3.521 y evita importar @smithy/node-http-handler, que es transitiva.
        requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
        // `maxAttempts` se queda en su valor por defecto (3, con backoff exponencial).
        //
        // Los checksums del SDK tambien se quedan por defecto. Estan activos desde
        // v3.729 y durante un tiempo rompieron R2, que no implementaba CRC32;
        // Cloudflare lo resolvio en febrero de 2025. Si alguna vez se cambia a un
        // proveedor que no los soporte, el knob es `requestChecksumCalculation:
        // "WHEN_REQUIRED"` -- pero desactivarlos cuesta integridad en transito en un
        // flujo de documentos legales, asi que solo con evidencia de que hace falta.
      });
      return { client, mod };
    })().catch(error => {
      sdkPromise = null;
      throw error;
    });
  }
  return sdkPromise;
}

function fallo(operacion: string, error: unknown): never {
  console.error(`[Almacenamiento] Fallo en ${operacion}:`, error);
  throw new Error(MENSAJE_USUARIO);
}

/** Deja constancia en el log de arranque. A proposito NO aborta: sin almacenamiento
 *  el portal del candidato deja de funcionar, pero login, empresas y usuarios siguen
 *  sirviendo, y abortar tumbaria tambien el health check de la plataforma. La version
 *  anterior de este modulo fallaba en silencio hasta que un candidato intentaba subir
 *  un archivo, con las credenciales sin declarar en render.yaml y sin que nada lo
 *  detectara. */
export function logStorageEnvStatus(): void {
  const faltan = variablesQueFaltan();
  if (faltan.length) {
    console.warn(
      `[Almacenamiento] NO CONFIGURADO: faltan ${faltan.join(", ")}. El portal de candidatos no podra subir ni descargar documentos.`
    );
    return;
  }
  console.log(
    `[Almacenamiento] Listo: bucket=${ENV.storageBucket} endpoint=${ENV.storageEndpoint || "AWS S3"}`
  );
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

/** Nombre que vera el usuario al guardar, fijado como metadato del objeto.
 *
 *  Va en la escritura y no en la firma a proposito: R2 documenta `Content-Disposition`
 *  como metadato HTTP del objeto, pero no los parametros `response-*` de GetObject, y
 *  hay reportes de que `response-content-disposition` no se refleja en la respuesta.
 *  Fijarlo al firmar habria sido un fallo intermitente dependiente del proveedor.
 *
 *  `inline` para que el PDF siga abriendose en el navegador. Solo la forma `filename*`
 *  de RFC 5987, sin fallback ASCII entre comillas: el nombre lo controla el cliente
 *  (`originalName` de una procedure publica) y el percent-encoding elimina CR, LF y
 *  comillas, que es toda la superficie de inyeccion de cabeceras. */
function contentDisposition(downloadName: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
  downloadName?: string
): Promise<{ key: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  try {
    const { client, mod } = await getSdk();
    await client.send(
      new mod.PutObjectCommand({
        Bucket: getStorageConfig().bucket,
        Key: key,
        Body: typeof data === "string" ? data : Buffer.from(data),
        ContentType: contentType,
        ...(downloadName
          ? { ContentDisposition: contentDisposition(downloadName) }
          : {}),
      })
    );
  } catch (error) {
    fallo("storagePut", error);
  }
  // `key` es lo que persisten los llamadores (candidate_documents.fileKey). Para leer
  // el archivo se usa `storageGetSignedUrl(key)` previa validacion de permisos.
  return { key };
}

export async function storageGetSignedUrl(
  relKey: string,
  expiresInSeconds = TTL_FIRMA_SEGUNDOS
): Promise<string> {
  try {
    const { client, mod } = await getSdk();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return await getSignedUrl(
      client,
      new mod.GetObjectCommand({
        Bucket: getStorageConfig().bucket,
        Key: normalizeKey(relKey),
      }),
      // SigV4 no admite mas de 7 dias; ningun llamador se acerca a ese limite, asi
      // que no hace falta validarlo en runtime.
      { expiresIn: expiresInSeconds }
    );
  } catch (error) {
    fallo("storageGetSignedUrl", error);
  }
}

/** Descarga directa, sin firmar nada. La usa el ZIP del expediente: firmar y luego
 *  hacer `fetch` costaba lo mismo en red, pero creaba una URL que podia acabar en un
 *  log y viajaba por un `fetch()` sin ningun timeout. Asi hereda los timeouts y
 *  reintentos del cliente. */
export async function storageGetBytes(relKey: string): Promise<Uint8Array> {
  try {
    const { client, mod } = await getSdk();
    const response = await client.send(
      new mod.GetObjectCommand({
        Bucket: getStorageConfig().bucket,
        Key: normalizeKey(relKey),
      })
    );
    if (!response.Body) throw new Error("Respuesta sin cuerpo");
    return await response.Body.transformToByteArray();
  } catch (error) {
    fallo("storageGetBytes", error);
  }
}

/** Borra objetos del bucket. A diferencia de las otras tres operaciones NO pasa por
 *  `fallo()` ni lanza: devuelve que se borro y que no.
 *
 *  Su unico llamador es `deleteHiring`, y cuando llega aqui la transaccion que borro el
 *  proceso YA esta confirmada. Lanzar le diria al analista "no se elimino" sobre algo
 *  que si se elimino, y le empujaria a reintentar contra un proceso inexistente. La
 *  invariante 2 de la cabecera se cumple aqui con mas fuerza que en el resto del modulo:
 *  no se propaga absolutamente nada al cliente; el error del proveedor y las claves solo
 *  llegan al log.
 *
 *  De ahi tambien que en `deleteHiring` el orden sea commit primero y bucket despues, y
 *  nunca al reves: un objeto huerfano cuesta almacenamiento, pero una fila de
 *  candidate_documents apuntando a un objeto que ya no existe es un expediente roto que
 *  sigue ofreciendo "Descargar" y firma una URL perfectamente valida hacia un 404.
 *
 *  Un `DeleteObjectCommand` por clave y no un `DeleteObjectsCommand` por lote:
 *  `DeleteObjects` exige `Content-MD5` por spec, y desde la v3.729 el SDK manda
 *  `x-amz-checksum-crc32` en su lugar, que varios backends compatibles rechazan
 *  (aws-sdk-js-v3#6920). Aqui el proveedor es una variable de entorno -- ver la nota
 *  sobre la rotura de R2 con CRC32 en `getSdk()` -- y `DeleteObject` no tiene ningun
 *  requisito de checksum, ademas de ser idempotente: 204 sobre una clave que ya no
 *  existe. El tope de 1000 por lote no llega a aplicar con decenas de documentos por
 *  expediente. Si algun dia hay que borrar una empresa entera, el cambio es
 *  `DeleteObjectsCommand` MAS `requestChecksumCalculation: "WHEN_REQUIRED"`. */
export async function storageDelete(
  relKeys: string[]
): Promise<{ eliminados: number; fallidos: string[] }> {
  // Antes de tocar `getSdk()`: es lo que permite eliminar una contratacion sin
  // documentos en un entorno sin STORAGE_S3_*, que es el estado por defecto en local.
  if (!relKeys.length) return { eliminados: 0, fallidos: [] };

  let sdk: Awaited<ReturnType<typeof getSdk>>;
  try {
    sdk = await getSdk();
  } catch (error) {
    // Un solo registro y no N identicos: la causa es la misma para todas las claves.
    console.error(
      `[Almacenamiento] Fallo en storageDelete: cliente no disponible. Quedan sin borrar ${relKeys.length} objeto(s): ${relKeys.join(", ")}`,
      error
    );
    return { eliminados: 0, fallidos: [...relKeys] };
  }

  const bucket = getStorageConfig().bucket;
  const fallidos: string[] = [];
  let eliminados = 0;
  // Secuencial a proposito: son unidades, no miles, y lo dispara una persona a mano.
  for (const relKey of relKeys) {
    const key = normalizeKey(relKey);
    try {
      await sdk.client.send(new sdk.mod.DeleteObjectCommand({ Bucket: bucket, Key: key }));
      eliminados += 1;
    } catch (error) {
      // La clave completa en el log es lo unico que permite localizar despues un
      // documento personal que quedo en el bucket: su `fileKey` ya no existe en base.
      fallidos.push(relKey);
      console.error(`[Almacenamiento] Fallo en storageDelete de "${key}":`, error);
    }
  }
  return { eliminados, fallidos };
}
