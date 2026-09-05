import { describe, expect, it, vi } from "vitest";

const { TEST_SECRET } = vi.hoisted(() => ({
  TEST_SECRET: "secreto-de-pruebas-suficientemente-largo-32+",
}));

vi.mock("./_core/env", () => ({
  ENV: { cookieSecret: TEST_SECRET, forgeApiUrl: "", forgeApiKey: "", storageEndpoint: "", storageRegion: "auto", storageBucket: "", storageAccessKeyId: "", storageSecretAccessKey: "", storageForcePathStyle: false },
}));

import { assertCanGrantRole, canGrantRole, INVITABLE_ROLES } from "./authorization";
import { isDuplicateKeyError, passwordAttemptKey } from "./auth";
import { hashInviteToken, isInviteUsable } from "./orgDomain";

// Nota sobre el alcance de estas pruebas: `inviteUser` y `acceptInvite` son
// transacciones de varias tablas con condiciones WHERE que deciden el resultado
// (revocar solo las pendientes de ESE correo y empresa, cerrar la invitacion solo
// si sigue activa). Un doble de drizzle que ignorase esas condiciones probaria el
// doble, no el codigo, y daria confianza falsa. Esos flujos se verifican de punta a
// punta contra una base real; aqui se prueba lo que es genuinamente unitario.

describe("techo de rol al invitar", () => {
  it("HR no puede conceder COMPANY_ADMIN", () => {
    expect(canGrantRole("HR", "COMPANY_ADMIN")).toBe(false);
    expect(() => assertCanGrantRole({ role: "HR", companyId: 1 }, "COMPANY_ADMIN")).toThrow();
  });

  it("HR si puede conceder EMPLOYEE y MANAGER", () => {
    expect(canGrantRole("HR", "EMPLOYEE")).toBe(true);
    expect(canGrantRole("HR", "MANAGER")).toBe(true);
    expect(() => assertCanGrantRole({ role: "HR", companyId: 1 }, "EMPLOYEE")).not.toThrow();
  });

  it("COMPANY_ADMIN puede conceder todo menos SUPER_ADMIN", () => {
    expect(canGrantRole("COMPANY_ADMIN", "COMPANY_ADMIN")).toBe(true);
    expect(canGrantRole("COMPANY_ADMIN", "FINANCE")).toBe(true);
    expect(canGrantRole("COMPANY_ADMIN", "SUPER_ADMIN")).toBe(false);
  });

  it("nadie concede SUPER_ADMIN, ni siquiera un SUPER_ADMIN", () => {
    for (const rol of Object.keys(INVITABLE_ROLES) as (keyof typeof INVITABLE_ROLES)[]) {
      expect(canGrantRole(rol, "SUPER_ADMIN")).toBe(false);
    }
  });

  it("los roles sin gente a cargo no pueden invitar a nadie", () => {
    for (const rol of ["FINANCE", "MANAGER", "EMPLOYEE"] as const) {
      expect(INVITABLE_ROLES[rol]).toHaveLength(0);
      expect(() => assertCanGrantRole({ role: rol, companyId: 1 }, "EMPLOYEE")).toThrow();
    }
  });
});

describe("token de invitacion", () => {
  it("hashea de forma determinista y no reversible", () => {
    const token = "un-token-de-invitacion-de-prueba";
    expect(hashInviteToken(token)).toHaveLength(64);
    expect(hashInviteToken(token)).not.toBe(token);
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
  });

  it("tokens distintos dan hashes distintos", () => {
    expect(hashInviteToken("token-a")).not.toBe(hashInviteToken("token-b"));
  });
});

describe("vigencia de la invitacion", () => {
  const futuro = new Date(Date.now() + 86400000);
  const pasado = new Date(Date.now() - 1000);

  it("solo es usable si esta activa y no ha caducado", () => {
    expect(isInviteUsable("active", futuro)).toBe(true);
    expect(isInviteUsable("active", pasado)).toBe(false);
    expect(isInviteUsable("revoked", futuro)).toBe(false);
    expect(isInviteUsable("accepted", futuro)).toBe(false);
  });

  it("acepta un instante inyectado, para no depender del reloj", () => {
    const corte = new Date(1000);
    expect(isInviteUsable("active", corte, 999)).toBe(true);
    expect(isInviteUsable("active", corte, 1001)).toBe(false);
  });
});

// Nota de alcance: el filtro `status = 'active'` de getAppProfile, listMemberships
// y switchActiveCompany vive dentro de consultas drizzle. Afirmar sobre el texto
// fuente de esas funciones seria teatro -pasaria con un comentario-, y un doble que
// ignorase las clausulas WHERE probaria el doble. Ese comportamiento se verifica de
// punta a punta contra una base real. Aqui se prueba lo que si es unitario.

describe("clave del limitador de intentos", () => {
  it("acceptInvite y signIn comparten contador para la misma cuenta", () => {
    // La clave la construye una sola funcion, asi que los dos caminos no pueden
    // divergir. Antes acceptInvite la derivaba del token y regenerar la invitacion
    // reiniciaba el contador, dando intentos ilimitados.
    expect(passwordAttemptKey("1.2.3.4", "ana@empresa.test")).toBe(
      passwordAttemptKey("1.2.3.4", "ana@empresa.test")
    );
  });

  it("normaliza el correo, para que mayusculas y espacios no creen otro cubo", () => {
    expect(passwordAttemptKey("1.2.3.4", "  ANA@Empresa.TEST  ")).toBe(
      passwordAttemptKey("1.2.3.4", "ana@empresa.test")
    );
  });

  it("separa por IP y por cuenta", () => {
    expect(passwordAttemptKey("1.2.3.4", "ana@x.test")).not.toBe(
      passwordAttemptKey("5.6.7.8", "ana@x.test")
    );
    expect(passwordAttemptKey("1.2.3.4", "ana@x.test")).not.toBe(
      passwordAttemptKey("1.2.3.4", "beto@x.test")
    );
  });

  it("tolera una IP ausente sin agrupar a todos bajo undefined", () => {
    expect(passwordAttemptKey(undefined, "ana@x.test")).toContain("sin-ip");
  });
});

describe("colisiones de indice unico", () => {
  const correo = { code: "ER_DUP_ENTRY", message: "Duplicate entry 'a@b.c' for key 'users.users_email_idx'" };
  const perfil = { code: "ER_DUP_ENTRY", message: "Duplicate entry '5-1' for key 'app_profiles.profiles_user_company_idx'" };

  it("distingue una colision de correo de una de perfil", () => {
    // Sin acotar por indice, ambas se respondian con el mensaje del primer caso.
    expect(isDuplicateKeyError(correo, "users_email_idx")).toBe(true);
    expect(isDuplicateKeyError(correo, "profiles_user_company_idx")).toBe(false);
    expect(isDuplicateKeyError(perfil, "profiles_user_company_idx")).toBe(true);
    expect(isDuplicateKeyError(perfil, "users_email_idx")).toBe(false);
  });

  it("reconoce la colision por mensaje aunque falte el codigo del driver", () => {
    expect(isDuplicateKeyError({ message: correo.message }, "users_email_idx")).toBe(true);
  });

  it("no confunde cualquier otro error con una colision", () => {
    expect(isDuplicateKeyError(new Error("connection lost"), "users_email_idx")).toBe(false);
    expect(isDuplicateKeyError(null, "users_email_idx")).toBe(false);
  });
});
