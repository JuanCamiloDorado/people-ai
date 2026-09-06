import { describe, expect, it, vi } from "vitest";

vi.mock("./db", async () => { const actual = await vi.importActual<typeof import("./db")>("./db"); return { ...actual, getAppProfile: vi.fn(async (userId: number, companyId?: number | null) => { const perfil = userId === 2 ? { role: "EMPLOYEE", companyId: 4 } : { role: "HR", companyId: 4 }; return companyId == null || companyId === perfil.companyId ? perfil : undefined; }) }; });
import { appRouter } from "./routers";
import { getMissingRequirements, isLinkUsable } from "./hrDomain";
import { assertCompanyScope, assertRole } from "./authorization";
import type { TrpcContext } from "./_core/context";

const context = (role: "HR" | "EMPLOYEE" = "HR"): TrpcContext => ({
  user: { id: role === "EMPLOYEE" ? 2 : 1, openId: "phase23-test", name: "Test", email: "test@example.com", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
} as TrpcContext);

describe("Fases 2 y 3 — contratos de flujo", () => {
  // OJO: este caso NO demuestra que un token inexistente se rechace. En el entorno de
  // test no hay DATABASE_URL, asi que `getPortal` sale por su guarda de conexion antes
  // de llegar a mirar el token, y daria lo mismo con cualquier entrada -- durante un
  // tiempo el test afirmo justo eso y pasaba por el motivo equivocado.
  //
  // Lo que si fija es la otra mitad, que es una regresion real: que esa salida sea un
  // error y no un `null`. El cliente pinta todo `null` como "Este enlace ya no esta
  // disponible", asi que devolver null cuando la base no responde equivale a decirle a
  // un candidato que su enlace expiro cuando esta perfectamente vivo.
  //
  // Un ida y vuelta real de generateLink -> getPortal exigiria una base en los tests,
  // que hoy no existe; de ahi el aserto explicito de la precondicion.
  it("sin base de datos falla con error, en vez de fingir que el enlace no existe", async () => {
    expect(process.env.DATABASE_URL).toBeFalsy();
    await expect(
      appRouter.createCaller(context()).candidatePortal.get({ token: "a".repeat(32) })
    ).rejects.toThrow(/No pudimos verificar el enlace/);
  });

  it("rechaza enlaces expirados y revocados antes de resolver el portal", () => {
    expect(isLinkUsable("active", new Date(Date.now() - 1))).toBe(false);
    expect(isLinkUsable("revoked", new Date(Date.now() + 86400000))).toBe(false);
    expect(isLinkUsable("active", new Date(Date.now() + 86400000))).toBe(true);
  });

  it("bloquea rol insuficiente y alcance cross-tenant en procedimientos tRPC protegidos", async () => {
    await expect(appRouter.createCaller(context("EMPLOYEE")).hiring.list({ companyId: 4 })).rejects.toThrow();
    await expect(appRouter.createCaller(context("HR")).hiring.detail({ companyId: 5, processId: 1 })).rejects.toThrow();
    expect(() => assertRole({ role: "EMPLOYEE", companyId: 4 }, ["HR"])).toThrow();
    expect(() => assertCompanyScope({ role: "HR", companyId: 4 }, 5)).toThrow();
    // El contacto de soporte se publica a los candidatos: escribirlo cross-tenant seria
    // cambiar el correo y el telefono que otra empresa ensena en sus enlaces.
    await expect(appRouter.createCaller(context("HR")).company.updateContact({ companyId: 5, candidateSupportEmail: null, candidateSupportPhone: null })).rejects.toThrow();
    await expect(appRouter.createCaller(context("EMPLOYEE")).company.contact({ companyId: 4 })).rejects.toThrow();
  });

  it("detecta documentos obligatorios faltantes antes del envío", () => {
    expect(getMissingRequirements([{ required: true, status: "pending" }, { required: true, status: "uploaded" }, { required: false, status: "pending" }])).toHaveLength(1);
  });

  it("rechaza datos de portal con tokens demasiado cortos en el contrato tRPC", async () => {
    await expect(appRouter.createCaller(context()).candidatePortal.get({ token: "short" })).rejects.toThrow();
  });
});
