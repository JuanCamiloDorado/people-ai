/** Texto del correo que se le envia al candidato con el enlace del portal.
 *
 *  Vive en `shared/` porque hay dos consumidores que TIENEN que decir lo mismo: el correo que
 *  arma el servidor (`buildCandidateEmail` en `server/hrDomain.ts`) y el preview del modal
 *  "Enviar documentacion" (`HiringDetailPage.tsx`). Antes eran dos copias escritas a mano y
 *  divergieron: el preview prometia "Completa cada documento desde el enlace seguro." y omitia
 *  la fecha limite, mientras el correo real mandaba "Completa tu documentacion aqui: {url}".
 *  La analista revisaba un texto y se enviaba otro.
 *
 *  Modulo puro a proposito: el cliente lo importa en runtime, asi que no puede tener imports de
 *  Node, de drizzle ni de la base. Es la misma restriccion que ya arrastra `server/authorization.ts`
 *  y que rompe el build del cliente en cuanto se incumple. */

export const CANDIDATE_EMAIL_SUBJECT = "Documentación requerida para tu proceso de contratación";
export const CANDIDATE_REMINDER_SUBJECT = "Recordatorio: documentación pendiente";

export const candidateEmailSubject = (reminder = false) =>
  reminder ? CANDIDATE_REMINDER_SUBJECT : CANDIDATE_EMAIL_SUBJECT;

/** Formato unico de la fecha limite. El servidor y el modal lo mostraban por separado con la
 *  misma llamada copiada; centralizarlo evita que uno de los dos cambie y el otro no. */
export const formatDeadline = (value: Date | string) =>
  new Date(value).toLocaleDateString("es-CO", { dateStyle: "long" });

export type CandidateEmailInput = {
  candidateName?: string | null;
  positionName?: string | null;
  documentDeadline?: Date | string | null;
  portalUrl: string;
  reminder?: boolean;
};

/** Cuerpo en texto plano, con saltos de linea REALES.
 *
 *  Antes este template estaba en `hrDomain.ts` escrito con `\n`, que dentro de un template
 *  literal produce barra invertida + letra n, no un salto: el candidato recibia todo el correo
 *  en un parrafo con los "\n" a la vista. Los saltos de aqui son `\n` de verdad; convertirlos a
 *  CRLF para el `mailto:` es responsabilidad de `server/emailService.ts`. */
export function buildCandidateEmailText({
  candidateName,
  positionName,
  documentDeadline,
  portalUrl,
  reminder = false,
}: CandidateEmailInput): string {
  const candidate = candidateName || "candidato";
  const position = positionName || "tu cargo";
  const intro = reminder
    ? "Te recordamos que todavía tienes documentos pendientes de cargar para completar tu proceso de contratación."
    : `Nos encontramos adelantando tu proceso de contratación para el cargo de ${position}.`;
  const deadline = documentDeadline
    ? `\n\nFecha límite para cargar documentos: ${formatDeadline(documentDeadline)}.`
    : "";
  return `Hola ${candidate},\n\n${intro}${deadline}\n\nCompleta tu documentación aquí: ${portalUrl}\n\nGracias,\nEquipo de Talento Humano.`;
}
