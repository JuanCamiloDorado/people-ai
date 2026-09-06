import { describe, expect, it } from "vitest";
import { buildManualCommunicationRecord, communicationAuditAction, createZipArchive, buildCandidateEmail, hashOtp, isExpiringWithin, isLinkUsable, isOtpUsable, isReminderAllowed, manualCommunicationEvents } from "./hrDomain";
import { buildMailtoUrl, prepareMailtoEmail } from "./emailService";

describe("Fase 3.1 - OTP", () => {
  it("only stores a deterministic hash and accepts active challenges", () => {
    const now = Date.now();
    expect(hashOtp("123456")).toHaveLength(64);
    expect(hashOtp("123456")).toBe(hashOtp("123456"));
    expect(isOtpUsable({ invalidatedAt: null, verifiedAt: null, expiresAt: new Date(now + 1000), attempts: 0, maxAttempts: 5 }, now)).toBe(true);
    expect(isOtpUsable({ invalidatedAt: new Date(), verifiedAt: null, expiresAt: new Date(now + 1000), attempts: 0, maxAttempts: 5 }, now)).toBe(false);
    expect(isOtpUsable({ invalidatedAt: null, verifiedAt: null, expiresAt: new Date(now - 1), attempts: 0, maxAttempts: 5 }, now)).toBe(false);
    expect(isOtpUsable({ invalidatedAt: null, verifiedAt: null, expiresAt: new Date(now + 1000), attempts: 5, maxAttempts: 5 }, now)).toBe(false);
  });
});

describe("Fase 3.1 - expediente y enlaces", () => {
  it("detects expiring links and blocks reminder cooldown", () => {
    const now = Date.now();
    expect(isExpiringWithin(new Date(now + 23 * 3600000), 24, now)).toBe(true);
    expect(isExpiringWithin(new Date(now + 25 * 3600000), 24, now)).toBe(false);
    expect(isReminderAllowed(new Date(now - 5 * 3600000), 4, now)).toBe(true);
    expect(isReminderAllowed(new Date(now - 2 * 3600000), 4, now)).toBe(false);
    expect(communicationAuditAction("reminder", "not_configured")).toBe("candidate_reminder_not_configured");
  });
  it("creates a ZIP with the normalized document entries", async () => {
    const archive = await createZipArchive([{ name: "cedula.pdf", bytes: new TextEncoder().encode("%PDF-demo") }, { name: "foto.png", bytes: new Uint8Array([137, 80, 78, 71]) }]);
    expect(archive.length).toBeGreaterThan(40);
  });
  it("distinguishes active, revoked and expired links", () => {
    const now = Date.now();
    expect(isLinkUsable("active", new Date(now + 1000), now)).toBe(true);
    expect(isLinkUsable("revoked", new Date(now + 1000), now)).toBe(false);
    expect(isLinkUsable("active", new Date(now - 1000), now)).toBe(false);
  });
});

