import { useRef, useState, useEffect } from "react";
import { useRoute } from "wouter";
import {
  CheckCircle2,
  Clock,
  FileText,
  FileUp,
  Loader2,
  Send,
  ShieldCheck,
  AlertCircle,
  X,
  Eye,
  Mail,
  Phone,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { CandidatePortalSkeleton } from "@/components/CandidatePortalSkeleton";
import {
  DEFAULT_ALLOWED_MIMETYPES,
  formatAllowedExtensions,
  getAcceptAttribute,
  getFileTypeBadgeInfo,
} from "@shared/documentTypes";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",") + " MB";
  }
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}


function getFormatChips(allowedMime?: string | null): string[] {
  const allowed = allowedMime || DEFAULT_ALLOWED_MIMETYPES;
  const lower = allowed.toLowerCase();
  const chips: string[] = [];

  if (lower.includes("pdf")) chips.push("PDF");
  if (lower.includes("jpeg") || lower.includes("png") || lower.includes("webp")) chips.push("FOTOS");
  if (lower.includes("word") || lower.includes("msword")) chips.push("WORD");
  if (lower.includes("excel") || lower.includes("sheet") || lower.includes("ms-excel")) chips.push("EXCEL");

  return chips.length > 0 ? chips : ["PDF"];
}

interface UploadProgressState {
  progress: number;
  filename: string;
  sizeBytes: number;
}

