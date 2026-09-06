import { COOKIE_NAME } from "@shared/const";
import { AuthError, MIN_PASSWORD_LENGTH, SESSION_TTL_MS, changePassword, passwordAttemptKey, signIn, signSession, signUp, toPublicUser } from "./auth";
import { acceptInvite, getInvitePreview, inviteUser, switchActiveCompany } from "./orgDomain";
import type { TrpcContext } from "./_core/context";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDashboardForRole, assertCanGrantRole, assertCompanyScope, assertRole, INVITABLE_ROLES } from "./authorization";
import { getAppProfile, listCompanies, listMemberships, listDepartmentsByCompany, listEmployeesByCompany, listKnowledgeByCompany, listRecruitmentByCompany } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { demoHRAssistant } from "./aiDemo";
import { analyzeHiringDocuments, askPeopleAi, availableAiModels, getHiringAiSummary, listAiConversations, listAiFindings, listAiInsights, listAiRuns, reviewAiFinding, updateAiInsight } from "./aiDomain";
import { MAX_FILE_BYTES, assignDefaultTemplate, assignTemplateToPosition, createHiring, createPosition, createTemplate, deleteHiring, deletePosition, deleteTemplate, generateLink, getDashboardStats, getDocumentUrl, getHiringDetail, getLinkState, getMasterStandardTemplate, getPortal, getPortalDocumentUrl, listActivities, listCommunications, listHiring, listPositions, listTemplates, listNotifications, removePortalDocument, revokeLink, prepareCandidateEmail, prepareCandidateReminder, markCommunicationSent, downloadHiringZip, listExpiringLinks, requestCandidateOtp, submitPortal, updateHiringDeadline, updateMasterStandardTemplate, updateTemplateName, verifyCandidateOtp, updateRequirement, updateTemplate, uploadPortalDocument } from "./hrDomain";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";


const roleSchema = z.enum(["SUPER_ADMIN", "COMPANY_ADMIN", "HR", "FINANCE", "MANAGER", "EMPLOYEE"]);

async function resolveAccess(user: { id: number; role: string; activeCompanyId: number | null }) {
  // Empresa seleccionada, si la hay y el perfil sigue existiendo. Con activeCompanyId
  // nulo -el estado de todo usuario que nunca ha cambiado de empresa- esto se salta
  // y el comportamiento es identico al historico: el perfil mas antiguo.
  if (user.activeCompanyId != null) {
    const active = await getAppProfile(user.id, user.activeCompanyId);
    if (active) return { role: active.role, companyId: active.companyId } as const;
  }
  const profile = await getAppProfile(user.id);
  if (profile) return { role: profile.role, companyId: profile.companyId } as const;
  if (user.role === "admin") return { role: "SUPER_ADMIN" as const, companyId: null };
  throw new TRPCError({ code: "FORBIDDEN", message: "Tu cuenta aún no tiene un perfil empresarial activo." });
}

const AUTH_ERROR_STATUS: Record<AuthError["code"], TRPCError["code"]> = {
  INVALID_CREDENTIALS: "UNAUTHORIZED",
  EMAIL_TAKEN: "CONFLICT",
  COMPANY_TAKEN: "CONFLICT",
  RATE_LIMITED: "TOO_MANY_REQUESTS",
  WEAK_PASSWORD: "BAD_REQUEST",
  NO_PASSWORD_SET: "BAD_REQUEST",
  // No pertenecer a una empresa es un fallo de autorizacion, no de autenticacion.
  NOT_A_MEMBER: "FORBIDDEN",
};

/** Traduce los errores de dominio de `auth.ts` a codigos tRPC. El modulo de auth
 *  no conoce tRPC; esta es la unica frontera donde se cruzan.
 *
 *  Cualquier otro error se registra en el servidor y se sustituye por un mensaje
 *  generico: tRPC devuelve `message` al cliente incluso en produccion, y estas
 *  procedures son publicas, asi que un fallo de base de datos filtraria la consulta
 *  y los nombres de las columnas a quien no ha iniciado sesion. */
