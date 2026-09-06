import type { RoleKey } from "../drizzle/schema";

export type TenantContext = { companyId: number; userId: number; role: RoleKey };

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };
export type LlmAnswer = { content: string; model: string; usage?: { inputTokens?: number; outputTokens?: number } };

export type AiDocumentFindingInput = {
  documentId?: number;
  requirementId?: number;
  sourcePageStart?: number;
  sourcePageEnd?: number;
  detectedType: string;
  suggestedName?: string;
  confidence: number;
  status: "identified" | "review_required" | "confirmed" | "corrected" | "rejected";
  issueType?: string;
  issueMessage?: string;
  extractedData?: Record<string, unknown>;
};

export type AiDocumentAnalysisInput = {
  candidateName: string;
  positionName: string;
  requirements: Array<{ id: number; title: string; required: boolean }>;
  documents: Array<{ id: number; originalName: string; normalizedName: string; mimeType: string; url?: string }>;
};

export type AiDocumentAnalysisOutput = {
  findings: AiDocumentFindingInput[];
  summary: string;
};

export interface AIProvider {
  readonly name: string;
  readonly mode: "demo" | "real";
  analyzeDocuments(input: { tenant: TenantContext; data: AiDocumentAnalysisInput }): Promise<AiDocumentAnalysisOutput>;
  answerAssistant(input: { tenant: TenantContext; question: string; context: string }): Promise<{ content: string; model: string }>;
}

export interface LlmProvider {
  readonly name: string;
  generateAnswer(input: { messages: LlmMessage[]; tenant: TenantContext; temperature?: number }): Promise<LlmAnswer>;
  embed?(input: { text: string; tenant: TenantContext }): Promise<number[]>;
}

export interface KnowledgeBasePort {
  search(input: { tenant: TenantContext; query: string; limit?: number }): Promise<Array<{ id: string; title: string; excerpt: string; score: number }>>;
  upsert(input: { tenant: TenantContext; title: string; content: string; sourceRef?: string }): Promise<{ id: string }>;
}

export type IntegrationName = "whatsapp" | "teams" | "email" | "payroll" | "erp" | "csv";
export interface IntegrationAdapter {
  readonly name: IntegrationName;
  connect(tenant: TenantContext, config: Record<string, string>): Promise<{ connected: boolean }>;
  disconnect(tenant: TenantContext): Promise<void>;
  health(tenant: TenantContext): Promise<{ status: "connected" | "disconnected" | "error"; checkedAt: number }>;
}

// Aqui vivia `DocumentStoragePort`. Se borro: nunca tuvo implementacion ni un solo
// import en runtime, y su firma mentia en los tres metodos (`put` recibia metadata en
// vez de una clave, `getUrl` pedia un TenantContext que el almacenamiento no usa ni
// debe usar -- la autorizacion vive en routers.ts -- y `remove` no existia). Una
// interfaz muerta con la firma equivocada es documentacion activa y falsa.
//
// Y no hacia falta reemplazarla: los otros puertos de este archivo existen porque hay
// dos implementaciones y un `mode: "demo" | "real"` que elige entre ellas. El
// almacenamiento tiene una sola (`server/storage.ts`, S3), y la variabilidad de
// proveedor la absorben las variables STORAGE_S3_*. Un puerto con un unico
// implementador es indireccion sin beneficio.

export type AiCapability = "hr-assistant" | "onboarding" | "payroll-intelligence" | "people-analytics" | "talent-intelligence";
export type FutureModuleStatus = "planned" | "available";
export const FUTURE_MODULES: Record<AiCapability | IntegrationName | "documents", FutureModuleStatus> = {
  "hr-assistant": "planned",
  onboarding: "planned",
  "payroll-intelligence": "planned",
  "people-analytics": "planned",
  "talent-intelligence": "planned",
  whatsapp: "planned",
  teams: "planned",
  email: "planned",
  payroll: "planned",
  erp: "planned",
  csv: "planned",
  documents: "planned",
};
