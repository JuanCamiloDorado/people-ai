/** `href` de un `tel:` derivado del texto que Talento Humano guardo.
 *
 *  Antes el portal tenia `href="tel:+573000000000"` y justo debajo, como texto visible,
 *  "+57 (601) 000 0000": dos numeros distintos dentro del MISMO enlace. Quien leia copiaba
 *  uno y quien pulsaba desde el movil marcaba otro, y nada en el codigo relacionaba ambos
 *  literales, asi que corregir uno no corregia el otro.
 *
 *  Ahora hay una sola fuente -- `companies.candidateSupportPhone` -- y el href se deriva
 *  de ella: no pueden volver a divergir. Se conservan solo digitos y un `+` inicial, que
 *  es lo que entiende RFC 3966; los parentesis, espacios y guiones del formato colombiano
 *  se quedan en el texto visible, donde ayudan a leer.
 *
 *  Vive en `shared/` y no dentro de la pagina para que los tests puedan importarlo:
 *  `vitest.config.ts` solo recoge `server/**`. Mismo motivo por el que
 *  `server/statusFormatters.test.ts` cruza la frontera hacia el cliente. */
export const telHref = (telefono: string) =>
  `tel:${telefono.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "")}`;
