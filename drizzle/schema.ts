import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  // Null = la cuenta no puede iniciar sesion con contrasena (usuarios demo/OAuth heredados).
  passwordHash: varchar("passwordHash", { length: 255 }),
  // Se incrementa al cambiar la contrasena para invalidar las sesiones ya emitidas.
  sessionVersion: int("sessionVersion").default(0).notNull(),
  // Empresa seleccionada cuando se pertenece a varias. Nulo = se resuelve por el
  // perfil mas antiguo, que es el comportamiento historico.
  activeCompanyId: int("activeCompanyId"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, (table) => ({ emailIdx: uniqueIndex("users_email_idx").on(table.email) }));

export const companies = mysqlTable("companies", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  legalName: varchar("legalName", { length: 220 }).notNull(),
  logo: varchar("logo", { length: 500 }),
  industry: varchar("industry", { length: 120 }),
  country: varchar("country", { length: 80 }).default("Colombia").notNull(),
  city: varchar("city", { length: 100 }),
  // Contacto de soporte que el portal PUBLICA a los candidatos (tarjeta "Dudas con un
  // documento?"). Vive aqui y no en `company_communication_settings` porque
  // `getHiringDetail` ya trae esta fila entera: el portal lo obtiene sin una consulta
  // extra. Esa tabla ademas no tiene telefono, y su `senderEmail` es el remitente de un
  // correo saliente, no el buzon al que el candidato escribe.
  //
  // Nulos a proposito: null = "sin configurar" y el portal oculta la linea. Antes se
  // fabricaba la direccion `talento@<empresa>.co`, un buzon que en general no existe.
  // Longitudes pegadas a `employees.email` (320) y `employees.phone` (40).
  candidateSupportEmail: varchar("candidateSupportEmail", { length: 320 }),
  candidateSupportPhone: varchar("candidateSupportPhone", { length: 40 }),
  timezone: varchar("timezone", { length: 80 }).default("America/Bogota").notNull(),
  status: mysqlEnum("status", ["active", "suspended", "archived"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ nameIdx: uniqueIndex("companies_name_idx").on(table.name) }));

export const appProfiles = mysqlTable("app_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  companyId: int("companyId"),
  role: mysqlEnum("role", ["SUPER_ADMIN", "COMPANY_ADMIN", "HR", "FINANCE", "MANAGER", "EMPLOYEE"]).notNull(),
  status: mysqlEnum("status", ["active", "invited", "suspended"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userCompanyIdx: uniqueIndex("profiles_user_company_idx").on(table.userId, table.companyId), companyIdx: index("profiles_company_idx").on(table.companyId) }));

/** Invitacion para unirse a una empresa.
 *
 *  Tabla propia y no `app_profiles.status = 'invited'` porque `app_profiles.userId`
 *  es NOT NULL: una invitacion pendiente no puede reservar fila antes de que el
 *  usuario exista. Sigue la forma de `candidate_access_links`: solo se guarda el
 *  hash del token, nunca el token. */
export const invitations = mysqlTable("invitations", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  // No unico: un mismo correo puede recibir varias invitaciones a lo largo del tiempo.
  email: varchar("email", { length: 320 }).notNull(),
  role: mysqlEnum("role", ["SUPER_ADMIN", "COMPANY_ADMIN", "HR", "FINANCE", "MANAGER", "EMPLOYEE"]).notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  invitedByUserId: int("invitedByUserId").notNull(),
  status: mysqlEnum("status", ["active", "accepted", "revoked"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  revokedAt: timestamp("revokedAt"),
}, (table) => ({ companyIdx: index("invitations_company_idx").on(table.companyId), emailIdx: index("invitations_email_idx").on(table.email) }));

export const departments = mysqlTable("departments", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  managerEmployeeId: int("managerEmployeeId"),
  status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ companyIdx: index("departments_company_idx").on(table.companyId) }));

export const employees = mysqlTable("employees", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  userId: int("userId"),
  departmentId: int("departmentId"),
  managerId: int("managerId"),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  employeeCode: varchar("employeeCode", { length: 50 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 40 }),
  position: varchar("position", { length: 140 }),
  hireDate: timestamp("hireDate"),
  employmentStatus: mysqlEnum("employmentStatus", ["active", "leave", "terminated"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ companyIdx: index("employees_company_idx").on(table.companyId), codeIdx: uniqueIndex("employees_company_code_idx").on(table.companyId, table.employeeCode) }));

export const roles = mysqlTable("roles", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId"),
  key: varchar("key", { length: 80 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  isSystem: boolean("isSystem").default(false).notNull(),
}, (table) => ({ roleScopeIdx: uniqueIndex("roles_scope_key_idx").on(table.companyId, table.key) }));

export const permissions = mysqlTable("permissions", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 120 }).notNull().unique(),
  description: text("description"),
});

