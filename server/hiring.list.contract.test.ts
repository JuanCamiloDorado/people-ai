import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Contrato del listado de contrataciones.
 *
 *  `listHiring` es la consulta mas caliente del sistema: la pide la tabla de
 *  `/hr/contrataciones`, la pide la misma tabla en el inicio y la vuelve a pedir
 *  `getDashboardStats` para las tarjetas. Cualquier trabajo por fila se multiplica por
 *  tres pantallas y por el numero de procesos de la empresa.
 *
 *  Aviso sobre el alcance real de este archivo, el mismo que el de `hiring.delete`: NO
 *  demuestra que la consulta devuelva los datos correctos. No hay base de datos en los
 *  tests (`vitest.config.ts` solo incluye `server/**`) ni CI. Lo que si hace es congelar
 *  una decision que se deshace sola en cuanto alguien quiera "reutilizar codigo", porque
 *  el resultado sigue siendo correcto y nada falla: solo se vuelve lento. Un N+1 no
 *  rompe ningun test ni el compilador -- aparece cuando hay datos de verdad. */
const cuerpoListHiring = () => {
  const source = readFileSync(resolve(process.cwd(), "server", "hrDomain.ts"), "utf8");
  // El corte empieza en la firma, no en el bloque de documentacion de encima: ese
  // comentario explica por que ya NO se llama a `getHiringDetail`, y lo nombra. Incluirlo
  // haria que la primera asercion se acusara a si misma.
  const inicio = source.indexOf("export async function listHiring");
  expect(inicio).toBeGreaterThan(-1);
  const fin = source.indexOf("\nexport ", inicio + 1);
  return source.slice(inicio, fin === -1 ? undefined : fin);
};

describe("Listado de contrataciones — contrato", () => {
  it("no vuelve al N+1: nada de una consulta por fila", () => {
    const cuerpo = cuerpoListHiring();
    // `getHiringDetail` trae seis SELECT y ademas ESCRIBE (sincroniza los requisitos con
    // la plantilla vigente). Llamarlo por proceso convertia pintar una lista en cientos
    // de consultas y en UPDATEs. Los cuatro campos que la lista necesita salen de dos
    // consultas fijas.
    expect(cuerpo).not.toContain("getHiringDetail(");
    // La otra forma del mismo error: recorrer los procesos con un callback asincrono para
    // consultar dentro. Es el patron exacto que habia aqui.
    expect(cuerpo).not.toContain(".map(async");
  });

  it("agrega los recuentos en la base y no en memoria", () => {
    const cuerpo = cuerpoListHiring();
    expect(cuerpo).toContain("groupBy(");
    // El companyId va en el WHERE de la consulta de recuentos ademas del `inArray`: el
    // aislamiento entre empresas vive solo en codigo de aplicacion, no hay foreign keys
    // ni RLS que lo respalden.
    expect(cuerpo).toContain("eq(hiringRequirements.companyId, companyId)");
    // Drizzle genera `in ()` con una lista vacia y MySQL lo rechaza como error de
    // sintaxis: sin la salida temprana, una empresa sin procesos reventaria el listado.
    expect(cuerpo).toContain("rows.length === 0");
  });

  it("un proceso sin candidato o sin cargo sigue apareciendo", () => {
    const cuerpo = cuerpoListHiring();
    // Con INNER JOIN el proceso desapareceria de la lista en silencio en vez de mostrarse
    // con el texto de reserva. Para un expediente ese es el peor modo de fallo posible:
    // nadie busca lo que no sabe que falta.
    expect(cuerpo).not.toContain("innerJoin");
    expect(cuerpo.match(/leftJoin/g)?.length).toBe(2);
    expect(cuerpo).toContain('|| "Candidato"');
    expect(cuerpo).toContain('|| "Cargo"');
  });

  it("convierte los agregados a numero en vez de confiar en el tipo declarado", () => {
    const cuerpo = cuerpoListHiring();
    // `sql<number>` es una asercion, no una conversion: quien decide es el driver.
    // `count()` llega como numero, pero `sum()` llega como string en mysql2, y entonces
    // el `receivedCount >= requiredCount` de las tarjetas y de `getHiringStatusInfo`
    // compararia cadenas -- "9" >= "12" seria true y el proceso saldria completo.
    expect(cuerpo).toContain("Number(c.requiredCount)");
    expect(cuerpo).toContain("Number(c.receivedCount)");
  });
});
