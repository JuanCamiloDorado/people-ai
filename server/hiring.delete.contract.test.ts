import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/** Contrato del borrado de contrataciones.
 *
 *  `hiring.delete` es la unica operacion destructiva-FISICA del sistema: borra el proceso
 *  y trece tablas hijas a mano, porque la base no tiene foreign keys. Lo que se pierde no
 *  se recupera.
 *
 *  Aviso sobre el alcance real de este archivo: NO demuestra que se borre una sola fila.
 *  No hay base de datos en los tests (vitest.config.ts solo incluye `server/**`) ni CI, y
 *  este repo nunca ha tenido tests de integracion contra MySQL. Lo que si hace es congelar
 *  las decisiones que se pueden deshacer en silencio -- por copiar el patron de la funcion
 *  vecina -- y que ningun test ni el compilador detectarian. La verificacion de que borra
 *  se hace a mano contra la app, como el resto del proyecto.
 *
 *  La tecnica de aserciones sobre el texto fuente es la de `phase4.ui-contract.test.ts` y
 *  `hiring.link.contract.test.ts`: para `HiringPage.tsx` es la unica red que hay. */
const readClient = (file: string) =>
  readFileSync(resolve(process.cwd(), "client/src/pages", file), "utf8");
const readServer = (file: string) =>
  readFileSync(resolve(process.cwd(), "server", file), "utf8");

/** El cuerpo de `deleteHiring` aislado del resto del archivo: sin esto, un `activity(` de
 *  cualquier funcion vecina daria un falso negativo en las aserciones de abajo. */
const cuerpoDeleteHiring = () => {
  const source = readServer("hrDomain.ts");
  const inicio = source.indexOf("export async function deleteHiring");
  expect(inicio).toBeGreaterThan(-1);
  const fin = source.indexOf("\nexport ", inicio + 1);
  return source.slice(inicio, fin === -1 ? undefined : fin);
};

