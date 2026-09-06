import { describe, expect, it } from "vitest";
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES, MAX_ZIP_BYTES, hasMagicSignature, hashToken, isValidUpload, normalize, uniqueZipName } from "./hrDomain";
import { assertCompanyScope, assertRole } from "./authorization";

describe("Fases 2 y 3 — seguridad y documentos", () => {
  it("genera un hash determinista que no expone el token", () => {
    const token = "candidate-demo-token-without-personal-data";
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("normaliza el nombre desde el título del requisito y conserva extensión", () => {
    expect(normalize("Hoja de vida personal", "HV_Carlos_Final.pdf")).toBe("Hoja de vida personal.pdf");
    expect(normalize("Cédula de ciudadanía", "IMG_8272.JPG")).toBe("Cédula de ciudadanía.jpg");
  });

  it("acepta únicamente formatos documentales permitidos y limita tamaño", () => {
    expect(ALLOWED_MIME_TYPES.has("application/pdf")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("image/jpeg")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("application/x-executable")).toBe(false);
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(hasMagicSignature(new TextEncoder().encode("%PDF-1.7"), "application/pdf")).toBe(true);
    expect(hasMagicSignature(new Uint8Array([0, 1, 2]), "application/pdf")).toBe(false);
    expect(isValidUpload("documento.pdf", "application/pdf", 1200, new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(isValidUpload("documento.exe", "application/pdf", 1200)).toBe(false);
    expect(isValidUpload("documento.pdf", "application/pdf", MAX_FILE_BYTES + 1)).toBe(false);
  });

  it("rechaza alcance cross-tenant y roles insuficientes", () => {
    expect(() => assertCompanyScope({ role: "HR", companyId: 4 }, 5)).toThrow();
    expect(() => assertRole({ role: "EMPLOYEE", companyId: 4 }, ["HR"])).toThrow();
    expect(() => assertRole({ role: "HR", companyId: 4 }, ["HR"])).not.toThrow();
  });

  it("el borrado de una contratación no revienta sin base de datos", async () => {
    // Como el resto del módulo, `deleteHiring` tiene que degradar en vez de lanzar cuando
    // `getDb()` devuelve undefined: sin esta rama, abrir la página sin base tumbaría la
    // mutation con un error de infraestructura en lugar de un no-op.
    const { deleteHiring } = await import("./hrDomain");
    await expect(deleteHiring(4, 1, 1)).resolves.toMatchObject({ success: true, id: 1, avisoAlmacenamiento: false });
  });

  it("calcula estructura de estadísticas del dashboard", async () => {
    const { getDashboardStats } = await import("./hrDomain");
    const stats = await getDashboardStats(4);
    expect(stats).toHaveProperty("totalProcesses");
    expect(stats).toHaveProperty("pendingDocuments");
    expect(stats).toHaveProperty("completeProcesses");
    expect(stats).toHaveProperty("assistantQueries");
    expect(typeof stats.totalProcesses).toBe("number");
    expect(typeof stats.pendingDocuments).toBe("number");
    expect(typeof stats.completeProcesses).toBe("number");
    expect(typeof stats.assistantQueries).toBe("number");
  });

  it("garantiza la definición estándar de la plantilla por defecto 'Expediente de Ingreso Estándar'", async () => {
    const { DEFAULT_TEMPLATE_NAME, DEFAULT_STANDARD_DOCUMENTS } = await import("./hrDomain");
    expect(DEFAULT_TEMPLATE_NAME).toBe("Expediente de Ingreso Estándar");
    expect(DEFAULT_STANDARD_DOCUMENTS.length).toBe(6);
    expect(DEFAULT_STANDARD_DOCUMENTS.some(d => d.title.includes("Cédula"))).toBe(true);
    expect(DEFAULT_STANDARD_DOCUMENTS.some(d => d.title.includes("Hoja de Vida"))).toBe(true);
    expect(DEFAULT_STANDARD_DOCUMENTS.some(d => d.title.includes("EPS"))).toBe(true);
    expect(DEFAULT_STANDARD_DOCUMENTS.some(d => d.title.includes("Pensiones"))).toBe(true);
    expect(DEFAULT_STANDARD_DOCUMENTS.some(d => d.title.includes("Examen Médico"))).toBe(true);
  });

  it("permite consultar la plantilla estándar maestra de la empresa", async () => {
    const { getMasterStandardTemplate } = await import("./hrDomain");
    const master = await getMasterStandardTemplate(4);
    expect(master).toHaveProperty("items");
    expect(Array.isArray(master.items)).toBe(true);
    expect(master.items.length).toBeGreaterThanOrEqual(1);
  });

  it("permite actualizar la plantilla estándar maestra de la empresa preservando tipos de archivo permitidos", async () => {
    const { updateMasterStandardTemplate } = await import("./hrDomain");
    const newItems = [
      { title: "Cédula de Ciudadanía", description: "PDF legible", required: true, sortOrder: 1, allowedMimeTypes: "application/pdf" },
      { title: "Hoja de Vida", description: "Formato actualizado", required: true, sortOrder: 2, allowedMimeTypes: "application/pdf,image/jpeg,image/png,image/webp" },
    ];
    const updated = await updateMasterStandardTemplate(4, newItems);
    expect(updated.items.length).toBe(2);
    expect(updated.items[0].title).toBe("Cédula de Ciudadanía");
    expect(updated.items[0].allowedMimeTypes).toBe("application/pdf");
    expect(updated.items[1].allowedMimeTypes).toBe("application/pdf,image/jpeg,image/png,image/webp");
  });

  it("exporta y ejecuta la sincronización de procesos activos con plantillas", async () => {
    const { syncActiveProcessesWithTemplate } = await import("./hrDomain");
    expect(typeof syncActiveProcessesWithTemplate).toBe("function");
    await expect(syncActiveProcessesWithTemplate(4, 999, [])).resolves.not.toThrow();
  });

  it("permite ejecutar el flujo de creación y eliminación de un cargo", async () => {
    const { createPosition, deletePosition } = await import("./hrDomain");
    const testName = `Cargo Test ${Date.now()}`;
    const newId = await createPosition(4, testName, "Descripción de prueba para test");
    expect(typeof newId).toBe("number");
    expect(newId).toBeGreaterThan(0);

    const deleteRes = await deletePosition(4, newId);
    expect(deleteRes).toEqual({ success: true, id: newId });
  });

  it("permite crear plantillas reutilizables a nivel empresa y asignarlas a múltiples cargos", async () => {
    const { createPosition, createTemplate, assignTemplateToPosition, listPositions, getTemplate, deletePosition } = await import("./hrDomain");

    // 1. Create a standalone company template
    const templateName = `Plantilla Reutilizable ${Date.now()}`;
    const items = [
      { title: "Certificado de Antecedentes", description: "Vigencia 30 días", required: true, sortOrder: 1 },
      { title: "Certificación Bancaria", description: "Cuenta activa", required: false, sortOrder: 2 },
    ];
    const createdTemplate = await createTemplate(4, templateName, items);
    expect(createdTemplate).toHaveProperty("id");
    expect(createdTemplate.name).toBe(templateName);
    expect(createdTemplate.companyId).toBe(4);

    // 2. Create two distinct positions
    const pos1Id = await createPosition(4, `Cargo A ${Date.now()}`, "Perfil A");
    const pos2Id = await createPosition(4, `Cargo B ${Date.now()}`, "Perfil B");

    // 3. Assign the SAME reusable template to both positions
    const assign1 = await assignTemplateToPosition(4, pos1Id, createdTemplate.id);
    const assign2 = await assignTemplateToPosition(4, pos2Id, createdTemplate.id);
    expect(assign1).toEqual({ success: true, positionId: pos1Id, templateId: createdTemplate.id });
    expect(assign2).toEqual({ success: true, positionId: pos2Id, templateId: createdTemplate.id });

    // 4. Verify both positions list the templateId if DB is active
    const allPositions = await listPositions(4);
    if (allPositions.length > 0) {
      const pos1 = allPositions.find(p => p.id === pos1Id);
      const pos2 = allPositions.find(p => p.id === pos2Id);
      expect(pos1?.templateId).toBe(createdTemplate.id);
      expect(pos2?.templateId).toBe(createdTemplate.id);
    }

    // 5. Clean up positions
    await deletePosition(4, pos1Id);
    await deletePosition(4, pos2Id);

    // 6. Verify the shared template still exists and is not deleted by deleting a position
    const fetchedTemplate = await getTemplate(4, createdTemplate.id);
    if (fetchedTemplate) {
      expect(fetchedTemplate.name).toBe(templateName);
    }
  });

  it("permite registrar y actualizar la fecha límite de entrega de documentos en un proceso de contratación", async () => {
    const { createHiring, updateHiringDeadline, createPosition, deletePosition, getMasterStandardTemplate } = await import("./hrDomain");
    const master = await getMasterStandardTemplate(4);
    if (!master) return;
    const posId = await createPosition(4, `Cargo Deadline Test ${Date.now()}`, "Test desc");
    const deadline = new Date("2026-10-01T23:59:59.000Z");
    try {
      const created = await createHiring(4, 1, {
        fullName: "Candidato Con Fecha Límite",
        identificationNumber: "1098765432",
        email: "candidato.deadline@test.com",
        positionId: posId,
        templateId: master.id,
        documentDeadline: deadline,
      });
      expect(created).not.toBeNull();
      expect(created?.process.documentDeadline).toBeDefined();

      const updatedDeadline = new Date("2026-10-15T23:59:59.000Z");
      const updated = await updateHiringDeadline(4, created!.process.id, updatedDeadline, 1);
      expect(updated).not.toBeNull();
      expect(updated?.process.documentDeadline).toBeDefined();
    } finally {
      await deletePosition(4, posId);
    }
  });

  it("aplica validaciones estrictas de tipo de archivo y magic bytes según allowedMimeTypes", () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.7 test content");
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    const xlsxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);

    // 1. Requisito con Solo PDF
    const pdfOnly = "application/pdf";
    expect(isValidUpload("cedula.pdf", "application/pdf", 1024, pdfBytes, pdfOnly)).toBe(true);
    expect(isValidUpload("foto.jpg", "image/jpeg", 1024, jpegBytes, pdfOnly)).toBe(false);
    expect(isValidUpload("doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1024, docxBytes, pdfOnly)).toBe(false);

    // 2. Requisito con Solo Fotos
    const photosOnly = "image/jpeg,image/png,image/webp";
    expect(isValidUpload("cedula.pdf", "application/pdf", 1024, pdfBytes, photosOnly)).toBe(false);
    expect(isValidUpload("foto.jpg", "image/jpeg", 1024, jpegBytes, photosOnly)).toBe(true);
    expect(isValidUpload("foto.png", "image/png", 1024, pngBytes, photosOnly)).toBe(true);

    // 3. Requisito con Word y PDF
    const wordAndPdf = "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(isValidUpload("hoja_de_vida.pdf", "application/pdf", 1024, pdfBytes, wordAndPdf)).toBe(true);
    expect(isValidUpload("hoja_de_vida.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1024, docxBytes, wordAndPdf)).toBe(true);
    expect(isValidUpload("tabla.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1024, xlsxBytes, wordAndPdf)).toBe(false);
    expect(isValidUpload("foto.jpg", "image/jpeg", 1024, jpegBytes, wordAndPdf)).toBe(false);

    // 4. Requisito con Excel y PDF
    const excelAndPdf = "application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(isValidUpload("balance.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1024, xlsxBytes, excelAndPdf)).toBe(true);
    expect(isValidUpload("balance.pdf", "application/pdf", 1024, pdfBytes, excelAndPdf)).toBe(true);
    expect(isValidUpload("carta.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1024, docxBytes, excelAndPdf)).toBe(false);

    // 5. Rechaza magic bytes falsos
    const fakeDocx = new TextEncoder().encode("Not a zip file");
    expect(isValidUpload("fake.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1024, fakeDocx, wordAndPdf)).toBe(false);
  });

  it("persiste allowedMimeTypes al crear y consultar plantillas personalizadas", async () => {
    const { createTemplate, getTemplate } = await import("./hrDomain");
    const templateName = `Plantilla Tipos Archivo ${Date.now()}`;
    const items = [
      {
        title: "Cédula Solo PDF",
        description: "En formato PDF únicamente",
        required: true,
        sortOrder: 1,
        allowedMimeTypes: "application/pdf",
      },
      {
        title: "Hoja de Vida Word o PDF",
        description: "Word o PDF editable",
        required: true,
        sortOrder: 2,
        allowedMimeTypes: "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      {
        title: "Prueba Técnica Excel",
        description: "Hoja de cálculo",
        required: false,
        sortOrder: 3,
        allowedMimeTypes: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ];

    const created = await createTemplate(4, templateName, items);
    expect(created).toHaveProperty("id");
    expect(created.items.length).toBe(3);
    expect(created.items[0].allowedMimeTypes).toBe("application/pdf");
    expect(created.items[1].allowedMimeTypes).toContain("wordprocessingml");
    expect(created.items[2].allowedMimeTypes).toContain("spreadsheetml");

    const fetched = await getTemplate(4, created.id);
    if (fetched) {
      expect(fetched.items.length).toBe(3);
      expect(fetched.items[0].allowedMimeTypes).toBe("application/pdf");
      expect(fetched.items[1].allowedMimeTypes).toContain("wordprocessingml");
      expect(fetched.items[2].allowedMimeTypes).toContain("spreadsheetml");
    }
  });
});

describe("descarga del expediente comprimido", () => {
  it("desambigua nombres repetidos en vez de dejar que JSZip los pise", () => {
    // `normalize()` produce `${titulo}.${ext}`, asi que dos requisitos con el mismo
    // titulo daban el mismo nombre y JSZip sobrescribia en silencio: un documento
    // desaparecia del expediente sin ningun error.
    const usados = new Set<string>();
    expect(uniqueZipName(usados, "Certificado laboral.pdf")).toBe("Certificado laboral.pdf");
    expect(uniqueZipName(usados, "Certificado laboral.pdf")).toBe("Certificado laboral-2.pdf");
    expect(uniqueZipName(usados, "Certificado laboral.pdf")).toBe("Certificado laboral-3.pdf");
    expect(uniqueZipName(usados, "Otro.pdf")).toBe("Otro.pdf");
  });

  it("desambigua tambien cuando el nombre no tiene extension", () => {
    const usados = new Set<string>();
    expect(uniqueZipName(usados, "Anexo")).toBe("Anexo");
    expect(uniqueZipName(usados, "Anexo")).toBe("Anexo-2");
  });

  it("no colisiona con un nombre que ya termina en el sufijo de desambiguacion", () => {
    const usados = new Set<string>();
    expect(uniqueZipName(usados, "Contrato.pdf")).toBe("Contrato.pdf");
    expect(uniqueZipName(usados, "Contrato-2.pdf")).toBe("Contrato-2.pdf");
    expect(uniqueZipName(usados, "Contrato.pdf")).toBe("Contrato-3.pdf");
  });

  it("el tope del ZIP deja margen dentro de los 512 MB del contenedor", () => {
    // El pico ronda 3,3 veces la suma (documentos + ZIP + su base64 en la respuesta
    // tRPC). Si alguien sube este valor, que sea con esa cuenta delante.
    expect(MAX_ZIP_BYTES).toBe(40 * 1024 * 1024);
    expect(MAX_ZIP_BYTES * 3.3).toBeLessThan(200 * 1024 * 1024);
  });
});