export const rolePermissions = mysqlTable("role_permissions", {
  roleId: int("roleId").notNull(),
  permissionId: int("permissionId").notNull(),
}, (table) => ({ pairIdx: uniqueIndex("role_permission_pair_idx").on(table.roleId, table.permissionId) }));

export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId"),
  userId: int("userId"),
  action: varchar("action", { length: 120 }).notNull(),
  module: varchar("module", { length: 80 }).notNull(),
  result: mysqlEnum("result", ["success", "denied", "error"]).notNull(),
  metadata: text("metadata"),
  ipAddress: varchar("ipAddress", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ auditCompanyIdx: index("audit_company_idx").on(table.companyId), auditUserIdx: index("audit_user_idx").on(table.userId) }));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type AppProfile = typeof appProfiles.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type Department = typeof departments.$inferSelect;
export const recruitmentCandidates = mysqlTable("recruitment_candidates", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  candidateName: varchar("candidateName", { length: 160 }).notNull(),
  position: varchar("position", { length: 140 }).notNull(),
  documentsReceived: int("documentsReceived").default(0).notNull(),
  documentsRequired: int("documentsRequired").default(9).notNull(),
  status: mysqlEnum("status", ["pending", "complete", "review"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ companyIdx: index("recruitment_company_idx").on(table.companyId) }));

export const knowledgeBaseDocuments = mysqlTable("knowledge_base_documents", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  status: mysqlEnum("status", ["demo", "draft", "published"]).default("demo").notNull(),
  sourceRef: varchar("sourceRef", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ companyIdx: index("knowledge_company_idx").on(table.companyId) }));

export type RecruitmentCandidate = typeof recruitmentCandidates.$inferSelect;
export type KnowledgeBaseDocument = typeof knowledgeBaseDocuments.$inferSelect;
export const jobPositions = mysqlTable("job_positions", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), templateId: int("templateId"), name: varchar("name", { length: 160 }).notNull(), description: text("description"), status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ companyIdx: index("positions_company_idx").on(table.companyId), templateIdx: index("positions_template_idx").on(table.templateId) }));

export const documentTemplates = mysqlTable("document_templates", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), positionId: int("positionId"), name: varchar("name", { length: 180 }).notNull(), version: int("version").default(1).notNull(), status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ companyIdx: index("templates_company_idx").on(table.companyId), positionIdx: index("templates_position_idx").on(table.positionId) }));

export const documentTemplateItems = mysqlTable("document_template_items", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), templateId: int("templateId").notNull(), title: varchar("title", { length: 180 }).notNull(), description: text("description"), required: boolean("required").default(true).notNull(), sortOrder: int("sortOrder").default(0).notNull(), allowedMimeTypes: varchar("allowedMimeTypes", { length: 300 }).default("application/pdf,image/jpeg,image/png").notNull(),
}, (table) => ({ companyIdx: index("template_items_company_idx").on(table.companyId), templateIdx: index("template_items_template_idx").on(table.templateId) }));

export const candidateProfiles = mysqlTable("candidate_profiles", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), fullName: varchar("fullName", { length: 180 }).notNull(), identificationNumber: varchar("identificationNumber", { length: 80 }).notNull(), email: varchar("email", { length: 320 }).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ companyIdx: index("candidates_company_idx").on(table.companyId) }));

export const hiringProcesses = mysqlTable("hiring_processes", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), candidateId: int("candidateId").notNull(), positionId: int("positionId").notNull(), templateId: int("templateId").notNull(), createdByUserId: int("createdByUserId").notNull(), status: mysqlEnum("status", ["draft", "pending", "in_progress", "complete", "in_review", "finalized"]).default("pending").notNull(), documentDeadline: timestamp("documentDeadline"), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ companyIdx: index("hiring_company_idx").on(table.companyId), candidateIdx: index("hiring_candidate_idx").on(table.candidateId) }));

export const hiringRequirements = mysqlTable("hiring_requirements", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), processId: int("processId").notNull(), sourceTemplateItemId: int("sourceTemplateItemId"), title: varchar("title", { length: 180 }).notNull(), description: text("description"), required: boolean("required").default(true).notNull(), sortOrder: int("sortOrder").default(0).notNull(), status: mysqlEnum("status", ["pending", "uploaded", "replaced", "removed", "verified"]).default("pending").notNull(), allowedMimeTypes: varchar("allowedMimeTypes", { length: 300 }).default("application/pdf,image/jpeg,image/png,image/webp"),
}, (table) => ({ companyIdx: index("requirements_company_idx").on(table.companyId), processIdx: index("requirements_process_idx").on(table.processId) }));

