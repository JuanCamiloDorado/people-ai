import DashboardLayout from "@/components/DashboardLayout";
import HiringProcessesCard from "@/components/HiringProcessesCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText, Mail, Phone } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCompanyId } from "@/hooks/useCompanyId";

export default function HiringPage() {
  const { companyId, ready } = useCompanyId(); const utils = trpc.useUtils();
  // `hiring.list` ya no se consulta aqui: la tabla es `HiringProcessesCard` y la pide por
  // su cuenta. `positions` si se queda, porque alimenta el <Select> del formulario de alta.
  const positions = trpc.positions.list.useQuery({ companyId }, { enabled: ready }); const templates = trpc.templates.list.useQuery({ companyId }, { enabled: ready });
  const [positionId, setPositionId] = useState<string>("");
  const contacto = trpc.company.contact.useQuery({ companyId }, { enabled: ready });
  const [contactoOpen, setContactoOpen] = useState(false);
  const [contactEmail, setContactEmail] = useState(""); const [contactPhone, setContactPhone] = useState("");
  // Los inputs se siembran AL ABRIR el dialogo, no con un useEffect que siga a
  // `contacto.data`: react-query refetch al recuperar el foco de la ventana, y ese efecto
  // le borraria a la analista lo que este escribiendo a medio formulario.
  const abrirContacto = () => {
    setContactEmail(contacto.data?.candidateSupportEmail ?? ""); setContactPhone(contacto.data?.candidateSupportPhone ?? "");
    setContactoOpen(true);
  };
  const guardarContacto = trpc.company.updateContact.useMutation({
    onSuccess: () => { utils.company.contact.invalidate(); setContactoOpen(false); toast.success("Contacto de soporte actualizado"); },
    onError: error => toast.error(error.message || "No fue posible guardar el contacto"),
  });
  
  useEffect(() => {
    if (positions.data && positions.data.length > 0) {
      if (!positionId || !positions.data.some(p => String(p.id) === positionId)) {
        setPositionId(String(positions.data[0].id));
      }
    }
  }, [positions.data, positionId]);

  const currentPosition = positions.data?.find(p => p.id === Number(positionId));
  const selectedTemplate = templates.data?.find(t => t.id === currentPosition?.templateId) || templates.data?.find(t => t.positionId === Number(positionId)) || templates.data?.[0];
  const template = trpc.templates.get.useQuery({ companyId, templateId: selectedTemplate?.id || 1 }, { enabled: ready && Boolean(selectedTemplate?.id) });
  const [fullName, setFullName] = useState(""); const [identificationNumber, setIdentificationNumber] = useState(""); const [email, setEmail] = useState(""); const [documentDeadline, setDocumentDeadline] = useState("");
  const create = trpc.hiring.create.useMutation({ onSuccess: () => { utils.hiring.list.invalidate(); toast.success("Contratación creada con snapshot de documentos"); setFullName(""); setIdentificationNumber(""); setEmail(""); setDocumentDeadline(""); } });
  return (
    <DashboardLayout roleOverride="HR">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Talento Humano</p>
            <h1 className="mt-2 text-3xl font-semibold">Contrataciones</h1>
            <p className="mt-2 text-sm text-slate-500">Crea procesos y da seguimiento al expediente de cada candidato.</p>
          </div>
          <Button
            onClick={() => document.getElementById("new-hiring")?.scrollIntoView({ behavior: "smooth" })}
            className="bg-slate-950 text-white"
          >
            <Plus className="mr-2 h-4 w-4" />Nueva contratación
          </Button>
        </div>

        <Card id="new-hiring">
          <CardHeader>
            <CardTitle className="text-base">Nueva contratación</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <div>
                <Label>Nombre completo</Label>
                <Input
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Carlos Pérez"
                  className="mt-2"
                />
              </div>
              <div>
                <Label>Número de identificación</Label>
                <Input
                  value={identificationNumber}
                  onChange={e => setIdentificationNumber(e.target.value)}
                  placeholder="1020304050"
                  className="mt-2"
                />
              </div>
              <div>
                <Label>Correo electrónico</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="carlos@ejemplo.com"
                  className="mt-2"
                />
              </div>
              <div>
                <Label>Cargo</Label>
                <Select value={positionId} onValueChange={setPositionId}>
                  <SelectTrigger className="mt-2 w-full">
                    <SelectValue placeholder="Seleccionar cargo" />
                  </SelectTrigger>
                  <SelectContent>
                    {positions.data?.map(position => (
                      <SelectItem key={position.id} value={String(position.id)}>
                        {position.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fecha límite de carga de documentos</Label>
                <Input
                  type="date"
                  value={documentDeadline}
                  onChange={e => setDocumentDeadline(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="mt-2"
                />
              </div>
              <Button
                disabled={!fullName || !identificationNumber || !email || !selectedTemplate || create.isPending}
                onClick={() =>
                  selectedTemplate &&
                  create.mutate({
                    companyId,
                    fullName,
                    identificationNumber,
                    email,
                    positionId: Number(positionId),
                    templateId: selectedTemplate.id,
                    documentDeadline: documentDeadline ? new Date(documentDeadline) : null,
                  })
                }
                className="w-full bg-blue-600 text-white"
              >
                Crear contratación
              </Button>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <p className="text-sm font-semibold">Documentos requeridos</p>
              <p className="mt-1 text-xs text-slate-500">Se copiarán automáticamente como snapshot.</p>
              <div className="mt-4 space-y-2">
                {template.data?.items.map(item => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                    <FileText className="h-4 w-4 text-blue-600" />
                    {item.title}
                    <span className="ml-auto text-xs text-slate-400">{item.required ? "Obligatorio" : "Opcional"}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contacto de soporte del portal. Vive en esta pestana y no en una pagina de
            ajustes porque es exactamente lo que el candidato ve al abrir el enlace que se
            genera aqui: quien crea el proceso tiene que poder comprobarlo de un vistazo. */}
        <Card>
          <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Contacto de soporte del portal</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                El correo y el teléfono que ve el candidato para resolver dudas sobre sus documentos.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={abrirContacto} disabled={!ready}>
              Editar contacto
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-8">
            <span className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-slate-400" />
              {contacto.data?.candidateSupportEmail || <span className="text-slate-400">Sin configurar</span>}
            </span>
            <span className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-slate-400" />
              {contacto.data?.candidateSupportPhone || <span className="text-slate-400">Sin configurar</span>}
            </span>
          </CardContent>
        </Card>

        <HiringProcessesCard />
      </div>

      {/* DIALOG: Contacto de soporte del portal. */}
      <Dialog open={contactoOpen} onOpenChange={open => { if (!open && !guardarContacto.isPending) setContactoOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={e => {
              e.preventDefault();
              // Vacio -> null: borrar el contacto es una operacion valida y el portal
              // oculta esa linea. Enviar "" haria fallar el `.email()` de zod con un
              // mensaje que hablaria de un correo invalido en vez de un borrado.
              guardarContacto.mutate({
                companyId,
                candidateSupportEmail: contactEmail.trim() || null,
                candidateSupportPhone: contactPhone.trim() || null,
              });
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">
                Contacto de soporte del portal
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 pt-2">
                Aparece en la tarjeta "¿Dudas con un documento?" del portal del candidato. Deja un
                campo vacío para no ofrecer ese canal.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="contacto-correo">Correo de contacto</Label>
                <Input
                  id="contacto-correo"
                  type="email"
                  maxLength={320}
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                  placeholder="talento@empresa.com"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="contacto-telefono">Teléfono de contacto</Label>
                <Input
                  id="contacto-telefono"
                  type="tel"
                  maxLength={40}
                  value={contactPhone}
                  onChange={e => setContactPhone(e.target.value)}
                  placeholder="+57 (601) 000 0000"
                  className="mt-1.5"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Escríbelo como quieras que se lea. El enlace para llamar se genera con este mismo
                  número.
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setContactoOpen(false)}
                disabled={guardarContacto.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={guardarContacto.isPending}
                className="bg-slate-900 text-white hover:bg-slate-800"
              >
                {guardarContacto.isPending ? "Guardando..." : "Guardar contacto"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
