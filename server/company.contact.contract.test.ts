import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appRouter } from "./routers";
import { telHref } from "../shared/contacto";
import type { TrpcContext } from "./_core/context";

/** Contrato del contacto de soporte que el portal publica al candidato.
 *
 *  Aviso sobre el alcance real, igual que en `hiring.delete.contract.test.ts`: no hay base
 *  de datos en los tests, asi que esto NO demuestra que se guarde una fila. Lo que congela
 *  son las decisiones que se deshacen en silencio al copiar el patron de la funcion vecina
 *  y que ni el compilador ni ningun otro test detectarian. */
const readClient = (file: string) =>
  readFileSync(resolve(process.cwd(), "client/src/pages", file), "utf8");
const readServer = (file: string) =>
  readFileSync(resolve(process.cwd(), "server", file), "utf8");

/** El bloque de una procedure multilinea, aislado del resto del router: sin esto un
 *  `assertCompanyScope(` de cualquier procedure vecina daria un falso positivo. */
const bloqueProcedure = (nombre: string) => {
  const source = readServer("routers.ts");
  const inicio = source.indexOf(`${nombre}: protectedProcedure`);
  expect(inicio).toBeGreaterThan(-1);
  const fin = source.indexOf("\n    }),", inicio);
  return source.slice(inicio, fin === -1 ? undefined : fin);
};

function unauthenticatedContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("Contacto de soporte del portal — contrato", () => {
  it("deriva el href del tel: del mismo texto que se muestra", () => {
    // La regresion que evita: el portal tenia `href="tel:+573000000000"` con el texto
    // "+57 (601) 000 0000" justo debajo. Dos numeros distintos en el mismo enlace.
    expect(telHref("+57 (601) 000 0000")).toBe("tel:+576010000000");
    expect(telHref("601 000 0000")).toBe("tel:6010000000");
    expect(telHref("(+57) 300-000-0000")).toBe("tel:+573000000000");
    // Un `+` que no sea el primer caracter no es parte del numero en RFC 3966.
    expect(telHref("57+300 000 0000")).toBe("tel:573000000000");
  });

  it("no se puede leer ni escribir el contacto sin sesion", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext());
    await expect(
      caller.company.contact({ companyId: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.company.updateContact({
        companyId: 1,
        candidateSupportEmail: null,
        candidateSupportPhone: null,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("las procedures conservan el preambulo de aislamiento entre empresas", () => {
    // No hay `companyProcedure`: el preambulo se copia a mano y nada falla si se omite.
    // Sin `assertCompanyScope`, cualquier analista cambiaria el contacto que otro tenant
    // publica a sus candidatos.
    for (const nombre of ["contact", "updateContact"]) {
      const bloque = bloqueProcedure(nombre);
      expect(bloque).toContain("const access = await resolveAccess(ctx.user);");
      expect(bloque).toContain(
        'assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]);'
      );
      expect(bloque).toContain("assertCompanyScope(access, input.companyId);");
    }
  });

  it("el UPDATE filtra por la empresa", () => {
    // En `companies` el propio `id` ES la clave de tenant: no hay columna `companyId` que
    // anadir al WHERE, asi que este `eq` es el filtro multi-tenant completo.
    const source = readServer("orgDomain.ts");
    const inicio = source.indexOf("export async function updateCompanyContact");
    expect(inicio).toBeGreaterThan(-1);
    expect(source.slice(inicio)).toContain(
      ".where(eq(companies.id, companyId));"
    );
  });

  it("ensureSchema aplica el DDL, que es lo unico que corre en produccion", () => {
    // `render.yaml` no ejecuta migraciones: el `.sql` de drizzle no crea estas columnas en
    // ningun entorno desplegado. Si alguien borra este bloque creyendo que basta con el
    // fichero de migracion, produccion revienta con "Unknown column" en la primera lectura.
    const source = readServer("db.ts");
    expect(source).toMatch(
      /ALTER TABLE .*companies.* ADD COLUMN .*candidateSupportEmail.* VARCHAR\(320\) NULL/
    );
    expect(source).toMatch(
      /ALTER TABLE .*companies.* ADD COLUMN .*candidateSupportPhone.* VARCHAR\(40\) NULL/
    );
  });

  it("el portal publica solo los campos de empresa que necesita", () => {
    // `getHiringDetail` hace `select()` sin proyeccion y `candidatePortal.get` es publica:
    // sin esta lista explicita, la proxima columna de `companies` viaja a un endpoint sin
    // sesion el mismo dia en que alguien la anade.
    const source = readServer("hrDomain.ts");
    expect(source).toContain("company: companyForPortal(detail.company)");
    expect(source).toContain(
      "candidateSupportEmail: company.candidateSupportEmail"
    );
    expect(source).not.toContain("legalName: company.legalName");
  });

  it("el portal ya no fabrica el correo ni hardcodea el telefono", () => {
    const source = readClient("CandidatePortalPage.tsx");
    expect(source).not.toContain("tel:+573000000000");
    expect(source).not.toContain('"bivien"');
    expect(source).toContain("telHref(company.candidateSupportPhone)");
    expect(source).toContain("mailto:${company.candidateSupportEmail}");
  });

  it("Contrataciones siembra el formulario al abrir y no con un efecto", () => {
    // Un `useEffect` sobre `contacto.data` le borraria a la analista lo que esta
    // escribiendo cada vez que react-query refetch al recuperar el foco de la ventana.
    const source = readClient("HiringPage.tsx");
    expect(source).toContain("const abrirContacto = ");
    expect(source).toContain("utils.company.contact.invalidate()");
  });
});
