import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { invokeLLM, listLLMModels, type MessageContent } from "./_core/llm";
import { storageGetSignedUrl } from "./storage";
import { getDb } from "./db";
import { auditLogs, aiAnalysisRuns, aiConversationMessages, aiConversations, aiDocumentFindings, aiHiringSummaries, aiInsights, candidateDocuments, candidateProfiles, hiringProcesses, hiringRequirements, jobPositions } from "../drizzle/schema";
import type { AIProvider, AiDocumentAnalysisInput, AiDocumentAnalysisOutput, AiDocumentFindingInput, TenantContext } from "../shared/extensions";

const MODEL = "gpt-5-mini";
const HR_ROLES = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]);
export const isSensitiveAssistantRequest = (question: string) => /regenera|revoca|env[ií]a|elimina|modifica|crea/.test(question.toLowerCase());
export async function splitPdfBytes(bytes: Uint8Array) { const source = await PDFDocument.load(bytes); const segments: Uint8Array[] = []; for (let index = 0; index < source.getPageCount(); index += 1) { const segment = await PDFDocument.create(); const [page] = await segment.copyPages(source, [index]); segment.addPage(page); segments.push(await segment.save()); } return segments; }
const safeJson = (value: unknown) => JSON.stringify(value).slice(0, 12000);
const hashData = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textOf = (content: string | Array<{ type: string; text?: string }>) => typeof content === "string" ? content : content.map(part => part.text || "").join("\n");

function demoAnalysis(data: AiDocumentAnalysisInput): AiDocumentAnalysisOutput {
  const findings: AiDocumentFindingInput[] = data.documents.map((document, index) => {
    const source = `${document.originalName} ${document.normalizedName}`.toLowerCase();
    const requirement = data.requirements.find(item => source.includes(item.title.toLowerCase().split(" ")[0])) || data.requirements[index];
    const ambiguous = source.includes("final") || source.includes("doc") || source.includes("scan");
    const detectedType = requirement?.title || "Documento no identificado";
    const confidence = ambiguous ? 61 : requirement ? 94 : 42;
    return {
      documentId: document.id,
      requirementId: requirement?.id,
      detectedType,
      suggestedName: requirement ? `${requirement.title}.${document.originalName.split(".").pop()?.toLowerCase() || "pdf"}` : document.normalizedName,
      confidence,
      status: confidence < 70 ? "review_required" : "identified",
      issueType: confidence < 70 ? "ambiguous" : undefined,
      issueMessage: confidence < 70 ? "No hay suficiente evidencia para clasificarlo automáticamente." : undefined,
      extractedData: { sourceName: document.originalName, mode: "DEMO", pageHint: index + 1 },
    };
  });
  const matched = new Set(findings.filter(item => item.requirementId).map(item => item.requirementId));
  const missing = data.requirements.filter(item => item.required && !matched.has(item.id));
  for (const requirement of missing) findings.push({ requirementId: requirement.id, detectedType: requirement.title, confidence: 0, status: "review_required", issueType: "missing", issueMessage: "No se encontró un documento asociado a este requisito." });
  return { findings, summary: `Modo DEMO: ${data.documents.length} documento(s) recibidos, ${findings.filter(item => item.confidence >= 70).length} identificados con alta confianza y ${findings.filter(item => item.status === "review_required").length} requieren revisión humana.` };
}

function buildAnalysisSchema() {
  return { type: "json_schema" as const, json_schema: { name: "ai_document_analysis", strict: true, schema: { type: "object", properties: { summary: { type: "string" }, findings: { type: "array", items: { type: "object", properties: { documentId: { type: ["integer", "null"] }, requirementId: { type: ["integer", "null"] }, detectedType: { type: "string" }, suggestedName: { type: ["string", "null"] }, confidence: { type: "integer" }, status: { type: "string", enum: ["identified", "review_required"] }, issueType: { type: ["string", "null"] }, issueMessage: { type: ["string", "null"] }, extractedData: { type: "object", additionalProperties: true } }, required: ["documentId", "requirementId", "detectedType", "suggestedName", "confidence", "status", "issueType", "issueMessage", "extractedData"], additionalProperties: false } } }, required: ["summary", "findings"], additionalProperties: false } } };
}

