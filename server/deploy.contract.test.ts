// Contrato del build desplegable. No comprueba comportamiento sino la forma del
// codigo, porque lo que protege se puede deshacer sin que nada falle en local:
// el error solo aparece en un contenedor con dependencias de produccion.
// Misma tecnica que `phase4.ui-contract.test.ts`.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (file: string) =>
  readFileSync(resolve(process.cwd(), file), "utf8");
const scripts = () =>
  JSON.parse(read("package.json")).scripts as Record<string, string>;

describe("contrato de despliegue", () => {
  it("la entrada de produccion y la fabrica de la app no conocen vite", () => {
    // `index.ts` se empaqueta con esbuild; si alguna de estas dos importara
    // `./vite`, el bundle volveria a arrastrar devDependencies. La entrada de
    // desarrollo es `dev.ts` y es la unica que debe tocar Vite.
    for (const file of ["server/_core/index.ts", "server/_core/app.ts"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/from ["']\.\/vite["']/);
      expect(source, file).not.toMatch(/from ["']vite["']/);
      expect(source, file).not.toMatch(/import\(["']\.\/vite["']\)/);
    }
  });

  it("start no depende de cross-env, que es devDependency", () => {
    expect(scripts().start).toBe("node dist/index.js");
  });

  it("build fija NODE_ENV=production para no empaquetar React de desarrollo", () => {
    expect(scripts().build).toContain("NODE_ENV=production");
  });

  // Este es el test que faltaba cuando el almacenamiento se rompio: las credenciales de
  // Forge nunca estuvieron en render.yaml y nada lo detecto, asi que el fallo solo
  // aparecia cuando un candidato intentaba subir un archivo, ya en produccion.
  // A proposito NO lista los nombres a mano, para que cubra tambien la proxima variable
  // que alguien anada; quien no la declare tiene que decidir explicitamente meterla en
  // OPCIONALES.
  it("render.yaml declara toda variable de entorno que el servidor lee", () => {
    const OPCIONALES = new Set([
      // La inyecta la plataforma; declararla la fijaria a un valor equivocado.
      "PORT",
      // Solo las usa el modo "real" de la IA. Sin ellas el modo demo sigue funcionando.
      "BUILT_IN_FORGE_API_URL",
      "BUILT_IN_FORGE_API_KEY",
    ]);
    const declaradas = new Set(
      [...read("render.yaml").matchAll(/^\s*-\s*key:\s*(\S+)/gm)].map(m => m[1])
    );
    const fuentes = readdirSync(resolve(process.cwd(), "server"), {
      recursive: true,
      encoding: "utf8",
    }).filter(nombre => nombre.endsWith(".ts") && !nombre.endsWith(".test.ts"));

    for (const nombre of fuentes) {
      const source = read(`server/${nombre}`);
      for (const [, variable] of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        if (OPCIONALES.has(variable)) continue;
        expect(declaradas, `${variable} (leida en server/${nombre})`).toContain(
          variable
        );
      }
    }
  });

  // El SDK de S3 cuesta ~2.5 s y ~25 MB de RSS al cargarse. Importarlo de forma
  // estatica lo traeria en cada arranque en frio de Render Free, y ademas haria que
  // importar `storage.ts` tuviera efectos: el servidor y `hrDomain.test.ts` dejarian de
  // poder cargarlo cuando no hay credenciales.
  it("el adaptador de almacenamiento carga el SDK de forma perezosa", () => {
    const source = read("server/storage.ts");
    expect(source).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+["']@aws-sdk/m);
    expect(source).toMatch(/await import\(["']@aws-sdk\/client-s3["']\)/);
  });
});
