import DashboardLayout from "@/components/DashboardLayout";
import HiringProcessesCard from "@/components/HiringProcessesCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { BookOpen, Bot, FileText, Plus, UserPlus, Users, Settings2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

export default function HRDashboard() {
  const { user } = useAuth();
  const access = trpc.access.me.useQuery(undefined, { retry: false });
  const companyId = access.data?.companyId ?? 0;
  // `hiring.list` se queda aunque la tabla ya no viva aqui: alimenta los valores de
  // reserva de las tarjetas de abajo cuando `hr.stats` todavia no ha respondido. Es la
  // misma queryKey que consulta `HiringProcessesCard`, asi que react-query la deduplica:
  // una sola peticion y un solo dato para las tarjetas y para la tabla.
  const hiring = trpc.hiring.list.useQuery({ companyId }, { enabled: Boolean(companyId) });
  const stats = trpc.hr.stats.useQuery({ companyId }, { enabled: Boolean(companyId) });
  const knowledge = trpc.hr.knowledge.useQuery({ companyId }, { enabled: Boolean(companyId) });
  const expiring = trpc.hiring.expiringLinks.useQuery({ companyId, withinHours: 24 }, { enabled: Boolean(companyId) });
  const aiInsights = trpc.ai.insights.useQuery({ companyId, status: "unread" }, { enabled: Boolean(companyId) });
  const soon = (label: string) => toast.info(`${label} estará disponible en la siguiente fase.`);

  const candidates = hiring.data ?? [];
  const docs = knowledge.data ?? [];
  const displayName = user?.name || "Alexa Torres";

  const isStatsLoading = stats.isLoading && hiring.isLoading;
  const totalProcesses = stats.data?.totalProcesses ?? candidates.length;
  const pendingDocuments = stats.data?.pendingDocuments ?? candidates.reduce((sum, c) => sum + Math.max(0, c.requiredCount - c.receivedCount), 0);
  const completeProcesses = stats.data?.completeProcesses ?? candidates.filter(c => c.status === "complete" || (c.requiredCount > 0 && c.receivedCount >= c.requiredCount)).length;
  const assistantQueries = stats.data?.assistantQueries ?? 0;

  const metricCards = [
    {
      label: "Procesos de contratación",
      value: totalProcesses,
      caption: "Procesos activos",
      icon: UserPlus,
      badgeStyle: "bg-gradient-to-br from-blue-100/90 via-blue-50 to-white text-blue-600 border border-blue-200/60 shadow-[0_4px_14px_rgba(59,130,246,0.12)]",
      dotColor: "bg-blue-500",
    },
    {
      label: "Documentos pendientes",
      value: pendingDocuments,
      caption: "Documentos por recibir",
      icon: FileText,
      badgeStyle: "bg-gradient-to-br from-amber-100/90 via-amber-50 to-white text-amber-600 border border-amber-200/60 shadow-[0_4px_14px_rgba(245,158,11,0.12)]",
      dotColor: "bg-amber-500",
    },
    {
      label: "Procesos completos",
      value: completeProcesses,
      caption: "Listos para revisión",
      icon: Users,
      badgeStyle: "bg-gradient-to-br from-emerald-100/90 via-emerald-50 to-white text-emerald-600 border border-emerald-200/60 shadow-[0_4px_14px_rgba(16,185,129,0.12)]",
      dotColor: "bg-emerald-500",
    },
    {
      label: "Consultas al asistente",
      value: assistantQueries,
      caption: "Consultas atendidas",
      icon: Bot,
      badgeStyle: "bg-gradient-to-br from-violet-100/90 via-violet-50 to-white text-violet-600 border border-violet-200/60 shadow-[0_4px_14px_rgba(139,92,246,0.12)]",
      dotColor: "bg-violet-500",
    },
  ];

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Buenos días";
    if (hour >= 12 && hour < 19) return "Buenas tardes";
    return "Buenas noches";
  };

  return (
    <DashboardLayout roleOverride="HR">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{getGreeting()}, {displayName}</h1>
          <p className="mt-2 text-sm text-slate-500">Este es el centro de gestión de Talento Humano de PEOPLE AI.</p>
        </div>

        {aiInsights.data?.length ? (
          <Card className="border-violet-200 bg-violet-50/50 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-violet-950">
                    <Bot className="h-4 w-4" />AI Insights
                  </div>
                  <p className="mt-1 text-xs text-violet-800">Hallazgos que requieren atención humana, sin decisiones automáticas.</p>
                </div>
                <Badge variant="outline" className="border-violet-200 bg-white text-violet-800">
                  {aiInsights.data.length} nuevas
                </Badge>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {aiInsights.data.slice(0, 4).map(insight => (
                  <a
                    key={insight.id}
                    href={insight.processId ? `/hr/contrataciones/${insight.processId}` : "/hr/notifications"}
                    className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-slate-800 hover:border-violet-400 transition"
                  >
                    <span className="font-medium">{insight.title}</span>
                    <span className="mt-1 block text-xs text-slate-500">{insight.description}</span>
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {expiring.data?.length ? (
          <Card className="border-amber-200 bg-amber-50/60 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4" />Requieren atención
              </div>
              <p className="mt-1 text-xs text-amber-800">Enlaces que expiran durante las próximas 24 horas.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {expiring.data.map(item => (
                  <a
                    key={item.id}
                    href={`/hr/contrataciones/${item.processId}`}
                    className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-800 hover:border-amber-400 transition"
                  >
                    <span className="font-medium">{item.candidateName}</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      Expira {new Date(item.expiresAt).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* KPIs */}
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {metricCards.map(item => (
            <Card key={item.label} className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
              <div className="flex items-center gap-3.5">
                {/* Logo a la izquierda con fondo suave y brillo */}
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-105 ${item.badgeStyle}`}>
                  <item.icon className="h-5 w-5 stroke-[2.2]" />
                </div>

                {/* Contenido derecho compacto */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-600">{item.label}</p>
                  <div className="mt-0.5 flex items-baseline">
                    {isStatsLoading ? (
                      <Skeleton className="h-7 w-12 rounded-md" />
                    ) : (
                      <span className="text-2xl font-extrabold tracking-tight text-slate-950 tabular-nums">
                        {item.value}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dotColor}`} />
                    <span className="truncate font-medium">{item.caption}</span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Procesos de contratacion: la MISMA tabla que /hr/contrataciones, a ancho
            completo. Antes aqui habia una copia reducida a cinco filas -- sin filtros, sin
            fecha limite y sin borrado -- que se fue quedando atras, y al lado un panel de
            demostracion del asistente cuya respuesta estaba escrita a mano en el servidor.
            El asistente de verdad sigue en el menu lateral, en /hr/assistant. */}
        <HiringProcessesCard conBotonNuevaContratacion conEnlaceVerContrataciones />

        {/* Base de conocimiento & Canales */}
        <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="h-4 w-4 text-violet-600" />Base de conocimiento
                </CardTitle>
                <p className="mt-1 text-xs text-slate-500">Información que posteriormente utilizará el asistente.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => soon("Agregar documento")}>
                <Plus className="mr-1 h-3.5 w-3.5" />Agregar documento
              </Button>
            </CardHeader>
            <CardContent>
              {knowledge.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : knowledge.error ? (
                <p className="text-sm text-rose-600">No se pudo cargar la base de conocimiento.</p>
              ) : docs.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {docs.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => soon(doc.title)}
                      className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 p-3 text-left transition hover:border-violet-300 hover:bg-violet-50/40"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50">
                        <BookOpen className="h-4 w-4 text-violet-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">{doc.title}</p>
                        <p className="text-xs text-slate-400">{doc.category}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-5 text-center text-sm text-slate-500">No hay documentos registrados.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="h-4 w-4 text-slate-600" />Canales e integraciones
              </CardTitle>
              <p className="mt-1 text-xs text-slate-500">Un mismo asistente, varios canales futuros.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                ["Web", "Disponible", "bg-teal-500"],
                ["WhatsApp", "Próximamente", "bg-amber-400"],
                ["Microsoft Teams", "Próximamente", "bg-amber-400"],
              ].map(([name, status, dot]) => (
                <div key={name} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3">
                  <span className="text-sm font-medium text-slate-700">{name}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    <i className={`h-2 w-2 rounded-full ${dot}`} />
                    {status}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

