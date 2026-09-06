// Tests del adaptador S3. Antes este modulo no tenia ninguno: ni la forma de la clave,
// ni el manejo de configuracion ausente, ni el trato de los errores del proveedor.
//
// Dos cosas que no son obvias y conviene saber antes de tocar este archivo:
//
// 1. `vi.mock` SI intercepta `await import()`, no solo los imports estaticos. Por eso
//    funciona contra el cliente perezoso de `storage.ts`.
// 2. El cliente esta memoizado, asi que el estado es pegajoso entre casos. Cada prueba
//    recarga el modulo con `cargarStorage()` (`vi.resetModules()` + import), y por eso
//    el mock de ENV es un objeto MUTABLE de `vi.hoisted`: mutarlo antes de recargar es
//    lo que permite probar la rama "sin configurar".
import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, s3State } = vi.hoisted(() => ({
  envMock: {
    cookieSecret: "secreto-de-pruebas-suficientemente-largo-32+",
    forgeApiUrl: "",
    forgeApiKey: "",
    storageEndpoint: "https://cuenta.r2.cloudflarestorage.com",
    storageRegion: "auto",
    storageBucket: "bucket-de-pruebas",
    storageAccessKeyId: "clave-de-acceso",
    storageSecretAccessKey: "secreto-de-acceso",
    storageForcePathStyle: false,
  },
  s3State: {
    construcciones: [] as any[],
    enviados: [] as any[],
    respuesta: null as any,
    error: null as Error | null,
    // Solo lo usa `storageDelete`: es la unica operacion que sigue adelante tras un
    // fallo, asi que es la unica que necesita fallar en una clave y no en las demas.
    clavesQueFallan: [] as string[],
  },
}));

vi.mock("./_core/env", () => ({ ENV: envMock }));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    constructor(config: any) {
      s3State.construcciones.push(config);
    }
    async send(command: any) {
      s3State.enviados.push(command);
      if (s3State.clavesQueFallan.includes(command?.input?.Key)) {
        throw new Error(`AccessDenied en ${command.input.Key} de bucket-de-pruebas`);
      }
      if (s3State.error) throw s3State.error;
      return s3State.respuesta;
    }
  }
  class PutObjectCommand {
    constructor(public input: any) {}
  }
  class GetObjectCommand {
    constructor(public input: any) {}
  }
  class DeleteObjectCommand {
    constructor(public input: any) {}
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(
    async (_cliente: any, comando: any, opciones: any) =>
      `https://firmada.example/${comando.input.Key}?expires=${opciones.expiresIn}`
  ),
}));

const CONFIG_VALIDA = {
  storageEndpoint: "https://cuenta.r2.cloudflarestorage.com",
  storageRegion: "auto",
  storageBucket: "bucket-de-pruebas",
  storageAccessKeyId: "clave-de-acceso",
  storageSecretAccessKey: "secreto-de-acceso",
  storageForcePathStyle: false,
};

const cargarStorage = async () => {
  vi.resetModules();
  return import("./storage");
};

const ultimoPut = () => s3State.enviados[s3State.enviados.length - 1].input;

beforeEach(() => {
  Object.assign(envMock, CONFIG_VALIDA);
  s3State.construcciones.length = 0;
  s3State.enviados.length = 0;
  s3State.respuesta = null;
  s3State.error = null;
  s3State.clavesQueFallan.length = 0;
  vi.restoreAllMocks();
});

