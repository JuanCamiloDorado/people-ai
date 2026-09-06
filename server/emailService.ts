export type EmailPayload = { to: string; subject: string; html: string; text: string };
export type MailtoDraft = EmailPayload & { status: "prepared"; mailtoUrl: string };

/** Contrato local: prepara un correo para que la analista lo revise y lo envíe desde su cliente. */
export interface EmailComposer { compose(payload: EmailPayload): MailtoDraft; }

/** RFC 6068: el query de un `mailto:` es percent-encoding puro, no
 *  `application/x-www-form-urlencoded`. Antes esta funcion remataba con
 *  `.replace(/%20/g, "+")` -- el truco de los formularios HTTP -- y el candidato recibia
 *  "Hola+CAMILO+DORADO,": para un cliente de correo el `+` es un signo mas literal, no un
 *  espacio, y lo pinta tal cual. Con `%20` lo decodifican todos. */
function encode(value: string) {
  return encodeURIComponent(value);
}

/** El cuerpo ademas normaliza los saltos a CRLF (`%0D%0A`), el fin de linea de RFC 5322.
 *  Con `%0A` a secas Outlook de escritorio pega todo el correo en un solo parrafo. Solo aplica
 *  al body: `to` y `subject` no llevan saltos. */
function encodeBody(value: string) {
  return encode(value.replace(/\r\n|\r|\n/g, "\r\n"));
}

export function buildMailtoUrl(payload: Pick<EmailPayload, "to" | "subject" | "text">) {
  return `mailto:${encode(payload.to)}?subject=${encode(payload.subject)}&body=${encodeBody(payload.text)}`;
}

export class MailtoEmailComposer implements EmailComposer {
  compose(payload: EmailPayload): MailtoDraft {
    return { ...payload, status: "prepared", mailtoUrl: buildMailtoUrl(payload) };
  }
}

export function prepareMailtoEmail(payload: EmailPayload): MailtoDraft {
  return new MailtoEmailComposer().compose(payload);
}

/** Compatibilidad de dominio: ya no realiza envíos y no consulta ningún proveedor externo. */
export async function sendTransactionalEmail(payload: EmailPayload): Promise<MailtoDraft> {
  return prepareMailtoEmail(payload);
}