export default function CandidatePortalPage() {
  const [, params] = useRoute("/candidate/documents/:token");
  const token = params?.token || "";

  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const progressIntervals = useRef<Record<number, NodeJS.Timeout>>({});

  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [activeUploads, setActiveUploads] = useState<Record<number, UploadProgressState>>({});
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);
  const [localBlobUrls, setLocalBlobUrls] = useState<Record<number, string>>({});
  const [isViewingSubmitted, setIsViewingSubmitted] = useState(false);
  const [submittedLocal, setSubmittedLocal] = useState(false);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const portal = trpc.candidatePortal.get.useQuery(
    { token },
    { enabled: token.length >= 20, retry: false }
  );

  const removeMutation = trpc.candidatePortal.remove.useMutation({
    onSuccess: (_, variables) => {
      utils.candidatePortal.get.invalidate({ token });
      setCardErrors((prev) => {
        const next = { ...prev };
        delete next[variables.requirementId];
        return next;
      });
      if (localBlobUrls[variables.requirementId]) {
        try {
          URL.revokeObjectURL(localBlobUrls[variables.requirementId]);
        } catch {}
        setLocalBlobUrls((prev) => {
          const next = { ...prev };
          delete next[variables.requirementId];
          return next;
        });
      }
      toast.success("Documento eliminado correctamente");
    },
    onError: (e) => toast.error(e.message),
  });

  const uploadMutation = trpc.candidatePortal.upload.useMutation({
    onSuccess: (data, variables) => {
      if (progressIntervals.current[variables.requirementId]) {
        clearInterval(progressIntervals.current[variables.requirementId]);
        delete progressIntervals.current[variables.requirementId];
      }

      setActiveUploads((prev) => {
        const next = { ...prev };
        delete next[variables.requirementId];
        return next;
      });

      setCardErrors((prev) => {
        const next = { ...prev };
        delete next[variables.requirementId];
        return next;
      });

      setSubmitErrorMessage(null);
      utils.candidatePortal.get.setData({ token }, data);
      toast.success("Documento cargado correctamente");
    },
    onError: (e, variables) => {
      if (progressIntervals.current[variables.requirementId]) {
        clearInterval(progressIntervals.current[variables.requirementId]);
        delete progressIntervals.current[variables.requirementId];
      }
      setActiveUploads((prev) => {
        const next = { ...prev };
        delete next[variables.requirementId];
        return next;
      });
      setCardErrors((prev) => ({
        ...prev,
        [variables.requirementId]: e.message || "Error al cargar el archivo",
      }));
      toast.error(e.message || "Error al cargar el archivo");
    },
  });

  const submitMutation = trpc.candidatePortal.submit.useMutation({
    onSuccess: () => {
      setSubmittedLocal(true);
      setIsViewingSubmitted(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast.success("¡Documentación enviada con éxito!");
    },
    onError: (e) => {
      setSubmitErrorMessage(e.message);
      toast.error(e.message);
    },
  });

  useEffect(() => {
    return () => {
      Object.values(progressIntervals.current).forEach((t) => clearInterval(t));
      Object.values(localBlobUrls).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
    };
  }, []);

  const handleOpenFileInput = (reqId: number) => {
    const input = fileInputRefs.current[reqId];
    if (input) {
      input.value = "";
      input.click();
    }
  };

  const handleFileChosen = (req: { id: number; title: string; allowedMimeTypes?: string | null }, file?: File) => {
    if (!file) return;

    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[req.id];
      return next;
    });
    setSubmitErrorMessage(null);

    if (file.size > MAX_BYTES) {
      const errMsg = `El archivo pesa ${formatFileSize(file.size)} y el tamaño máximo permitido es de 10 MB.`;
      setCardErrors((prev) => ({ ...prev, [req.id]: errMsg }));
      toast.error(errMsg);
      return;
    }

    const rawAllowed = req.allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES;
    const acceptExts = getAcceptAttribute(rawAllowed)
      .split(",")
      .map((ext) => ext.trim().toLowerCase());
    const fileExt = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
      : "";
    const mimeList = rawAllowed.split(",").map((m) => m.trim().toLowerCase());

    const isExtMatch = acceptExts.includes(fileExt);
    const isMimeMatch = file.type ? mimeList.includes(file.type.toLowerCase()) : false;

    if (!isExtMatch && !isMimeMatch) {
      const errMsg = `Formato no admitido (${fileExt || "archivo"}). Formatos permitidos: ${formatAllowedExtensions(rawAllowed)}.`;
      setCardErrors((prev) => ({ ...prev, [req.id]: errMsg }));
      toast.error(errMsg);
      return;
    }

    try {
      const previewUrl = URL.createObjectURL(file);
      setLocalBlobUrls((prev) => ({ ...prev, [req.id]: previewUrl }));
    } catch {}

    setActiveUploads((prev) => ({
      ...prev,
      [req.id]: {
        progress: 15,
        filename: file.name,
        sizeBytes: file.size,
      },
    }));

    if (progressIntervals.current[req.id]) {
      clearInterval(progressIntervals.current[req.id]);
    }

    progressIntervals.current[req.id] = setInterval(() => {
      setActiveUploads((prev) => {
        const current = prev[req.id];
        if (!current) return prev;
        const nextProgress = Math.min(94, current.progress + Math.floor(Math.random() * 18) + 8);
        return {
          ...prev,
          [req.id]: { ...current, progress: nextProgress },
        };
      });
    }, 180);

    const reader = new FileReader();
    reader.onload = () => {
      uploadMutation.mutate({
        token,
        requirementId: req.id,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64: String(reader.result).split(",")[1] || "",
      });
    };
    reader.onerror = () => {
      if (progressIntervals.current[req.id]) {
        clearInterval(progressIntervals.current[req.id]);
        delete progressIntervals.current[req.id];
      }
      setActiveUploads((prev) => {
        const next = { ...prev };
        delete next[req.id];
        return next;
      });
      const errMsg = "Error al leer el archivo en tu dispositivo.";
      setCardErrors((prev) => ({ ...prev, [req.id]: errMsg }));
      toast.error(errMsg);
    };
    reader.readAsDataURL(file);
  };

  const handleViewDocument = async (reqId: number) => {
    if (localBlobUrls[reqId]) {
      window.open(localBlobUrls[reqId], "_blank");
      return;
    }

    try {
      const data = await utils.client.candidatePortal.documentUrl.query({
        token,
        requirementId: reqId,
      });
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        toast.error("No se pudo obtener el enlace de previsualización.");
      }
    } catch (err: any) {
      toast.error(err?.message || "No se pudo abrir el documento");
    }
  };

  const scrollToRequirement = (reqId: number) => {
    const el = cardRefs.current[reqId];
    if (el) {
      const topOffset = el.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top: Math.max(0, topOffset), behavior: "smooth" });
      setHighlightedId(reqId);
      setTimeout(() => setHighlightedId(null), 1400);
    }
  };

  const handleSubmit = (missingRequirements: any[]) => {
    if (missingRequirements.length > 0) {
      const msg =
        missingRequirements.length === 1
          ? `Falta cargar un documento obligatorio: ${missingRequirements[0].title}. Cárgalo para poder enviar.`
          : `Faltan ${missingRequirements.length} documentos obligatorios: ${missingRequirements
              .map((r) => r.title)
              .join(", ")}.`;
      setSubmitErrorMessage(msg);
      toast.error(msg);
      scrollToRequirement(missingRequirements[0].id);
      return;
    }

    submitMutation.mutate({ token });
  };

  // 1. Estado de carga: mientras se consulta la información del portal
  const isLoadingPortal =
    token.length >= 20 &&
    (portal.isLoading || (portal.isPending && !portal.data));

  if (isLoadingPortal) {
    return <CandidatePortalSkeleton />;
  }

  // 2. Error del servidor o de red: no confundir una falla temporal de conexión con un enlace expirado
  if (portal.error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8fafd] p-6 font-['Schibsted_Grotesk',sans-serif]">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <AlertCircle className="h-7 w-7 text-amber-600" />
          </div>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">
            No pudimos cargar la información
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Hubo un problema al conectar con el servidor. El enlace puede seguir siendo válido.
          </p>
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => portal.refetch()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#0144a0] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#01326f] transition-all cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </button>
          </div>
        </div>
      </main>
    );
  }

  // 3. Enlace no disponible / expirado / token inválido
  if (!token || token.length < 20 || !portal.data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8fafd] p-6 font-['Schibsted_Grotesk',sans-serif]">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <ShieldCheck className="h-7 w-7 text-slate-500" />
          </div>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">
            Este enlace ya no está disponible
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            El enlace de carga ha expirado, fue revocado o ya fue completado. Comunícate con el
            equipo de Talento Humano para solicitar uno nuevo.
          </p>
        </div>
      </main>
    );
  }

  const { candidate, position, company, requirements, documents, process } = portal.data;
  const isProcessSubmitted =
    submittedLocal ||
    process?.status === "in_review" ||
    process?.status === "complete" ||
    process?.status === "finalized";

  const total = requirements.length;
  const received = requirements.filter((r) =>
    documents.some((d) => d.requirementId === r.id)
  ).length;
  const pct = total > 0 ? Math.round((received / total) * 100) : 0;
  const missingRequired = requirements.filter(
    (r) => r.required && !documents.some((d) => d.requirementId === r.id)
  );
  const isReadyToSend = missingRequired.length === 0;

  return (
    <div className="min-h-screen bg-[#f8fafd] text-slate-800 antialiased font-['Schibsted_Grotesk',sans-serif] pb-20 pt-6 sm:pt-8 px-4 sm:px-6">
      <div className="mx-auto max-w-[1080px]">
        {/* ========================================================================= */}
        {/* HERO BANNER CARD                                                          */}
        {/* ========================================================================= */}
        <header className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#04519f] via-[#0144a0] to-[#012f73] p-8 sm:p-11 text-white shadow-[0_22px_48px_-24px_rgba(1,47,115,0.6)]">
          {/* Subtle geometric dot grid pattern in top-right */}
          <div
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-1/2 opacity-25"
            style={{
              backgroundImage:
                "radial-gradient(rgba(255, 255, 255, 0.8) 1.2px, transparent 1.2px)",
              backgroundSize: "22px 22px",
              WebkitMaskImage:
                "linear-gradient(255deg, rgba(0,0,0,1) 0%, transparent 65%)",
              maskImage:
                "linear-gradient(255deg, rgba(0,0,0,1) 0%, transparent 65%)",
            }}
          />

          <div className="relative z-10">
            <div className="flex items-center gap-2.5 mb-5">
              <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-[#a9c8f0]">
                {company?.name || "PEOPLE AI"} · INCORPORACIÓN
              </span>
              <span className="h-[1px] w-24 bg-white/20" />
            </div>

            <h1 className="text-4xl sm:text-[46px] font-bold tracking-[-0.035em] leading-[1.02] text-white">
              ¡Bienvenido!
            </h1>
            <p className="mt-3 text-lg leading-relaxed text-[#d3e3f9] max-w-[62ch]">
              <strong className="text-white font-medium">{candidate?.fullName || "Candidato"}</strong>
              , estamos felices de acompañarte en tu proceso.
            </p>

            {/* Metadata row */}
            <div className="mt-8 flex flex-wrap gap-y-4 gap-x-10 border-t border-white/20 pt-6">
              <div>
                <div className="text-[10.5px] font-semibold tracking-[0.14em] uppercase text-[#9dbdea] mb-1">
                  Cargo
                </div>
                <div className="text-[15.5px] font-semibold tracking-tight text-white">
                  {position?.name || "Cargo en contratación"}
                </div>
              </div>

              <div>
                <div className="text-[10.5px] font-semibold tracking-[0.14em] uppercase text-[#9dbdea] mb-1">
                  Empresa
                </div>
                <div className="text-[15.5px] font-semibold tracking-tight text-white">
                  {company?.name || "Empresa"}
                </div>
              </div>

              {process?.documentDeadline && (
                <div>
                  <div className="text-[10.5px] font-semibold tracking-[0.14em] uppercase text-[#9dbdea] mb-1">
                    Fecha límite
                  </div>
                  <div className="flex items-center gap-1.5 text-[15.5px] font-semibold tracking-tight text-white">
                    <Clock className="h-3.5 w-3.5 text-amber-300" />
                    {new Date(process.documentDeadline).toLocaleDateString("es-CO", {
                      dateStyle: "long",
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[10.5px] font-semibold tracking-[0.14em] uppercase text-[#9dbdea] mb-1">
                  Documentos
                </div>
                <div className="text-[15.5px] font-semibold tracking-tight text-white font-mono">
                  {received} de {total} cargados
                </div>
              </div>
            </div>

            {/* Notice banner */}
            <div className="mt-7 flex items-start gap-3.5 border-l-[3.5px] border-[#f0b429] pl-3.5">
              <p className="m-0 text-sm sm:text-[14.5px] leading-relaxed text-white max-w-[85ch]">
                <strong className="font-semibold text-white">
                  Todos los documentos de esta lista son obligatorios.
                </strong>{" "}
                <span className="text-[#d3e3f9]">
                  Tu contratación permanece en espera hasta que estén todos cargados y validados,
                  así que revisa que cada archivo sea legible y esté vigente antes de adjuntarlo.
                </span>
              </p>
            </div>
          </div>
        </header>

        {/* ========================================================================= */}
        {/* TWO-COLUMN LAYOUT (SIDEBAR + MAIN)                                        */}
        {/* ========================================================================= */}
        <div className="mt-6 flex flex-col lg:flex-row items-start gap-6">
          {/* ----------------------------------------------------------------------- */}
          {/* LEFT SIDEBAR                                                            */}
          {/* ----------------------------------------------------------------------- */}
          <aside className="w-full lg:w-[310px] shrink-0 lg:sticky lg:top-5 flex flex-col gap-4">
            {/* Progress and quick checklist */}
            <div className="rounded-2xl bg-gradient-to-br from-[#04519f] via-[#0144a0] to-[#012f73] p-5.5 text-white shadow-[0_16px_34px_-22px_rgba(1,47,115,0.55)]">
              <div className="flex items-center gap-4">
                {/* Conical circular progress */}
                <div
                  className="relative h-[62px] w-[62px] shrink-0 rounded-full transition-all duration-300"
                  style={{
                    background: `conic-gradient(#ffffff ${pct}%, rgba(255, 255, 255, 0.24) 0)`,
                  }}
                >
                  <div className="absolute inset-[7px] flex items-center justify-center rounded-full bg-[#0a4899] font-mono text-[13.5px] font-bold tracking-tight text-white">
                    {received}/{total}
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="text-[15px] font-semibold tracking-tight text-white">
                    Tu documentación
                  </div>
                  <div className="mt-0.5 text-xs text-[#cfe0f7]">
                    {received === total
                      ? "Todos los documentos listos"
                      : `${received} de ${total} completados (${pct}%)`}
                  </div>
                </div>
              </div>

              <div className="my-4 h-[1px] bg-white/20" />

              {/* Quick Jump List */}
              <ul className="m-0 p-0 list-none space-y-1">
                {requirements.map((req) => {
                  const isUploaded = documents.some((d) => d.requirementId === req.id);
                  const isUploading = !!activeUploads[req.id];
                  const hasError = !!cardErrors[req.id];

                  return (
                    <li key={req.id}>
                      <button
                        type="button"
                        onClick={() => scrollToRequirement(req.id)}
                        className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-[#dbe8fa] transition-colors hover:bg-white/15"
                      >
                        {isUploaded ? (
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-400 font-bold text-[#01326f] text-[9.5px]">
                            ✓
                          </span>
                        ) : hasError ? (
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-400 font-bold text-[#4a0d06] text-[9.5px]">
                            !
                          </span>
                        ) : isUploading ? (
                          <span className="h-4 w-4 shrink-0 rounded-full border-2 border-white animate-pulse" />
                        ) : (
                          <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-white/50" />
                        )}
                        <span className="truncate group-hover:text-white">
                          {req.title}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Action Box: Submit Documentation */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
              <button
                type="button"
                disabled={!isReadyToSend || submitMutation.isPending || isProcessSubmitted}
                onClick={() => handleSubmit(missingRequired)}
                className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 px-4 font-semibold text-sm tracking-tight transition-all duration-150 ${
                  isReadyToSend && !isProcessSubmitted
                    ? "bg-[#0144a0] text-white hover:bg-[#01326f] shadow-md shadow-blue-950/20 active:scale-[0.98]"
                    : "cursor-not-allowed bg-slate-100 text-slate-400 border border-slate-200"
                }`}
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enviando...
                  </>
                ) : isProcessSubmitted ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Documentos enviados
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Enviar documentación
                  </>
                )}
              </button>

              <p className="mt-2.5 text-center text-xs leading-relaxed text-slate-500">
                {isProcessSubmitted
                  ? "Recibido. Talento Humano validará los archivos."
                  : isReadyToSend
                  ? "Todo listo para revisión por Talento Humano."
                  : missingRequired.length === 1
                  ? "Falta 1 documento obligatorio por cargar."
                  : `Faltan ${missingRequired.length} documentos obligatorios por cargar.`}
              </p>
            </div>

            {/* Help / Support box */}
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5">
              <div className="text-sm font-semibold text-slate-800">
                ¿Dudas con un documento?
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Escríbenos y te ayudamos con las especificaciones antes de que venza el plazo.
              </p>
              <div className="mt-3.5 space-y-1.5 font-mono text-xs text-[#0144a0]">
                <a
                  href={`mailto:talento@${company?.name?.toLowerCase().replace(/\s+/g, "") || "bivien"}.co`}
                  className="flex items-center gap-2 hover:underline"
                >
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  talento@{company?.name?.toLowerCase().replace(/\s+/g, "") || "bivien"}.co
                </a>
                <a href="tel:+573000000000" className="flex items-center gap-2 hover:underline">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  +57 (601) 000 0000
                </a>
              </div>
            </div>
          </aside>

          {/* ----------------------------------------------------------------------- */}
          {/* MAIN CONTENT AREA                                                       */}
          {/* ----------------------------------------------------------------------- */}
          <main className="min-w-0 flex-1 w-full space-y-5">
            {/* If Process is Submitted and not in review inspection mode */}
            {isProcessSubmitted && !isViewingSubmitted ? (
              <div className="rounded-[18px] border border-emerald-200 bg-white p-8 sm:p-10 shadow-sm animate-in fade-in duration-300">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white font-bold text-2xl shadow-md shadow-emerald-700/20 mb-6">
                  ✓
                </div>
                <h2 className="text-2xl sm:text-[28px] font-bold tracking-tight text-slate-900">
                  Documentación enviada
                </h2>
                <p className="mt-2 text-sm sm:text-base leading-relaxed text-slate-600 max-w-xl">
                  Recibimos tu documentación completa. El equipo de talento de{" "}
                  <strong className="text-slate-800">{company?.name || "la empresa"}</strong> revisará
                  cada archivo en un plazo de uno a dos días hábiles y te contactará si algo necesita
                  corrección.
                </p>

                <div className="mt-7 border-t border-slate-100 pt-6 space-y-3.5">
                  <div className="flex items-start gap-3 text-sm">
                    <span className="font-bold text-xs text-[#0144a0] pt-0.5">01</span>
                    <span className="text-slate-700">
                      Validación de legibilidad y vigencia por el equipo de Talento Humano.
                    </span>
                  </div>
                  <div className="flex items-start gap-3 text-sm">
                    <span className="font-bold text-xs text-[#0144a0] pt-0.5">02</span>
                    <span className="text-slate-700">
                      Firma digital o formalización del contrato laboral.
                    </span>
                  </div>
                  <div className="flex items-start gap-3 text-sm">
                    <span className="font-bold text-xs text-[#0144a0] pt-0.5">03</span>
                    <span className="text-slate-700">
                      Inducción, entrega de equipos y bienvenida en tu primer día.
                    </span>
                  </div>
                </div>

                <div className="mt-8 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsViewingSubmitted(true)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
                  >
                    <FileText className="h-4 w-4 text-slate-400" />
                    Revisar mis archivos cargados
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Back button if candidate was reviewing after submit */}
                {isProcessSubmitted && isViewingSubmitted && (
                  <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900">
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Documentación enviada para revisión. Puedes visualizar tus archivos cargados.
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsViewingSubmitted(false)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 underline hover:text-emerald-950"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Volver al estado de confirmación
                    </button>
                  </div>
                )}

                {/* Validation error banner if submit clicked with missing docs */}
                {submitErrorMessage && (
                  <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-900 shadow-sm animate-in shake duration-300">
                    <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{submitErrorMessage}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSubmitErrorMessage(null)}
                      className="text-rose-400 hover:text-rose-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {/* Requirements Cards List */}
                <div className="space-y-3.5">
                  {requirements.map((req, idx) => {
                    const doc = documents.find((d) => d.requirementId === req.id);
                    const isUploaded = !!doc;
                    const uploading = activeUploads[req.id];
                    const errorMsg = cardErrors[req.id];
                    const isDragging = dragOverId === req.id;
                    const isHighlighted = highlightedId === req.id;

                    const note = req.description?.trim() || null;
                    const rawAllowed = req.allowedMimeTypes;
                    const formatChips = getFormatChips(rawAllowed);
                    const indexStr = idx < 9 ? `0${idx + 1}` : `${idx + 1}`;

                    return (
                      <div
                        key={req.id}
                        ref={(el) => {
                          cardRefs.current[req.id] = el;
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (!uploading && !isProcessSubmitted) setDragOverId(req.id);
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          if (dragOverId === req.id) setDragOverId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverId(null);
                          if (uploading || isProcessSubmitted) return;
                          const droppedFile = e.dataTransfer.files?.[0];
                          if (droppedFile) handleFileChosen(req, droppedFile);
                        }}
                        className={`group relative flex items-stretch overflow-hidden rounded-2xl border bg-white transition-all duration-200 ${
                          isHighlighted
                            ? "ring-2 ring-[#0144a0] shadow-md"
                            : isDragging
                            ? "border-[#0144a0] bg-blue-50/20 shadow-md scale-[1.005]"
                            : "border-slate-200/90 hover:border-slate-300 hover:shadow-md hover:shadow-blue-950/5"
                        }`}
                      >
                        {/* Hidden file input */}
                        <input
                          ref={(el) => {
                            fileInputRefs.current[req.id] = el;
                          }}
                          type="file"
                          accept={getAcceptAttribute(rawAllowed)}
                          className="hidden"
                          onChange={(e) => handleFileChosen(req, e.target.files?.[0])}
                        />

                        {/* Left Gutter Status bar (58px) */}
                        <div
                          className={`flex w-[58px] shrink-0 flex-col items-center justify-center gap-2 border-r py-4 transition-colors ${
                            isUploaded
                              ? "border-emerald-100 bg-emerald-50/60"
                              : errorMsg
                              ? "border-rose-100 bg-rose-50/60"
                              : uploading
                              ? "border-blue-100 bg-[#eef4fd]"
                              : "border-slate-100 bg-slate-50/80"
                          }`}
                        >
                          <span
                            className={`font-['Schibsted_Grotesk',sans-serif] text-[15px] font-bold tracking-tight ${
                              isUploaded
                                ? "text-emerald-700"
                                : errorMsg
                                ? "text-rose-700"
                                : uploading
                                ? "text-[#0144a0]"
                                : "text-slate-400 group-hover:text-slate-600"
                            } transition-colors`}
                          >
                            {indexStr}
                          </span>

                          {isUploaded ? (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-[10px]">
                              ✓
                            </span>
                          ) : errorMsg ? (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white font-bold text-[10px]">
                              !
                            </span>
                          ) : uploading ? (
                            <span className="h-5 w-5 rounded-full border-2 border-[#0144a0] border-t-transparent animate-spin" />
                          ) : (
                            <span className="h-5 w-5 rounded-full border-[1.5px] border-dashed border-slate-300" />
                          )}
                        </div>

                        {/* Card Content Area */}
                        <div className="flex min-w-0 flex-1 flex-col justify-between p-4 sm:p-5">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <h3 className="text-[16.5px] font-semibold leading-snug tracking-tight text-slate-900">
                                {req.title}
                              </h3>

                              {note && (
                                <p className="mt-1 text-[13.5px] leading-relaxed text-slate-500 max-w-2xl">
                                  {note}
                                </p>
                              )}

                              {/* Chips Row */}
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {formatChips.map((chip) => (
                                  <span
                                    key={chip}
                                    className="font-mono text-[10.5px] font-semibold tracking-wider text-slate-600 bg-slate-100/90 border border-slate-200/80 rounded px-1.5 py-0.5"
                                  >
                                    {chip}
                                  </span>
                                ))}
                                <span className="font-mono text-[11px] text-slate-400">
                                  máx. 10 MB
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                                    req.required
                                      ? "bg-amber-50 text-amber-800 border border-amber-200/60"
                                      : "bg-slate-100 text-slate-500"
                                  }`}
                                >
                                  {req.required ? "Obligatorio" : "Opcional"}
                                </span>
                              </div>
                            </div>

                            {/* Main Right Action */}
                            {!isProcessSubmitted && (
                              <div className="shrink-0 flex items-center gap-2">
                                {isUploaded ? (
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenFileInput(req.id)}
                                      className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.98] transition"
                                    >
                                      Reemplazar
                                    </button>
                                    <button
                                      type="button"
                                      title="Eliminar archivo"
                                      onClick={() =>
                                        removeMutation.mutate({ token, requirementId: req.id })
                                      }
                                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 active:scale-[0.96] transition"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenFileInput(req.id)}
                                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#0144a0] px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#01326f] active:scale-[0.98] transition"
                                  >
                                    <FileUp className="h-4 w-4" />
                                    Adjuntar
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Uploading In-Card Progress */}
                          {uploading && (
                            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
                              <div className="flex items-center justify-between gap-2 text-xs font-mono mb-2">
                                <span className="truncate text-slate-700 font-medium">
                                  {uploading.filename}
                                </span>
                                <span className="font-bold text-[#0144a0] shrink-0">
                                  {uploading.progress}%
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                                <div
                                  className="h-full bg-[#0144a0] rounded-full transition-all duration-200 ease-out"
                                  style={{ width: `${uploading.progress}%` }}
                                />
                              </div>
                            </div>
                          )}

                          {/* Uploaded Ready Container */}
                          {isUploaded && !uploading && (
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                                <span className="truncate font-mono text-xs text-emerald-950 font-medium">
                                  {doc?.originalName || "documento_cargado"}
                                </span>
                                {doc?.sizeBytes ? (
                                  <span className="shrink-0 font-mono text-[11px] text-emerald-700">
                                    {formatFileSize(doc.sizeBytes)}
                                  </span>
                                ) : null}
                              </div>

                              <button
                                type="button"
                                onClick={() => handleViewDocument(req.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 active:scale-[0.98] transition shadow-xs"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                Ver
                              </button>
                            </div>
                          )}

                          {/* Error Container */}
                          {errorMsg && !uploading && (
                            <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-3">
                              <div className="flex items-start gap-2 text-xs text-rose-800">
                                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                                <span>{errorMsg}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleOpenFileInput(req.id)}
                                className="shrink-0 text-xs font-bold text-rose-700 underline hover:text-rose-900"
                              >
                                Elegir otro
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Bottom Bar Summary & Action Card */}
                {!isProcessSubmitted && (
                  <div className="rounded-2xl bg-gradient-to-br from-[#04519f] via-[#0144a0] to-[#012f73] p-5 sm:p-6 text-white shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                      <div className="text-base font-semibold">
                        {received === total
                          ? "¡Completaste toda la documentación!"
                          : `${received} de ${total} documentos cargados (${pct}%)`}
                      </div>
                      <p className="mt-0.5 text-xs text-[#cfe0f7]">
                        {isReadyToSend
                          ? "Puedes enviar tu expediente para que Recursos Humanos lo valide."
                          : `Recuerda que faltan ${missingRequired.length} documentos obligatorios.`}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={!isReadyToSend || submitMutation.isPending}
                      onClick={() => handleSubmit(missingRequired)}
                      className={`inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold tracking-tight transition shadow-sm ${
                        isReadyToSend
                          ? "bg-white text-[#01326f] hover:bg-[#dbe8fa] active:scale-[0.98]"
                          : "bg-white/20 text-white/50 cursor-not-allowed"
                      }`}
                    >
                      {submitMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" />
                          Enviar documentación
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </main>
        </div>

        {/* ========================================================================= */}
        {/* FOOTER PRIVACY NOTICE                                                     */}
        {/* ========================================================================= */}
        <p className="mt-8 flex items-center justify-center gap-2 text-center text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
          Tus archivos se transmiten cifrados y solo los ve el equipo de talento de{" "}
          {company?.name || "la empresa"}.
        </p>
      </div>
    </div>
  );
}

