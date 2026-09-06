import DashboardLayout from "@/components/DashboardLayout";
import HiringProcessesCard from "@/components/HiringProcessesCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText } from "lucide-react";
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

        <HiringProcessesCard />
      </div>
    </DashboardLayout>
  );
}