export const candidateAccessLinks = mysqlTable("candidate_access_links", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), processId: int("processId").notNull(), candidateId: int("candidateId").notNull(), tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(), createdAt: timestamp("createdAt").defaultNow().notNull(), expiresAt: timestamp("expiresAt").notNull(), revokedAt: timestamp("revokedAt"), lastUsedAt: timestamp("lastUsedAt"), status: mysqlEnum("status", ["active", "expired", "revoked", "completed"]).default("active").notNull(),
}, (table) => ({ companyIdx: index("links_company_idx").on(table.companyId), processIdx: index("links_process_idx").on(table.processId) }));

export const candidateDocuments = mysqlTable("candidate_documents", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), processId: int("processId").notNull(), requirementId: int("requirementId").notNull(), originalName: varchar("originalName", { length: 255 }).notNull(), normalizedName: varchar("normalizedName", { length: 255 }).notNull(), fileKey: varchar("fileKey", { length: 500 }).notNull(), mimeType: varchar("mimeType", { length: 120 }).notNull(), sizeBytes: int("sizeBytes").notNull(), checksum: varchar("checksum", { length: 128 }), status: mysqlEnum("status", ["active", "removed", "verified"]).default("active").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ companyIdx: index("documents_company_idx").on(table.companyId), processIdx: index("documents_process_idx").on(table.processId), requirementIdx: index("documents_requirement_idx").on(table.requirementId) }));

export const internalNotifications = mysqlTable("internal_notifications", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), recipientUserId: int("recipientUserId").notNull(), processId: int("processId"), type: varchar("type", { length: 80 }).notNull(), title: varchar("title", { length: 180 }).notNull(), readAt: timestamp("readAt"), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ companyIdx: index("notifications_company_idx").on(table.companyId), recipientIdx: index("notifications_recipient_idx").on(table.recipientUserId) }));

export type JobPosition = typeof jobPositions.$inferSelect;
export type DocumentTemplate = typeof documentTemplates.$inferSelect;
export type DocumentTemplateItem = typeof documentTemplateItems.$inferSelect;
export type CandidateProfile = typeof candidateProfiles.$inferSelect;
export type HiringProcess = typeof hiringProcesses.$inferSelect;
export type HiringRequirement = typeof hiringRequirements.$inferSelect;
export type CandidateAccessLink = typeof candidateAccessLinks.$inferSelect;
export type CandidateDocument = typeof candidateDocuments.$inferSelect;
export const communicationLogs = mysqlTable("communication_logs", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), processId: int("processId").notNull(), userId: int("userId"), type: varchar("type", { length: 40 }).notNull(), recipient: varchar("recipient", { length: 320 }).notNull(), subject: varchar("subject", { length: 240 }).notNull(), status: mysqlEnum("status", ["not_sent", "sent", "error", "delivered", "opened"]).default("not_sent").notNull(), errorMessage: text("errorMessage"), sentAt: timestamp("sentAt"), cooldownUntil: timestamp("cooldownUntil"), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ companyIdx: index("communications_company_idx").on(table.companyId), processIdx: index("communications_process_idx").on(table.processId), recipientIdx: index("communications_recipient_idx").on(table.recipient) }));

export const processActivities = mysqlTable("process_activities", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), processId: int("processId").notNull(), actorType: mysqlEnum("actorType", ["analyst", "candidate", "system"]).notNull(), actorUserId: int("actorUserId"), type: varchar("type", { length: 80 }).notNull(), metadata: text("metadata"), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ companyIdx: index("activities_company_idx").on(table.companyId), processIdx: index("activities_process_idx").on(table.processId) }));

export const candidateOtpChallenges = mysqlTable("candidate_otp_challenges", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull(), processId: int("processId").notNull(), codeHash: varchar("codeHash", { length: 128 }).notNull(), expiresAt: timestamp("expiresAt").notNull(), attempts: int("attempts").default(0).notNull(), maxAttempts: int("maxAttempts").default(5).notNull(), invalidatedAt: timestamp("invalidatedAt"), verifiedAt: timestamp("verifiedAt"), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ companyIdx: index("otp_company_idx").on(table.companyId), processIdx: index("otp_process_idx").on(table.processId) }));

