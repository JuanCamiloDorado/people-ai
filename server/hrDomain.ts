import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { aiConversationMessages, auditLogs, candidateAccessLinks, candidateDocuments, candidateProfiles, candidateOtpChallenges, companies, communicationLogs, companyCommunicationSettings, documentTemplateItems, documentTemplates, hiringProcesses, hiringRequirements, internalNotifications, jobPositions, processActivities } from "../drizzle/schema";
import { getDb } from "./db";
import { hashOpaqueToken, isTokenUsable } from "./tokens";
import { storageGetBytes, storageGetSignedUrl, storagePut } from "./storage";
import { prepareMailtoEmail } from "./emailService";
import { buildCandidateEmailText, candidateEmailSubject, formatDeadline } from "../shared/candidateEmail";
import JSZip from "jszip";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Tope del expediente completo, medido sobre el `sizeBytes` de la base antes de
 *  tocar el bucket. `downloadHiringZip` mantiene a la vez los N documentos, el ZIP y
 *  su base64 en la respuesta tRPC; con PDF y JPEG, que apenas comprimen, el pico
 *  ronda 3,3 veces la suma. 40 MB dejan ese pico en ~130 MB, holgado dentro de los
 *  512 MB del contenedor. Sin este tope un expediente grande provocaba un OOM que
 *  tumbaba el servicio para TODAS las empresas, no solo para quien pulso el boton. */
export const MAX_ZIP_BYTES = 40 * 1024 * 1024;
export const ALL_SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
export const ALLOWED_MIME_TYPES = ALL_SUPPORTED_MIME_TYPES;
export const MIME_EXTENSIONS: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.ms-excel": ["xls"],
};
/** Reexportado desde `./tokens`, compartido con las invitaciones de empresa. */
export const hashToken = hashOpaqueToken;
export const hashOtp = (code: string) => createHash("sha256").update(code).digest("hex");
export const isOtpUsable = (challenge: { invalidatedAt: Date | null; verifiedAt: Date | null; expiresAt: Date; attempts: number; maxAttempts: number }, now = Date.now()) => !challenge.invalidatedAt && !challenge.verifiedAt && challenge.expiresAt.getTime() >= now && challenge.attempts < challenge.maxAttempts;
export const isReminderAllowed = (lastSentAt: Date | null | undefined, cooldownHours: number, now = Date.now()) => !lastSentAt || lastSentAt.getTime() + Math.max(1, cooldownHours) * 3600000 <= now;
export const isExpiringWithin = (expiresAt: Date, withinHours: number, now = Date.now()) => expiresAt.getTime() >= now && expiresAt.getTime() <= now + Math.max(1, withinHours) * 3600000;
export const communicationAuditAction = (type: "initial" | "reminder", outcome: "sent" | "error" | "not_configured") => `candidate_${type}_${outcome}`;
export const isLinkUsable = isTokenUsable;
export const getMissingRequirements = (requirements: Array<{ required: boolean; status: string }>) => requirements.filter(req => req.required && !["uploaded", "replaced", "verified"].includes(req.status));
export const normalize = (title: string, original: string) => `${title.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, "").trim()}.${original.split(".").pop()?.toLowerCase() || "bin"}`;
export const hasMagicSignature = (bytes: Uint8Array, mimeType: string) => {
  if (mimeType === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  if (mimeType === "image/webp") {
    if (bytes.length < 12) return false;
    const riff = new TextDecoder().decode(bytes.slice(0, 4));
    const webp = new TextDecoder().decode(bytes.slice(8, 12));
    return riff === "RIFF" && webp === "WEBP";
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  }
  if (mimeType === "application/msword" || mimeType === "application/vnd.ms-excel") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0
    );
  }
  return false;
};
export const isValidUpload = (
  originalName: string,
  mimeType: string,
  sizeBytes: number,
  bytes?: Uint8Array,
  allowedMimeTypes?: string | string[] | Set<string>
) => {
  const extension = originalName.split(".").pop()?.toLowerCase() || "";
  if (allowedMimeTypes) {
    const allowedSet = typeof allowedMimeTypes === "string"
      ? new Set(allowedMimeTypes.split(",").map(s => s.trim().toLowerCase()))
      : allowedMimeTypes instanceof Set
      ? allowedMimeTypes
      : new Set(allowedMimeTypes.map(s => s.toLowerCase()));
    if (!allowedSet.has(mimeType.toLowerCase())) return false;
  }
  return (
    ALLOWED_MIME_TYPES.has(mimeType) &&
    Boolean(MIME_EXTENSIONS[mimeType]?.includes(extension)) &&
    sizeBytes <= MAX_FILE_BYTES &&
    (!bytes || hasMagicSignature(bytes, mimeType))
  );
};
async function audit(companyId: number, action: string, metadata: Record<string, unknown>, userId?: number) { const db = await getDb(); if (db) await db.insert(auditLogs).values({ companyId, userId, action, module: "hiring", result: "success", metadata: JSON.stringify(metadata) }); }
async function activity(companyId: number, processId: number, type: string, actorType: "analyst" | "candidate" | "system", actorUserId?: number, metadata: Record<string, unknown> = {}) { const db = await getDb(); if (db) await db.insert(processActivities).values({ companyId, processId, actorType, actorUserId, type, metadata: JSON.stringify(metadata) }); }
const escapeHtml = (value: string) => value.replace(/[&<>\"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;" })[char] || char);
export const buildCandidateEmail = (detail: NonNullable<Awaited<ReturnType<typeof getHiringDetail>>>, portalUrl: string, reminder = false) => {
  /* Los valores van en crudo y `escapeHtml` se aplica solo en cada interpolacion del HTML.
     Antes se escapaban una vez arriba y se reutilizaban tambien en el texto plano, asi que un
     candidato llamado "Ana & Jose" recibia "Ana &amp; Jose" en el cuerpo del correo.
     El texto sale de `shared/candidateEmail.ts`: es el mismo que pinta el preview del modal. */
  const candidate = detail.candidate?.fullName || "candidato";
  const position = detail.position?.name || "tu cargo";
  const company = detail.company?.name || "la empresa";
  const deadline = detail.process?.documentDeadline;
  const intro = reminder
    ? "Te recordamos que todavía tienes documentos pendientes de cargar para completar tu proceso de contratación."
    : `Nos encontramos adelantando tu proceso de contratación para el cargo de ${position}.`;
  const deadlineHtml = deadline ? `<p><strong>Fecha límite para cargar documentos:</strong> ${escapeHtml(formatDeadline(deadline))}</p>` : "";
  return {
    subject: candidateEmailSubject(reminder),
    text: buildCandidateEmailText({ candidateName: candidate, positionName: position, documentDeadline: deadline, portalUrl, reminder }),
    html: `<p>Hola ${escapeHtml(candidate)},</p><p>${escapeHtml(intro)}</p>${deadlineHtml}<p>Empresa: ${escapeHtml(company)}</p><p><a href="${escapeHtml(portalUrl)}">Completar documentación</a></p><p>Gracias,<br>Equipo de Talento Humano.</p>`,
  };
};

