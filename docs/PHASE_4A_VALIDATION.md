# Informe de validación — Fase 4A

**Proyecto:** PEOPLE AI  
**Fase:** 4A — Inteligencia documental y People AI Assistant  
**Estado:** Implementación funcional sobre el MVP de Fases 1–3.1; no se avanzó a WhatsApp, Teams ni Fase 5.

## Alcance implementado

La Fase 4A añade una capa de inteligencia artificial desacoplada mediante `AIProvider`. La aplicación conserva `companyId` en todas las entidades nuevas y en todos los procedimientos tRPC. El backend valida empresa, proceso y rol antes de consultar o mutar cualquier resultado. Los resultados de IA se almacenan con proveedor, modo, confianza, estado de revisión y auditoría.

| Capacidad | Estado | Evidencia principal |
|---|---:|---|
| Runs de análisis documental | Implementado | `ai_analysis_runs`, `analyzeHiringDocuments` |
| Identificación y clasificación | Implementado | `ai_document_findings`, confianza 0–100 |
| Faltantes e incertidumbre | Implementado | hallazgos `missing` y `review_required` |
| Revisión humana | Implementado | confirmar, corregir tipo/requisito y descartar |
| Auditoría | Implementado | `auditLogs` módulo `ai` |
| Proveedor DEMO | Implementado | `demoProvider`, visible en la interfaz |
| Proveedor real | Implementado | `invokeLLM`, respuestas estructuradas y URLs firmadas |
| Asistente general | Implementado | `/hr/assistant`, `trpc.ai.ask` |
| Asistente contextual | Implementado | `HiringDetailPage` con `processId` |
| Confirmación de acciones sensibles | Implementado | diálogo confirmar/cancelar; no ejecuta mutaciones automáticamente |
| AI Insights | Implementado | estados unread/read/reviewed/resolved y deduplicación |
| Resumen de contratación | Implementado | fingerprint por proceso y actualización por cambios |
| Separación PDF | Preparado | `splitPdfBytes` conserva el original; integración automática de expediente queda delimitada |
| WhatsApp y Teams | Fuera de alcance | contratos preparados, canales no activos |

## Modelo y datos procesados

El análisis usa requisitos de la contratación, nombres de archivo, MIME, nombre normalizado y, en modo real, el contenido de archivos privados mediante URLs firmadas de corta duración. El modo DEMO nunca simula una llamada externa: clasifica de forma determinista los metadatos entregados, marca incertidumbre y declara explícitamente `PEOPLE AI DEMO`.

En modo real, el servicio usa el catálogo de modelos incorporado disponible en el entorno y actualmente selecciona `gpt-5-mini`. La respuesta documental exige JSON estructurado con tipo detectado, requisito asociado, confianza, nombre sugerido, páginas cuando el modelo pueda determinarlas, incidencia y estado de revisión. La aplicación limita la confianza a 0–100 y fuerza revisión humana por debajo del umbral de confianza.

> La IA propone asociaciones y hallazgos; no rechaza candidatos, no decide contratación y no modifica requisitos automáticamente.

## Seguridad y privacidad

Todas las nuevas tablas incluyen `companyId` y los procedimientos exigen `SUPER_ADMIN`, `COMPANY_ADMIN` o `HR`, además de `assertCompanyScope`. Las conversaciones se filtran por empresa y usuario. Las conversaciones contextualizadas se filtran adicionalmente por `processId`. Las URLs de storage siguen siendo privadas y firmadas; no se guardan credenciales en el cliente ni se insertan contenidos documentales en logs de auditoría.

La corrección humana conserva la trazabilidad del resultado original mediante el registro de finding y una acción auditada. AI Insights usa una clave de deduplicación por empresa y contexto para evitar spam. Las mutaciones sensibles sugeridas por el asistente solo muestran una propuesta y requieren confirmación explícita; la confirmación no sustituye la ejecución manual del módulo autorizado.

## Validación automatizada

La suite final pasa con **35 pruebas**: las 30 existentes de Fases 1–3.1 más cinco pruebas específicas de Fase 4A. Se validaron el análisis DEMO, faltantes, confianza, transparencia, ausencia de invención, detección de acciones sensibles y separación PDF por páginas. TypeScript (`pnpm check`) y build (`pnpm build`) finalizan correctamente.

La validación del navegador autenticado y la interacción con objetos reales de storage permanecen como verificación manual pendiente porque la sesión OAuth no pudo completarse en el navegador de verificación. No se enviaron correos reales ni se realizaron comunicaciones externas.

## Configuración externa y límites

El modo DEMO funciona sin credenciales adicionales y debe mantenerse para demostraciones. El modo real requiere que estén disponibles `BUILT_IN_FORGE_API_URL` y `BUILT_IN_FORGE_API_KEY` (catálogo LLM incorporado) y, por separado, las `STORAGE_S3_*` que permiten firmar las URLs de los documentos. El proveedor real descarga archivos privados desde esas URLs firmadas, que se emiten con 900 s de vida porque las consume el LLM y no un navegador; una organización debe revisar retención, residencia, consentimiento y políticas del proveedor antes de activarlo en producción.

La utilidad PDF puede separar bytes por página, pero esta iteración no crea automáticamente nuevos expedientes derivados ni reemplaza el original en storage. La extracción OCR especializada, el versionado de páginas, el enriquecimiento de Knowledge Base y las acciones operativas automáticas requieren una fase posterior. WhatsApp, Microsoft Teams y otros canales siguen desactivados.

## Archivos principales

| Área | Archivos |
|---|---|
| Esquema | `drizzle/schema.ts`, `drizzle/0006_pale_hellfire_club.sql` |
| Dominio AI | `server/aiDomain.ts` |
| Contratos | `shared/extensions.ts` |
| API | `server/routers.ts` |
| Asistente | `client/src/pages/HRSection.tsx`, `client/src/pages/HiringDetailPage.tsx` |
| Insights | `client/src/pages/HRDashboard.tsx`, `client/src/pages/NotificationsPage.tsx` |
| Pruebas | `server/ai.domain.test.ts` |

## Decisión de cierre

La Fase 4A queda implementada y validada como una capacidad de IA asistida, explicable y con revisión humana. El sistema se entrega sin activar canales de mensajería externos y sin convertir resultados DEMO en supuestos resultados reales. El siguiente checkpoint debe representar esta versión y no debe confundirse con una habilitación de producción del proveedor real.