const realProvider: AIProvider = {
  name: MODEL,
  mode: "real",
  async analyzeDocuments({ data }) {
    const documentParts: MessageContent[] = data.documents.filter(document => document.url).map(document => document.mimeType === "application/pdf" ? { type: "file_url", file_url: { url: document.url as string, mime_type: "application/pdf" } } : { type: "image_url", image_url: { url: document.url as string, detail: "high" } });
    const response = await invokeLLM({ model: MODEL, maxTokens: 4000, responseFormat: buildAnalysisSchema(), messages: [
      { role: "system", content: "Eres un analista documental de RRHH. Devuelve únicamente JSON válido. No tomes decisiones laborales. Si hay incertidumbre usa review_required. Analiza solo los archivos y requisitos autorizados; no inventes contenido. Conserva el original y no afirmes separación si no puedes verificar páginas." },
      { role: "user", content: [{ type: "text", text: JSON.stringify({ candidateName: data.candidateName, positionName: data.positionName, requirements: data.requirements, documents: data.documents.map(({ id, originalName, mimeType }) => ({ id, originalName, mimeType })) }) }, ...documentParts] },
    ] });
    const raw = JSON.parse(textOf(response.choices[0].message.content));
    return { summary: raw.summary, findings: raw.findings.map((item: AiDocumentFindingInput) => ({ ...item, confidence: Math.max(0, Math.min(100, item.confidence)), status: item.confidence < 70 ? "review_required" : item.status })) };
  },
  async answerAssistant({ question, context }) {
    const response = await invokeLLM({ model: MODEL, maxTokens: 1200, messages: [
      { role: "system", content: "Eres People AI Assistant para una analista de Talento Humano. Responde solo usando el contexto autorizado. Si falta información, di: No tengo suficiente información para determinarlo. Nunca inventes, nunca decidas rechazos laborales. Para incertidumbre indica: Esto requiere revisión humana. Cita que la respuesta se basa en la información registrada en PEOPLE AI." },
      { role: "user", content: `Pregunta: ${question}\nContexto autorizado:\n${context}` },
    ] });
    return { content: textOf(response.choices[0].message.content), model: response.model || MODEL };
  },
};

export const demoProvider: AIProvider = {
  name: "PEOPLE AI DEMO",
  mode: "demo",
  async analyzeDocuments({ data }) { return demoAnalysis(data); },
  async answerAssistant({ question, context }) { return { model: "PEOPLE AI DEMO", content: demoAnswer(question, context) }; },
};

function demoAnswer(question: string, context: string) {
  const normalized = question.toLowerCase();
  if (!context.trim()) return "No tengo suficiente información para determinarlo.";
  if (/regenera|revoca|env[ií]a|elimina|modifica|crea/.test(normalized)) return "Puedo preparar esa acción, pero requiere confirmación explícita de la analista antes de modificar datos.";
  if (/falta|pendiente|incompleta/.test(normalized)) return `Según la información registrada en PEOPLE AI:\n\n${context}\n\nLos documentos faltantes o inciertos requieren revisión humana.`;
  if (/revisi[oó]n|revisar|sospech|inconsist/.test(normalized)) return `Según la información registrada en PEOPLE AI, estos resultados requieren atención:\n\n${context}`;
  return `Según la información registrada en PEOPLE AI:\n\n${context}\n\nNo se han usado datos fuera del alcance autorizado.`;
}

function providerFor(mode: "demo" | "real") { return mode === "real" ? realProvider : demoProvider; }

async function ensureProcess(companyId: number, processId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const process = (await db.select().from(hiringProcesses).where(and(eq(hiringProcesses.companyId, companyId), eq(hiringProcesses.id, processId))).limit(1))[0];
  if (!process) throw new Error("Hiring process not found");
  return { db, process };
}

async function auditAi(companyId: number, userId: number | undefined, action: string, metadata: Record<string, unknown>) {
  const db = await getDb();
  if (db) await db.insert(auditLogs).values({ companyId, userId, action, module: "ai", result: "success", metadata: safeJson(metadata) });
}

