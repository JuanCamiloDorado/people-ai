import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Contrato de la descarga completa del expediente (`hiring.downloadZip`).
 *
 *  Dos cosas distintas que ningun otro test cubre y que se rompen en silencio:
 *
 *  1. El preambulo de aislamiento entre empresas. No existe un `companyProcedure`: las tres
 *     lineas se copian a mano en cada procedure y nada falla si se omiten -- queda un
 *     agujero entre tenants, y aqui el material son documentos personales del candidato.
 *     `phase31.router.test.ts` ya comprueba que sin sesion la respuesta es UNAUTHORIZED,
 *     que es otra cosa: eso no dice nada sobre CON sesion de otra empresa.
 *
 *  2. Donde vive el boton. Estuvo enterrado al final de la tarjeta "Comunicacion", en la
 *     columna derecha, donde nadie lo encontraba; se movio a la cabecera de "Documentos
 *     requeridos", que es donde se mira el expediente. `vitest.config.ts` solo incluye
 *     `server/**`, asi que la unica red del cliente es esta -- la tecnica de aserciones
 *     sobre el texto fuente de `phase4.ui-contract.test.ts` y `hiring.link.contract.test.ts`. */
const readClient = (file: string) =>
  readFileSync(resolve(process.cwd(), "client/src/pages", file), "utf8");
const readServer = (file: string) =>
  readFileSync(resolve(process.cwd(), "server", file), "utf8");

/** El cuerpo de `downloadHiringZip` aislado: sin esto, un `expedienteFolderName(` del
 *  propio helper vecino daria un falso negativo en las aserciones de abajo. */
const cuerpoDownloadHiringZip = () => {
  const source = readServer("hrDomain.ts");
  const inicio = source.indexOf("export async function downloadHiringZip");
  expect(inicio).toBeGreaterThan(-1);
  const fin = source.indexOf("\nexport ", inicio + 1);
  return source.slice(inicio, fin === -1 ? undefined : fin);
};

describe("Descarga del expediente completo — contrato", () => {
  it("la procedure conserva el preambulo de aislamiento entre empresas", () => {
    const linea = readServer("routers.ts")
      .split("\n")
      .find((l) => l.includes("return downloadHiringZip("));
    expect(linea).toBeDefined();
    expect(linea).toContain('assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"])');
    expect(linea).toContain("assertCompanyScope(access, input.companyId)");
  });

  it("cada documento cuelga de la carpeta del candidato", () => {
    // La carpeta se calcula UNA vez fuera del bucle y se prefija a un `uniqueZipName`
    // que sigue recibiendo el nombre desnudo: si se le pasara ya prefijado, el `Set` de
    // deduplicacion dejaria de ver las colisiones y JSZip pisaria documentos en silencio.
    const cuerpo = cuerpoDownloadHiringZip();
    expect(cuerpo).toContain(
      "const carpeta = expedienteFolderName(detail.candidate?.fullName, detail.candidate?.identificationNumber)"
    );
    expect(cuerpo).toContain("name: `${carpeta}/${uniqueZipName(usados, document.normalizedName)}`");
    expect(cuerpo).toContain("filename: `${carpeta}.zip`");
  });

  it("no genera un ZIP vacio cuando el candidato no ha subido nada", () => {
    // La UI deshabilita el boton, pero la procedure es alcanzable por si sola y un ZIP
    // vacio parece un expediente que se perdio, no uno que aun no existe.
    expect(cuerpoDownloadHiringZip()).toContain("if (!detail.documents.length) throw new Error(");
  });

  it("el boton de descarga vive en la tarjeta de documentos, no en la de comunicaciones", () => {
    const source = readClient("HiringDetailPage.tsx");
    expect(source).toContain("Descargar todo");
    expect(source).not.toContain("Descargar expediente ZIP");
    const documentos = source.indexOf("Documentos requeridos");
    const boton = source.indexOf("Descargar todo");
    const siguienteTarjeta = source.indexOf("AI Document Intelligence");
    expect(documentos).toBeGreaterThan(-1);
    expect(siguienteTarjeta).toBeGreaterThan(documentos);
    expect(boton).toBeGreaterThan(documentos);
    expect(boton).toBeLessThan(siguienteTarjeta);
  });

  it("explica por que el boton esta deshabilitado sin documentos", () => {
    // El `title` va en el `span` que envuelve al boton y no en el boton: la variante de
    // shadcn aplica `disabled:pointer-events-none`, asi que un boton deshabilitado no
    // recibe hover y nunca mostraria su propio tooltip -- justo cuando hay que explicarse.
    const source = readClient("HiringDetailPage.tsx");
    const boton = source.indexOf("Descargar todo");
    const contexto = source.slice(Math.max(0, boton - 900), boton);
    expect(contexto).toContain('title={');
    expect(contexto).toContain("El candidato aún no ha subido documentos");
    expect(contexto).toContain("disabled={downloadZip.isPending || documents.length === 0}");
  });
});