function unauthenticatedContext(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("Borrado de contrataciones — contrato", () => {
  it("no se puede borrar sin sesion", async () => {
    // Sin sesion la respuesta es UNAUTHORIZED sea cual sea el input: el middleware de
    // `protectedProcedure` corre antes que la validacion zod. Por eso aqui no se puede
    // comprobar el `positive()` del companyId sin una sesion real, y no hay base de datos
    // en los tests para fabricarla.
    const caller = appRouter.createCaller(unauthenticatedContext());
    await expect(caller.hiring.delete({ companyId: 1, processId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("la procedure conserva el preambulo de aislamiento entre empresas", () => {
    // No hay `companyProcedure`: el preambulo se copia a mano y nada falla si se omite.
    // Sin `assertCompanyScope`, cualquier analista podria borrar el expediente de otro
    // tenant pasando su companyId.
    const linea = readServer("routers.ts")
      .split("\n")
      .find(l => l.includes("return deleteHiring("));
    expect(linea).toBeDefined();
    expect(linea).toContain('assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"])');
    expect(linea).toContain("assertCompanyScope(access, input.companyId)");
  });

  it("borra todo en una transaccion y deja el proceso para el final", () => {
    const cuerpo = cuerpoDeleteHiring();
    expect(cuerpo).toContain("db.transaction(");
    // El orden decide el modo de fallo: si la transaccion se parte alguna vez, es
    // preferible "el proceso sigue en la lista y se puede reintentar" a "huerfanos
    // invisibles sin padre".
    expect(cuerpo.indexOf("delete(hiringProcesses)")).toBeGreaterThan(cuerpo.indexOf("delete(hiringRequirements)"));
    // Las trece hijas, uno por uno: anadir una tabla con processId y olvidarla aqui es el
    // fallo mas probable de este codigo, y no lo detecta ni el compilador ni la base.
    for (const tabla of [
      "hiringRequirements", "candidateAccessLinks", "candidateDocuments", "candidateOtpChallenges",
      "communicationLogs", "processActivities", "internalNotifications", "aiAnalysisRuns",
      "aiDocumentFindings", "aiHiringSummaries", "aiInsights",
    ]) {
      expect(cuerpo).toContain(`delete(${tabla})`);
    }
    // Y el perfil del candidato solo si no lo usa otro proceso.
    expect(cuerpo).toContain("delete(candidateProfiles)");
    expect(cuerpo).toContain("otrosProcesos");
  });

  it("recoge las claves de S3 sin filtrar por documento activo", () => {
    // `uploadPortalDocument` marca la version anterior como "removed" y NO borra el
    // objeto. Con el filtro `status = "active"` que usa el resto del archivo, cada
    // documento que el candidato reemplazo quedaria en el bucket para siempre y sin forma
    // de localizarlo: su `fileKey` solo existe en la fila que estamos borrando.
    const cuerpo = cuerpoDeleteHiring();
    expect(cuerpo).toContain("fileKey: candidateDocuments.fileKey");
    expect(cuerpo).not.toContain("candidateDocuments.status");
    // Y el bucket siempre despues del commit: al reves, un fallo de la transaccion dejaria
    // filas apuntando a objetos inexistentes.
    expect(cuerpo.indexOf("storageDelete(")).toBeGreaterThan(cuerpo.indexOf("db.transaction("));
  });

  it("no reintroduce las filas que acaba de borrar ni escribe al leer el proceso", () => {
    const cuerpo = cuerpoDeleteHiring();
    // `activity()` insertaria en process_activities con el processId recien borrado.
    expect(cuerpo).not.toContain("activity(");
    // `getHiringDetail()` escribe (sincroniza requisitos con la plantilla vigente) y
    // filtra documentos activos: emitiria UPDATEs contra filas condenadas.
    expect(cuerpo).not.toContain("getHiringDetail(");
    // El rastro va a audit_logs, que no cuelga del proceso, y con el nombre del candidato:
    // sin el, el registro no dice que se perdio.
    expect(cuerpo).toContain('audit(companyId, "hiring_process_deleted"');
    expect(cuerpo).toContain("candidateName: candidate?.fullName");
  });

  it("desvincula las conversaciones del asistente en vez de borrarlas", () => {
    // Pertenecen a un usuario, no al proceso, y sus mensajes alimentan la metrica de
    // consultas del dashboard. Eliminar la contratacion de un candidato no autoriza a
    // borrar el historial de chat de un empleado.
    const cuerpo = cuerpoDeleteHiring();
    expect(cuerpo).toContain("update(aiConversations)");
    expect(cuerpo).toContain("processId: null");
    expect(cuerpo).not.toContain("delete(aiConversations)");
  });

  it("el boton de la fila es hermano del enlace, no un boton dentro de un enlace", () => {
    // Un <button> dentro de un <a> es HTML invalido y deja dos controles anidados en el
    // arbol de accesibilidad. El enlace se estira sobre la fila con un ::after, asi que no
    // hace falta ningun stopPropagation -- que es justo la correccion que se pierde el dia
    // que alguien envuelva el boton en un Tooltip o un DialogTrigger.
    const source = readClient("HiringPage.tsx");
    expect(source).toContain("after:absolute after:inset-0");
    // La forma de llamada, no el nombre suelto: el comentario que explica por que no hace
    // falta lo menciona, y con `toContain("stopPropagation")` se acusaria a si mismo.
    expect(source).not.toContain("stopPropagation()");
    expect(source).toContain("aria-label={`Eliminar la contratación de ${process.candidateName}`}");
  });

  it("confirma antes de borrar y avisa de que no hay vuelta atras", () => {
    const source = readClient("HiringPage.tsx");
    expect(source).toContain("Esta acción no se puede deshacer.");
    // Sin `hr.stats` las tarjetas del dashboard siguen contando una fila que ya no existe:
    // `getDashboardStats` es el mismo `listHiring` recontado.
    expect(source).toContain("utils.hr.stats.invalidate()");
    expect(source).toContain("utils.hiring.list.invalidate()");
  });
});