// En modo "real" las URLs firmadas se generan con 900 s y no con el default de 300:
// no las abre un navegador al instante, se las queda el proveedor de LLM y las
// descarga cuando procesa la peticion. Implica que documentos personales salen hacia
// un tercero; ver docs/PHASE_4A_VALIDATION.md antes de activarlo en produccion.
export async function analyzeHiringDocuments(companyId: number, processId: number, userId: number, mode: "demo" | "real" = "demo") {
  const { db, process } = await ensureProcess(companyId, processId);
  const [requirements, documents] = await Promise.all([
    db.select().from(hiringRequirements).where(and(eq(hiringRequirements.companyId, companyId), eq(hiringRequirements.processId, processId))),
    db.select().from(candidateDocuments).where(and(eq(candidateDocuments.companyId, companyId), eq(candidateDocuments.processId, processId), eq(candidateDocuments.status, "active"))),
  ]);
  const baseDocuments = documents.map(item => ({ id: item.id, originalName: item.originalName, normalizedName: item.normalizedName, mimeType: item.mimeType }));
  const input: AiDocumentAnalysisInput = { candidateName: `candidate-${process.candidateId}`, positionName: `position-${process.positionId}`, requirements: requirements.map(item => ({ id: item.id, title: item.title, required: item.required })), documents: mode === "real" ? await Promise.all(baseDocuments.map(async document => ({ ...document, url: await storageGetSignedUrl(documents.find(item => item.id === document.id)!.fileKey, 900) }))) : baseDocuments };
  const runInsert = await db.insert(aiAnalysisRuns).values({ companyId, processId, requestedByUserId: userId, providerMode: mode, status: "running" });
  const runId = Number(runInsert[0].insertId);
  try {
    const result = await providerFor(mode).analyzeDocuments({ tenant: { companyId, userId, role: "HR" }, data: input });
    await db.insert(aiDocumentFindings).values(result.findings.map(item => ({ companyId, processId, analysisRunId: runId, documentId: item.documentId ?? null, requirementId: item.requirementId ?? null, sourcePageStart: item.sourcePageStart ?? null, sourcePageEnd: item.sourcePageEnd ?? null, detectedType: item.detectedType, suggestedName: item.suggestedName ?? null, confidence: item.confidence, status: item.status, issueType: item.issueType ?? null, issueMessage: item.issueMessage ?? null, extractedData: item.extractedData ? safeJson(item.extractedData) : null })));
    await db.update(aiAnalysisRuns).set({ status: "completed", summary: result.summary, completedAt: new Date() }).where(and(eq(aiAnalysisRuns.companyId, companyId), eq(aiAnalysisRuns.id, runId)));
    await upsertAnalysisInsights(companyId, processId, result.findings, userId);
    await auditAi(companyId, userId, "ai_document_analysis_completed", { processId, runId, mode, findingCount: result.findings.length });
    return { runId, provider: providerFor(mode).name, mode, ...result };
  } catch (error) {
    await db.update(aiAnalysisRuns).set({ status: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "AI analysis failed", completedAt: new Date() }).where(and(eq(aiAnalysisRuns.companyId, companyId), eq(aiAnalysisRuns.id, runId)));
    await auditAi(companyId, userId, "ai_document_analysis_failed", { processId, runId, mode });
    throw error;
  }
}

export async function listAiFindings(companyId: number, processId: number) { const db = await getDb(); if (!db) return []; return db.select().from(aiDocumentFindings).where(and(eq(aiDocumentFindings.companyId, companyId), eq(aiDocumentFindings.processId, processId))).orderBy(desc(aiDocumentFindings.createdAt)); }
export async function listAiRuns(companyId: number, processId: number) { const db = await getDb(); if (!db) return []; return db.select().from(aiAnalysisRuns).where(and(eq(aiAnalysisRuns.companyId, companyId), eq(aiAnalysisRuns.processId, processId))).orderBy(desc(aiAnalysisRuns.createdAt)); }

export async function reviewAiFinding(companyId: number, findingId: number, userId: number, input: { status: "confirmed" | "corrected" | "rejected"; requirementId?: number; detectedType?: string }) {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  const existing = (await db.select().from(aiDocumentFindings).where(and(eq(aiDocumentFindings.companyId, companyId), eq(aiDocumentFindings.id, findingId))).limit(1))[0];
  if (!existing) throw new Error("AI finding not found");
  await db.update(aiDocumentFindings).set({ status: input.status, requirementId: input.requirementId ?? existing.requirementId, detectedType: input.detectedType ?? existing.detectedType }).where(and(eq(aiDocumentFindings.companyId, companyId), eq(aiDocumentFindings.id, findingId)));
  await auditAi(companyId, userId, "ai_finding_reviewed", { findingId, status: input.status, correctedRequirementId: input.requirementId });
  return (await db.select().from(aiDocumentFindings).where(eq(aiDocumentFindings.id, findingId)).limit(1))[0];
}