export const aiAnalysisRuns = mysqlTable("ai_analysis_runs", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  processId: int("processId").notNull(),
  requestedByUserId: int("requestedByUserId").notNull(),
  providerMode: mysqlEnum("providerMode", ["demo", "real"]).default("demo").notNull(),
  status: mysqlEnum("status", ["queued", "running", "completed", "failed"]).default("queued").notNull(),
  sourceDocumentId: int("sourceDocumentId"),
  summary: text("summary"),
  errorMessage: varchar("errorMessage", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => ({ companyIdx: index("ai_runs_company_idx").on(table.companyId), processIdx: index("ai_runs_process_idx").on(table.processId) }));

export const aiDocumentFindings = mysqlTable("ai_document_findings", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  processId: int("processId").notNull(),
  analysisRunId: int("analysisRunId").notNull(),
  documentId: int("documentId"),
  requirementId: int("requirementId"),
  sourcePageStart: int("sourcePageStart"),
  sourcePageEnd: int("sourcePageEnd"),
  detectedType: varchar("detectedType", { length: 180 }).notNull(),
  suggestedName: varchar("suggestedName", { length: 255 }),
  confidence: int("confidence").notNull(),
  status: mysqlEnum("status", ["identified", "review_required", "confirmed", "corrected", "rejected"]).default("identified").notNull(),
  issueType: varchar("issueType", { length: 80 }),
  issueMessage: varchar("issueMessage", { length: 500 }),
  extractedData: text("extractedData"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ companyIdx: index("ai_findings_company_idx").on(table.companyId), processIdx: index("ai_findings_process_idx").on(table.processId), runIdx: index("ai_findings_run_idx").on(table.analysisRunId) }));

export const aiConversations = mysqlTable("ai_conversations", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  userId: int("userId").notNull(),
  processId: int("processId"),
  title: varchar("title", { length: 180 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ companyIdx: index("ai_conversations_company_idx").on(table.companyId), userIdx: index("ai_conversations_user_idx").on(table.userId), processIdx: index("ai_conversations_process_idx").on(table.processId) }));

export const aiConversationMessages = mysqlTable("ai_conversation_messages", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  conversationId: int("conversationId").notNull(),
  userId: int("userId"),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  model: varchar("model", { length: 120 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ companyIdx: index("ai_messages_company_idx").on(table.companyId), conversationIdx: index("ai_messages_conversation_idx").on(table.conversationId) }));

export const aiInsights = mysqlTable("ai_insights", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  processId: int("processId"),
  type: varchar("type", { length: 80 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  description: text("description").notNull(),
  severity: mysqlEnum("severity", ["info", "warning", "critical", "success"]).default("info").notNull(),
  status: mysqlEnum("status", ["unread", "read", "reviewed", "resolved"]).default("unread").notNull(),
  dedupeKey: varchar("dedupeKey", { length: 220 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
}, (table) => ({ companyIdx: index("ai_insights_company_idx").on(table.companyId), processIdx: index("ai_insights_process_idx").on(table.processId), dedupeIdx: uniqueIndex("ai_insights_company_dedupe_idx").on(table.companyId, table.dedupeKey) }));

export const aiHiringSummaries = mysqlTable("ai_hiring_summaries", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  processId: int("processId").notNull(),
  summary: text("summary").notNull(),
  dataFingerprint: varchar("dataFingerprint", { length: 128 }).notNull(),
  model: varchar("model", { length: 120 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ companyIdx: index("ai_summaries_company_idx").on(table.companyId), processIdx: uniqueIndex("ai_summaries_process_idx").on(table.companyId, table.processId) }));

export const companyCommunicationSettings = mysqlTable("company_communication_settings", {
  id: int("id").autoincrement().primaryKey(), companyId: int("companyId").notNull().unique(), senderName: varchar("senderName", { length: 160 }).default("Equipo de Talento Humano").notNull(), senderEmail: varchar("senderEmail", { length: 320 }), logoUrl: varchar("logoUrl", { length: 500 }), signature: text("signature"), subjectTemplate: varchar("subjectTemplate", { length: 240 }), bodyTemplate: text("bodyTemplate"), reminderTemplate: text("reminderTemplate"), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiAnalysisRun = typeof aiAnalysisRuns.$inferSelect;
export type AiDocumentFinding = typeof aiDocumentFindings.$inferSelect;
export type AiConversation = typeof aiConversations.$inferSelect;
export type AiConversationMessage = typeof aiConversationMessages.$inferSelect;
export type AiInsight = typeof aiInsights.$inferSelect;
export type AiHiringSummary = typeof aiHiringSummaries.$inferSelect;
export type CandidateOtpChallenge = typeof candidateOtpChallenges.$inferSelect;
export type CommunicationLog = typeof communicationLogs.$inferSelect;
export type ProcessActivity = typeof processActivities.$inferSelect;
export type CompanyCommunicationSettings = typeof companyCommunicationSettings.$inferSelect;
export type InternalNotification = typeof internalNotifications.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type RoleKey = "SUPER_ADMIN" | "COMPANY_ADMIN" | "HR" | "FINANCE" | "MANAGER" | "EMPLOYEE";