describe("Fase 3.1 - correo transaccional", () => {
  it("renders candidate, position, company and secure portal URL", () => {
    const email = buildCandidateEmail({ candidate: { fullName: "Ada Lovelace" }, position: { name: "Ingeniera" }, company: { name: "Empresa Demo" } } as never, "https://people.example/candidate/documents/token-demo");
    expect(email.text).toContain("Ada Lovelace");
    expect(email.text).toContain("Ingeniera");
    expect(email.html).toContain("Empresa Demo");
    expect(email.html).toContain("https://people.example/candidate/documents/token-demo");
  });

  it("includes documentDeadline in email text and html when specified", () => {
    const deadline = new Date("2026-09-15T00:00:00Z");
    const email = buildCandidateEmail({
      candidate: { fullName: "Ada Lovelace" },
      position: { name: "Ingeniera" },
      company: { name: "Empresa Demo" },
      process: { documentDeadline: deadline },
    } as never, "https://people.example/candidate/documents/token-demo");
    expect(email.text).toContain("Fecha límite para cargar documentos:");
    expect(email.html).toContain("Fecha límite para cargar documentos:");
  });

  /** Regresion: el template estaba escrito con `\\n`, que dentro de un template literal produce
   *  barra invertida + letra n. El candidato veia "Hola CAMILO DORADO,\\n\\nNos encontramos...". */
  it("usa saltos de linea reales, no la secuencia literal \\n", () => {
    const email = buildCandidateEmail({ candidate: { fullName: "Ada Lovelace" }, position: { name: "Ingeniera" }, company: { name: "Empresa Demo" } } as never, "https://people.example/candidate/documents/token-demo");
    expect(email.text).not.toContain("\\n");
    expect(email.text.split("\n").length).toBeGreaterThan(3);
  });

  /** Regresion: `escapeHtml` se aplicaba una vez arriba y el resultado se reutilizaba en el
   *  texto plano, asi que un candidato con "&" en el nombre recibia "&amp;" en el correo. */
  it("no filtra entidades HTML al cuerpo en texto plano", () => {
    const email = buildCandidateEmail({ candidate: { fullName: "Ana & José" }, position: { name: "Diseñador & Co" }, company: { name: "Empresa Demo" } } as never, "https://people.example/candidate/documents/token-demo");
    expect(email.text).toContain("Ana & José");
    expect(email.text).not.toContain("&amp;");
    expect(email.html).toContain("Ana &amp; José");
  });

  it("prepares a mailto draft without sending or requiring a provider", () => {
    const draft = prepareMailtoEmail({ to: "candidate@example.test", subject: "Demo", text: "Hola candidata", html: "<p>Hola candidata</p>" });
    expect(draft.status).toBe("prepared");
    expect(draft.mailtoUrl).toBe(buildMailtoUrl({ to: "candidate@example.test", subject: "Demo", text: "Hola candidata" }));
    expect(decodeURIComponent(draft.mailtoUrl)).toContain("candidate@example.test");
    expect(decodeURIComponent(draft.mailtoUrl)).toContain("Hola candidata");
  });

  it("records manual send separately from draft preparation", () => {
    const now = new Date("2026-08-31T00:00:00Z");
    const record = buildManualCommunicationRecord("reminder", "candidate@example.test", "Recordatorio", now, 4);
    expect(record.status).toBe("sent");
    expect(record.sentAt).toBe(now);
    expect(record.cooldownUntil).toEqual(new Date("2026-08-31T04:00:00Z"));
    expect(manualCommunicationEvents("initial")).toEqual({ activity: "link_sent", audit: "candidate_initial_sent" });
    expect(manualCommunicationEvents("reminder")).toEqual({ activity: "communication_reminder_sent", audit: "candidate_reminder_sent" });
  });

  it("encodes recipient, subject and body safely in mailto", () => {
    const url = buildMailtoUrl({ to: "candidate@example.test", subject: "Documentación & proceso", text: "Línea 1\nLínea 2" });
    expect(url.startsWith("mailto:candidate%40example.test?")).toBe(true);
    expect(decodeURIComponent(url)).toContain("Documentación & proceso");
    expect(decodeURIComponent(url)).toContain("Línea 1\r\nLínea 2");
  });

  /** Regresion: `encode` remataba con `.replace(/%20/g, "+")`, el truco de
   *  `application/x-www-form-urlencoded`. En un `mailto:` (RFC 6068) el query es
   *  percent-encoding puro y el `+` es un signo mas literal: el candidato recibia
   *  "Hola+CAMILO+DORADO". */
  it("codifica los espacios como %20 y nunca como +", () => {
    const url = buildMailtoUrl({ to: "candidate@example.test", subject: "Documentación requerida", text: "Hola CAMILO DORADO" });
    expect(url).toContain("%20");
    expect(url).not.toContain("+");
  });

  /** Regresion: los saltos del cuerpo deben viajar como CRLF (`%0D%0A`), no como `%0A` suelto,
   *  que Outlook de escritorio ignora y pega todo el correo en un parrafo. */
  it("codifica los saltos del cuerpo como CRLF y hace round-trip del texto", () => {
    const text = "Hola Ada,\n\nSegunda línea.\n\nGracias.";
    const url = buildMailtoUrl({ to: "candidate@example.test", subject: "Asunto con espacios", text });
    expect(url).toContain("%0D%0A");
    expect(decodeURIComponent(url.split("&body=")[1])).toBe(text.replace(/\n/g, "\r\n"));
  });
});
