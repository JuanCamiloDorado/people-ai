import { describe, expect, it } from "vitest";
import { DIRECCION_INICIAL, ordenarProcesos, progresoDe, type FilaOrdenable } from "../client/src/lib/hiringSort";

/** Cruza la frontera al cliente como ya hace `statusFormatters.test.ts`: `vitest.config.ts`
 *  solo recoge `server/**`, y esta logica merece pruebas de comportamiento y no aserciones
 *  sobre el texto fuente. */

const fila = (p: Partial<FilaOrdenable> & { candidateName: string }): FilaOrdenable => ({
  positionName: "Cargo",
  status: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
  requiredCount: 10,
  receivedCount: 0,
  ...p,
});

describe("ordenarProcesos", () => {
  it("no toca el array de entrada", () => {
    // Las filas salen de `hiring.data`, la entrada de cache de react-query que comparten la
    // tabla y las tarjetas del dashboard. `Array.sort` ordena en el sitio: hacerlo ahi las
    // reordenaria para ambos observadores sin que React se entere de que algo cambio.
    const entrada = [fila({ candidateName: "Zulema" }), fila({ candidateName: "Ana" })];
    const salida = ordenarProcesos(entrada, "candidateName", "asc");
    expect(entrada.map(f => f.candidateName)).toEqual(["Zulema", "Ana"]);
    expect(salida).not.toBe(entrada);
    expect(salida.map(f => f.candidateName)).toEqual(["Ana", "Zulema"]);
  });

  it("ordena los nombres con los acentos en su sitio", () => {
    // Con la comparacion por defecto "VARÓN" cae detras de "VARZ", porque se ordena por
    // punto de codigo y la Ó vive muy por encima de la Z en Unicode. En esta tabla casi
    // todos los nombres llevan acento.
    const nombres = ["VARZ", "VARÓN", "VARA"].map(n => fila({ candidateName: n }));
    expect(ordenarProcesos(nombres, "candidateName", "asc").map(f => f.candidateName))
      .toEqual(["VARA", "VARÓN", "VARZ"]);
  });

  it("ordena los estados por el flujo y no por el alfabeto", () => {
    const estados = ["complete", "pending", "in_review", "draft"].map((s, i) =>
      fila({ candidateName: `c${i}`, status: s })
    );
    expect(ordenarProcesos(estados, "status", "asc").map(f => f.status))
      .toEqual(["draft", "pending", "in_review", "complete"]);
  });

  it("manda al final los estados que no conoce, sin colarlos entre los conocidos", () => {
    // Un estado nuevo en el esquema que nadie anadio al mapa no debe aparecer como si
    // fuera el mas urgente de todos.
    const estados = [
      fila({ candidateName: "a", status: "estado_futuro" }),
      fila({ candidateName: "b", status: "complete" }),
      fila({ candidateName: "c", status: "pending" }),
    ];
    expect(ordenarProcesos(estados, "status", "asc").map(f => f.status))
      .toEqual(["pending", "complete", "estado_futuro"]);
  });

  it("ordena el progreso por fraccion y no por documentos recibidos", () => {
    // 1 de 2 va por delante de 3 de 12: lo que la columna muestra es la fraccion, y quien
    // persigue documentos quiere arriba a quien mas le falta.
    const progresos = [
      fila({ candidateName: "medio", requiredCount: 2, receivedCount: 1 }),
      fila({ candidateName: "poco", requiredCount: 12, receivedCount: 3 }),
      fila({ candidateName: "todo", requiredCount: 4, receivedCount: 4 }),
    ];
    expect(ordenarProcesos(progresos, "progress", "asc").map(f => f.candidateName))
      .toEqual(["poco", "medio", "todo"]);
  });

  it("un proceso sin requisitos obligatorios no cuenta como completo", () => {
    // Misma regla que `getHiringStatusInfo`, que exige `required > 0` para dar algo por
    // terminado. Sin el guardia seria 0/0 = NaN y el orden quedaria indefinido.
    expect(progresoDe({ requiredCount: 0, receivedCount: 0 })).toBe(0);
    const filas = [
      fila({ candidateName: "completo", requiredCount: 3, receivedCount: 3 }),
      fila({ candidateName: "sin requisitos", requiredCount: 0, receivedCount: 0 }),
    ];
    expect(ordenarProcesos(filas, "progress", "asc").map(f => f.candidateName))
      .toEqual(["sin requisitos", "completo"]);
  });

  it("mantiene el orden previo entre filas empatadas", () => {
    // `Array.sort` es estable desde ES2019 y de eso depende algo visible: al agrupar por
    // estado o por progreso, dentro de cada grupo se conserva el "mas reciente primero"
    // que ya traia el servidor, en vez de barajarse en cada render.
    const empatadas = ["tercero", "segundo", "primero"].map(n => fila({ candidateName: n, status: "pending" }));
    expect(ordenarProcesos(empatadas, "status", "asc").map(f => f.candidateName))
      .toEqual(["tercero", "segundo", "primero"]);
  });

  it("invierte el orden con la direccion descendente", () => {
    const fechas = [
      fila({ candidateName: "vieja", createdAt: "2026-01-01T00:00:00.000Z" }),
      fila({ candidateName: "nueva", createdAt: "2026-09-01T00:00:00.000Z" }),
    ];
    expect(ordenarProcesos(fechas, "createdAt", "desc").map(f => f.candidateName)).toEqual(["nueva", "vieja"]);
    expect(ordenarProcesos(fechas, "createdAt", "asc").map(f => f.candidateName)).toEqual(["vieja", "nueva"]);
  });

  it("acepta fechas como Date y como string", () => {
    // `listHiring` las devuelve como Date, pero superjson y el cache rehidratado pueden
    // entregarlas como string: comparar `Date` con `string` sin normalizar daria NaN.
    const mezcladas = [
      fila({ candidateName: "string", createdAt: "2026-09-01T00:00:00.000Z" }),
      fila({ candidateName: "date", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
    ];
    expect(ordenarProcesos(mezcladas, "createdAt", "asc").map(f => f.candidateName)).toEqual(["date", "string"]);
  });

  it("el primer clic deja arriba lo que se va a mirar", () => {
    // Texto de la A a la Z; lo menos completo y lo mas atrasado primero, que es lo que hay
    // que perseguir; las fechas de la mas reciente a la mas antigua.
    expect(DIRECCION_INICIAL.candidateName).toBe("asc");
    expect(DIRECCION_INICIAL.positionName).toBe("asc");
    expect(DIRECCION_INICIAL.progress).toBe("asc");
    expect(DIRECCION_INICIAL.status).toBe("asc");
    expect(DIRECCION_INICIAL.createdAt).toBe("desc");
  });
});
