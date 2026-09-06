import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Contrato del enlace del candidato.
 *
 *  Aserciones sobre el texto fuente, como `phase4.ui-contract.test.ts`: vitest.config.ts
 *  solo incluye `server/**` y el cliente no tiene ninguna otra red de seguridad.
 *
 *  Cubre un bug que no se manifestaba en local ni rompia ningun test: la URL del portal
 *  vivia en un useState que se perdia al recargar, y el unico boton que la devolvia era
 *  "Regenerar", que revoca el enlace que el candidato ya tenia. Talento Humano enviaba
 *  un enlace, recargaba, pulsaba "Regenerar" para volver a copiarlo, y con ese clic
 *  mataba el que acababa de enviar. En su navegador funcionaba; en el del candidato no. */
const readClient = (file: string) =>
  readFileSync(resolve(process.cwd(), "client/src/pages", file), "utf8");
const readServer = (file: string) =>
  readFileSync(resolve(process.cwd(), "server", file), "utf8");

describe("Enlace del candidato — contrato", () => {
  it("no ofrece una URL sin que el servidor confirme que el enlace sigue activo", () => {
    const source = readClient("HiringDetailPage.tsx");
    expect(source).toContain("storedLink.linkId === linkState.data?.id");
    expect(source).toContain("<CopyableLink value={portalUrl} />");
    // El estado efimero que causaba el bug no debe volver.
    expect(source).not.toContain('const [link, setLink] = useState("")');
  });

  it("exige confirmacion explicita antes de invalidar el enlace ya enviado", () => {
    const source = readClient("HiringDetailPage.tsx");
    expect(source).toContain("Confirmación requerida");
    expect(source).toContain("dejará de funcionar de inmediato");
    expect(source).toContain("Regenerar e invalidar el anterior");
    // Con enlace activo el boton abre el dialogo; solo genera directo si no hay ninguno.
    expect(source).toContain("? setRegenerateOpen(true)");
  });

  it("persiste la URL para que recargar no obligue a regenerar", () => {
    const source = readClient("HiringDetailPage.tsx");
    expect(source).toContain("writeStoredPortalLink(processId, stored)");
    expect(source).toContain("setStoredLink(readStoredPortalLink(processId))");
    // La lectura va en un efecto por processId y no en el inicializador de useState:
    // wouter mantiene el componente montado al cambiar de contratacion.
    expect(source).toContain("}, [processId]);");
  });

  it("generateLink devuelve el id con el que el cliente valida lo que guardo", () => {
    expect(readServer("hrDomain.ts")).toContain("linkId: inserted.insertId");
  });
});