export const DEFAULT_TEMPLATE_NAME = "Expediente de Ingreso Estándar";

export const DEFAULT_STANDARD_DOCUMENTS = [
  { title: "Cédula de Ciudadanía (150%)", description: "Copia legible por ambas caras en PDF o imagen", required: true, sortOrder: 1, allowedMimeTypes: "application/pdf,image/jpeg,image/png,image/webp" },
  { title: "Hoja de Vida Actualizada", description: "Formato PDF con datos de contacto", required: true, sortOrder: 2, allowedMimeTypes: "application/pdf" },
  { title: "Certificado de Afiliación EPS", description: "No mayor a 30 días de expedición", required: true, sortOrder: 3, allowedMimeTypes: "application/pdf,image/jpeg,image/png,image/webp" },
  { title: "Certificado de Fondo de Pensiones", description: "No mayor a 30 días de expedición", required: true, sortOrder: 4, allowedMimeTypes: "application/pdf,image/jpeg,image/png,image/webp" },
  { title: "Certificaciones Académicas", description: "Títulos profesionales, actas de grado y certificaciones", required: false, sortOrder: 5, allowedMimeTypes: "application/pdf,image/jpeg,image/png,image/webp" },
  { title: "Examen Médico de Ingreso", description: "Concepto de aptitud laboral emitido por IPS autorizada", required: true, sortOrder: 6, allowedMimeTypes: "application/pdf,image/jpeg,image/png,image/webp" },
];

export async function listPositions(companyId: number) {
  const db = await getDb();
  if (!db) return [];
  const positions = await db.select().from(jobPositions).where(and(eq(jobPositions.companyId, companyId), eq(jobPositions.status, "active"))).orderBy(asc(jobPositions.name));
  
  const allTemplates = await db.select().from(documentTemplates).where(and(eq(documentTemplates.companyId, companyId), eq(documentTemplates.status, "active")));
  const standardTemplate = allTemplates.find(t => t.name === DEFAULT_TEMPLATE_NAME);

  return positions.map(pos => {
    let resolvedTemplateId = pos.templateId;
    if (!resolvedTemplateId || !allTemplates.some(t => t.id === resolvedTemplateId)) {
      const matchByPosition = allTemplates.find(t => t.positionId === pos.id);
      if (matchByPosition) {
        resolvedTemplateId = matchByPosition.id;
      } else if (standardTemplate) {
        resolvedTemplateId = standardTemplate.id;
      }
    }
    return {
      ...pos,
      templateId: resolvedTemplateId ?? null,
    };
  });
}

export async function createPosition(companyId: number, name: string, description?: string, templateId?: number, userId?: number) {
  const db = await getDb();
  if (!db) return 999;
  
  let initialTemplateId = templateId;
  if (!initialTemplateId) {
    const standard = (await db.select().from(documentTemplates).where(and(
      eq(documentTemplates.companyId, companyId),
      eq(documentTemplates.name, DEFAULT_TEMPLATE_NAME),
      eq(documentTemplates.status, "active")
    )).limit(1))[0];
    if (standard) {
      initialTemplateId = standard.id;
    }
  }

  const result = await db.insert(jobPositions).values({
    companyId,
    name,
    description: description || null,
    templateId: initialTemplateId || null,
  });
  const id = Number(result[0].insertId);
  await audit(companyId, "job_position_created", { id, name, templateId: initialTemplateId }, userId);
  return id;
}

export async function assignTemplateToPosition(companyId: number, positionId: number, templateId: number, userId?: number) {
  const db = await getDb();
  if (!db) return { success: true, positionId, templateId };
  const position = (await db.select().from(jobPositions).where(and(eq(jobPositions.id, positionId), eq(jobPositions.companyId, companyId))).limit(1))[0];
  if (!position) throw new Error("Cargo no encontrado");
  
  const template = (await db.select().from(documentTemplates).where(and(eq(documentTemplates.id, templateId), eq(documentTemplates.companyId, companyId), eq(documentTemplates.status, "active"))).limit(1))[0];
  if (!template) throw new Error("Plantilla no encontrada");

  await db.update(jobPositions).set({ templateId, updatedAt: new Date() }).where(and(eq(jobPositions.companyId, companyId), eq(jobPositions.id, positionId)));
  await audit(companyId, "position_template_assigned", { positionId, templateId, templateName: template.name }, userId);
  return { success: true, positionId, templateId };
}