async function upsertAnalysisInsights(companyId: number, processId: number, findings: AiDocumentFindingInput[], userId: number) {
  const db = await getDb(); if (!db) return;
  for (const finding of findings.filter(item => item.status === "review_required")) {
    const dedupeKey = `document-review:${processId}:${finding.requirementId ?? finding.documentId ?? finding.detectedType}`;
    const existing = (await db.select().from(aiInsights).where(and(eq(aiInsights.companyId, companyId), eq(aiInsights.dedupeKey, dedupeKey))).limit(1))[0];
    if (!existing) await db.insert(aiInsights).values({ companyId, processId, type: finding.issueType || "document_review", title: "Documento requiere revisión", description: finding.issueMessage || `${finding.detectedType} requiere revisión humana.`, severity: finding.issueType === "missing" ? "critical" : "warning", status: "unread", dedupeKey });
  }
  await auditAi(companyId, userId, "ai_insights_generated", { processId, count: findings.filter(item => item.status === "review_required").length });
}

export async function listAiInsights(companyId: number, status?: "unread" | "read" | "reviewed" | "resolved") { const db = await getDb(); if (!db) return []; return db.select().from(aiInsights).where(status ? and(eq(aiInsights.companyId, companyId), eq(aiInsights.status, status)) : eq(aiInsights.companyId, companyId)).orderBy(desc(aiInsights.createdAt)); }
export async function updateAiInsight(companyId: number, insightId: number, userId: number, status: "read" | "reviewed" | "resolved") { const db = await getDb(); if (!db) throw new Error("Database unavailable"); await db.update(aiInsights).set({ status, resolvedAt: status === "resolved" ? new Date() : null }).where(and(eq(aiInsights.companyId, companyId), eq(aiInsights.id, insightId))); await auditAi(companyId, userId, "ai_insight_status_updated", { insightId, status }); return (await db.select().from(aiInsights).where(and(eq(aiInsights.companyId, companyId), eq(aiInsights.id, insightId))).limit(1))[0]; }

function assistantContext(question: string, hiring: Array<{ candidateName: string; positionName: string; requiredCount: number; receivedCount: number; status: string; id: number; missing?: string[] }>) {
  const normalized = question.toLowerCase();
  const relevant = /carlos/.test(normalized) ? hiring.filter(item => item.candidateName.toLowerCase().includes("carlos")) : hiring;
  if (/pendiente|incompleta|atenci[oó]n|falta/.test(normalized)) return relevant.filter(item => item.receivedCount < item.requiredCount).map(item => `${item.candidateName} — ${item.positionName}: ${item.receivedCount}/${item.requiredCount} documentos; proceso ${item.status}; faltan: ${item.missing?.join(", ") || "revisión requerida"}; procesoId ${item.id}`).join("\n");
  if (/completa|finaliz/.test(normalized)) return relevant.filter(item => item.receivedCount >= item.requiredCount).map(item => `${item.candidateName} — ${item.positionName}: documentación completa; procesoId ${item.id}`).join("\n");
  return relevant.map(item => `${item.candidateName} — ${item.positionName}: ${item.receivedCount}/${item.requiredCount} documentos; estado ${item.status}; procesoId ${item.id}`).join("\n");
}

