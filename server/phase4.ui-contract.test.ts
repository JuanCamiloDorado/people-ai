import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readClient = (file: string) => readFileSync(resolve(process.cwd(), "client/src/pages", file), "utf8");
const readComponent = (file: string) => readFileSync(resolve(process.cwd(), "client/src/components", file), "utf8");

describe("Fase 4A UI contracts", () => {
  it("expone asistente contextual limitado por processId", () => {
    const source = readClient("HiringDetailPage.tsx");
    expect(source).toContain("ContextualAssistant");
    expect(source).toContain("processId, question: content");
    expect(source).toContain("contexto de esta contratación");
  });

  it("expone corrección manual de tipo y requisito", () => {
    const source = readClient("HiringDetailPage.tsx");
    expect(source).toContain("Guardar corrección");
    expect(source).toContain('status: "corrected"');
    expect(source).toContain("editedRequirement");
  });

  it("expone confirmar/cancelar para acciones sensibles sin mutación automática", () => {
    const source = readClient("HRSection.tsx");
    expect(source).toContain("Confirmación requerida");
    expect(source).toContain("Confirmar y revisar");
    expect(source).toContain("Cancelar");
    expect(source).toContain("no ejecutará cambios automáticamente");
  });

  it("garantiza que HRDashboard usa datos y rutas reales de backend sin datos demo hardcodeados", () => {
    const source = readClient("HRDashboard.tsx");
    expect(source).toContain("trpc.hiring.list.useQuery");
    expect(source).toContain("trpc.hr.stats.useQuery");
    expect(source).toContain("/hr/contrataciones");
    // El invariante es "el dashboard enlaza a rutas reales de detalle por proceso, con el id
    // que devuelve el backend". La tabla propia del dashboard ya no existe -- es
    // `HiringProcessesCard`, y su enlace por fila se verifica en la prueba de abajo --, pero
    // el dashboard sigue construyendo rutas de detalle por su cuenta desde los insights de
    // IA y desde los enlaces por expirar. Esas son las que quedan aqui.
    expect(source).toContain("/hr/contrataciones/${insight.processId}");
    expect(source).toContain("/hr/contrataciones/${item.processId}");
    expect(source).toContain("<HiringProcessesCard");
    expect(source).not.toContain('"08"');
    expect(source).not.toContain('"14"');
    expect(source).not.toContain('"05"');
    expect(source).not.toContain('"142"');
    expect(source).not.toContain("Consultas atendidas · demo");
  });

  it("la tabla compartida de procesos enlaza al detalle real de cada proceso", () => {
    // La mitad del invariante anterior que se mudo al componente: cada fila lleva al detalle
    // por id, y las filas salen del backend y no de una constante de demostracion.
    const source = readComponent("HiringProcessesCard.tsx");
    expect(source).toContain("trpc.hiring.list.useQuery");
    expect(source).toContain("/hr/contrataciones/${process.id}");
  });

  it("garantiza que CandidatePortalPage maneja estado de carga con skeleton sin flash de enlace expirado", () => {
    const source = readClient("CandidatePortalPage.tsx");
    expect(source).toContain("CandidatePortalSkeleton");
    expect(source).toContain("isLoadingPortal");
    expect(source).toContain("portal.isLoading");
    expect(source).toContain("No pudimos cargar la información");
    expect(source).toContain("Este enlace ya no está disponible");
    // Verifica que no se verifique !portal.data antes de verificar el estado de carga
    const loadingIndex = source.indexOf("isLoadingPortal");
    const skeletonIndex = source.indexOf("<CandidatePortalSkeleton");
    const expiredIndex = source.indexOf("Este enlace ya no está disponible");
    expect(loadingIndex).toBeGreaterThan(-1);
    expect(skeletonIndex).toBeGreaterThan(-1);
    expect(skeletonIndex).toBeLessThan(expiredIndex);
  });
});

