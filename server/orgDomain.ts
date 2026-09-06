// Invitaciones para unirse a una empresa.
//
// Sin proveedor de correo, la invitacion se entrega como enlace copiable que el
// administrador comparte por su cuenta. Es el mismo mecanismo que ya usan los
// enlaces de candidato (`hrDomain.generateLink`): token aleatorio del que solo se
// guarda el hash, caducidad, y revocacion de los anteriores.

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  appProfiles,
  companies,
  invitations,
  users,
  type RoleKey,
  type User,
} from "../drizzle/schema";
import {
  AuthError,
  MIN_PASSWORD_LENGTH,
  assertNotRateLimited,
  clearAttempts,
  hashPassword,
  isDuplicateKeyError,
  normalizeEmail,
  passwordAttemptKey,
  recordFailedAttempt,
  verifyPassword,
} from "./auth";
import { writeAudit } from "./auditLog";
import { getDb, getUserByEmail, requireDb } from "./db";
import { hashOpaqueToken, isTokenUsable } from "./tokens";

/** Misma duracion que los enlaces de candidato. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const AUDIT_MODULE = "org";

/** Reexportados desde `./tokens`: el mismo mecanismo que los enlaces de candidato,
 *  sin que organizacion dependa de contratacion. */
export const hashInviteToken = hashOpaqueToken;
export const isInviteUsable = isTokenUsable;

// ------------------------------------------------------------------- invitar

export type InviteInput = {
  companyId: number;
  email: string;
  role: RoleKey;
  invitedByUserId: number;
};

/** Crea la invitacion y devuelve el token EN CRUDO. Es el unico momento en que
 *  existe: en base de datos solo queda su hash. */
export async function inviteUser(
  input: InviteInput
): Promise<{ token: string; expiresAt: Date }> {
  const email = normalizeEmail(input.email);
  const db = await requireDb();

  // Solo un perfil ACTIVO impide invitar. Contar tambien los suspendidos dejaba a
  // esas personas permanentemente fuera: no hay pantalla para reactivarlas, asi que
  // reinvitar era el unico camino de vuelta y devolvia conflicto para siempre.
  const existing = await getUserByEmail(email);
  if (existing) {
    const profile = (
      await db
        .select()
        .from(appProfiles)
        .where(
          and(
            eq(appProfiles.userId, existing.id),
            eq(appProfiles.companyId, input.companyId),
            eq(appProfiles.status, "active")
          )
        )
        .limit(1)
    )[0];
    if (profile) {
      throw new AuthError(
        "EMAIL_TAKEN",
        "Esa persona ya pertenece a esta empresa."
      );
    }
  }

  // Revocar e insertar van juntos: si el insert fallara despues de revocar, el
  // enlace que el administrador ya habia repartido quedaria anulado y sin
  // reemplazo, sin que nadie se entere.
  const token = randomBytes(32).toString("base64url");
  // Una sola vez: `generateLink` lo calcula dos veces y las fechas difieren en ms.
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await db.transaction(async tx => {
    await tx
      .update(invitations)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(
        and(
          eq(invitations.companyId, input.companyId),
          eq(invitations.email, email),
          eq(invitations.status, "active")
        )
      );
    await tx.insert(invitations).values({
      companyId: input.companyId,
      email,
      role: input.role,
      tokenHash: hashInviteToken(token),
      invitedByUserId: input.invitedByUserId,
      expiresAt,
    });
  });

  await writeAudit({
    companyId: input.companyId,
    userId: input.invitedByUserId,
    action: "invitation_created",
    module: AUDIT_MODULE,
    metadata: { email, role: input.role },
  });

  return { token, expiresAt };
}

// ------------------------------------------------------------------ consultar

export type InvitePreview = {
  email: string;
  companyName: string;
  role: RoleKey;
  /** Si ya existe cuenta, al aceptar se pide la contrasena actual en vez de una nueva. */
  userExists: boolean;
};

/** Devuelve `null` indistintamente para inexistente, caducada o revocada, para no
 *  revelar cual es el caso. */
export async function getInvitePreview(
  token: string
): Promise<InvitePreview | null> {
  const db = await requireDb();
  const invite = (
    await db
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashInviteToken(token)))
      .limit(1)
  )[0];
  if (!invite || !isInviteUsable(invite.status, invite.expiresAt)) return null;

  // Ambas dependen solo de `invite`, no una de otra.
  const [companyRows, user] = await Promise.all([
    db
      .select()
      .from(companies)
      .where(eq(companies.id, invite.companyId))
      .limit(1),
    getUserByEmail(invite.email),
  ]);
  const company = companyRows[0];
  if (!company) return null;
  return {
    email: invite.email,
    companyName: company.name,
    role: invite.role,
    userExists: Boolean(user),
  };
}

