/** Ordenacion de la tabla de procesos de contratacion.
 *
 *  Vive aparte del componente porque es logica pura y se puede probar de verdad: el
 *  `vitest.config.ts` solo recoge `server/**`, asi que un modulo aqui se prueba desde
 *  `server/hiringSort.test.ts`, igual que ya hace `statusFormatters`. Dentro del .tsx solo
 *  quedaria cubierto por aserciones sobre el texto fuente, que no comprueban nada de lo
 *  que esta ordenacion hace mal cuando la hace mal. */

export type OrdenColumna = "candidateName" | "positionName" | "progress" | "status" | "createdAt";

/** Lo minimo que una fila necesita exponer para poder ordenarse. Estructural a proposito:
 *  el tipo real lo genera tRPC desde `listHiring` y arrastra veinte campos mas. */
export interface FilaOrdenable {
  candidateName: string;
  positionName: string;
  status: string;
  createdAt: Date | string;
  requiredCount: number;
  receivedCount: number;
}

/** Orden del flujo, no alfabetico: "Completo" antes que "En revision" antes que
 *  "Pendiente" no significa nada para quien mira esta tabla. Lo que no este aqui cae al
 *  final en vez de colarse entre los conocidos. */
const ORDEN_ESTADO: Record<string, number> = { draft: 0, pending: 1, in_progress: 2, in_review: 3, complete: 4, finalized: 5 };
const ESTADO_DESCONOCIDO = 99;

/** Fraccion completada, que es lo que la columna muestra ("1/12"). Un proceso sin
 *  requisitos obligatorios cuenta como 0 y no como completo, igual que en
 *  `getHiringStatusInfo`, que exige `required > 0` para dar algo por terminado. */
export function progresoDe(fila: Pick<FilaOrdenable, "requiredCount" | "receivedCount">) {
  return fila.requiredCount > 0 ? fila.receivedCount / fila.requiredCount : 0;
}

/** Direccion del PRIMER clic en cada columna: la que deja arriba lo que se va a mirar.
 *  Texto de la A a la Z; los procesos menos completos y los mas atrasados primero, que son
 *  los que hay que perseguir; las fechas de la mas reciente a la mas antigua. */
export const DIRECCION_INICIAL: Record<OrdenColumna, "asc" | "desc"> = {
  candidateName: "asc", positionName: "asc", progress: "asc", status: "asc", createdAt: "desc",
};

function comparar(a: FilaOrdenable, b: FilaOrdenable, orden: OrdenColumna): number {
  switch (orden) {
    // `localeCompare` con locale explicito: con la comparacion por defecto "VARÓN" cae
    // detras de "VARZ" porque se ordena por punto de codigo, y esta tabla lleva acentos en
    // casi todos los nombres.
    case "candidateName": return a.candidateName.localeCompare(b.candidateName, "es");
    case "positionName": return a.positionName.localeCompare(b.positionName, "es");
    case "progress": return progresoDe(a) - progresoDe(b);
    case "status": return (ORDEN_ESTADO[a.status] ?? ESTADO_DESCONOCIDO) - (ORDEN_ESTADO[b.status] ?? ESTADO_DESCONOCIDO);
    case "createdAt": return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  }
}

/** Devuelve una copia ordenada. La copia no es un detalle: `Array.sort` ordena EN EL SITIO,
 *  y las filas que entran aqui salen de `hiring.data`, la entrada de cache de react-query
 *  que comparten la tabla y las tarjetas del dashboard -- misma queryKey, dos observadores.
 *  Ordenarla ahi la reordenaria para ambos sin que React se entere de que cambio. Por eso
 *  la entrada es `readonly`: que el compilador lo impida en vez de un comentario pidiendolo.
 *
 *  `Array.sort` es estable desde ES2019 y de eso depende algo visible: al ordenar por
 *  estado o por progreso, dentro de cada grupo se conserva el "mas reciente primero" que
 *  ya traia el servidor, en vez de barajarse. */
export function ordenarProcesos<T extends FilaOrdenable>(
  filas: readonly T[],
  orden: OrdenColumna,
  direccion: "asc" | "desc"
): T[] {
  const signo = direccion === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => signo * comparar(a, b, orden));
}
