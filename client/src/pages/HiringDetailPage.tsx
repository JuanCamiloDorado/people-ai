import DashboardLayout from "@/components/DashboardLayout";
import { type Message } from "@/components/AIChatBox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRoute } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Link2,
  FileText,
  ExternalLink,
  Mail,
  Bell,
  ShieldOff,
  Clock3,
  Download,
  BrainCircuit,
  AlertTriangle,
  Check,
  RefreshCcw,
  Sparkles,
  Send,
  RotateCcw,
  Loader2,
  User,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { CANDIDATE_EMAIL_SUBJECT, buildCandidateEmailText } from "@shared/candidateEmail";
import CopyableLink from "@/components/CopyableLink";
import { useCompanyId } from "@/hooks/useCompanyId";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import {
  getHiringStatusInfo,
  getLinkStatusInfo,
  getCommunicationStatusInfo,
} from "@/lib/statusFormatters";

const dateLabel = (value: Date | string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

const SUGGESTED_QUERIES = [
  {
    label: "Resumen del expediente",
    query: "Resume el estado general, documentos entregados y pendientes de este expediente.",
    icon: FileText,
  },
  {
    label: "¿Qué documentos faltan?",
    query: "¿Cuáles documentos obligatorios u opcionales están pendientes de cargar o verificar?",
    icon: AlertTriangle,
  },
  {
    label: "¿Hay alertas o inconsistencias?",
    query: "¿Se detectaron inconsistencias, advertencias o requisitos que necesiten revisión humana?",
    icon: Sparkles,
  },
  {
    label: "Estado de enlace y portal",
    query: "¿Cuál es el estado del enlace del candidato y las comunicaciones enviadas?",
    icon: Link2,
  },
];

function ContextualAssistant({ companyId, processId }: { companyId: number; processId: number }) {
  const initialMessage: Message = {
    role: "assistant",
    content:
      "👋 Hola, soy el asistente de **PEOPLE AI**. Estoy limitado al contexto de esta contratación para responder consultas sobre requisitos, hallazgos y avances del proceso.",
  };

  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [input, setInput] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);

  const ask = trpc.ai.ask.useMutation({
    onSuccess: (result) => {
      setMessages((prev) => [...prev, { role: "assistant", content: result.content }]);
    },
    onError: (error) => toast.error(error.message),
  });

  const handleSend = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || ask.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    ask.mutate({ companyId, processId, question: content, mode: "demo" });
  };

  const handleReset = () => {
    setMessages([initialMessage]);
    toast.info("Conversación reiniciada");
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      toast.success("Respuesta copiada");
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  };

  useEffect(() => {
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollTop = scrollViewportRef.current.scrollHeight;
    }
  }, [messages, ask.isPending]);

  return (
    <Card className="overflow-hidden border-violet-100 shadow-sm">
      {/* Header */}
      <CardHeader className="border-b bg-white pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                People AI · contexto de esta contratación
              </CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">
                La consulta se limita al proceso seleccionado y queda auditada.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-[11px] font-medium text-emerald-700"
            >
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Solo lectura auditada
            </Badge>
            {messages.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={ask.isPending}
                className="h-7 text-xs text-slate-500 hover:text-slate-900"
                title="Reiniciar conversación"
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                Reiniciar
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Content */}
      <CardContent className="p-0">
        {/* Quick Suggestion Pills */}
        <div className="border-b bg-slate-50/50 px-4 py-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-2 font-medium">
            <Sparkles className="h-3.5 w-3.5 text-violet-600" />
            <span>Consultas sugeridas para este expediente:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUERIES.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSend(item.query)}
                  disabled={ask.isPending}
                  className="group flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-2xs transition-all hover:border-violet-300 hover:bg-violet-50/70 hover:text-violet-900 disabled:opacity-50"
                >
                  <Icon className="h-3 w-3 text-slate-400 group-hover:text-violet-600 transition-colors" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Message Stream */}
        <div
          ref={scrollViewportRef}
          className="max-h-[360px] min-h-[180px] overflow-y-auto p-4 space-y-3.5 bg-white"
        >
          {messages.map((message, index) => {
            const isAssistant = message.role === "assistant";
            return (
              <div
                key={index}
                className={cn(
                  "flex items-start gap-3 text-xs leading-relaxed",
                  isAssistant ? "justify-start" : "justify-end"
                )}
              >
                {isAssistant && (
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 shadow-2xs">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                )}

                <div
                  className={cn(
                    "relative group max-w-[85%] rounded-2xl p-3.5 shadow-2xs",
                    isAssistant
                      ? "rounded-tl-xs border border-violet-100 bg-violet-50/50 text-slate-800"
                      : "rounded-tr-xs bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-normal"
                  )}
                >
                  {isAssistant ? (
                    <div>
                      <div className="prose prose-xs max-w-none text-slate-800 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5 [&_strong]:font-semibold [&_strong]:text-violet-950">
                        <Streamdown>{message.content}</Streamdown>
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-violet-100/60 pt-1.5 text-[10px] text-slate-400">
                        <span>PEOPLE AI · Contexto del proceso</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(message.content, index)}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-400 hover:bg-violet-100 hover:text-slate-700 transition-colors"
                        >
                          {copiedIndex === index ? (
                            <>
                              <Check className="h-2.5 w-2.5 text-emerald-600" />
                              <span className="text-emerald-600 font-medium">Copiado</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-2.5 w-2.5" />
                              <span>Copiar</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap font-medium">{message.content}</p>
                  )}
                </div>

                {!isAssistant && (
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white shadow-2xs">
                    <User className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            );
          })}

          {ask.isPending && (
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 animate-pulse">
                <BrainCircuit className="h-3.5 w-3.5" />
              </div>
              <div className="rounded-2xl rounded-tl-xs border border-violet-100 bg-violet-50/50 p-3 text-xs text-violet-900 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600" />
                <span>Analizando contexto y requisitos del expediente…</span>
              </div>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="border-t bg-white p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(input);
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(input);
                  }
                }}
                disabled={ask.isPending}
                placeholder="Pregunta por pendientes, estado de documentos o requisitos de este expediente…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition-all disabled:opacity-50"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={!input.trim() || ask.isPending}
              className="h-8 rounded-xl bg-violet-600 px-3 text-xs text-white shadow-2xs hover:bg-violet-700 disabled:opacity-50 transition-all shrink-0"
            >
              {ask.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Preguntar
                </>
              )}
            </Button>
          </form>
          <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-slate-400">
            <span>Presiona <kbd className="rounded border bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">Enter ↵</kbd> para enviar</span>
            <span>PEOPLE AI · Apoyo consultivo de talento humano</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** URL del portal guardada para una contratacion.
 *
 *  El token en crudo existe una sola vez, al generarlo (server/tokens.ts solo persiste
 *  el hash), asi que si el cliente lo pierde no hay forma de recuperarlo: habria que
 *  regenerar, y regenerar revoca el enlace que el candidato ya tiene. Guardarlo evita
 *  ese callejon sin salida. Se guarda junto al `linkId` para poder comprobar despues
 *  que sigue siendo el enlace vigente y no uno anterior.
 *
 *  `sessionStorage` y no `localStorage`: vive en la pestaña y muere al cerrarla. Es un
 *  secreto de 7 dias, y en un equipo compartido no debe sobrevivir a la sesion. */
type StoredPortalLink = { url: string; linkId: number };

const portalLinkKey = (processId: number) => `people-ai:portal-link:${processId}`;

/** Las tres envuelven el acceso en try/catch: leer o escribir `sessionStorage` lanza en
 *  navegacion privada o con el almacenamiento del sitio bloqueado, y quedarse sin la URL
 *  es un incordio menor -- que la pagina entera reviente por eso, no. */
function readStoredPortalLink(processId: number): StoredPortalLink | null {
  try {
    const raw = sessionStorage.getItem(portalLinkKey(processId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPortalLink;
    return typeof parsed?.url === "string" && typeof parsed?.linkId === "number"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeStoredPortalLink(processId: number, value: StoredPortalLink) {
  try {
    sessionStorage.setItem(portalLinkKey(processId), JSON.stringify(value));
  } catch {
    // Sin almacenamiento la URL sigue visible en esta pagina; solo se pierde al recargar.
  }
}

function clearStoredPortalLink(processId: number) {
  try {
    sessionStorage.removeItem(portalLinkKey(processId));
  } catch {
    // Nada que limpiar si no hay almacenamiento.
  }
}

export default function HiringDetailPage() {
  const [, params] = useRoute("/hr/contrataciones/:id");
  const processId = Number(params?.id || 0);
  const { companyId, ready } = useCompanyId();
  const [storedLink, setStoredLink] = useState<StoredPortalLink | null>(null);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [activeDoc, setActiveDoc] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editingFinding, setEditingFinding] = useState<number | null>(null);
  const [editedType, setEditedType] = useState("");
  const [editedRequirement, setEditedRequirement] = useState("");
  const [preparedEmail, setPreparedEmail] = useState<{
    mailtoUrl: string;
    subject: string;
    text: string;
    type: "initial" | "reminder";
  } | null>(null);

  const detail = trpc.hiring.detail.useQuery(
    { companyId, processId },
    { enabled: ready && processId > 0 }
  );
  const documentUrl = trpc.hiring.documentUrl.useQuery(
    { companyId, processId, documentId: activeDoc },
    { enabled: ready && activeDoc > 0 }
  );
  const linkState = trpc.hiring.linkState.useQuery(
    { companyId, processId },
    { enabled: ready && processId > 0 }
  );
  const downloadZip = trpc.hiring.downloadZip.useMutation({
    onSuccess: (data) => {
      const bytes = Uint8Array.from(atob(data.base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Expediente descargado");
    },
    onError: (error) => toast.error(error.message),
  });
  const communications = trpc.hiring.communications.useQuery(
    { companyId, processId },
    { enabled: ready && processId > 0 }
  );
  const activities = trpc.hiring.activities.useQuery(
    { companyId, processId },
    { enabled: ready && processId > 0 }
  );
  const utils = trpc.useUtils();
  const generate = trpc.hiring.generateLink.useMutation({
    onSuccess: (data) => {
      const url = `${window.location.origin}/candidate/documents/${data.token}`;
      const stored = { url, linkId: data.linkId };
      setStoredLink(stored);
      writeStoredPortalLink(processId, stored);
      // Sembrar la cache antes de invalidar, no solo invalidar.
      //
      // `portalUrl` exige que el linkId guardado coincida con el que reporta el
      // servidor. Con solo invalidar, react-query conserva el dato anterior mientras
      // refetchea: durante esos milisegundos el id guardado (el nuevo) no coincidiria
      // con el de la cache (el viejo) y la tarjeta mostraria "la URL solo se muestra al
      // generarla" justo despues de generarla. La mutacion ya devuelve la verdad, asi
      // que se escribe y se invalida a continuacion para reconciliar con el servidor.
      // `createdAt` es lo unico aproximado -- la columna es TIMESTAMP sin fraccion y
      // solo alimenta un "Creado ..." -- y el refetch lo corrige acto seguido.
      utils.hiring.linkState.setData(
        { companyId, processId },
        {
          id: data.linkId,
          status: "active",
          createdAt: new Date(),
          expiresAt: data.expiresAt,
          lastUsedAt: null,
        }
      );
      utils.hiring.linkState.invalidate({ companyId, processId });
      toast.success("Enlace seguro generado");
    },
    // Era la unica mutacion de la pagina sin onError: un fallo al generar no decia nada.
    onError: (error) => toast.error(error.message),
    // En onSettled y no en onSuccess: si falla, el dialogo tambien tiene que cerrarse o
    // se queda encima del toast de error.
    onSettled: () => setRegenerateOpen(false),
  });
  const prepareEmail = trpc.hiring.prepareEmail.useMutation({
    onSuccess: (data) => {
      setPreparedEmail(data);
      setComposeOpen(false);
      window.location.href = data.mailtoUrl;
      toast.info(
        "Borrador abierto en tu cliente de correo. Envíalo manualmente y luego regístralo en PEOPLE AI."
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const prepareReminder = trpc.hiring.prepareReminder.useMutation({
    onSuccess: (data) => {
      setPreparedEmail(data);
      window.location.href = data.mailtoUrl;
      toast.info(
        "Recordatorio preparado en tu cliente de correo. Envíalo manualmente y luego regístralo en PEOPLE AI."
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const markSent = trpc.hiring.markCommunicationSent.useMutation({
    onSuccess: () => {
      setPreparedEmail(null);
      utils.hiring.communications.invalidate({ companyId, processId });
      utils.hiring.activities.invalidate({ companyId, processId });
      utils.hiring.linkState.invalidate({ companyId, processId });
      toast.success("Envío registrado manualmente");
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = trpc.hiring.revokeLink.useMutation({
    onSuccess: () => {
      // Por higiene: dejar de mostrar la URL ya lo garantiza `portalUrl`, que exige que
      // el servidor diga "active". Esto solo evita conservar un secreto muerto.
      setStoredLink(null);
      clearStoredPortalLink(processId);
      utils.hiring.linkState.invalidate({ companyId, processId });
      toast.success("Enlace revocado");
    },
    onError: (error) => toast.error(error.message),
  });
  const review = trpc.hiring.updateRequirement.useMutation({
    onSuccess: () => {
      utils.hiring.detail.invalidate({ companyId, processId });
      toast.success("Estado de revisión actualizado");
    },
  });
  const aiFindings = trpc.ai.findings.useQuery(
    { companyId, processId },
    { enabled: ready && processId > 0 }
  );
  const aiSummary = trpc.ai.summary.useQuery(
    { companyId, processId, mode: "demo" },
    { enabled: ready && processId > 0 }
  );
  const analyzeAi = trpc.ai.analyzeDocuments.useMutation({
    onSuccess: () => {
      utils.ai.findings.invalidate({ companyId, processId });
      utils.ai.runs.invalidate({ companyId, processId });
      utils.ai.summary.invalidate({ companyId, processId });
      toast.success("Análisis DEMO completado; los hallazgos requieren revisión humana");
    },
    onError: (error) => toast.error(error.message),
  });
  const reviewAi = trpc.ai.reviewFinding.useMutation({
    onSuccess: () => {
      utils.ai.findings.invalidate({ companyId, processId });
      utils.ai.insights.invalidate({ companyId });
      toast.success("Corrección de IA registrada");
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (documentUrl.data) {
      window.open(documentUrl.data, "_blank", "noopener,noreferrer");
      setActiveDoc(0);
    }
  }, [documentUrl.data]);

  // Recupera la URL guardada al montar y cada vez que se cambia de contratacion.
  //
  // Va en un efecto con [processId] y no en el inicializador de useState porque wouter
  // mantiene este componente montado al navegar de una contratacion a otra: un
  // inicializador perezoso solo corre en el primer montaje y dejaria en pantalla la URL
  // del proceso anterior.
  useEffect(() => {
    setStoredLink(readStoredPortalLink(processId));
  }, [processId]);

  // Escape cierra el dialogo de regeneracion. El foco inicial lo lleva "Cancelar" via
  // autoFocus. Regenerar revoca el enlace que el candidato ya tiene, asi que ni un
  // Escape ni un Enter reflejos deben acabar en la accion destructiva.
  useEffect(() => {
    if (!regenerateOpen) return;
    const alCerrar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setRegenerateOpen(false);
    };
    document.addEventListener("keydown", alCerrar);
    return () => document.removeEventListener("keydown", alCerrar);
  }, [regenerateOpen]);

  if (detail.isLoading) {
    return (
      <DashboardLayout roleOverride="HR">
        <div className="p-8 text-sm text-slate-500">Cargando expediente…</div>
      </DashboardLayout>
    );
  }

  if (!detail.data) {
    return (
      <DashboardLayout roleOverride="HR">
        <div className="p-8 text-sm text-rose-600">
          Contratación no encontrada para este tenant.
        </div>
      </DashboardLayout>
    );
  }

  const { process, candidate, position, company, requirements, documents } = detail.data;
  const received = requirements.filter((r) =>
    ["uploaded", "replaced", "verified"].includes(r.status)
  ).length;
  const pending = requirements.length - received;
  const activeLink = Boolean(linkState.data && linkState.data.status === "active");
  /** URL del portal que se puede mostrar ahora mismo, o cadena vacia.
   *
   *  El servidor decide si hay enlace que mostrar; sessionStorage solo aporta la cadena.
   *  Antes la URL dependia solo de un useState que se perdia al recargar: la tarjeta
   *  seguia diciendo "Activo" pero no habia forma de copiarla, y el unico boton que la
   *  devolvia era "Regenerar", que revoca el enlace ya enviado al candidato. Ese era el
   *  bug: para leer habia que destruir.
   *
   *  La comparacion por linkId cubre dos casos que `activeLink` por si solo no cubre:
   *  otra pestaña que regenero por su cuenta, y el enlace revocado cuya URL seguia
   *  visible y copiable porque `revoke.onSuccess` nunca limpiaba el estado. */
  const portalUrl =
    activeLink && storedLink && storedLink.linkId === linkState.data?.id
      ? storedLink.url
      : "";
  const sent = communications.data?.some((item) => item.status === "sent") || false;
  const submitted = process.status === "in_review" || process.status === "complete";

  const hiringStatus = getHiringStatusInfo(
    process.status,
    requirements.filter((r) => r.required).length,
    received
  );
  const linkStatus = getLinkStatusInfo(linkState.data?.status, activeLink);

  return (
    <DashboardLayout roleOverride="HR">
      <div className="mx-auto max-w-7xl space-y-6">
        <button
          onClick={() => history.back()}
          className="flex items-center text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a contrataciones
        </button>

        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
              Expediente digital
            </p>
            <h1 className="mt-2 text-3xl font-semibold">{candidate?.fullName}</h1>
            <p className="mt-2 text-sm text-slate-500">
              {position?.name} · {company?.name}
            </p>
            {process.documentDeadline && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <Clock3 className="h-3.5 w-3.5" />
                Fecha límite de entrega: {new Date(process.documentDeadline).toLocaleDateString("es-CO", { dateStyle: "long" })}
              </p>
            )}
          </div>
          <Badge
            variant="outline"
            className={cn("w-fit font-normal text-xs px-3 py-1", hiringStatus.className)}
          >
            {hiringStatus.label}
          </Badge>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="text-base">Documentos requeridos</CardTitle>
                    <p className="text-sm text-slate-500">
                      {received}/{requirements.length} documentos recibidos · {pending} pendientes
                    </p>
                  </div>
                  {/* El title va en el span y no en el Button: la variante de shadcn aplica
                      disabled:pointer-events-none, asi que un boton deshabilitado no recibe
                      hover y nunca mostraria su propio tooltip -- justo el unico caso en el
                      que hay algo que explicar. */}
                  <span
                    className="shrink-0"
                    title={
                      documents.length === 0
                        ? "El candidato aún no ha subido documentos"
                        : undefined
                    }
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={downloadZip.isPending || documents.length === 0}
                      onClick={() => downloadZip.mutate({ companyId, processId })}
                    >
                      {downloadZip.isPending ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="mr-1 h-3.5 w-3.5" />
                      )}
                      {downloadZip.isPending ? "Preparando…" : "Descargar todo"}
                    </Button>
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {requirements.map((req) => {
                  const doc = documents.find((d) => d.requirementId === req.id);
                  return (
                    <div
                      key={req.id}
                      className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"
                    >
                      <FileText className="h-4 w-4 text-blue-600" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{req.title}</p>
                        <p className="text-xs text-slate-500">
                          {doc
                            ? `${doc.normalizedName} · ${Math.round(doc.sizeBytes / 1024)} KB`
                            : req.required
                            ? "Pendiente · obligatorio"
                            : "Pendiente · opcional"}
                        </p>
                      </div>
                      {doc ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveDoc(doc.id)}
                          >
                            <ExternalLink className="mr-1 h-3.5 w-3.5" />
                            Abrir
                          </Button>
                          <Button
                            size="sm"
                            variant={req.status === "verified" ? "default" : "ghost"}
                            onClick={() =>
                              review.mutate({
                                companyId,
                                processId,
                                requirementId: req.id,
                                status: req.status === "verified" ? "uploaded" : "verified",
                              })
                            }
                          >
                            {req.status === "verified" ? "Verificado" : "Marcar verificado"}
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                          Pendiente
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="border-violet-100">
              <CardHeader>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base text-violet-950">
                      <BrainCircuit className="h-4 w-4 text-violet-600" />
                      AI Document Intelligence
                    </CardTitle>
                    <p className="mt-1 text-xs text-violet-800">
                      Analiza metadatos de documentos, propone asociaciones y nunca reemplaza la
                      revisión humana.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => analyzeAi.mutate({ companyId, processId, mode: "demo" })}
                    disabled={analyzeAi.isPending || documents.length === 0}
                    className="bg-violet-700 text-white hover:bg-violet-800"
                  >
                    <RefreshCcw
                      className={`mr-1 h-3.5 w-3.5 ${analyzeAi.isPending ? "animate-spin" : ""}`}
                    />
                    {analyzeAi.isPending ? "Analizando…" : "Analizar con IA"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {aiSummary.data && (
                  <p className="rounded-lg bg-violet-50/70 border border-violet-100 p-3 text-xs leading-5 text-violet-950">
                    {aiSummary.data.summary}
                  </p>
                )}
                {aiFindings.data?.length ? (
                  <div className="space-y-2">
                    {aiFindings.data.slice(0, 6).map((finding) => (
                      <div key={finding.id} className="rounded-lg border bg-white p-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-slate-900">
                            {finding.detectedType}
                          </span>
                          <Badge
                            variant={
                              finding.status === "review_required" ? "destructive" : "outline"
                            }
                          >
                            {finding.confidence}% ·{" "}
                            {finding.status === "review_required" ? "Revisión" : "Identificado"}
                          </Badge>
                        </div>
                        {finding.issueMessage && (
                          <p className="mt-1 flex items-start gap-1 text-amber-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {finding.issueMessage}
                          </p>
                        )}
                        <p className="mt-1 text-slate-500">
                          Nombre sugerido: {finding.suggestedName || "No disponible"}
                        </p>
                        {finding.status === "review_required" && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                reviewAi.mutate({
                                  companyId,
                                  findingId: finding.id,
                                  status: "confirmed",
                                })
                              }
                            >
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Confirmar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingFinding(finding.id)}
                            >
                              Corregir
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                reviewAi.mutate({
                                  companyId,
                                  findingId: finding.id,
                                  status: "rejected",
                                })
                              }
                            >
                              Descartar
                            </Button>
                            {editingFinding === finding.id && (
                              <div className="mt-2 grid gap-2 rounded-lg border border-violet-100 bg-violet-50 p-3 sm:grid-cols-2">
                                <label className="text-[11px] font-medium text-slate-600">
                                  Tipo corregido
                                  <input
                                    value={editedType || finding.detectedType}
                                    onChange={(event) => setEditedType(event.target.value)}
                                    className="mt-1 w-full rounded border px-2 py-1 text-xs"
                                  />
                                </label>
                                <label className="text-[11px] font-medium text-slate-600">
                                  Requirement ID opcional
                                  <Input
                                    value={
                                      editedRequirement || String(finding.requirementId || "")
                                    }
                                    onChange={(event) =>
                                      setEditedRequirement(event.target.value)
                                    }
                                    className="mt-1 h-7 text-xs"
                                  />
                                </label>
                                <div className="flex gap-2 sm:col-span-2">
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      const requirementId = Number(editedRequirement);
                                      reviewAi.mutate({
                                        companyId,
                                        findingId: finding.id,
                                        status: "corrected",
                                        detectedType: editedType || finding.detectedType,
                                        ...(requirementId > 0 ? { requirementId } : {}),
                                      });
                                      setEditingFinding(null);
                                      setEditedType("");
                                      setEditedRequirement("");
                                    }}
                                  >
                                    Guardar corrección
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditingFinding(null)}
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-violet-700">
                    Ejecuta el análisis para generar hallazgos de esta contratación.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="h-4 w-4" />
                  Enlace del candidato
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Estado</span>
                  <Badge variant={linkStatus.variant} className={cn("font-normal", linkStatus.className)}>
                    {linkStatus.label}
                  </Badge>
                </div>
                {linkState.data && (
                  <>
                    <p className="text-xs text-slate-500">
                      Creado {dateLabel(linkState.data.createdAt)} · Expira{" "}
                      {dateLabel(linkState.data.expiresAt)}
                    </p>
                    <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs">
                      <p
                        className={
                          linkState.data.status !== "expired" &&
                          linkState.data.status !== "revoked"
                            ? "text-slate-700"
                            : "text-slate-400"
                        }
                      >
                        <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                        Enlace generado
                      </p>
                      <p className={sent ? "text-slate-700" : "text-slate-400"}>
                        <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                        Enlace enviado
                      </p>
                      <p
                        className={
                          linkState.data.lastUsedAt ? "text-slate-700" : "text-slate-400"
                        }
                      >
                        <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                        Enlace abierto{" "}
                        {linkState.data.lastUsedAt
                          ? `· ${dateLabel(linkState.data.lastUsedAt)}`
                          : ""}
                      </p>
                      <p className={received > 0 ? "text-slate-700" : "text-slate-400"}>
                        <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                        Documentos cargados · {received}/{requirements.length}
                      </p>
                      <p className={pending === 0 ? "text-slate-700" : "text-slate-400"}>
                        <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                        Documentación completa
                      </p>
                      <p className={submitted ? "text-slate-700" : "text-slate-400"}>
                        <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                        Documentación enviada
                      </p>
                    </div>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={generate.isPending}
                    onClick={() =>
                      activeLink
                        ? setRegenerateOpen(true)
                        : generate.mutate({ companyId, processId })
                    }
                    className="bg-slate-950 text-white"
                  >
                    {activeLink ? "Regenerar enlace" : "Generar enlace"}
                  </Button>
                  {portalUrl && (
                    <Button
                      variant="outline"
                      onClick={() => window.open(portalUrl, "_blank", "noopener,noreferrer")}
                    >
                      Abrir portal
                    </Button>
                  )}
                  {activeLink && (
                    <Button
                      variant="outline"
                      onClick={() => revoke.mutate({ companyId, processId })}
                    >
                      <ShieldOff className="mr-1 h-4 w-4" />
                      Revocar
                    </Button>
                  )}
                </div>
                {portalUrl ? (
                  <CopyableLink value={portalUrl} />
                ) : activeLink ? (
                  <p className="text-xs leading-5 text-slate-500">
                    Por seguridad la URL solo se muestra al generarla. Si la perdiste,
                    regenera el enlace y envía el nuevo al candidato.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4" />
                  Comunicación
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-600">{candidate?.email}</p>
                <p className="text-xs text-slate-500">
                  PEOPLE AI prepara un borrador y abre tu cliente de correo. El envío lo realizas
                  tú.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={prepareEmail.isPending || !portalUrl}
                    onClick={() => setComposeOpen(true)}
                  >
                    <Mail className="mr-1 h-4 w-4" />
                    Enviar documentación
                  </Button>
                  <Button
                    variant="outline"
                    disabled={prepareReminder.isPending || pending === 0 || !portalUrl}
                    onClick={() =>
                      prepareReminder.mutate({ companyId, processId, portalUrl })
                    }
                  >
                    <Bell className="mr-1 h-4 w-4" />
                    Enviar recordatorio
                  </Button>
                </div>
                {preparedEmail && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
                    <p className="font-medium">
                      Borrador preparado para{" "}
                      {preparedEmail.type === "reminder" ? "recordatorio" : "documentación"}.
                    </p>
                    <p className="mt-1">
                      Después de revisarlo y enviarlo desde tu cliente, registra la acción aquí.
                    </p>
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() =>
                        markSent.mutate({
                          companyId,
                          processId,
                          type: preparedEmail.type,
                          portalUrl,
                        })
                      }
                      disabled={markSent.isPending || !portalUrl}
                    >
                      Marcar como enviado
                    </Button>
                  </div>
                )}
                {communications.data?.length ? (
                  <div className="space-y-2 border-t pt-3">
                    {communications.data.slice(0, 3).map((item) => {
                      const commStatus = getCommunicationStatusInfo(item.status);
                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between text-xs"
                        >
                          <span>
                            {item.type === "reminder" ? "Recordatorio" : "Documentación"}
                          </span>
                          <Badge
                            variant={commStatus.variant}
                            className={commStatus.className}
                          >
                            {commStatus.label}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Aún no hay comunicaciones registradas.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <ContextualAssistant companyId={companyId} processId={processId} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4" />
              Actividad reciente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activities.isLoading ? (
              <p className="text-sm text-slate-500">Cargando actividad…</p>
            ) : activities.data?.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {activities.data.slice(0, 8).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"
                  >
                    <span className="font-medium">{item.type}</span>
                    <span className="ml-2 text-slate-400">{dateLabel(item.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Sin actividad registrada.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {regenerateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="regenerar-enlace-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">
              Confirmación requerida
            </p>
            <h2
              id="regenerar-enlace-title"
              className="mt-2 text-lg font-semibold text-slate-950"
            >
              ¿Regenerar el enlace del candidato?
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              El enlace que ya enviaste dejará de funcionar de inmediato. Si el candidato
              lo abre, verá que no está disponible. Tendrás que enviarle el nuevo.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button autoFocus variant="outline" onClick={() => setRegenerateOpen(false)}>
                Cancelar
              </Button>
              <Button
                disabled={generate.isPending}
                onClick={() => generate.mutate({ companyId, processId })}
              >
                Regenerar e invalidar el anterior
              </Button>
            </div>
          </div>
        </div>
      )}
      {composeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-documentation-title"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                  Comunicación
                </p>
                <h2
                  id="send-documentation-title"
                  className="mt-1 text-xl font-semibold text-slate-950"
                >
                  Enviar documentación
                </h2>
              </div>
              <button
                onClick={() => setComposeOpen(false)}
                className="text-sm text-slate-500 hover:text-slate-900"
              >
                Cerrar
              </button>
            </div>
            <div className="mt-5 space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Candidato
                </p>
                <p className="mt-1 font-medium text-slate-900">{candidate?.fullName}</p>
                <p className="text-slate-500">{candidate?.email}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Asunto
                </p>
                <p className="mt-1 rounded-lg bg-slate-50 p-3 text-slate-700">
                  {CANDIDATE_EMAIL_SUBJECT}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Mensaje
                </p>
                {/* El preview es el correo real, no una copia a mano: mismo `buildCandidateEmailText`
                    que usa el servidor para armar el `mailto:`. Antes este bloque prometia "Completa
                    cada documento desde el enlace seguro." y omitia la fecha limite, mientras al
                    candidato le llegaba el enlace del portal. `whitespace-pre-line` respeta los saltos. */}
                <p className="mt-1 whitespace-pre-line rounded-lg bg-slate-50 p-3 leading-6 text-slate-600">
                  {buildCandidateEmailText({
                    candidateName: candidate?.fullName,
                    positionName: position?.name,
                    documentDeadline: process.documentDeadline,
                    portalUrl,
                  })}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setComposeOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  disabled={prepareEmail.isPending || !portalUrl}
                  onClick={() =>
                    prepareEmail.mutate({ companyId, processId, portalUrl })
                  }
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Abrir cliente de correo
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