export async function askPeopleAi(input: { companyId: number; userId: number; role: string; question: string; processId?: number; conversationId?: number; mode?: "demo" | "real" }) {
  if (!HR_ROLES.has(input.role)) throw new Error("AI assistant is not available for this role");
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  let hiring: Array<{ candidateName: string; positionName: string; requiredCount: number; receivedCount: number; status: string; id: number }> = [];
  const processes = await db.select().from(hiringProcesses).where(and(eq(hiringProcesses.companyId, input.companyId), input.processId ? eq(hiringProcesses.id, input.processId) : eq(hiringProcesses.companyId, input.companyId)));
  for (const process of processes) {
    const [requirements, candidateRows, positionRows] = await Promise.all([
      db.select().from(hiringRequirements).where(and(eq(hiringRequirements.companyId, input.companyId), eq(hiringRequirements.processId, process.id))),
      db.select().from(candidateProfiles).where(and(eq(candidateProfiles.companyId, input.companyId), eq(candidateProfiles.id, process.candidateId))).limit(1),
      db.select().from(jobPositions).where(and(eq(jobPositions.companyId, input.companyId), eq(jobPositions.id, process.positionId))).limit(1),
    ]);
    const missing = requirements.filter(item => item.required && !["uploaded", "replaced", "verified"].includes(item.status)).map(item => item.title);
    hiring.push({ id: process.id, candidateName: candidateRows[0]?.fullName || `Candidato #${process.candidateId}`, positionName: positionRows[0]?.name || `Cargo #${process.positionId}`, requiredCount: requirements.filter(item => item.required).length, receivedCount: requirements.filter(item => ["uploaded", "replaced", "verified"].includes(item.status)).length, status: process.status, ...(missing.length ? { missing } : {}) } as typeof hiring[number]);
  }
  const context = assistantContext(input.question, hiring).slice(0, 8000);
  const provider = providerFor(input.mode || "demo");
  const answer = await provider.answerAssistant({ tenant: { companyId: input.companyId, userId: input.userId, role: input.role as TenantContext["role"] }, question: input.question, context });
  let conversationId = input.conversationId;
  if (!conversationId) { const created = await db.insert(aiConversations).values({ companyId: input.companyId, userId: input.userId, processId: input.processId ?? null, title: input.question.slice(0, 180) }); conversationId = Number(created[0].insertId); }
  else { const conversation = (await db.select().from(aiConversations).where(and(eq(aiConversations.companyId, input.companyId), eq(aiConversations.id, conversationId), eq(aiConversations.userId, input.userId))).limit(1))[0]; if (!conversation) throw new Error("Conversation not found"); }
  await db.insert(aiConversationMessages).values([{ companyId: input.companyId, conversationId, userId: input.userId, role: "user", content: input.question }, { companyId: input.companyId, conversationId, role: "assistant", content: answer.content, model: answer.model }]);
  await auditAi(input.companyId, input.userId, "ai_assistant_asked", { conversationId, processId: input.processId, mode: provider.mode });
  const sensitive = isSensitiveAssistantRequest(input.question);
  return { conversationId, provider: provider.name, mode: provider.mode, content: answer.content, requiresConfirmation: sensitive, suggestedAction: sensitive ? "confirmation_required" : null, contextProcessIds: hiring.map(item => item.id) };
}

export async function listAiConversations(companyId: number, userId: number) { const db = await getDb(); if (!db) return []; return db.select().from(aiConversations).where(and(eq(aiConversations.companyId, companyId), eq(aiConversations.userId, userId))).orderBy(desc(aiConversations.updatedAt)); }

export async function getHiringAiSummary(companyId: number, processId: number, userId: number, mode: "demo" | "real" = "demo") {
  const { db, process } = await ensureProcess(companyId, processId);
  const requirements = await db.select().from(hiringRequirements).where(and(eq(hiringRequirements.companyId, companyId), eq(hiringRequirements.processId, processId)));
  const fingerprint = hashData({ process, requirements: requirements.map(item => ({ id: item.id, status: item.status, title: item.title })) });
  const existing = (await db.select().from(aiHiringSummaries).where(and(eq(aiHiringSummaries.companyId, companyId), eq(aiHiringSummaries.processId, processId))).limit(1))[0];
  if (existing?.dataFingerprint === fingerprint) return existing;
  const missing = requirements.filter(item => item.required && !["uploaded", "replaced", "verified"].includes(item.status));
  const summary = `Según la información registrada en PEOPLE AI, el proceso #${processId} tiene ${requirements.filter(item => item.required && ["uploaded", "replaced", "verified"].includes(item.status)).length}/${requirements.filter(item => item.required).length} requisitos completos. Estado: ${process.status}. ${missing.length ? `Pendientes: ${missing.map(item => item.title).join(", ")}.` : "No se detectan requisitos faltantes."} Toda inconsistencia requiere revisión humana.`;
  await db.insert(aiHiringSummaries).values({ companyId, processId, summary, dataFingerprint: fingerprint, model: mode === "demo" ? "PEOPLE AI DEMO" : MODEL }).onDuplicateKeyUpdate({ set: { summary, dataFingerprint: fingerprint, model: mode === "demo" ? "PEOPLE AI DEMO" : MODEL } });
  await auditAi(companyId, userId, "ai_hiring_summary_generated", { processId, mode });
  return (await db.select().from(aiHiringSummaries).where(and(eq(aiHiringSummaries.companyId, companyId), eq(aiHiringSummaries.processId, processId))).limit(1))[0];
}

export async function availableAiModels() { try { return (await listLLMModels()).data.map(model => model.id); } catch { return []; } }