async function toTrpc<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) {
      throw new TRPCError({ code: AUTH_ERROR_STATUS[error.code], message: error.message });
    }
    console.error("[Auth] Error inesperado:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "No fue posible completar la operacion. Intentalo de nuevo mas tarde.",
    });
  }
}

/** Emite la cookie de sesion tras un alta o un inicio de sesion correctos. */
async function issueSession(
  ctx: Pick<TrpcContext, "req" | "res">,
  openId: string,
  sessionVersion: number
): Promise<void> {
  const token = await signSession({ openId, sessionVersion });
  const cookieOptions = getSessionCookieOptions(ctx.req);
  ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => (opts.ctx.user ? toPublicUser(opts.ctx.user) : null)),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    signUp: publicProcedure
      .input(z.object({
        // `.trim()` antes de validar: un correo pegado con espacios es habitual y
        // seria rechazado como invalido pese a que auth.ts lo normaliza despues.
        email: z.string().trim().email("Correo invalido").max(320),
        password: z.string().min(MIN_PASSWORD_LENGTH, `Minimo ${MIN_PASSWORD_LENGTH} caracteres`).max(200),
        name: z.string().trim().min(1, "El nombre es obligatorio").max(160),
        companyName: z.string().trim().min(1, "El nombre de la empresa es obligatorio").max(160),
      }))
      .mutation(async ({ ctx, input }) => {
        const { user, companyId } = await toTrpc(() => signUp(input));
        await issueSession(ctx, user.openId, user.sessionVersion);
        return { user: toPublicUser(user), companyId } as const;
      }),
    signIn: publicProcedure
      .input(z.object({
        // `.trim()` antes de validar: un correo pegado con espacios es habitual y
        // seria rechazado como invalido pese a que auth.ts lo normaliza despues.
        email: z.string().trim().email("Correo invalido").max(320),
        password: z.string().min(1, "La contrasena es obligatoria").max(200),
      }))
      .mutation(async ({ ctx, input }) => {
        // El limite de intentos combina IP y correo para que un atacante no agote
        // la cuenta de un tercero solo repitiendo su correo desde otra red.
        const rateLimitKey = passwordAttemptKey(ctx.req.ip, input.email);
        const { user } = await toTrpc(() => signIn({ ...input, rateLimitKey }));
        await issueSession(ctx, user.openId, user.sessionVersion);
        return { user: toPublicUser(user) } as const;
      }),
    invitePreview: publicProcedure
      .input(z.object({ token: z.string().min(20).max(200) }))
      .query(({ input }) => toTrpc(() => getInvitePreview(input.token))),
    acceptInvite: publicProcedure
      .input(z.object({
        token: z.string().min(20).max(200),
        password: z.string().min(1).max(200),
        // Solo se usa al crear la cuenta; si ya existe se conserva su nombre.
        name: z.string().trim().max(160).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // El limitador vive dentro de acceptInvite, donde ya se conoce el correo de
        // la invitacion: la clave debe ser la misma que la de signIn. Derivarla del
        // token permitia reiniciar el contador con solo regenerar la invitacion.
        const user = await toTrpc(() => acceptInvite({ ...input, ip: ctx.req.ip }));
        await issueSession(ctx, user.openId, user.sessionVersion);
        return { user: toPublicUser(user) } as const;
      }),
    changePassword: protectedProcedure
      .input(z.object({
        currentPassword: z.string().min(1).max(200),
        newPassword: z.string().min(MIN_PASSWORD_LENGTH, `Minimo ${MIN_PASSWORD_LENGTH} caracteres`).max(200),
      }))
      .mutation(async ({ ctx, input }) => {
        await toTrpc(() => changePassword({ userId: ctx.user.id, ...input }));
        // La sesion actual acaba de quedar invalidada por el nuevo sessionVersion.
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
        return { success: true } as const;
      }),
  }),
  access: router({
    me: protectedProcedure.query(async ({ ctx }) => {
      // Independientes entre si: una depende de activeCompanyId y la otra solo del id.
      const [access, memberships] = await Promise.all([
        resolveAccess(ctx.user),
        listMemberships(ctx.user.id),
      ]);
      return {
        ...access,
        dashboard: getDashboardForRole(access.role),
        roles: roleSchema.options,
        memberships,
        // Roles que este usuario puede conceder al invitar. El selector de la
        // interfaz se construye con esto; el servidor lo vuelve a verificar.
        invitableRoles: INVITABLE_ROLES[access.role] ?? [],
      };
    }),
  }),
  platform: router({
    companies: protectedProcedure.query(async ({ ctx }) => {
      const access = await resolveAccess(ctx.user);
      assertRole(access, ["SUPER_ADMIN"]);
      return listCompanies();
    }),
  }),
  hr: router({
    stats: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const access = await resolveAccess(ctx.user);
      assertRole(access, ["SUPER_ADMIN", "HR", "COMPANY_ADMIN"]);
      assertCompanyScope(access, input.companyId);
      return getDashboardStats(input.companyId);
    }),
    recruitment: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const access = await resolveAccess(ctx.user);
      assertRole(access, ["SUPER_ADMIN", "HR", "COMPANY_ADMIN"]);
      assertCompanyScope(access, input.companyId);
      return listRecruitmentByCompany(input.companyId);
    }),
    assistantPreview: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const access = await resolveAccess(ctx.user);
      assertRole(access, ["SUPER_ADMIN", "HR", "COMPANY_ADMIN"]);
      assertCompanyScope(access, input.companyId);
      return {
        model: "PEOPLE AI Assistant",
        content: "Puedes solicitar certificados laborales directamente desde el módulo de Talento Humano o verificar el estado de tus radicados oficiales en la plataforma.",
      };
    }),
    knowledge: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const access = await resolveAccess(ctx.user);
      assertRole(access, ["SUPER_ADMIN", "HR", "COMPANY_ADMIN"]);
      assertCompanyScope(access, input.companyId);
      return listKnowledgeByCompany(input.companyId);
    }),
  }),
  positions: router({
    list: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return listPositions(input.companyId); }),
    create: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), name: z.string().trim().min(2).max(160), description: z.string().max(1000).optional(), templateId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return createPosition(input.companyId, input.name, input.description, input.templateId, ctx.user.id); }),
    assignTemplate: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), positionId: z.number().int().positive(), templateId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return assignTemplateToPosition(input.companyId, input.positionId, input.templateId, ctx.user.id); }),
    delete: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), positionId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return deletePosition(input.companyId, input.positionId, ctx.user.id); }),
  }),
  templates: router({
    list: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return listTemplates(input.companyId); }),
    get: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), templateId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return (await import("./hrDomain")).getTemplate(input.companyId, input.templateId); }),
    create: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), positionId: z.number().int().positive().optional(), name: z.string().trim().min(2).max(180), items: z.array(z.object({ title: z.string().trim().min(2).max(180), description: z.string().max(500).optional(), required: z.boolean(), sortOrder: z.number().int().nonnegative(), allowedMimeTypes: z.string().max(300).optional() })).min(1) })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return createTemplate(input.companyId, input.name, input.items, input.positionId, ctx.user.id); }),
    update: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), templateId: z.number().int().positive(), items: z.array(z.object({ title: z.string().trim().min(2).max(180), description: z.string().max(500).optional(), required: z.boolean(), sortOrder: z.number().int().nonnegative(), allowedMimeTypes: z.string().max(300).optional() })) })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return updateTemplate(input.companyId, input.templateId, input.items, ctx.user.id); }),
    updateName: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), templateId: z.number().int().positive(), name: z.string().trim().min(2).max(180) })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return updateTemplateName(input.companyId, input.templateId, input.name, ctx.user.id); }),
    assignDefault: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), positionId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return assignDefaultTemplate(input.companyId, input.positionId, ctx.user.id); }),
    delete: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), templateId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return deleteTemplate(input.companyId, input.templateId, ctx.user.id); }),
    getMasterStandard: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return getMasterStandardTemplate(input.companyId); }),
    updateMasterStandard: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), items: z.array(z.object({ title: z.string().trim().min(2).max(180), description: z.string().max(500).optional(), required: z.boolean(), sortOrder: z.number().int().nonnegative(), allowedMimeTypes: z.string().max(300).optional() })), applyToAllPositions: z.boolean().default(true) })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return updateMasterStandardTemplate(input.companyId, input.items, input.applyToAllPositions, ctx.user.id); }),
  }),
  hiring: router({
    list: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return listHiring(input.companyId); }),
    detail: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return getHiringDetail(input.companyId, input.processId); }),
    create: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), fullName: z.string().trim().min(3).max(180), identificationNumber: z.string().trim().min(4).max(80), email: z.string().email(), positionId: z.number().int().positive(), templateId: z.number().int().positive(), documentDeadline: z.union([z.string(), z.date()]).nullish() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return createHiring(input.companyId, ctx.user.id, input); }),
    updateDeadline: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive(), documentDeadline: z.union([z.string(), z.date()]).nullish() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return updateHiringDeadline(input.companyId, input.processId, input.documentDeadline ?? null, ctx.user.id); }),
    generateLink: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return generateLink(input.companyId, input.processId, ctx.user.id); }),
    notifications: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return listNotifications(input.companyId, ctx.user.id); }),
    documentUrl: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive(), documentId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return getDocumentUrl(input.companyId, input.processId, input.documentId); }),
    updateRequirement: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive(), requirementId: z.number().int().positive(), title: z.string().trim().min(2).max(180).optional(), required: z.boolean().optional(), status: z.enum(["pending", "uploaded", "replaced", "removed", "verified"]).optional() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return updateRequirement(input.companyId, input.processId, input.requirementId, input, ctx.user.id); }),
    communications: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return listCommunications(input.companyId, input.processId); }),
    activities: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return listActivities(input.companyId, input.processId); }),
    linkState: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return getLinkState(input.companyId, input.processId); }),
    expiringLinks: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), withinHours: z.number().int().positive().max(168).default(24) })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return listExpiringLinks(input.companyId, input.withinHours); }),
    prepareEmail: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive(), portalUrl: z.string().url() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return prepareCandidateEmail(input.companyId, input.processId, ctx.user.id, input.portalUrl); }),
    prepareReminder: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive(), portalUrl: z.string().url() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return prepareCandidateReminder(input.companyId, input.processId, ctx.user.id, input.portalUrl); }),
    markCommunicationSent: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive(), type: z.enum(["initial", "reminder"]), portalUrl: z.string().url() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return markCommunicationSent(input.companyId, input.processId, ctx.user.id, input.type, input.portalUrl); }),
    revokeLink: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return revokeLink(input.companyId, input.processId, ctx.user.id); }),
    downloadZip: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return downloadHiringZip(input.companyId, input.processId, ctx.user.id); }),
    delete: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return deleteHiring(input.companyId, input.processId, ctx.user.id); }),
  }),
  candidatePortal: router({
    get: publicProcedure.input(z.object({ token: z.string().min(20).max(200) })).query(({ input }) => getPortal(input.token)),
    // Topes en el input, no solo en el dominio: esta procedure es publica y sin ellos
    // `base64` aceptaba cualquier longitud, asi que la unica barrera era el limite de
    // 20mb del body parser (_core/app.ts) y un anonimo podia obligar a Express a
    // bufferizar eso en cada peticion. 4/3 es el inflado del base64 sobre MAX_FILE_BYTES
    // y el margen cubre el padding, asi que el tope sigue a la constante si cambia. El
    // limite del body parser sigue haciendo falta: zod corre DESPUES de leer el cuerpo.
    // `mimeType` se acota a los 120 de su columna en drizzle/schema.ts.
    upload: publicProcedure.input(z.object({ token: z.string().min(20).max(200), requirementId: z.number().int().positive(), originalName: z.string().min(1).max(255), mimeType: z.string().min(1).max(120), base64: z.string().min(1).max(Math.ceil(MAX_FILE_BYTES / 3) * 4 + 16) })).mutation(({ input }) => uploadPortalDocument(input.token, input.requirementId, input.originalName, input.mimeType, Buffer.from(input.base64, "base64"))),
    submit: publicProcedure.input(z.object({ token: z.string().min(20).max(200) })).mutation(({ input }) => submitPortal(input.token)),
    remove: publicProcedure.input(z.object({ token: z.string().min(20).max(200), requirementId: z.number().int().positive() })).mutation(({ input }) => removePortalDocument(input.token, input.requirementId)),
    documentUrl: publicProcedure.input(z.object({ token: z.string().min(20).max(200), requirementId: z.number().int().positive() })).query(({ input }) => getPortalDocumentUrl(input.token, input.requirementId)),
    otpRequest: publicProcedure.input(z.object({ token: z.string().min(20).max(200) })).mutation(({ input }) => requestCandidateOtp(input.token)),
    otpVerify: publicProcedure.input(z.object({ token: z.string().min(20).max(200), code: z.string().regex(/^\d{6}$/) })).mutation(({ input }) => verifyCandidateOtp(input.token, input.code)),
  }),
  ai: router({
    models: protectedProcedure.query(async ({ ctx }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); return availableAiModels(); }),
    analyzeDocuments: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive(), mode: z.enum(["demo", "real"]).default("demo") })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return analyzeHiringDocuments(input.companyId, input.processId, ctx.user.id, input.mode); }),
    findings: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return listAiFindings(input.companyId, input.processId); }),
    runs: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return listAiRuns(input.companyId, input.processId); }),
    reviewFinding: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), findingId: z.number().int().positive(), status: z.enum(["confirmed", "corrected", "rejected"]), requirementId: z.number().int().positive().optional(), detectedType: z.string().trim().min(2).max(180).optional() })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return reviewAiFinding(input.companyId, input.findingId, ctx.user.id, input); }),
    insights: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), status: z.enum(["unread", "read", "reviewed", "resolved"]).optional() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return listAiInsights(input.companyId, input.status); }),
    updateInsight: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), insightId: z.number().int().positive(), status: z.enum(["read", "reviewed", "resolved"]) })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return updateAiInsight(input.companyId, input.insightId, ctx.user.id, input.status); }),
    ask: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), question: z.string().trim().min(2).max(2000), processId: z.number().int().positive().optional(), conversationId: z.number().int().positive().optional(), mode: z.enum(["demo", "real"]).default("demo") })).mutation(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return askPeopleAi({ ...input, userId: ctx.user.id, role: access.role }); }),
    conversations: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return listAiConversations(input.companyId, ctx.user.id); }),
    summary: protectedProcedure.input(z.object({ companyId: z.number().int().positive(), processId: z.number().int().positive(), mode: z.enum(["demo", "real"]).default("demo") })).query(async ({ ctx, input }) => { const access = await resolveAccess(ctx.user); assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]); assertCompanyScope(access, input.companyId); return getHiringAiSummary(input.companyId, input.processId, ctx.user.id, input.mode); }),
  }),
  company: router({
    departments: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const access = await resolveAccess(ctx.user);
      assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]);
      assertCompanyScope(access, input.companyId);
      return listDepartmentsByCompany(input.companyId);
    }),
    employees: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const access = await resolveAccess(ctx.user);
      assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR", "MANAGER"]);
      assertCompanyScope(access, input.companyId);
      return listEmployeesByCompany(input.companyId);
    }),
    invite: protectedProcedure.input(z.object({
      companyId: z.number().int().positive(),
      email: z.string().trim().email("Correo invalido").max(320),
      role: roleSchema,
    })).mutation(async ({ ctx, input }) => {
      const access = await resolveAccess(ctx.user);
      assertRole(access, ["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]);
      assertCompanyScope(access, input.companyId);
      // Techo de rol: impide que HR se fabrique un COMPANY_ADMIN.
      assertCanGrantRole(access, input.role);
      return toTrpc(() => inviteUser({ ...input, invitedByUserId: ctx.user.id }));
    }),
    setActive: protectedProcedure.input(z.object({ companyId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      // Sin assertCompanyScope a proposito: cambiar de empresa es justamente salir
      // del alcance actual. La pertenencia la valida switchActiveCompany.
      await toTrpc(() => switchActiveCompany(ctx.user.id, input.companyId));
      return { success: true } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;