// -------------------------------------------------------------------- aceptar

/** Acepta la invitacion y devuelve el usuario resultante, ya con perfil en la
 *  empresa y con esa empresa marcada como activa.
 *
 *  Dos ramas: si no hay cuenta, se crea con la contrasena elegida; si la hay, se
 *  verifica su contrasena actual y solo se adjunta el perfil nuevo. */
export async function acceptInvite(input: {
  token: string;
  password: string;
  name?: string;
  /** IP de quien acepta. Junto al correo de la invitacion forma la clave del
   *  limitador, la MISMA que usa signIn: si se derivara del token, regenerar la
   *  invitacion reiniciaria el contador y daria intentos ilimitados. */
  ip?: string;
}): Promise<User> {
  const db = await requireDb();

  const invite = (
    await db
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashInviteToken(input.token)))
      .limit(1)
  )[0];
  if (!invite || !isInviteUsable(invite.status, invite.expiresAt)) {
    throw new AuthError(
      "INVALID_CREDENTIALS",
      "Esta invitacion ya no esta disponible."
    );
  }

  const existing = await getUserByEmail(invite.email);

  if (!existing && input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(
      "WEAK_PASSWORD",
      `La contrasena debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
    );
  }

  // Cuenta existente: su contrasena actual es la prueba de identidad, asi que este
  // endpoint verifica contrasenas y hay que limitarlo igual que signIn, con la misma
  // clave, para que los dos contadores sean el mismo cubo.
  if (existing) {
    const rateLimitKey = passwordAttemptKey(input.ip, invite.email);
    assertNotRateLimited(rateLimitKey);

    // Sin contrasena no hay forma de probar identidad: una cuenta heredada de OAuth
    // no puede aceptar invitaciones. Decirlo explicitamente evita que la persona
    // reintente sin fin creyendo que se equivoca de contrasena.
    if (!existing.passwordHash) {
      throw new AuthError(
        "NO_PASSWORD_SET",
        "Esa cuenta no tiene contrasena configurada y no puede aceptar invitaciones. Contacta con quien administra la plataforma."
      );
    }
    if (!(await verifyPassword(existing.passwordHash, input.password))) {
      recordFailedAttempt(rateLimitKey);
      throw new AuthError(
        "INVALID_CREDENTIALS",
        "La contrasena no es correcta."
      );
    }
    clearAttempts(rateLimitKey);
  }

  // El hash se calcula ANTES de la transaccion a proposito: argon2id es caro por
  // diseno (~100 ms de CPU) y hacerlo dentro retendria una conexion del pool todo
  // ese tiempo en cada aceptacion. Preferimos desperdiciarlo en la carrera perdida,
  // que es rara, antes que penalizar el caso normal.
  const passwordHash = existing ? null : await hashPassword(input.password);

  let user: User;
  try {
    user = await db.transaction(async tx => {
      // Cierre condicional: si dos pestanas aceptan a la vez, solo una avanza.
      const closed = await tx
        .update(invitations)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(
          and(eq(invitations.id, invite.id), eq(invitations.status, "active"))
        );
      if (closed[0].affectedRows === 0) {
        throw new AuthError(
          "INVALID_CREDENTIALS",
          "Esta invitacion ya no esta disponible."
        );
      }

      let userId: number;
      if (existing) {
        userId = existing.id;

        // Dentro de la transaccion, no antes: dos administradores pueden haber
        // invitado a la vez al mismo correo y dejar dos invitaciones activas.
        // Comprobarlo fuera dejaba abierta la ventana entre leer e insertar.
        const yaMiembro = (
          await tx
            .select()
            .from(appProfiles)
            .where(
              and(
                eq(appProfiles.userId, userId),
                eq(appProfiles.companyId, invite.companyId)
              )
            )
            .limit(1)
        )[0];
        if (yaMiembro) {
          throw new AuthError("EMAIL_TAKEN", "Ya perteneces a esta empresa.");
        }
      } else {
        const created = await tx.insert(users).values({
          openId: `local_${nanoid(21)}`,
          name: input.name?.trim() || invite.email.split("@")[0],
          email: invite.email,
          passwordHash,
          loginMethod: "password",
          role: "user",
        });
        userId = Number(created[0].insertId);
      }

      await tx.insert(appProfiles).values({
        userId,
        companyId: invite.companyId,
        role: invite.role,
        status: "active",
      });

      // La empresa recien aceptada pasa a ser la activa; sin esto, quien ya tenia
      // cuenta seguiria entrando a su empresa anterior y la invitacion no haria nada.
      await tx
        .update(users)
        .set({ activeCompanyId: invite.companyId })
        .where(eq(users.id, userId));

      const row = (
        await tx.select().from(users).where(eq(users.id, userId)).limit(1)
      )[0];
      if (!row) {
        throw new Error(
          "No se pudo leer el usuario tras aceptar la invitacion"
        );
      }
      return row;
    });
  } catch (error) {
    // Se acota por indice: una colision de correo y una de perfil son casos
    // distintos y merecen mensajes distintos. Antes una regex sin acotar
    // respondia a las dos con el texto del primero.
    if (isDuplicateKeyError(error, "users_email_idx")) {
      throw new AuthError(
        "EMAIL_TAKEN",
        "Esa cuenta acaba de crearse. Inicia sesion y vuelve a abrir el enlace."
      );
    }
    if (isDuplicateKeyError(error, "profiles_user_company_idx")) {
      throw new AuthError("EMAIL_TAKEN", "Ya perteneces a esta empresa.");
    }
    throw error;
  }

  await writeAudit({
    companyId: invite.companyId,
    userId: user.id,
    action: "invitation_accepted",
    module: AUDIT_MODULE,
    metadata: { email: invite.email, role: invite.role, newAccount: !existing },
  });

  return user;
}

// --------------------------------------------------------------- empresa activa

/** Cambia la empresa activa. Valida la pertenencia ANTES de escribir: sin esa
 *  comprobacion cualquiera se asignaria una empresa ajena y `assertCompanyScope` la
 *  daria por buena. */
export async function switchActiveCompany(
  userId: number,
  companyId: number
): Promise<void> {
  const db = await requireDb();
  const profile = (
    await db
      .select()
      .from(appProfiles)
      .where(
        and(
          eq(appProfiles.userId, userId),
          eq(appProfiles.companyId, companyId),
          // Activo, no solo existente: si no, un perfil suspendido seguiria
          // sirviendo para volver a esa empresa con su rol de antes.
          eq(appProfiles.status, "active")
        )
      )
      .limit(1)
  )[0];
  if (!profile) {
    throw new AuthError("NOT_A_MEMBER", "No perteneces a esa empresa.");
  }
  await db
    .update(users)
    .set({ activeCompanyId: companyId })
    .where(eq(users.id, userId));
}

// ------------------------------------------ contacto de soporte del portal

/** Contacto de soporte que el portal publica a los candidatos.
 *
 *  Lectura tolerante (`getDb`, no `requireDb`): sin base, la tarjeta de Contrataciones se
 *  pinta vacia en vez de tumbar la pagina entera. La escritura de abajo si exige conexion:
 *  un "Guardado" que no guardo nada es peor que un error.
 *
 *  `companies` es la unica tabla donde su propio `id` ES la clave de tenant: no hay una
 *  columna `companyId` que anadir al WHERE como defensa en profundidad. El
 *  `eq(companies.id, companyId)` ya es el filtro multi-tenant completo. */
export async function getCompanyContact(companyId: number) {
  const db = await getDb();
  if (!db) return null;
  const row = (
    await db
      .select({
        id: companies.id,
        candidateSupportEmail: companies.candidateSupportEmail,
        candidateSupportPhone: companies.candidateSupportPhone,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1)
  )[0];
  return row ?? null;
}

/** Guarda el contacto de soporte y devuelve la entidad releida.
 *
 *  Cadena vacia -> null antes de escribir: el portal distingue "sin configurar" (oculta la
 *  linea) de un valor real, y guardar "" dejaria un `mailto:` roto en la pantalla del
 *  candidato.
 *
 *  El telefono es texto libre a proposito -- el formato colombiano admite indicativo,
 *  extension y lineas 01 8000 -- y el `href` del `tel:` se deriva de este mismo texto con
 *  `telHref` (shared/contacto.ts), asi que el numero que se lee y el que se marca no
 *  pueden divergir. */
export async function updateCompanyContact(
  companyId: number,
  input: { candidateSupportEmail: string | null; candidateSupportPhone: string | null },
  userId?: number
) {
  const db = await requireDb();
  const candidateSupportEmail = input.candidateSupportEmail?.trim() || null;
  const candidateSupportPhone = input.candidateSupportPhone?.trim() || null;
  await db
    .update(companies)
    .set({ candidateSupportEmail, candidateSupportPhone, updatedAt: new Date() })
    .where(eq(companies.id, companyId));
  await writeAudit({
    companyId,
    userId,
    action: "company_contact_updated",
    module: AUDIT_MODULE,
    metadata: { candidateSupportEmail, candidateSupportPhone },
  });
  return getCompanyContact(companyId);
}