export async function deletePosition(companyId: number, positionId: number, userId?: number) {
  const db = await getDb();
  if (!db) return { success: true, id: positionId };
  const position = (await db.select().from(jobPositions).where(and(eq(jobPositions.id, positionId), eq(jobPositions.companyId, companyId))).limit(1))[0];
  if (!position) throw new Error("Cargo no encontrado");
  await db.update(jobPositions).set({ status: "archived", updatedAt: new Date() }).where(and(eq(jobPositions.companyId, companyId), eq(jobPositions.id, positionId)));
  await audit(companyId, "job_position_deleted", { positionId, name: position.name }, userId);
  return { success: true, id: positionId };
}
export async function listTemplates(companyId: number) { const db = await getDb(); if (!db) return []; return db.select().from(documentTemplates).where(and(eq(documentTemplates.companyId, companyId), eq(documentTemplates.status, "active"))).orderBy(desc(documentTemplates.updatedAt)); }
export async function getTemplate(companyId: number, templateId: number) { const db = await getDb(); if (!db) return null; const template = (await db.select().from(documentTemplates).where(and(eq(documentTemplates.companyId, companyId), eq(documentTemplates.id, templateId))).limit(1))[0]; if (!template) return null; const items = await db.select().from(documentTemplateItems).where(and(eq(documentTemplateItems.companyId, companyId), eq(documentTemplateItems.templateId, templateId))).orderBy(asc(documentTemplateItems.sortOrder)); return { ...template, items }; }
export async function createTemplate(companyId: number, name: string, items: Array<{ title: string; description?: string; required: boolean; sortOrder: number; allowedMimeTypes?: string }>, positionId?: number, userId?: number) {
  const db = await getDb();
  if (!db) {
    return {
      id: 999,
      companyId,
      positionId: positionId || null,
      name,
      status: "active" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: items.map((it, idx) => ({
        id: idx + 1,
        companyId,
        templateId: 999,
        title: it.title,
        description: it.description || null,
        required: it.required,
        sortOrder: it.sortOrder,
        allowedMimeTypes: it.allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp",
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    };
  }
  const result = await db.insert(documentTemplates).values({ companyId, positionId: positionId || null, name });
  const templateId = Number(result[0].insertId);
  if (items.length) {
    await db.insert(documentTemplateItems).values(items.map(item => ({
      ...item,
      allowedMimeTypes: item.allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp",
      companyId,
      templateId,
    })));
  }
  if (positionId) {
    await db.update(jobPositions).set({ templateId, updatedAt: new Date() }).where(and(eq(jobPositions.companyId, companyId), eq(jobPositions.id, positionId)));
  }
  await audit(companyId, "document_template_created", { templateId, positionId, name }, userId);
  return getTemplate(companyId, templateId);
}
export async function syncActiveProcessesWithTemplate(
  companyId: number,
  templateId: number,
  items: Array<{ title: string; description?: string; required: boolean; sortOrder: number; allowedMimeTypes?: string }>
) {
  const db = await getDb();
  if (!db) return;
  const activeProcesses = await db.select().from(hiringProcesses).where(and(
    eq(hiringProcesses.companyId, companyId),
    eq(hiringProcesses.templateId, templateId),
    inArray(hiringProcesses.status, ["draft", "pending", "in_progress"])
  ));
  for (const proc of activeProcesses) {
    const reqs = await db.select().from(hiringRequirements).where(and(
      eq(hiringRequirements.companyId, companyId),
      eq(hiringRequirements.processId, proc.id)
    ));
    for (const req of reqs) {
      const match = items.find(i => i.title && i.title.trim().toLowerCase() === req.title.trim().toLowerCase())
        || items.find(i => i.sortOrder === req.sortOrder);
      if (match) {
        await db.update(hiringRequirements).set({
          allowedMimeTypes: match.allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp",
          description: match.description || null,
          required: match.required,
        }).where(and(
          eq(hiringRequirements.companyId, companyId),
          eq(hiringRequirements.id, req.id)
        ));
      }
    }
  }
}

export async function updateTemplate(companyId: number, templateId: number, items: Array<{ title: string; description?: string; required: boolean; sortOrder: number; allowedMimeTypes?: string }>, userId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const template = await getTemplate(companyId, templateId);
  if (!template) throw new Error("Template not found");
  await db.delete(documentTemplateItems).where(and(eq(documentTemplateItems.companyId, companyId), eq(documentTemplateItems.templateId, templateId)));
  if (items.length) {
    await db.insert(documentTemplateItems).values(items.map(item => ({
      ...item,
      allowedMimeTypes: item.allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp",
      companyId,
      templateId,
    })));
  }
  await syncActiveProcessesWithTemplate(companyId, templateId, items);
  await audit(companyId, "document_template_updated", { templateId }, userId);
  return getTemplate(companyId, templateId);
}
export async function getMasterStandardTemplate(companyId: number) {
  const db = await getDb();
  if (!db) return { items: DEFAULT_STANDARD_DOCUMENTS };
  
  const standardTemplate = (await db.select().from(documentTemplates).where(and(
    eq(documentTemplates.companyId, companyId),
    eq(documentTemplates.name, DEFAULT_TEMPLATE_NAME),
    eq(documentTemplates.status, "active")
  )).orderBy(asc(documentTemplates.positionId), desc(documentTemplates.updatedAt)).limit(1))[0];

  if (!standardTemplate) {
    return { items: DEFAULT_STANDARD_DOCUMENTS };
  }

  const items = await db.select().from(documentTemplateItems).where(and(
    eq(documentTemplateItems.companyId, companyId),
    eq(documentTemplateItems.templateId, standardTemplate.id)
  )).orderBy(asc(documentTemplateItems.sortOrder));

  return {
    items: items.length > 0 ? items.map((i) => ({
      title: i.title,
      description: i.description || undefined,
      required: i.required,
      sortOrder: i.sortOrder,
      allowedMimeTypes: i.allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp",
    })) : DEFAULT_STANDARD_DOCUMENTS
  };
}

export async function updateMasterStandardTemplate(
  companyId: number,
  items: Array<{ title: string; description?: string; required: boolean; sortOrder: number; allowedMimeTypes?: string }>,
  applyToAllPositions = true,
  userId?: number
) {
  const db = await getDb();
  if (!db) {
    return {
      items: items.map((item, idx) => ({
        ...item,
        sortOrder: idx + 1,
        allowedMimeTypes: item.allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp",
      })),
    };
  }

  const standardTemplates = await db.select().from(documentTemplates).where(and(
    eq(documentTemplates.companyId, companyId),
    eq(documentTemplates.name, DEFAULT_TEMPLATE_NAME),
    eq(documentTemplates.status, "active")
  )).orderBy(asc(documentTemplates.positionId), desc(documentTemplates.updatedAt));

  if (standardTemplates.length > 0) {
    const targetTemplates = applyToAllPositions ? standardTemplates : [standardTemplates[0]];
    for (const t of targetTemplates) {
      await db.delete(documentTemplateItems).where(and(
        eq(documentTemplateItems.companyId, companyId),
        eq(documentTemplateItems.templateId, t.id)
      ));
      if (items.length) {
        await db.insert(documentTemplateItems).values(
          items.map((item, idx) => ({
            ...item,
            sortOrder: idx + 1,
            allowedMimeTypes: item.allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp",
            companyId,
            templateId: t.id,
          }))
        );
      }
      await db.update(documentTemplates).set({ updatedAt: new Date() }).where(eq(documentTemplates.id, t.id));
      await syncActiveProcessesWithTemplate(companyId, t.id, items);
    }
  } else {
    const res = await db.insert(documentTemplates).values({
      companyId,
      positionId: null,
      name: DEFAULT_TEMPLATE_NAME,
      status: "active"
    });
    const tId = Number(res[0].insertId);
    if (items.length) {
      await db.insert(documentTemplateItems).values(
        items.map((item, idx) => ({
          ...item,
          sortOrder: idx + 1,
          allowedMimeTypes: item.allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp",
          companyId,
          templateId: tId,
        }))
      );
    }
    await syncActiveProcessesWithTemplate(companyId, tId, items);
  }

  await audit(companyId, "master_standard_template_updated", { count: items.length, applyToAllPositions }, userId);
  return getMasterStandardTemplate(companyId);
}

export async function assignDefaultTemplate(companyId: number, positionId: number, userId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const position = (await db.select().from(jobPositions).where(and(eq(jobPositions.id, positionId), eq(jobPositions.companyId, companyId))).limit(1))[0];
  if (!position) throw new Error("Cargo no encontrado");

  const master = await getMasterStandardTemplate(companyId);
  const itemsToAssign = master.items.length > 0 ? master.items : DEFAULT_STANDARD_DOCUMENTS;

  let template = (await db.select().from(documentTemplates).where(and(
    eq(documentTemplates.companyId, companyId),
    eq(documentTemplates.name, DEFAULT_TEMPLATE_NAME),
    eq(documentTemplates.status, "active")
  )).limit(1))[0];

  if (!template) {
    const result = await db.insert(documentTemplates).values({
      companyId,
      positionId: null,
      name: DEFAULT_TEMPLATE_NAME,
      status: "active"
    });
    const templateId = Number(result[0].insertId);
    await db.insert(documentTemplateItems).values(
      itemsToAssign.map((item, idx) => ({
        ...item,
        allowedMimeTypes: (item as any).allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp",
        sortOrder: idx + 1,
        companyId,
        templateId,
      }))
    );
    template = (await db.select().from(documentTemplates).where(eq(documentTemplates.id, templateId)).limit(1))[0];
  }

  await db.update(jobPositions).set({ templateId: template.id, updatedAt: new Date() }).where(and(eq(jobPositions.companyId, companyId), eq(jobPositions.id, positionId)));
  await audit(companyId, "document_template_default_assigned", { templateId: template.id, positionId }, userId);
  return getTemplate(companyId, template.id);
}
export async function updateTemplateName(companyId: number, templateId: number, name: string, userId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(documentTemplates).set({ name, updatedAt: new Date() }).where(and(eq(documentTemplates.companyId, companyId), eq(documentTemplates.id, templateId)));
  await audit(companyId, "document_template_name_updated", { templateId, name }, userId);
  return getTemplate(companyId, templateId);
}
export async function deleteTemplate(companyId: number, templateId: number, userId?: number) {
  const db = await getDb();
  if (!db) return { success: true, id: templateId };
  const template = await getTemplate(companyId, templateId);
  if (!template) throw new Error("Plantilla no encontrada");
  if (template.name === DEFAULT_TEMPLATE_NAME) {
    throw new Error("No se puede eliminar la plantilla estándar principal de la empresa");
  }
  await db.update(documentTemplates).set({ status: "archived", updatedAt: new Date() }).where(and(eq(documentTemplates.companyId, companyId), eq(documentTemplates.id, templateId)));
  
  const standardTemplate = (await db.select().from(documentTemplates).where(and(
    eq(documentTemplates.companyId, companyId),
    eq(documentTemplates.name, DEFAULT_TEMPLATE_NAME),
    eq(documentTemplates.status, "active")
  )).limit(1))[0];

  if (standardTemplate) {
    await db.update(jobPositions).set({ templateId: standardTemplate.id, updatedAt: new Date() }).where(and(
      eq(jobPositions.companyId, companyId),
      eq(jobPositions.templateId, templateId)
    ));
  }

  await audit(companyId, "document_template_deleted", { templateId, name: template.name }, userId);
  return { success: true, id: templateId };
}
export async function listHiring(companyId: number) { const db = await getDb(); if (!db) return []; const processes = await db.select().from(hiringProcesses).where(eq(hiringProcesses.companyId, companyId)).orderBy(desc(hiringProcesses.createdAt)); return Promise.all(processes.map(async process => { const detail = await getHiringDetail(companyId, process.id); return { ...process, candidateName: detail?.candidate?.fullName || "Candidato", positionName: detail?.position?.name || "Cargo", requiredCount: detail?.requirements.filter(r => r.required).length || 0, receivedCount: detail?.requirements.filter(r => ["uploaded", "replaced", "verified"].includes(r.status)).length || 0 }; })); }
export async function createHiring(companyId: number, userId: number, input: { fullName: string; identificationNumber: string; email: string; positionId: number; templateId: number; documentDeadline?: Date | string | null }) {
  const db = await getDb();
  const deadlineDate = input.documentDeadline ? new Date(input.documentDeadline) : null;
  if (!db) {
    return {
      process: { id: 999, companyId, candidateId: 888, positionId: input.positionId, templateId: input.templateId, createdByUserId: userId, status: "pending" as const, documentDeadline: deadlineDate, createdAt: new Date(), updatedAt: new Date() },
      candidate: { id: 888, companyId, fullName: input.fullName, identificationNumber: input.identificationNumber, email: input.email, createdAt: new Date() },
      position: { id: input.positionId, companyId, templateId: input.templateId, name: "Cargo", description: null, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
      company: { id: companyId, name: "Empresa", legalName: "Empresa S.A.S.", logo: null, industry: null, country: "Colombia", city: null, timezone: "America/Bogota", status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
      requirements: [],
      documents: [],
    };
  }
  const template = await getTemplate(companyId, input.templateId);
  if (!template || template.companyId !== companyId) throw new Error("Plantilla no encontrada");
  const position = (await db.select().from(jobPositions).where(and(eq(jobPositions.id, input.positionId), eq(jobPositions.companyId, companyId))).limit(1))[0];
  if (!position) throw new Error("Cargo no encontrado");
  const candidateResult = await db.insert(candidateProfiles).values({ companyId, fullName: input.fullName, identificationNumber: input.identificationNumber, email: input.email });
  const candidateId = Number(candidateResult[0].insertId);
  const processResult = await db.insert(hiringProcesses).values({ companyId, candidateId, positionId: input.positionId, templateId: input.templateId, createdByUserId: userId, status: "pending", documentDeadline: deadlineDate });
  const processId = Number(processResult[0].insertId);
  await db.insert(hiringRequirements).values(template.items.map(item => ({
    companyId,
    processId,
    sourceTemplateItemId: item.id,
    title: item.title,
    description: item.description,
    required: item.required,
    sortOrder: item.sortOrder,
    allowedMimeTypes: item.allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp",
  })));
  await audit(companyId, "hiring_process_created", { processId, candidateId, documentDeadline: deadlineDate }, userId);
  return getHiringDetail(companyId, processId);
}
export async function updateHiringDeadline(companyId: number, processId: number, deadline: Date | string | null, userId?: number) {
  const db = await getDb();
  const deadlineDate = deadline ? new Date(deadline) : null;
  if (!db) {
    return {
      process: { id: processId, companyId, candidateId: 888, positionId: 1, templateId: 1, createdByUserId: userId || 1, status: "pending" as const, documentDeadline: deadlineDate, createdAt: new Date(), updatedAt: new Date() },
      candidate: null,
      position: null,
      company: null,
      requirements: [],
      documents: [],
    };
  }
  await db.update(hiringProcesses).set({ documentDeadline: deadlineDate }).where(and(eq(hiringProcesses.companyId, companyId), eq(hiringProcesses.id, processId)));
  await audit(companyId, "hiring_process_deadline_updated", { processId, documentDeadline: deadlineDate }, userId);
  return getHiringDetail(companyId, processId);
}
export async function getHiringDetail(companyId: number, processId: number) {
  const db = await getDb();
  if (!db) return null;
  const process = (await db.select().from(hiringProcesses).where(and(eq(hiringProcesses.companyId, companyId), eq(hiringProcesses.id, processId))).limit(1))[0];
  if (!process) return null;
  const candidate = (await db.select().from(candidateProfiles).where(and(eq(candidateProfiles.companyId, companyId), eq(candidateProfiles.id, process.candidateId))).limit(1))[0];
  const position = (await db.select().from(jobPositions).where(and(eq(jobPositions.companyId, companyId), eq(jobPositions.id, process.positionId))).limit(1))[0];
  const company = (await db.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
  const requirements = await db.select().from(hiringRequirements).where(and(eq(hiringRequirements.companyId, companyId), eq(hiringRequirements.processId, processId))).orderBy(asc(hiringRequirements.sortOrder));
  const documents = await db.select().from(candidateDocuments).where(and(eq(candidateDocuments.companyId, companyId), eq(candidateDocuments.processId, processId), eq(candidateDocuments.status, "active")));

  // Si el proceso de contratacion esta activo (candidato en fase de carga), sincronizamos requisitos con la plantilla vigente
  if (requirements.length > 0 && process.templateId && ["draft", "pending", "in_progress"].includes(process.status)) {
    let templateItems = await db.select().from(documentTemplateItems).where(and(
      eq(documentTemplateItems.companyId, companyId),
      eq(documentTemplateItems.templateId, process.templateId)
    )).orderBy(asc(documentTemplateItems.sortOrder));

    if (templateItems.length === 0) {
      const master = await getMasterStandardTemplate(companyId);
      if (master?.items?.length) {
        templateItems = master.items as any;
      }
    }

    if (templateItems.length > 0) {
      for (const req of requirements) {
        const match = templateItems.find((t: any) => t.id && t.id === req.sourceTemplateItemId)
          || templateItems.find((t: any) => t.title && t.title.trim().toLowerCase() === req.title.trim().toLowerCase())
          || templateItems.find((t: any) => t.sortOrder === req.sortOrder);
        if (match) {
          const targetMime = match.allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp";
          const targetDesc = match.description || null;
          if (req.allowedMimeTypes !== targetMime || (req.description || null) !== targetDesc) {
            await db.update(hiringRequirements).set({
              allowedMimeTypes: targetMime,
              description: targetDesc,
            }).where(and(
              eq(hiringRequirements.companyId, companyId),
              eq(hiringRequirements.id, req.id)
            ));
            req.allowedMimeTypes = targetMime;
            req.description = targetDesc;
          }
        }
      }
    }
  }

  return { process, candidate, position, company, requirements, documents };
}
export async function updateRequirement(companyId: number, processId: number, requirementId: number, patch: { title?: string; required?: boolean; status?: "pending" | "uploaded" | "replaced" | "removed" | "verified" }, userId?: number) { const db = await getDb(); if (!db) throw new Error("Database unavailable"); await db.update(hiringRequirements).set(patch).where(and(eq(hiringRequirements.companyId, companyId), eq(hiringRequirements.processId, processId), eq(hiringRequirements.id, requirementId))); await audit(companyId, "hiring_requirement_updated", { processId, requirementId }, userId); return getHiringDetail(companyId, processId); }
/** Genera un enlace nuevo para el candidato y revoca el anterior.
 *
 *  Devuelve `linkId` ademas del token porque el token en crudo existe una sola vez
 *  (tokens.ts solo persiste el hash) y el cliente lo guarda para no tener que
 *  regenerar -- y revocar el que ya envio -- cada vez que recarga la pagina. Sin ese
 *  id no podria saber si lo que guardo pertenece al enlace vigente o a uno anterior,
 *  y acabaria ofreciendo para copiar una URL ya muerta. */
export async function generateLink(companyId: number, processId: number, userId?: number) { const db = await getDb(); if (!db) throw new Error("Database unavailable"); const detail = await getHiringDetail(companyId, processId); if (!detail) throw new Error("Hiring process not found"); await db.update(candidateAccessLinks).set({ status: "revoked", revokedAt: new Date() }).where(and(eq(candidateAccessLinks.companyId, companyId), eq(candidateAccessLinks.processId, processId), eq(candidateAccessLinks.status, "active"))); const token = randomBytes(32).toString("base64url"); const expiresAt = new Date(Date.now() + 7 * 86400000); const [inserted] = await db.insert(candidateAccessLinks).values({ companyId, processId, candidateId: detail.process.candidateId, tokenHash: hashToken(token), expiresAt }); await audit(companyId, "candidate_link_generated", { processId }, userId); await activity(companyId, processId, "link_generated", "analyst", userId); return { token, expiresAt, linkId: inserted.insertId }; }
/** Resuelve el portal del candidato a partir de su token.
 *
 *  Lanza -- en vez de devolver null -- cuando no hay base de datos. Antes ambos casos
 *  colapsaban en el mismo `null`, y el cliente solo sabe pintar con eso "Este enlace ya
 *  no esta disponible": a un candidato con un enlace perfectamente vivo se le decia que
 *  habia expirado cada vez que la base no respondia, y ni el ni Talento Humano tenian
 *  como distinguirlo de una revocacion real. Con el throw, el portal cae en su rama de
 *  error ("No pudimos cargar la informacion", con reintento), que es la verdad.
 *
 *  El mensaje es neutro a proposito y por eso no se usa `requireDb()`: el suyo nombra
 *  DATABASE_URL y habla de "autenticar", y tRPC entrega `message` al cliente incluso en
 *  produccion -- esta procedure es publica y la lee un candidato. */
export async function getPortal(token: string, recordActivity = true) { const db = await getDb(); if (!db) throw new Error("No pudimos verificar el enlace en este momento. Intenta de nuevo en unos minutos."); const link = (await db.select().from(candidateAccessLinks).where(eq(candidateAccessLinks.tokenHash, hashToken(token))).limit(1))[0]; if (!link) return null; if (!isLinkUsable(link.status, link.expiresAt)) { if (link.status === "active" && link.expiresAt.getTime() < Date.now()) { await audit(link.companyId, "candidate_link_expired", { processId: link.processId, linkId: link.id }); await activity(link.companyId, link.processId, "link_expired", "system", undefined, { linkId: link.id }); } return null; } await db.update(candidateAccessLinks).set({ lastUsedAt: new Date() }).where(eq(candidateAccessLinks.id, link.id)); const detail = await getHiringDetail(link.companyId, link.processId); if (detail && recordActivity) { await activity(link.companyId, link.processId, "link_opened", "candidate"); await audit(link.companyId, "candidate_link_opened", { processId: link.processId, linkId: link.id }); } return detail ? { ...detail, linkId: link.id, expiresAt: link.expiresAt } : null; }
export async function uploadPortalDocument(token: string, requirementId: number, originalName: string, mimeType: string, bytes: Uint8Array) {
  const portal = await getPortal(token, false);
  if (!portal) throw new Error("Enlace no disponible");
  const requirement = portal.requirements.find(item => item.id === requirementId);
  if (!requirement) throw new Error("Requisito no encontrado");
  const allowedTypes = (requirement as any).allowedMimeTypes || "application/pdf,image/jpeg,image/png,image/webp";
  if (!isValidUpload(originalName, mimeType, bytes.byteLength, bytes, allowedTypes)) {
    throw new Error("Archivo inválido: formato no admitido para este requisito o tamaño no permitido");
  }
  const normalizedName = normalize(requirement.title, originalName);
  // Clave opaca: solo identificadores y azar, nunca el nombre del archivo. El nombre
  // normalizado conserva espacios y acentos (`Cedula de ciudadania.pdf`), legal en S3
  // pero fuente clasica de fallos de firma y codificacion entre proveedores. Lo que ve
  // el usuario al guardar lo fija `Content-Disposition`, que `storagePut` escribe en el
  // objeto con el cuarto argumento. La extension sale del nombre normalizado, que
  // `isValidUpload` ya comprobo contra el MIME declarado.
  const punto = normalizedName.lastIndexOf(".");
  const extension = punto === -1 ? "" : normalizedName.slice(punto);
  const key = `candidate-documents/${portal.process.companyId}/${portal.process.id}/${requirement.id}-${randomBytes(12).toString("hex")}${extension}`;
  // La columna existia desde el primer esquema y nunca se escribia. Los bytes ya estan
  // en memoria, asi que calcularlo no cuesta nada y da integridad verificable.
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const stored = await storagePut(key, Buffer.from(bytes), mimeType, normalizedName);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(candidateDocuments).set({ status: "removed" }).where(and(eq(candidateDocuments.companyId, portal.process.companyId), eq(candidateDocuments.requirementId, requirementId), eq(candidateDocuments.processId, portal.process.id), eq(candidateDocuments.status, "active")));
  await db.insert(candidateDocuments).values({ companyId: portal.process.companyId, processId: portal.process.id, requirementId, originalName, normalizedName, fileKey: stored.key, mimeType, sizeBytes: bytes.byteLength, checksum });
  await db.update(hiringRequirements).set({ status: "uploaded" }).where(and(eq(hiringRequirements.companyId, portal.process.companyId), eq(hiringRequirements.id, requirementId)));
  await audit(portal.process.companyId, "candidate_document_uploaded", { processId: portal.process.id, requirementId, normalizedName });
  await activity(portal.process.companyId, portal.process.id, "document_uploaded", "candidate", undefined, { requirementId });
  return getPortal(token);
}
// Borrado logico a proposito: la fila se queda en `removed` como evidencia de
// auditoria. Consecuencia conocida: los bytes quedan huerfanos en el bucket. No se
// borra el objeto porque la accion la dispara un actor anonimo con un token de portal,
// es irreversible, y la sustitucion de documento marca `removed` igual que este
// borrado, asi que una llamada suelta a DeleteObject no distinguiria los dos casos.
// Cuando exista una politica de retencion, ese es su sitio, no este.
export async function removePortalDocument(token: string, requirementId: number) { const portal = await getPortal(token, false); if (!portal) throw new Error("Enlace no disponible"); const db = await getDb(); if (!db) throw new Error("Database unavailable"); await db.update(candidateDocuments).set({ status: "removed" }).where(and(eq(candidateDocuments.companyId, portal.process.companyId), eq(candidateDocuments.processId, portal.process.id), eq(candidateDocuments.requirementId, requirementId), eq(candidateDocuments.status, "active"))); await db.update(hiringRequirements).set({ status: "removed" }).where(and(eq(hiringRequirements.companyId, portal.process.companyId), eq(hiringRequirements.processId, portal.process.id), eq(hiringRequirements.id, requirementId))); await audit(portal.process.companyId, "candidate_document_removed", { processId: portal.process.id, requirementId }); await activity(portal.process.companyId, portal.process.id, "document_removed", "candidate", undefined, { requirementId }); return getPortal(token); }
export async function getPortalDocumentUrl(token: string, requirementId: number) { const portal = await getPortal(token, false); if (!portal) throw new Error("Enlace no disponible"); const doc = portal.documents.find(d => d.requirementId === requirementId); if (!doc) throw new Error("Documento no encontrado"); const url = await storageGetSignedUrl(doc.fileKey); return { url, originalName: doc.originalName, mimeType: doc.mimeType }; }
export async function listNotifications(companyId: number, recipientUserId: number) { const db = await getDb(); if (!db) return []; return db.select().from(internalNotifications).where(and(eq(internalNotifications.companyId, companyId), eq(internalNotifications.recipientUserId, recipientUserId))).orderBy(desc(internalNotifications.createdAt)); }
export async function getDocumentUrl(companyId: number, processId: number, documentId: number) { const db = await getDb(); if (!db) return null; const document = (await db.select().from(candidateDocuments).where(and(eq(candidateDocuments.companyId, companyId), eq(candidateDocuments.processId, processId), eq(candidateDocuments.id, documentId), eq(candidateDocuments.status, "active"))).limit(1))[0]; return document ? storageGetSignedUrl(document.fileKey) : null; }
export async function submitPortal(token: string) { const portal = await getPortal(token, false); if (!portal) throw new Error("Enlace no disponible"); const missing = getMissingRequirements(portal.requirements); if (missing.length) throw new Error(`Faltan ${missing.length} documentos obligatorios`); const db = await getDb(); if (!db) throw new Error("Database unavailable"); await db.update(hiringProcesses).set({ status: "in_review" }).where(and(eq(hiringProcesses.companyId, portal.process.companyId), eq(hiringProcesses.id, portal.process.id))); await activity(portal.process.companyId, portal.process.id, "documentation_complete", "candidate"); await db.update(candidateAccessLinks).set({ status: "completed" }).where(eq(candidateAccessLinks.id, portal.linkId)); await db.insert(internalNotifications).values({ companyId: portal.process.companyId, recipientUserId: portal.process.createdByUserId, processId: portal.process.id, type: "candidate_submission_sent", title: `${portal.candidate?.fullName || "El candidato"} completó su documentación.` }); await audit(portal.process.companyId, "candidate_submission_sent", { processId: portal.process.id }); await activity(portal.process.companyId, portal.process.id, "documentation_submitted", "candidate"); return getPortal(token); }

export async function requestCandidateOtp(token: string) { const portal = await getPortal(token); if (!portal) throw new Error("Enlace no disponible"); const db = await getDb(); if (!db) throw new Error("Database unavailable"); await db.update(candidateOtpChallenges).set({ invalidatedAt: new Date() }).where(and(eq(candidateOtpChallenges.companyId, portal.process.companyId), eq(candidateOtpChallenges.processId, portal.process.id))); const expiresAt = new Date(Date.now() + 10 * 60 * 1000); const code = String((randomBytes(4).readUInt32BE(0) % 900000) + 100000); await db.insert(candidateOtpChallenges).values({ companyId: portal.process.companyId, processId: portal.process.id, codeHash: hashOtp(code), expiresAt, maxAttempts: 5 }); await audit(portal.process.companyId, "candidate_otp_requested", { processId: portal.process.id, delivery: "provider_pending" }); return { status: "not_configured" as const, expiresAt, message: "OTP preparado, pero requiere un proveedor de correo o SMS configurado." }; }
export async function verifyCandidateOtp(token: string, code: string) { const portal = await getPortal(token); if (!portal) return { verified: false, reason: "link_unavailable" as const }; const db = await getDb(); if (!db) throw new Error("Database unavailable"); const challenge = (await db.select().from(candidateOtpChallenges).where(and(eq(candidateOtpChallenges.companyId, portal.process.companyId), eq(candidateOtpChallenges.processId, portal.process.id))).orderBy(desc(candidateOtpChallenges.createdAt)).limit(1))[0]; if (!challenge || !isOtpUsable(challenge)) return { verified: false, reason: "expired_or_invalid" as const }; if (challenge.codeHash !== hashOtp(code)) { await db.update(candidateOtpChallenges).set({ attempts: challenge.attempts + 1 }).where(eq(candidateOtpChallenges.id, challenge.id)); return { verified: false, reason: "incorrect" as const }; } await db.update(candidateOtpChallenges).set({ verifiedAt: new Date() }).where(eq(candidateOtpChallenges.id, challenge.id)); await audit(portal.process.companyId, "candidate_otp_verified", { processId: portal.process.id }); return { verified: true as const }; }

export async function listCommunications(companyId: number, processId: number) { const db = await getDb(); if (!db) return []; return db.select().from(communicationLogs).where(and(eq(communicationLogs.companyId, companyId), eq(communicationLogs.processId, processId))).orderBy(desc(communicationLogs.createdAt)); }
export async function listActivities(companyId: number, processId: number) { const db = await getDb(); if (!db) return []; return db.select().from(processActivities).where(and(eq(processActivities.companyId, companyId), eq(processActivities.processId, processId))).orderBy(desc(processActivities.createdAt)); }
export async function getLinkState(companyId: number, processId: number) { const db = await getDb(); if (!db) return null; const link = (await db.select().from(candidateAccessLinks).where(and(eq(candidateAccessLinks.companyId, companyId), eq(candidateAccessLinks.processId, processId))).orderBy(desc(candidateAccessLinks.createdAt)).limit(1))[0]; if (!link) return null; const status = link.status === "active" && link.expiresAt.getTime() < Date.now() ? "expired" : link.status; return { id: link.id, status, createdAt: link.createdAt, expiresAt: link.expiresAt, lastUsedAt: link.lastUsedAt }; }
export async function listExpiringLinks(companyId: number, withinHours = 24) { const db = await getDb(); if (!db) return []; const now = new Date(); const links = await db.select().from(candidateAccessLinks).where(and(eq(candidateAccessLinks.companyId, companyId), eq(candidateAccessLinks.status, "active"))); const expiring = links.filter(link => isExpiringWithin(link.expiresAt, withinHours, now.getTime())); return Promise.all(expiring.map(async link => { const detail = await getHiringDetail(companyId, link.processId); return { id: link.id, companyId: link.companyId, processId: link.processId, status: link.status, createdAt: link.createdAt, expiresAt: link.expiresAt, lastUsedAt: link.lastUsedAt, candidateName: detail?.candidate?.fullName || "Candidato", processStatus: detail?.process.status || "pending" }; })); }
export async function revokeLink(companyId: number, processId: number, userId: number) { const db = await getDb(); if (!db) throw new Error("Database unavailable"); await db.update(candidateAccessLinks).set({ status: "revoked", revokedAt: new Date() }).where(and(eq(candidateAccessLinks.companyId, companyId), eq(candidateAccessLinks.processId, processId), eq(candidateAccessLinks.status, "active"))); await audit(companyId, "candidate_link_revoked", { processId }, userId); await activity(companyId, processId, "link_revoked", "analyst", userId); return getLinkState(companyId, processId); }
async function assertActivePortalUrl(db: Awaited<ReturnType<typeof getDb>>, companyId: number, processId: number, portalUrl: string) { const parsed = new URL(portalUrl); const parts = parsed.pathname.split("/").filter(Boolean); const token = parts[parts.length - 1]; if (parts.length !== 3 || parts[0] !== "candidate" || parts[1] !== "documents" || !token) throw new Error("Enlace de portal inválido"); const link = (await db!.select().from(candidateAccessLinks).where(and(eq(candidateAccessLinks.companyId, companyId), eq(candidateAccessLinks.processId, processId), eq(candidateAccessLinks.status, "active"))).limit(1))[0]; if (!link || link.tokenHash !== hashToken(decodeURIComponent(token)) || !isLinkUsable(link.status, link.expiresAt)) throw new Error("El enlace de portal ya no está activo"); return link; }
async function prepareProcessCommunication(companyId: number, processId: number, userId: number, type: "initial" | "reminder", portalUrl: string) { const detail = await getHiringDetail(companyId, processId); if (!detail?.candidate?.email) throw new Error("El candidato no tiene correo"); const parsed = new URL(portalUrl); if (!parsed.pathname.startsWith("/candidate/documents/")) throw new Error("Enlace de portal inválido"); const cooldownHours = Math.max(1, Number(process.env.REMINDER_COOLDOWN_HOURS || 4)); const db = await getDb(); if (!db) throw new Error("Database unavailable"); await assertActivePortalUrl(db, companyId, processId, portalUrl); const recent = (await db.select().from(communicationLogs).where(and(eq(communicationLogs.companyId, companyId), eq(communicationLogs.processId, processId), eq(communicationLogs.type, type), eq(communicationLogs.status, "sent"))).orderBy(desc(communicationLogs.createdAt)).limit(1))[0]; if (type === "reminder" && !isReminderAllowed(recent?.sentAt, cooldownHours)) throw new Error("No puedes enviar otro recordatorio todavía"); const message = buildCandidateEmail(detail, portalUrl, type === "reminder"); const draft = prepareMailtoEmail({ to: detail.candidate.email, subject: message.subject, html: message.html, text: message.text }); return { ...draft, type, portalUrl, candidateName: detail.candidate.fullName, positionName: detail.position?.name, companyName: detail.company?.name }; }
export const buildManualCommunicationRecord = (type: "initial" | "reminder", recipient: string, subject: string, now: Date, cooldownHours: number) => ({ type, recipient, subject, status: "sent" as const, sentAt: now, cooldownUntil: type === "reminder" ? new Date(now.getTime() + Math.max(1, cooldownHours) * 3600000) : null });
export const manualCommunicationEvents = (type: "initial" | "reminder") => ({ activity: type === "reminder" ? "communication_reminder_sent" : "link_sent", audit: communicationAuditAction(type, "sent") });
export async function markCommunicationSent(companyId: number, processId: number, userId: number, type: "initial" | "reminder", portalUrl: string) { const detail = await getHiringDetail(companyId, processId); if (!detail?.candidate?.email) throw new Error("El candidato no tiene correo"); const parsed = new URL(portalUrl); if (!parsed.pathname.startsWith("/candidate/documents/")) throw new Error("Enlace de portal inválido"); const db = await getDb(); if (!db) throw new Error("Database unavailable"); await assertActivePortalUrl(db, companyId, processId, portalUrl); const now = new Date(); const cooldownHours = Math.max(1, Number(process.env.REMINDER_COOLDOWN_HOURS || 4)); const subject = candidateEmailSubject(type === "reminder"); const record = buildManualCommunicationRecord(type, detail.candidate.email, subject, now, cooldownHours); const events = manualCommunicationEvents(type); await db.insert(communicationLogs).values({ companyId, processId, userId, ...record }); await activity(companyId, processId, events.activity, "analyst", userId, { portalUrl }); await audit(companyId, events.audit, { processId, recipient: detail.candidate.email, portalUrl }, userId); return { status: "sent" as const, recordedAt: now }; }
export const prepareCandidateEmail = (companyId: number, processId: number, userId: number, portalUrl: string) => prepareProcessCommunication(companyId, processId, userId, "initial", portalUrl);
export const prepareCandidateReminder = (companyId: number, processId: number, userId: number, portalUrl: string) => prepareProcessCommunication(companyId, processId, userId, "reminder", portalUrl);

export async function createZipArchive(files: Array<{ name: string; bytes: Uint8Array }>) { const zip = new JSZip(); for (const file of files) zip.file(file.name, file.bytes); return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }); }
/** Nombre unico dentro del ZIP. `normalize()` produce `${titulo}.${ext}`, asi que dos
 *  requisitos con el mismo titulo daban el mismo nombre y JSZip sobrescribia en
 *  silencio: un documento desaparecia del expediente sin ningun error, que en
 *  documentacion legal es perdida de datos. */
export const uniqueZipName = (usados: Set<string>, name: string) => {
  if (!usados.has(name)) { usados.add(name); return name; }
  const punto = name.lastIndexOf(".");
  const base = punto === -1 ? name : name.slice(0, punto);
  const ext = punto === -1 ? "" : name.slice(punto);
  let n = 2;
  while (usados.has(`${base}-${n}${ext}`)) n++;
  const unico = `${base}-${n}${ext}`;
  usados.add(unico);
  return unico;
};
export async function downloadHiringZip(companyId: number, processId: number, userId: number) {
  const detail = await getHiringDetail(companyId, processId);
  if (!detail) throw new Error("Hiring process not found");
  // Se comprueba contra la base, sin tocar el bucket: si el expediente no cabe, el
  // analista recibe un error explicable en vez de que el contenedor muera por OOM y
  // se lleve por delante a todas las empresas. Ver MAX_ZIP_BYTES.
  const totalBytes = detail.documents.reduce((suma, item) => suma + (item.sizeBytes || 0), 0);
  if (totalBytes > MAX_ZIP_BYTES) throw new Error(`El expediente pesa ${Math.round(totalBytes / 1048576)} MB y supera el limite de ${Math.round(MAX_ZIP_BYTES / 1048576)} MB de la descarga comprimida. Descarga los documentos por separado.`);
  const usados = new Set<string>();
  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const document of detail.documents) {
    // `storageGetBytes` y no firmar + fetch: cuesta lo mismo en red, pero no crea una
    // URL firmada que pueda acabar en un log y hereda los timeouts del cliente S3 en
    // vez de un `fetch()` sin ninguno, que podia colgar la peticion indefinidamente.
    let bytes: Uint8Array;
    try {
      bytes = await storageGetBytes(document.fileKey);
    } catch {
      // El detalle real ya quedo en el log del servidor; aqui interesa cual fallo.
      throw new Error(`No se pudo descargar ${document.normalizedName}`);
    }
    files.push({ name: uniqueZipName(usados, document.normalizedName), bytes });
  }
  const archive = await createZipArchive(files);
  await audit(companyId, "hiring_archive_downloaded", { processId, documentCount: detail.documents.length }, userId);
  await activity(companyId, processId, "archive_downloaded", "analyst", userId, { documentCount: detail.documents.length });
  return { filename: `${(detail.candidate?.fullName || "candidato").replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]/g, "_")}_expediente.zip`, base64: archive.toString("base64"), documentCount: detail.documents.length };
}

export async function getDashboardStats(companyId: number) {
  const db = await getDb();
  if (!db) return { totalProcesses: 0, pendingDocuments: 0, completeProcesses: 0, assistantQueries: 0 };
  const processes = await listHiring(companyId);
  const totalProcesses = processes.length;
  const pendingDocuments = processes.reduce((sum, p) => sum + Math.max(0, p.requiredCount - p.receivedCount), 0);
  const completeProcesses = processes.filter(p => p.status === "complete" || (p.requiredCount > 0 && p.receivedCount >= p.requiredCount)).length;

  let assistantQueries = 0;
  try {
    const messages = await db.select().from(aiConversationMessages).where(and(eq(aiConversationMessages.companyId, companyId), eq(aiConversationMessages.role, "user")));
    assistantQueries = messages.length;
  } catch {
    assistantQueries = 0;
  }

  return {
    totalProcesses,
    pendingDocuments,
    completeProcesses,
    assistantQueries,
  };
}
