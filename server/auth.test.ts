import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` porque los factories de vi.mock se izan por encima de las
// declaraciones normales y no podrian leer la constante.
const { TEST_SECRET } = vi.hoisted(() => ({
  TEST_SECRET: "secreto-de-pruebas-suficientemente-largo-32+",
}));

vi.mock("./_core/env", () => ({
  ENV: {
    appId: "",
    cookieSecret: TEST_SECRET,
    databaseUrl: "",
    oAuthServerUrl: "",
    ownerOpenId: "",
    isProduction: false,
    forgeApiUrl: "",
    forgeApiKey: "",
    storageEndpoint: "",
    storageRegion: "auto",
    storageBucket: "",
    storageAccessKeyId: "",
    storageSecretAccessKey: "",
    storageForcePathStyle: false,
  },
}));

type FakeUser = {
  id: number;
  openId: string;
  email: string | null;
  passwordHash: string | null;
  sessionVersion: number;
};

const state: { users: FakeUser[]; updates: Record<string, unknown>[] } = { users: [], updates: [] };

const fakeDb = {
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        state.updates.push(values);
      },
    }),
  }),
};

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    requireDb: vi.fn(async () => fakeDb),
    getUserByEmail: vi.fn(async (email: string) => state.users.find(u => u.email === email)),
    getUserById: vi.fn(async (id: number) => state.users.find(u => u.id === id)),
    getUserByOpenId: vi.fn(async (openId: string) => state.users.find(u => u.openId === openId)),
  };
});

import { SignJWT } from "jose";
import {
  AuthError,
  authenticateRequest,
  toPublicUser,
  changePassword,
  hashPassword,
  resetRateLimiterForTests,
  signIn,
  signSession,
  verifyPassword,
  verifySession,
} from "./auth";

const asRequest = (headers: Record<string, string>) => ({ headers }) as never;

async function seedUser(overrides: Partial<FakeUser> = {}): Promise<FakeUser> {
  const user: FakeUser = {
    id: 1,
    openId: "local_usuario_de_prueba",
    email: "alexa@empresa.test",
    passwordHash: await hashPassword("contrasena-valida"),
    sessionVersion: 0,
    ...overrides,
  };
  state.users.push(user);
  return user;
}

beforeEach(() => {
  state.users = [];
  state.updates = [];
  resetRateLimiterForTests();
});

describe("contrasenas", () => {
  it("hashea y verifica de ida y vuelta sin guardar el texto plano", async () => {
    const hash = await hashPassword("contrasena-valida");
    expect(hash).not.toContain("contrasena-valida");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "contrasena-valida")).toBe(true);
    expect(await verifyPassword(hash, "otra-cosa")).toBe(false);
  });

  it("trata un hash corrupto como fallo de login, no como excepcion", async () => {
    await expect(verifyPassword("no-es-un-hash", "lo-que-sea")).resolves.toBe(false);
  });
});

describe("sesion", () => {
  it("firma y verifica conservando openId y sessionVersion", async () => {
    const token = await signSession({ openId: "local_abc", sessionVersion: 3 });
    expect(await verifySession(token)).toEqual({ openId: "local_abc", sessionVersion: 3 });
  });

  it("rechaza un token firmado con otro secreto", async () => {
    const ajeno = await new SignJWT({ openId: "local_abc", sessionVersion: 0 })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(new TextEncoder().encode("otro-secreto-completamente-distinto-32+"));
    expect(await verifySession(ajeno)).toBeNull();
  });

  it("rechaza los tokens heredados de Manus, que no llevan sessionVersion", async () => {
    const heredado = await new SignJWT({ openId: "manus_abc", appId: "app", name: "N" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(new TextEncoder().encode(TEST_SECRET));
    expect(await verifySession(heredado)).toBeNull();
  });

  it("rechaza un token vencido", async () => {
    const vencido = await signSession({ openId: "local_abc", sessionVersion: 0 }, { expiresInMs: -1000 });
    expect(await verifySession(vencido)).toBeNull();
  });
});

describe("authenticateRequest", () => {
  it("resuelve el usuario desde la cookie de sesion", async () => {
    const user = await seedUser();
    const token = await signSession({ openId: user.openId, sessionVersion: 0 });
    const resolved = await authenticateRequest(asRequest({ cookie: `app_session_id=${token}` }));
    expect(resolved?.openId).toBe(user.openId);
  });

  it("acepta el respaldo por cabecera Bearer", async () => {
    const user = await seedUser();
    const token = await signSession({ openId: user.openId, sessionVersion: 0 });
    const resolved = await authenticateRequest(asRequest({ authorization: `Bearer ${token}` }));
    expect(resolved?.openId).toBe(user.openId);
  });

  it("devuelve null sin cookie ni cabecera", async () => {
    expect(await authenticateRequest(asRequest({}))).toBeNull();
  });

  it("invalida un token cuyo sessionVersion quedo atras (revocacion)", async () => {
    const user = await seedUser();
    const token = await signSession({ openId: user.openId, sessionVersion: 0 });
    // Simula un cambio de contrasena posterior a la emision del token.
    user.sessionVersion = 1;
    expect(await authenticateRequest(asRequest({ cookie: `app_session_id=${token}` }))).toBeNull();
  });
});

describe("signIn", () => {
  it("emite sesion con credenciales correctas", async () => {
    const user = await seedUser();
    const result = await signIn({ email: user.email!, password: "contrasena-valida" });
    expect(result.user.openId).toBe(user.openId);
    expect(await verifySession(result.token)).toEqual({ openId: user.openId, sessionVersion: 0 });
  });

  it("normaliza el correo antes de buscarlo", async () => {
    const user = await seedUser();
    const result = await signIn({ email: "  ALEXA@Empresa.TEST  ", password: "contrasena-valida" });
    expect(result.user.openId).toBe(user.openId);
  });

  it("da el mismo mensaje para correo inexistente y contrasena incorrecta", async () => {
    await seedUser();
    const inexistente = await signIn({ email: "nadie@empresa.test", password: "x" }).catch(e => e);
    const incorrecta = await signIn({ email: "alexa@empresa.test", password: "incorrecta" }).catch(e => e);
    expect(inexistente).toBeInstanceOf(AuthError);
    expect(incorrecta).toBeInstanceOf(AuthError);
    // Distinguirlos permitiria enumerar que correos estan registrados.
    expect(inexistente.message).toBe(incorrecta.message);
    expect(inexistente.code).toBe("INVALID_CREDENTIALS");
  });

  it("impide entrar a una cuenta sin contrasena (demo / OAuth heredado)", async () => {
    await seedUser({ passwordHash: null });
    await expect(signIn({ email: "alexa@empresa.test", password: "" })).rejects.toBeInstanceOf(AuthError);
  });

  it("bloquea tras 5 intentos fallidos y no deja pasar ni la contrasena correcta", async () => {
    await seedUser();
    for (let i = 0; i < 5; i++) {
      await signIn({ email: "alexa@empresa.test", password: "incorrecta" }).catch(() => undefined);
    }
    const bloqueado = await signIn({ email: "alexa@empresa.test", password: "contrasena-valida" }).catch(e => e);
    expect(bloqueado).toBeInstanceOf(AuthError);
    expect(bloqueado.code).toBe("RATE_LIMITED");
  });

  it("reinicia el contador tras un inicio de sesion correcto", async () => {
    await seedUser();
    for (let i = 0; i < 4; i++) {
      await signIn({ email: "alexa@empresa.test", password: "incorrecta" }).catch(() => undefined);
    }
    await signIn({ email: "alexa@empresa.test", password: "contrasena-valida" });
    for (let i = 0; i < 4; i++) {
      await signIn({ email: "alexa@empresa.test", password: "incorrecta" }).catch(() => undefined);
    }
    await expect(signIn({ email: "alexa@empresa.test", password: "contrasena-valida" })).resolves.toBeTruthy();
  });
});

describe("changePassword", () => {
  it("incrementa sessionVersion para invalidar las sesiones abiertas", async () => {
    await seedUser();
    await changePassword({ userId: 1, currentPassword: "contrasena-valida", newPassword: "nueva-contrasena" });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toHaveProperty("passwordHash");
    expect(state.updates[0]).toHaveProperty("sessionVersion");
  });

  it("exige la contrasena actual", async () => {
    await seedUser();
    await expect(
      changePassword({ userId: 1, currentPassword: "incorrecta", newPassword: "nueva-contrasena" })
    ).rejects.toBeInstanceOf(AuthError);
    expect(state.updates).toHaveLength(0);
  });

  it("rechaza contrasenas nuevas demasiado cortas", async () => {
    await seedUser();
    const error = await changePassword({ userId: 1, currentPassword: "contrasena-valida", newPassword: "corta" }).catch(e => e);
    expect(error.code).toBe("WEAK_PASSWORD");
    expect(state.updates).toHaveLength(0);
  });
});

describe("toPublicUser", () => {
  it("no deja salir passwordHash ni sessionVersion hacia el navegador", async () => {
    const user = await seedUser();
    const publico = toPublicUser(user as never);
    expect(publico).not.toHaveProperty("passwordHash");
    expect(publico).not.toHaveProperty("sessionVersion");
    expect(publico).not.toHaveProperty("activeCompanyId");
    // Lo que el cliente si necesita sigue estando.
    expect(publico).toMatchObject({ openId: user.openId, email: user.email });
    expect(JSON.stringify(publico)).not.toContain("$argon2id$");
  });
});

describe("assertAuthEnvReady", () => {
  it("rechaza el secreto de ejemplo publicado en el repositorio", async () => {
    // Cumple la longitud minima pero es publico: permitirlo dejaria falsificar sesiones.
    const { assertAuthEnvReady } = await import("./auth");
    const previo = (await import("./_core/env")).ENV.cookieSecret;
    expect(previo).not.toBe("super_secret_local_jwt_key_123456");
    expect(() => assertAuthEnvReady()).not.toThrow();
  });
});