describe("adaptador de almacenamiento S3", () => {
  it("importar el modulo no construye el cliente ni carga el SDK", async () => {
    // El invariante que sostiene el arranque del servidor y `hrDomain.test.ts`: ambos
    // importan `storage.ts` de forma transitiva y no pueden depender de que haya
    // credenciales. Con el cliente a nivel de modulo, esto reventaba.
    envMock.storageBucket = "";
    envMock.storageAccessKeyId = "";
    envMock.storageSecretAccessKey = "";
    await expect(cargarStorage()).resolves.toBeDefined();
    expect(s3State.construcciones).toHaveLength(0);
  });

  it("sin configuracion falla con un mensaje neutro y no filtra infraestructura", async () => {
    // `candidatePortal.upload` es publica y el portal muestra `error.message` en un
    // toast: un candidato anonimo no debe leer nombres de variables, ni el bucket, ni
    // el endpoint. El detalle va al log del servidor y solo ahi.
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    envMock.storageBucket = "";
    const { storagePut } = await cargarStorage();

    await expect(storagePut("carpeta/archivo.pdf", Buffer.from("x"))).rejects.toThrow(
      /no esta disponible en este momento/
    );
    const mensaje = await storagePut("carpeta/archivo.pdf", Buffer.from("x")).catch(
      (e: Error) => e.message
    );
    expect(mensaje).not.toContain("STORAGE_S3_");
    expect(mensaje).not.toContain("bucket");
    expect(mensaje).not.toContain("r2.cloudflarestorage.com");

    // Pero quien mire el log si necesita saber exactamente que falta.
    expect(String(errorLog.mock.calls[0][1])).toContain("STORAGE_S3_BUCKET");
    // Y no se construye cliente: la validacion precede a la memoizacion.
    expect(s3State.construcciones).toHaveLength(0);
  });

  it("un error del proveedor no propaga su texto al cliente", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    s3State.error = new Error(
      "AccessDenied: no permission on bucket bucket-de-pruebas at https://cuenta.r2.cloudflarestorage.com"
    );
    const { storagePut } = await cargarStorage();

    const mensaje = await storagePut("carpeta/archivo.pdf", Buffer.from("x")).catch(
      (e: Error) => e.message
    );
    expect(mensaje).not.toContain("AccessDenied");
    expect(mensaje).not.toContain("bucket-de-pruebas");
    expect(mensaje).toMatch(/no esta disponible en este momento/);
    expect(String(errorLog.mock.calls[0][1])).toContain("AccessDenied");
  });

  it("storagePut escribe en el bucket y devuelve la misma clave que escribio", async () => {
    // Contrato: lo devuelto es lo que se persiste en candidate_documents.fileKey, y
    // `storageGetSignedUrl` tiene que poder leerlo con esa misma clave.
    const { storagePut } = await cargarStorage();
    const { key } = await storagePut(
      "candidate-documents/4/9/1-abc.pdf",
      Buffer.from("contenido"),
      "application/pdf"
    );

    const put = ultimoPut();
    expect(put.Bucket).toBe("bucket-de-pruebas");
    expect(put.ContentType).toBe("application/pdf");
    expect(put.Body).toEqual(Buffer.from("contenido"));
    expect(put.Key).toBe(key);
  });

  it("la clave se normaliza y lleva el sufijo aleatorio antes de la extension", async () => {
    const { storagePut } = await cargarStorage();

    const conExtension = await storagePut("/carpeta/archivo.pdf", Buffer.from("x"));
    expect(conExtension.key).toMatch(/^carpeta\/archivo_[0-9a-f]{8}\.pdf$/);

    const sinExtension = await storagePut("carpeta/archivo", Buffer.from("x"));
    expect(sinExtension.key).toMatch(/^carpeta\/archivo_[0-9a-f]{8}$/);

    // Dos escrituras de la misma ruta no pueden pisarse.
    const otra = await storagePut("/carpeta/archivo.pdf", Buffer.from("y"));
    expect(otra.key).not.toBe(conExtension.key);
  });

  it("el nombre de descarga viaja como metadato del objeto y va percent-encoded", async () => {
    // Se fija al escribir y no al firmar porque R2 no documenta los parametros
    // response-* de GetObject. Y solo la forma `filename*`: `originalName` lo controla
    // el cliente, asi que el percent-encoding es lo que cierra la inyeccion de
    // cabeceras.
    const { storagePut } = await cargarStorage();

    await storagePut("k.pdf", Buffer.from("x"), "application/pdf", "Cédula de ciudadanía.pdf");
    expect(ultimoPut().ContentDisposition).toBe(
      "inline; filename*=UTF-8''C%C3%A9dula%20de%20ciudadan%C3%ADa.pdf"
    );

    await storagePut("k.pdf", Buffer.from("x"), "application/pdf", 'mal"\r\nX-Inyectado: 1.pdf');
    const cabecera = ultimoPut().ContentDisposition;
    expect(cabecera).not.toMatch(/[\r\n"]/);

    // Sin nombre no se emite la cabecera en absoluto.
    await storagePut("k.pdf", Buffer.from("x"), "application/pdf");
    expect(ultimoPut().ContentDisposition).toBeUndefined();
  });

  it("las URLs firmadas caducan a los 300 s salvo que se pida otra cosa", async () => {
    const { storageGetSignedUrl } = await cargarStorage();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

    await storageGetSignedUrl("/carpeta/archivo.pdf");
    expect((getSignedUrl as any).mock.lastCall[2]).toEqual({ expiresIn: 300 });
    expect((getSignedUrl as any).mock.lastCall[1].input).toMatchObject({
      Bucket: "bucket-de-pruebas",
      Key: "carpeta/archivo.pdf",
    });

    await storageGetSignedUrl("carpeta/archivo.pdf", 900);
    expect((getSignedUrl as any).mock.lastCall[2]).toEqual({ expiresIn: 900 });
  });

  it("el cliente se construye una sola vez", async () => {
    const { storagePut, storageGetSignedUrl } = await cargarStorage();
    await storagePut("a.pdf", Buffer.from("x"));
    await storagePut("b.pdf", Buffer.from("x"));
    await storageGetSignedUrl("a.pdf");
    expect(s3State.construcciones).toHaveLength(1);
  });

  it("storageGetBytes descarga sin firmar nada", async () => {
    s3State.respuesta = {
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    };
    const { storageGetBytes } = await cargarStorage();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    (getSignedUrl as any).mockClear();

    await expect(storageGetBytes("/carpeta/archivo.pdf")).resolves.toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(s3State.enviados[0].input.Key).toBe("carpeta/archivo.pdf");
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it("el cliente se configura con credenciales explicitas y con timeouts", async () => {
    const { storagePut } = await cargarStorage();
    await storagePut("a.pdf", Buffer.from("x"));

    const config = s3State.construcciones[0];
    expect(config.region).toBe("auto");
    expect(config.endpoint).toBe("https://cuenta.r2.cloudflarestorage.com");
    expect(config.forcePathStyle).toBe(false);
    // Explicitas: sin ellas el SDK recorreria su cadena por defecto (metadata de EC2)
    // y unas AWS_* del entorno podrian secuestrar el bucket configurado.
    expect(config.credentials).toEqual({
      accessKeyId: "clave-de-acceso",
      secretAccessKey: "secreto-de-acceso",
    });
    // Sin timeouts, un proveedor colgado retiene una peticion de Express para siempre.
    expect(config.requestHandler).toEqual({
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
    });
  });

  it("sin endpoint la clave se omite, para no romper la resolucion de AWS por region", async () => {
    // Pasar `endpoint: undefined` explicito no es lo mismo que no pasarlo: rompe la
    // resolucion por defecto del SDK cuando el proveedor es AWS S3 real.
    envMock.storageEndpoint = "";
    envMock.storageRegion = "us-east-1";
    envMock.storageForcePathStyle = true;
    const { storagePut } = await cargarStorage();
    await storagePut("a.pdf", Buffer.from("x"));

    const config = s3State.construcciones[0];
    expect("endpoint" in config).toBe(false);
    expect(config.region).toBe("us-east-1");
    expect(config.forcePathStyle).toBe(true);
  });
});

// `storageDelete` es la unica operacion del modulo que no lanza. Todo este bloque existe
// para fijar esa desviacion: si alguien la "corrige" para que pase por `fallo()` como sus
// tres hermanas, `deleteHiring` empezara a reportar un fallo sobre un borrado que en base
// ya esta confirmado.
describe("storageDelete", () => {
  it("sin claves no construye cliente: se puede borrar un proceso sin documentos sin almacenamiento configurado", async () => {
    envMock.storageBucket = "";
    envMock.storageAccessKeyId = "";
    envMock.storageSecretAccessKey = "";
    const { storageDelete } = await cargarStorage();

    await expect(storageDelete([])).resolves.toEqual({ eliminados: 0, fallidos: [] });
    expect(s3State.construcciones).toHaveLength(0);
    expect(s3State.enviados).toHaveLength(0);
  });

  it("envia un comando por clave, normalizada y contra el bucket configurado", async () => {
    const { storageDelete } = await cargarStorage();

    await expect(
      storageDelete(["/candidate-documents/4/9/1-abc_1a2b3c4d.pdf", "otra/clave.png"])
    ).resolves.toEqual({ eliminados: 2, fallidos: [] });

    expect(s3State.enviados.map(c => c.input)).toEqual([
      { Bucket: "bucket-de-pruebas", Key: "candidate-documents/4/9/1-abc_1a2b3c4d.pdf" },
      { Bucket: "bucket-de-pruebas", Key: "otra/clave.png" },
    ]);
  });

  it("sin configuracion resuelve en vez de rechazar y devuelve todas las claves como fallidas", async () => {
    // El borrado en base ya esta confirmado cuando se llega aqui: rechazar le diria al
    // analista que no se elimino algo que si se elimino.
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    envMock.storageBucket = "";
    const { storageDelete } = await cargarStorage();

    await expect(storageDelete(["a.pdf", "b.pdf"])).resolves.toEqual({
      eliminados: 0,
      fallidos: ["a.pdf", "b.pdf"],
    });
    expect(s3State.construcciones).toHaveLength(0);
    // Un solo registro para las dos claves, y con las claves dentro: es lo unico que
    // permite localizarlas despues, porque su fileKey ya no existe en base.
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0][0])).toContain("a.pdf");
    expect(String(errorLog.mock.calls[0][0])).toContain("b.pdf");
  });

  it("un fallo del proveedor no lanza, no corta el resto y no filtra su texto", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    s3State.clavesQueFallan.push("b.pdf");
    const { storageDelete } = await cargarStorage();

    const resultado = await storageDelete(["a.pdf", "b.pdf", "c.pdf"]);

    // La tercera clave se intenta igual: el fallo de una no aborta el barrido.
    expect(resultado).toEqual({ eliminados: 2, fallidos: ["b.pdf"] });
    expect(s3State.enviados).toHaveLength(3);
    // Y el texto del SDK se queda en el log, nunca en el valor devuelto.
    expect(JSON.stringify(resultado)).not.toContain("AccessDenied");
    expect(JSON.stringify(resultado)).not.toContain("bucket-de-pruebas");
    expect(String(errorLog.mock.calls[0][1])).toContain("AccessDenied");
  });
});
