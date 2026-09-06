import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  FileText,
  Briefcase,
  Sparkles,
  Trash2,
  CheckCircle2,
  Search,
  ShieldCheck,
  Clock,
  AlertCircle,
  Pencil,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Sliders,
  ArrowLeft,
  Info,
  Check,
  FileType,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCompanyId } from "@/hooks/useCompanyId";
import DocumentFormatSelector from "@/components/DocumentFormatSelector";
import {
  FILE_TYPE_PRESETS,
  DEFAULT_ALLOWED_MIMETYPES,
  getFileTypeBadgeInfo,
  formatAllowedExtensions,
} from "@shared/documentTypes";

const DEFAULT_TEMPLATE_NAME = "Expediente de Ingreso Estándar";

const STANDARD_REFERENCE_DOCS = [
  {
    title: "Cédula de Ciudadanía (150%)",
    description: "Copia legible ampliada al 150% por ambas caras en formato PDF.",
    required: true,
    legalRef: "Identificación laboral oficial (Art. 58 C.S.T.)",
    allowedMimeTypes: "application/pdf,image/jpeg,image/png,image/webp",
  },
  {
    title: "Hoja de Vida Actualizada",
    description: "Formato PDF con datos de contacto, perfil profesional y trayectoria.",
    required: true,
    legalRef: "Validación de perfil y antecedentes laborales",
    allowedMimeTypes: "application/pdf",
  },
  {
    title: "Certificado de Afiliación EPS",
    description: "Certificación expedida con vigencia no mayor a 30 días.",
    required: true,
    legalRef: "Afiliación obligatoria al SGSSS (Ley 100 de 1993)",
    allowedMimeTypes: "application/pdf,image/jpeg,image/png,image/webp",
  },
  {
    title: "Certificado de Fondo de Pensiones",
    description: "Certificado de afiliación al fondo pensional (Colpensiones o Fondo Privado).",
    required: true,
    legalRef: "Aporte pensional obligatorio (Ley 100 de 1993)",
    allowedMimeTypes: "application/pdf,image/jpeg,image/png,image/webp",
  },
  {
    title: "Certificaciones Académicas",
    description: "Diplomas, actas de grado o certificaciones de estudio correspondientes al perfil.",
    required: false,
    legalRef: "Soporte de idoneidad y competencias del cargo",
    allowedMimeTypes: "application/pdf,image/jpeg,image/png,image/webp",
  },
  {
    title: "Examen Médico de Ingreso",
    description: "Concepto de aptitud ocupacional expedido por médico especialista en SST / IPS autorizada.",
    required: true,
    legalRef: "Resolución 2346 de 2007 (Evaluaciones Médicas Ocupacionales)",
    allowedMimeTypes: "application/pdf,image/jpeg,image/png,image/webp",
  },
];

interface TemplateItem {
  id?: number;
  title: string;
  description?: string;
  required: boolean;
  sortOrder: number;
  allowedMimeTypes?: string;
}

export default function PositionsPage() {
  const { companyId, ready } = useCompanyId();
  const utils = trpc.useUtils();

  // Queries
  const positionsQuery = trpc.positions.list.useQuery({ companyId }, { enabled: ready });
  const templatesQuery = trpc.templates.list.useQuery({ companyId }, { enabled: ready });
  const masterStandardQuery = trpc.templates.getMasterStandard.useQuery({ companyId }, { enabled: ready });

  // State
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  // Dialog states
  const [isNewPositionOpen, setIsNewPositionOpen] = useState(false);
  const [isDeletePositionOpen, setIsDeletePositionOpen] = useState(false);
  const [positionToDelete, setPositionToDelete] = useState<{ id: number; name: string } | null>(null);
  const [isNewTemplateOpen, setIsNewTemplateOpen] = useState(false);
  const [isMasterStandardView, setIsMasterStandardView] = useState(false);
  const [isEditDocOpen, setIsEditDocOpen] = useState(false);
  const [isRenameTemplateOpen, setIsRenameTemplateOpen] = useState(false);

  // Edit single document in Master Standard state
  const [isEditMasterDocDialogOpen, setIsEditMasterDocDialogOpen] = useState(false);
  const [editingMasterIndex, setEditingMasterIndex] = useState<number | null>(null);
  const [editingMasterDocTitle, setEditingMasterDocTitle] = useState("");
  const [editingMasterDocDesc, setEditingMasterDocDesc] = useState("");
  const [editingMasterDocRequired, setEditingMasterDocRequired] = useState(true);
  const [editingMasterDocFileType, setEditingMasterDocFileType] = useState(DEFAULT_ALLOWED_MIMETYPES);

  // New position form
  const [newPositionName, setNewPositionName] = useState("");
  const [newPositionDescription, setNewPositionDescription] = useState("");
  const [newPositionTemplateId, setNewPositionTemplateId] = useState<string>("");

  // New template form
  const [newTemplateName, setNewTemplateName] = useState("");
  const [copyStandardDocs, setCopyStandardDocs] = useState(true);
  const [assignNewTemplateToCargo, setAssignNewTemplateToCargo] = useState(true);

  // Rename template form
  const [editTemplateTitle, setEditTemplateTitle] = useState("");

  // Edit single document form
  const [editingDocId, setEditingDocId] = useState<number | null>(null);
  const [editingDocTitle, setEditingDocTitle] = useState("");
  const [editingDocDesc, setEditingDocDesc] = useState("");
  const [editingDocRequired, setEditingDocRequired] = useState(true);
  const [editingDocFileType, setEditingDocFileType] = useState(DEFAULT_ALLOWED_MIMETYPES);

  // Master standard template editing state
  const [masterItems, setMasterItems] = useState<TemplateItem[]>([]);
  const [masterApplyToAll, setMasterApplyToAll] = useState(true);
  const [newMasterDocTitle, setNewMasterDocTitle] = useState("");
  const [newMasterDocDesc, setNewMasterDocDesc] = useState("");
  const [newMasterDocRequired, setNewMasterDocRequired] = useState(true);
  const [newMasterDocFileType, setNewMasterDocFileType] = useState(DEFAULT_ALLOWED_MIMETYPES);

  // Inline new document form
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocDesc, setNewDocDesc] = useState("");
  const [newDocRequired, setNewDocRequired] = useState(true);
  const [newDocFileType, setNewDocFileType] = useState(DEFAULT_ALLOWED_MIMETYPES);

  // Initialize master standard items when query loads
  useEffect(() => {
    if (masterStandardQuery.data?.items) {
      setMasterItems(
        masterStandardQuery.data.items.map((item, idx) => ({
          title: item.title,
          description: item.description || undefined,
          required: item.required,
          sortOrder: item.sortOrder || idx + 1,
          allowedMimeTypes: (item as any).allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES,
        }))
      );
    }
  }, [masterStandardQuery.data]);

  // Filter positions
  const positions = useMemo(() => {
    return (positionsQuery.data || []).filter((p) =>
      p.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(searchFilter.toLowerCase()))
    );
  }, [positionsQuery.data, searchFilter]);

  // Set default selected position and handle selection updates
  useEffect(() => {
    if (positionsQuery.data && positionsQuery.data.length > 0) {
      if (!selectedPositionId || !positionsQuery.data.some((p) => p.id === selectedPositionId)) {
        setSelectedPositionId(positionsQuery.data[0].id);
      }
    } else if (positionsQuery.data && positionsQuery.data.length === 0) {
      setSelectedPositionId(null);
    }
  }, [positionsQuery.data, selectedPositionId]);

  // Selected position object
  const selectedPosition = useMemo(() => {
    return positionsQuery.data?.find((p) => p.id === selectedPositionId) || null;
  }, [positionsQuery.data, selectedPositionId]);

  // Helper to determine active template id for position
  const getPositionAssignedTemplate = (pos: { id: number; templateId?: number | null } | null) => {
    if (!pos || !templatesQuery.data?.length) return null;
    if (pos.templateId) {
      const match = templatesQuery.data.find((t) => t.id === pos.templateId);
      if (match) return match;
    }
    const matchByPos = templatesQuery.data.find((t) => t.positionId === pos.id);
    if (matchByPos) return matchByPos;
    const standard = templatesQuery.data.find((t) => t.name === DEFAULT_TEMPLATE_NAME);
    if (standard) return standard;
    return templatesQuery.data[0] || null;
  };

  // Sync selectedTemplateId whenever selectedPosition changes
  useEffect(() => {
    if (selectedPosition) {
      const assigned = getPositionAssignedTemplate(selectedPosition);
      if (assigned) {
        setSelectedTemplateId(assigned.id);
      } else if (templatesQuery.data && templatesQuery.data.length > 0) {
        setSelectedTemplateId(templatesQuery.data[0].id);
      } else {
        setSelectedTemplateId(null);
      }
    } else {
      setSelectedTemplateId(null);
    }
  }, [selectedPositionId, selectedPosition?.templateId, templatesQuery.data]);

  // Active template query
  const templateQuery = trpc.templates.get.useQuery(
    { companyId, templateId: selectedTemplateId! },
    { enabled: Boolean(selectedTemplateId) }
  );

  // Positions using the currently selected template
  const positionsUsingActiveTemplate = useMemo(() => {
    if (!selectedTemplateId || !positionsQuery.data) return [];
    return positionsQuery.data.filter((p) => {
      const assigned = getPositionAssignedTemplate(p);
      return assigned?.id === selectedTemplateId;
    });
  }, [selectedTemplateId, positionsQuery.data, templatesQuery.data]);

  // Mutations
  const createPositionMutation = trpc.positions.create.useMutation({
    onSuccess: (newId) => {
      utils.positions.list.invalidate();
      setSelectedPositionId(newId);
      setIsNewPositionOpen(false);
      setNewPositionName("");
      setNewPositionDescription("");
      setNewPositionTemplateId("");
      toast.success("Cargo creado exitosamente");
    },
    onError: (err) => {
      toast.error(err.message || "Error al crear el cargo");
    },
  });

  const assignTemplateMutation = trpc.positions.assignTemplate.useMutation({
    onSuccess: (data) => {
      utils.positions.list.invalidate();
      utils.templates.list.invalidate();
      if (data.templateId) {
        setSelectedTemplateId(data.templateId);
        utils.templates.get.invalidate({ companyId, templateId: data.templateId });
      }
      const tName = templatesQuery.data?.find((t) => t.id === data.templateId)?.name || "Plantilla";
      const pName = selectedPosition?.name || "el cargo";
      toast.success(`Plantilla "${tName}" asignada a ${pName}`);
    },
    onError: (err) => {
      toast.error(err.message || "Error al asignar la plantilla al cargo");
    },
  });

  const deletePositionMutation = trpc.positions.delete.useMutation({
    onSuccess: () => {
      utils.positions.list.invalidate();
      utils.templates.list.invalidate();
      setIsDeletePositionOpen(false);
      setPositionToDelete(null);
      toast.success("Cargo eliminado exitosamente");
    },
    onError: (err) => {
      toast.error(err.message || "Error al eliminar el cargo");
    },
  });

  const createTemplateMutation = trpc.templates.create.useMutation({
    onSuccess: (data) => {
      utils.templates.list.invalidate();
      utils.positions.list.invalidate();
      if (data) {
        setSelectedTemplateId(data.id);
        utils.templates.get.invalidate({ companyId, templateId: data.id });
      }
      setIsNewTemplateOpen(false);
      setNewTemplateName("");
      toast.success("Nueva plantilla creada exitosamente");
    },
    onError: (err) => {
      toast.error(err.message || "Error al crear la plantilla");
    },
  });

  const assignDefaultMutation = trpc.templates.assignDefault.useMutation({
    onSuccess: (data) => {
      utils.positions.list.invalidate();
      utils.templates.list.invalidate();
      if (data) {
        setSelectedTemplateId(data.id);
        utils.templates.get.invalidate({ companyId, templateId: data.id });
      }
      toast.success("Plantilla por defecto asignada");
    },
    onError: (err) => {
      toast.error(err.message || "Error al asignar la plantilla");
    },
  });

  const updateTemplateMutation = trpc.templates.update.useMutation({
    onSuccess: () => {
      if (selectedTemplateId) {
        utils.templates.get.invalidate({ companyId, templateId: selectedTemplateId });
      }
      utils.templates.getMasterStandard.invalidate();
      toast.success("Plantilla de documentos actualizada");
      setNewDocTitle("");
      setNewDocDesc("");
      setNewDocRequired(true);
      setIsEditDocOpen(false);
    },
    onError: (err) => {
      toast.error(err.message || "Error al actualizar la plantilla");
    },
  });

  const updateMasterStandardMutation = trpc.templates.updateMasterStandard.useMutation({
    onSuccess: () => {
      utils.templates.getMasterStandard.invalidate();
      utils.templates.list.invalidate();
      if (selectedTemplateId) {
        utils.templates.get.invalidate({ companyId, templateId: selectedTemplateId });
      }
      setIsMasterStandardView(false);
      toast.success("Plantilla estándar de la empresa guardada exitosamente");
    },
    onError: (err) => {
      toast.error(err.message || "Error al guardar la plantilla estándar");
    },
  });

  const updateTemplateNameMutation = trpc.templates.updateName.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      if (selectedTemplateId) {
        utils.templates.get.invalidate({ companyId, templateId: selectedTemplateId });
      }
      setIsRenameTemplateOpen(false);
      toast.success("Nombre de plantilla actualizado");
    },
    onError: (err) => {
      toast.error(err.message || "Error al renombrar la plantilla");
    },
  });

  const deleteTemplateMutation = trpc.templates.delete.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      utils.positions.list.invalidate();
      toast.success("Plantilla eliminada");
    },
    onError: (err) => {
      toast.error(err.message || "Error al eliminar la plantilla");
    },
  });

  // Handlers
  const handleCreatePosition = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPositionName.trim()) return;
    createPositionMutation.mutate({
      companyId,
      name: newPositionName.trim(),
      description: newPositionDescription.trim() || undefined,
      templateId: newPositionTemplateId ? Number(newPositionTemplateId) : undefined,
    });
  };

  const handlePromptDeletePosition = (pos: { id: number; name: string }, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPositionToDelete(pos);
    setIsDeletePositionOpen(true);
  };

  const handleConfirmDeletePosition = () => {
    if (!positionToDelete) return;
    deletePositionMutation.mutate({
      companyId,
      positionId: positionToDelete.id,
    });
  };

  const handleCreateCustomTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) return;

    const baseDocs = masterStandardQuery.data?.items || STANDARD_REFERENCE_DOCS;
    const items = copyStandardDocs
      ? baseDocs.map((doc, idx) => ({
          title: doc.title,
          description: doc.description || undefined,
          required: doc.required,
          sortOrder: idx + 1,
          allowedMimeTypes: (doc as any).allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES,
        }))
      : [
          {
            title: "Hoja de Vida Actualizada",
            description: "Formato PDF con datos de contacto",
            required: true,
            sortOrder: 1,
            allowedMimeTypes: "application/pdf",
          },
        ];

    createTemplateMutation.mutate({
      companyId,
      name: newTemplateName.trim(),
      items,
      positionId: assignNewTemplateToCargo && selectedPositionId ? selectedPositionId : undefined,
    });
  };

  const handleAssignDefault = () => {
    if (!selectedPositionId) return;
    assignDefaultMutation.mutate({
      companyId,
      positionId: selectedPositionId,
    });
  };

  const handleAddDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocTitle.trim() || !templateQuery.data || !selectedTemplateId) return;

    const existingItems = templateQuery.data.items || [];
    const updatedItems = [
      ...existingItems.map((item, index) => ({
        title: item.title,
        description: item.description || undefined,
        required: item.required,
        sortOrder: index + 1,
        allowedMimeTypes: item.allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES,
      })),
      {
        title: newDocTitle.trim(),
        description: newDocDesc.trim() || undefined,
        required: newDocRequired,
        sortOrder: existingItems.length + 1,
        allowedMimeTypes: newDocFileType,
      },
    ];

    updateTemplateMutation.mutate({
      companyId,
      templateId: selectedTemplateId,
      items: updatedItems,
    });

    setNewDocTitle("");
    setNewDocDesc("");
    setNewDocRequired(true);
    setNewDocFileType(DEFAULT_ALLOWED_MIMETYPES);
  };

  const handleOpenEditDoc = (item: { id: number; title: string; description?: string | null; required: boolean; allowedMimeTypes?: string | null }) => {
    setEditingDocId(item.id);
    setEditingDocTitle(item.title);
    setEditingDocDesc(item.description || "");
    setEditingDocRequired(item.required);
    setEditingDocFileType(item.allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES);
    setIsEditDocOpen(true);
  };

  const handleSaveDocEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateQuery.data || !selectedTemplateId || editingDocId === null || !editingDocTitle.trim()) return;

    const updatedItems = templateQuery.data.items.map((item) => {
      if (item.id === editingDocId) {
        return {
          title: editingDocTitle.trim(),
          description: editingDocDesc.trim() || undefined,
          required: editingDocRequired,
          sortOrder: item.sortOrder,
          allowedMimeTypes: editingDocFileType,
        };
      }
      return {
        title: item.title,
        description: item.description || undefined,
        required: item.required,
        sortOrder: item.sortOrder,
        allowedMimeTypes: item.allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES,
      };
    });

    updateTemplateMutation.mutate({
      companyId,
      templateId: selectedTemplateId,
      items: updatedItems,
    });
  };

  const handleMoveDoc = (index: number, direction: "up" | "down") => {
    if (!templateQuery.data || !selectedTemplateId) return;
    const items = [...templateQuery.data.items];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const temp = items[index];
    items[index] = items[targetIndex];
    items[targetIndex] = temp;

    const updatedItems = items.map((item, idx) => ({
      title: item.title,
      description: item.description || undefined,
      required: item.required,
      sortOrder: idx + 1,
      allowedMimeTypes: item.allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES,
    }));

    updateTemplateMutation.mutate({
      companyId,
      templateId: selectedTemplateId,
      items: updatedItems,
    });
  };

  const handleToggleRequired = (itemId: number) => {
    if (!templateQuery.data || !selectedTemplateId) return;

    const updatedItems = templateQuery.data.items.map((item) => ({
      title: item.title,
      description: item.description || undefined,
      required: item.id === itemId ? !item.required : item.required,
      sortOrder: item.sortOrder,
      allowedMimeTypes: item.allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES,
    }));

    updateTemplateMutation.mutate({
      companyId,
      templateId: selectedTemplateId,
      items: updatedItems,
    });
  };

  const handleDeleteDocument = (itemId: number) => {
    if (!templateQuery.data || !selectedTemplateId) return;

    const updatedItems = templateQuery.data.items
      .filter((item) => item.id !== itemId)
      .map((item, index) => ({
        title: item.title,
        description: item.description || undefined,
        required: item.required,
        sortOrder: index + 1,
        allowedMimeTypes: item.allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES,
      }));

    updateTemplateMutation.mutate({
      companyId,
      templateId: selectedTemplateId,
      items: updatedItems,
    });
  };

  const handleEnterMasterStandardView = () => {
    if (masterStandardQuery.data?.items) {
      setMasterItems(
        masterStandardQuery.data.items.map((item, idx) => ({
          title: item.title,
          description: item.description || undefined,
          required: item.required,
          sortOrder: item.sortOrder || idx + 1,
          allowedMimeTypes: (item as any).allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES,
        }))
      );
    }
    setIsMasterStandardView(true);
  };

  const handleOpenEditMasterDoc = (index: number) => {
    const doc = masterItems[index];
    if (!doc) return;
    setEditingMasterIndex(index);
    setEditingMasterDocTitle(doc.title);
    setEditingMasterDocDesc(doc.description || "");
    setEditingMasterDocRequired(doc.required);
    setEditingMasterDocFileType(doc.allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES);
    setIsEditMasterDocDialogOpen(true);
  };

  const handleSaveMasterDocEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingMasterIndex === null || !editingMasterDocTitle.trim()) return;
    setMasterItems((prev) =>
      prev.map((item, idx) =>
        idx === editingMasterIndex
          ? {
              ...item,
              title: editingMasterDocTitle.trim(),
              description: editingMasterDocDesc.trim() || undefined,
              required: editingMasterDocRequired,
              allowedMimeTypes: editingMasterDocFileType,
            }
          : item
      )
    );
    setIsEditMasterDocDialogOpen(false);
    setEditingMasterIndex(null);
    toast.success("Documento actualizado en la lista");
  };

  const handleAddMasterItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMasterDocTitle.trim()) return;
    setMasterItems((prev) => [
      ...prev,
      {
        title: newMasterDocTitle.trim(),
        description: newMasterDocDesc.trim() || undefined,
        required: newMasterDocRequired,
        sortOrder: prev.length + 1,
        allowedMimeTypes: newMasterDocFileType,
      },
    ]);
    setNewMasterDocTitle("");
    setNewMasterDocDesc("");
    setNewMasterDocRequired(true);
    setNewMasterDocFileType(DEFAULT_ALLOWED_MIMETYPES);
    toast.success("Documento añadido a la lista estándar");
  };

  const handleRemoveMasterItem = (index: number) => {
    setMasterItems((prev) => prev.filter((_, idx) => idx !== index));
    toast.info("Documento eliminado de la lista estándar");
  };

  const handleMoveMasterItem = (index: number, direction: "up" | "down") => {
    setMasterItems((prev) => {
      const newItems = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newItems.length) return prev;
      const temp = newItems[index];
      newItems[index] = newItems[targetIndex];
      newItems[targetIndex] = temp;
      return newItems;
    });
  };

  const handleToggleMasterItemRequired = (index: number) => {
    setMasterItems((prev) =>
      prev.map((item, idx) =>
        idx === index ? { ...item, required: !item.required } : item
      )
    );
  };

  const handleResetMasterToLegalDefaults = () => {
    if (confirm("¿Deseas restaurar la plantilla estándar con los 6 requisitos normativos de Colombia?")) {
      setMasterItems(
        STANDARD_REFERENCE_DOCS.map((doc, idx) => ({
          title: doc.title,
          description: doc.description,
          required: doc.required,
          sortOrder: idx + 1,
          allowedMimeTypes: doc.allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES,
        }))
      );
      toast.info("Valores normativos cargados en la plantilla estándar");
    }
  };

  const handleSaveMasterStandard = () => {
    if (masterItems.length === 0) {
      toast.error("La plantilla estándar debe contener al menos 1 documento");
      return;
    }
    updateMasterStandardMutation.mutate({
      companyId,
      items: masterItems.map((item, idx) => ({
        title: item.title,
        description: item.description,
        required: item.required,
        sortOrder: idx + 1,
        allowedMimeTypes: item.allowedMimeTypes || DEFAULT_ALLOWED_MIMETYPES,
      })),
      applyToAllPositions: masterApplyToAll,
    });
  };

  const isDefaultTemplate = templateQuery.data?.name === DEFAULT_TEMPLATE_NAME;

  if (isMasterStandardView) {
    return (
      <DashboardLayout roleOverride="HR">
        <div className="mx-auto max-w-7xl space-y-6 pb-12">
          {/* Navigation Breadcrumb / Back Button */}
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMasterStandardView(false)}
              className="-ml-2 mb-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Volver a Cargos y Plantillas
            </Button>

            <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
                  Plantilla Maestra Corporativa
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                  Plantilla Estándar de la Empresa
                </h1>
                <p className="mt-1 text-sm text-slate-500 max-w-3xl">
                  Personaliza los documentos estándar que tu organización solicitará por defecto a todos los candidatos en las nuevas contrataciones.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsMasterStandardView(false)}
                  className="h-9 px-4 text-xs font-medium text-slate-700 hover:bg-slate-100 border-slate-300"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveMasterStandard}
                  disabled={masterItems.length === 0 || updateMasterStandardMutation.isPending}
                  className="h-9 px-4 bg-blue-600 text-white hover:bg-blue-700 shadow-sm text-xs font-semibold"
                >
                  {updateMasterStandardMutation.isPending ? (
                    <>
                      <Clock className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Guardar Plantilla Estándar
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Global Banner and Sync Control Card */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2 rounded-xl bg-blue-50/70 border border-blue-200/80 p-4 flex items-start gap-3">
              <div className="rounded-lg bg-blue-100 p-2 text-blue-700 shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-blue-950">
                  Base oficial para todos los cargos de la empresa
                </h3>
                <p className="mt-0.5 text-xs text-blue-800 leading-relaxed">
                  Esta lista sirve como el modelo central de cumplimiento legal y operativo. Cualquier cargo que tenga asignado el <strong>"Expediente de Ingreso Estándar"</strong> tomará como referencia estos requisitos documentales.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-white border border-slate-200 shadow-sm p-4 flex flex-col justify-center">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label htmlFor="master-sync-toggle" className="text-xs font-bold text-slate-800 cursor-pointer">
                    Sincronizar cargos activos
                  </Label>
                  <p className="mt-0.5 text-[11px] text-slate-500 leading-tight">
                    Aplica inmediatamente estos cambios a todos los cargos con plantilla estándar.
                  </p>
                </div>
                <Switch
                  id="master-sync-toggle"
                  checked={masterApplyToAll}
                  onCheckedChange={setMasterApplyToAll}
                  className="shrink-0 mt-0.5"
                />
              </div>
            </div>
          </div>

          {/* 2-Column Responsive Workspace */}
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            {/* Left Column: Add Document Form & Legal Helper */}
            <div className="space-y-5">
              <Card className="border-slate-200 shadow-sm bg-white">
                <CardHeader className="p-5 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="rounded-md bg-slate-900 p-1.5 text-white">
                      <Plus className="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold text-slate-900">
                        Añadir Documento
                      </CardTitle>
                      <CardDescription className="text-xs text-slate-500">
                        Agrega un nuevo requisito a la plantilla estándar
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-5 pt-4">
                  <form onSubmit={handleAddMasterItem} className="space-y-4">
                    <div>
                      <Label htmlFor="master-add-title" className="text-xs font-semibold text-slate-700">
                        Título del Documento *
                      </Label>
                      <Input
                        id="master-add-title"
                        placeholder="Ej. Certificación Bancaria, Certificado EPS..."
                        value={newMasterDocTitle}
                        onChange={(e) => setNewMasterDocTitle(e.target.value)}
                        className="mt-1.5 text-xs bg-white"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="master-add-desc" className="text-xs font-semibold text-slate-700">
                        Instrucciones o Descripción (opcional)
                      </Label>
                      <Textarea
                        id="master-add-desc"
                        placeholder="Ej. Certificación con vigencia no mayor a 30 días en formato PDF..."
                        value={newMasterDocDesc}
                        onChange={(e) => setNewMasterDocDesc(e.target.value)}
                        className="mt-1.5 text-xs resize-none bg-white"
                        rows={3}
                      />
                    </div>

                    <div>
                      <DocumentFormatSelector
                        value={newMasterDocFileType}
                        onChange={setNewMasterDocFileType}
                        label="Formato aceptado"
                      />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                      <div>
                        <Label htmlFor="master-add-req" className="text-xs font-semibold text-slate-800 cursor-pointer">
                          Documento Obligatorio
                        </Label>
                        <p className="text-[11px] text-slate-500">
                          {newMasterDocRequired
                            ? "El candidato debe adjuntarlo para avanzar"
                            : "El candidato puede omitirlo si no aplica"}
                        </p>
                      </div>
                      <Switch
                        id="master-add-req"
                        checked={newMasterDocRequired}
                        onCheckedChange={setNewMasterDocRequired}
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={!newMasterDocTitle.trim()}
                      className="w-full bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm"
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      Añadir Documento a la Lista
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Colombian Legal Standards Reference Card */}
              <Card className="border-slate-200/80 bg-slate-50/60 shadow-xs">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center gap-2 text-slate-800 font-semibold text-xs">
                    <Info className="h-4 w-4 text-blue-600" />
                    <span>Referencia Normativa (Colombia)</span>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-1 space-y-2 text-xs text-slate-600 leading-relaxed">
                  <p className="text-[11px] text-slate-500">
                    La legislación laboral colombiana suele requerir para el inicio de labores:
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600">
                    <li><strong>Cédula de Ciudadanía:</strong> Art. 58 Código Sustantivo del Trabajo.</li>
                    <li><strong>EPS y Pensión:</strong> Afiliación obligatoria Ley 100 de 1993.</li>
                    <li><strong>Examen Médico de Ingreso:</strong> Resolución 2346 de 2007 (SST).</li>
                    <li><strong>Certificaciones Académicas:</strong> Validación de idoneidad.</li>
                  </ul>
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Interactive Document List */}
            <div className="space-y-4">
              <Card className="border-slate-200 shadow-sm bg-white overflow-hidden">
                <CardHeader className="p-5 pb-4 border-b border-slate-100">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="text-base font-bold text-slate-900">
                        Documentos en la Plantilla Estándar
                      </CardTitle>
                      <CardDescription className="text-xs text-slate-500">
                        Reordena, edita o elimina los requisitos documentales oficiales.
                      </CardDescription>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {masterItems.length} {masterItems.length === 1 ? "documento" : "documentos"}
                      </span>
                      <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 border border-blue-100">
                        {masterItems.filter((i) => i.required).length} obligatorios
                      </span>
                      <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {masterItems.filter((i) => !i.required).length} opcionales
                      </span>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-0 divide-y divide-slate-100">
                  {masterItems.length === 0 ? (
                    <div className="p-12 text-center">
                      <FileText className="mx-auto h-10 w-10 text-slate-300" />
                      <h4 className="mt-3 text-sm font-semibold text-slate-700">
                        No hay documentos en la plantilla estándar
                      </h4>
                      <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                        Añade documentos utilizando el formulario de la izquierda para configurar los requisitos estándar de la empresa.
                      </p>
                    </div>
                  ) : (
                    masterItems.map((item, index) => (
                      <div
                        key={index}
                        className="group flex flex-col gap-3 p-4 transition-colors hover:bg-slate-50/80 sm:flex-row sm:items-center sm:gap-4"
                      >
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                            {index + 1}
                          </span>

                          {/* Reorder Buttons */}
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => handleMoveMasterItem(index, "up")}
                              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-20 transition"
                              title="Mover arriba"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={index === masterItems.length - 1}
                              onClick={() => handleMoveMasterItem(index, "down")}
                              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-20 transition"
                              title="Mover abajo"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Title, Format Badge and Description */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-semibold text-slate-900 leading-snug">
                              {item.title}
                            </h4>
                            {(() => {
                              const badgeInfo = getFileTypeBadgeInfo(item.allowedMimeTypes);
                              return (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium border ${badgeInfo.badgeColor}`}
                                  title={badgeInfo.title}
                                >
                                  <FileText className="h-3 w-3 shrink-0" />
                                  {badgeInfo.badgeText}
                                </span>
                              );
                            })()}
                          </div>
                          {item.description ? (
                            <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">
                              {item.description}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-xs italic text-slate-400">
                              Sin instrucciones adicionales
                            </p>
                          )}
                        </div>

                        {/* Action Badges and Buttons */}
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleMasterItemRequired(index)}
                            title="Haz clic para alternar entre obligatorio y opcional"
                            className={`h-7 px-2.5 text-xs font-medium rounded-full transition ${
                              item.required
                                ? "bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200"
                            }`}
                          >
                            {item.required ? "Obligatorio" : "Opcional"}
                          </Button>

                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpenEditMasterDoc(index)}
                            className="h-8 px-2.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-md"
                            title="Editar título e instrucciones"
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5 text-slate-500" />
                            Editar
                          </Button>

                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => handleRemoveMasterItem(index)}
                            className="h-8 w-8 text-slate-400 hover:bg-red-50 hover:text-red-600 rounded-md transition"
                            title="Eliminar de la plantilla estándar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Bottom Action Footer Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs text-slate-500 text-center sm:text-left">
                  Tienes <strong className="text-slate-800">{masterItems.length} requisitos</strong> configurados en la plantilla estándar oficial.
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsMasterStandardView(false)}
                    className="text-xs"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveMasterStandard}
                    disabled={masterItems.length === 0 || updateMasterStandardMutation.isPending}
                    className="bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold shadow-sm"
                  >
                    {updateMasterStandardMutation.isPending ? (
                      <>
                        <Clock className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Guardando Cambios...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        Guardar Plantilla Estándar
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* DIALOG: Editar Documento de la Plantilla Estándar */}
          <Dialog open={isEditMasterDocDialogOpen} onOpenChange={setIsEditMasterDocDialogOpen}>
            <DialogContent className="sm:max-w-lg max-h-[min(90vh,760px)] p-0 flex flex-col overflow-hidden">
              <form onSubmit={handleSaveMasterDocEdit} className="w-full min-w-0 flex flex-col max-h-[min(90vh,760px)]">
                <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
                  <DialogTitle className="text-lg font-bold">
                    Editar Documento Estándar
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500">
                    Modifica el título, las instrucciones y la obligatoriedad de este documento de la plantilla maestra.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 px-6 py-2 overflow-y-auto min-w-0 flex-1">
                  <div>
                    <Label htmlFor="edit-master-title" className="text-xs font-semibold">
                      Título del documento *
                    </Label>
                    <Input
                      id="edit-master-title"
                      value={editingMasterDocTitle}
                      onChange={(e) => setEditingMasterDocTitle(e.target.value)}
                      placeholder="Ej. Certificado de Afiliación EPS"
                      className="mt-1 text-xs h-9"
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="edit-master-desc" className="text-xs font-semibold">
                      Instrucciones o descripción (opcional)
                    </Label>
                    <Textarea
                      id="edit-master-desc"
                      value={editingMasterDocDesc}
                      onChange={(e) => setEditingMasterDocDesc(e.target.value)}
                      placeholder="Instrucciones para el candidato sobre vigencia, formato o emisor..."
                      className="mt-1 resize-none text-xs min-h-[56px]"
                      rows={2}
                    />
                  </div>

                  <DocumentFormatSelector
                    value={editingMasterDocFileType}
                    onChange={setEditingMasterDocFileType}
                  />

                  <div className="flex items-center justify-between rounded-xl border border-slate-200 p-2.5 bg-slate-50">
                    <div>
                      <Label htmlFor="edit-master-req" className="text-xs font-semibold cursor-pointer">
                        Documento Obligatorio
                      </Label>
                      <p className="text-[11px] text-slate-500">
                        {editingMasterDocRequired
                          ? "El candidato debe subirlo obligatoriamente."
                          : "El candidato puede omitirlo en su proceso."}
                      </p>
                    </div>
                    <Switch
                      id="edit-master-req"
                      checked={editingMasterDocRequired}
                      onCheckedChange={setEditingMasterDocRequired}
                    />
                  </div>
                </div>

                <DialogFooter className="px-6 py-3 border-t border-slate-100 bg-slate-50/70 shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEditMasterDocDialogOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={!editingMasterDocTitle.trim()}
                    className="bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Actualizar Documento
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout roleOverride="HR">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Top Header */}
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
              Configuración Operativa
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              Cargos y Plantillas de Documentos
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Administra los perfiles de cargo de la empresa y define sus listas de chequeo documental estándar o personalizadas.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEnterMasterStandardView}
              className="border-blue-200 bg-blue-50/50 text-blue-700 hover:bg-blue-100 hover:text-blue-800"
            >
              <Sliders className="mr-1.5 h-4 w-4 text-blue-600" />
              Editar Plantilla Estándar de la Empresa
            </Button>
          </div>
        </div>

        {/* Master-Detail Layout */}
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* Left Column: Cargos List Component */}
          <div className="space-y-4">
            <Card className="border-slate-200 shadow-sm bg-white">
              <CardHeader className="p-4 pb-3 border-b border-slate-100">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base font-semibold text-slate-900">
                    Cargos ({positions.length})
                  </CardTitle>
                  <Button
                    size="sm"
                    onClick={() => setIsNewPositionOpen(true)}
                    className="h-8 bg-slate-950 text-white hover:bg-slate-800 text-xs font-medium px-2.5 shadow-sm"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Nuevo Cargo
                  </Button>
                </div>
                <div className="relative mt-2.5">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Buscar cargo..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="pl-9 text-sm"
                  />
                </div>
              </CardHeader>

              <CardContent className="p-2 pt-2 space-y-1.5 max-h-[600px] overflow-y-auto">
                {positionsQuery.isLoading ? (
                  <div className="p-6 text-center text-sm text-slate-400">
                    <Clock className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    Cargando cargos...
                  </div>
                ) : positions.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-400">
                    <Briefcase className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                    No se encontraron cargos.
                  </div>
                ) : (
                  positions.map((position) => {
                    const isSelected = selectedPositionId === position.id;
                    const assignedTemplate = getPositionAssignedTemplate(position);
                    const hasDefault = assignedTemplate?.name === DEFAULT_TEMPLATE_NAME;

                    return (
                      <div
                        key={position.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedPositionId(position.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedPositionId(position.id);
                          }
                        }}
                        className={`group relative flex w-full flex-col items-start rounded-xl border p-3.5 text-left transition-all cursor-pointer select-none ${
                          isSelected
                            ? "border-blue-500 bg-blue-50/60 shadow-sm ring-1 ring-blue-500/30"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80"
                        }`}
                      >
                        <div className="flex w-full items-start justify-between gap-2">
                          <span
                            className={`font-semibold text-sm line-clamp-1 ${
                              isSelected ? "text-blue-950" : "text-slate-800"
                            }`}
                          >
                            {position.name}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={(e) => handlePromptDeletePosition(position, e)}
                              className="h-6 w-6 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title={`Eliminar cargo "${position.name}"`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                            <Briefcase
                              className={`h-4 w-4 shrink-0 transition ${
                                isSelected ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
                              }`}
                            />
                          </div>
                        </div>

                        {position.description && (
                          <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                            {position.description}
                          </p>
                        )}

                        <div className="mt-2.5 flex w-full items-center justify-between gap-2">
                          {!assignedTemplate ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
                              <AlertCircle className="h-3 w-3" /> Sin plantilla
                            </span>
                          ) : hasDefault ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-blue-100/80 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                              <CheckCircle2 className="h-3 w-3" /> Estándar
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-purple-100/80 px-2 py-0.5 text-[11px] font-medium text-purple-700 max-w-[170px] truncate" title={assignedTemplate.name}>
                              <Sparkles className="h-3 w-3 shrink-0" /> <span className="truncate">{assignedTemplate.name}</span>
                            </span>
                          )}

                          <span className="text-[11px] text-slate-400">
                            1 plantilla
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Template Management for Selected Position */}
          <div className="space-y-4">
            {selectedPosition ? (
              <>
                {/* Position Summary Card */}
                <Card className="border-slate-200 bg-white shadow-sm">
                  <CardHeader className="p-5">
                    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Cargo seleccionado
                          </span>
                          <Badge variant="outline" className="text-xs font-normal">
                            ID: {selectedPosition.id}
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePromptDeletePosition(selectedPosition)}
                            className="h-6 px-2 text-xs font-medium text-red-600 border-red-200 bg-red-50/40 hover:bg-red-50 hover:text-red-700 hover:border-red-300 transition-colors ml-1"
                            title="Eliminar este cargo"
                          >
                            <Trash2 className="mr-1 h-3 w-3 text-red-500" />
                            Eliminar cargo
                          </Button>
                        </div>
                        <CardTitle className="mt-1 text-xl font-bold text-slate-900">
                          {selectedPosition.name}
                        </CardTitle>
                        <p className="mt-1 text-xs text-slate-500">
                          {selectedPosition.description || "Este cargo no tiene una descripción adicional configurada."}
                        </p>
                      </div>

                      {/* Select para asignar plantilla de documentos a este cargo */}
                      <div className="w-full md:w-80 bg-slate-50/80 border border-slate-200/90 rounded-xl p-3.5 shrink-0">
                        <Label htmlFor="position-template-select" className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-1.5">
                          <FileText className="h-3.5 w-3.5 text-blue-600" />
                          Plantilla asignada al cargo:
                        </Label>
                        <Select
                          value={selectedTemplateId ? String(selectedTemplateId) : ""}
                          onValueChange={(val) => {
                            const newId = Number(val);
                            setSelectedTemplateId(newId);
                            if (selectedPosition) {
                              assignTemplateMutation.mutate({
                                companyId,
                                positionId: selectedPosition.id,
                                templateId: newId,
                              });
                            }
                          }}
                          disabled={assignTemplateMutation.isPending || !templatesQuery.data?.length}
                        >
                          <SelectTrigger id="position-template-select" className="bg-white text-xs h-9 font-medium shadow-xs border-slate-300">
                            <SelectValue placeholder="Seleccionar plantilla..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(templatesQuery.data || []).map((t) => (
                              <SelectItem key={t.id} value={String(t.id)} className="text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{t.name}</span>
                                  {t.name === DEFAULT_TEMPLATE_NAME && (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-blue-50 text-blue-700 border-blue-200">
                                      Estándar
                                    </Badge>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="mt-1.5 text-[11px] text-slate-500 leading-tight">
                          Requisitos documentales que se solicitarán en las contrataciones de este cargo.
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                </Card>

                {/* Header Bar Above Template Configuration Card */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Configuración de Plantilla de Documentos
                    </h2>
                    <p className="text-xs text-slate-500">
                      Requisitos documentales que se solicitarán en las contrataciones de este cargo.
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => setIsNewTemplateOpen(true)}
                      className="bg-blue-600 text-white hover:bg-blue-700 shadow-sm text-xs font-semibold"
                      size="sm"
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      Crear Nueva Plantilla
                    </Button>
                  </div>
                </div>

                {/* Template Documents Card */}
                {!selectedTemplateId || !templateQuery.data ? (
                  <Card className="border-dashed border-2 border-slate-300 bg-slate-50/50 p-8 text-center">
                    <div className="mx-auto max-w-md space-y-3">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                        <FileText className="h-6 w-6" />
                      </div>
                      <h3 className="text-base font-semibold text-slate-900">
                        Este cargo aún no tiene una plantilla de documentos asignada
                      </h3>
                      <p className="text-xs text-slate-500">
                        Puedes asignarle la plantilla estándar de contratación legal o crear una nueva plantilla con requisitos personalizados.
                      </p>
                      <div className="flex flex-wrap justify-center gap-3 pt-2">
                        <Button
                          onClick={handleAssignDefault}
                          disabled={assignDefaultMutation.isPending}
                          className="bg-blue-600 text-white hover:bg-blue-700"
                        >
                          <ShieldCheck className="mr-1.5 h-4 w-4" />
                          Asignar Expediente Estándar
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setIsNewTemplateOpen(true)}
                        >
                          <Plus className="mr-1.5 h-4 w-4" />
                          Crear Nueva Plantilla
                        </Button>
                      </div>
                    </div>
                  </Card>
                ) : (
                  <Card className="border-slate-200 shadow-sm bg-white overflow-hidden">
                    <CardHeader className="p-5 pb-4 border-b border-slate-100">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        {/* Template title and info */}
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-lg font-bold text-slate-900 truncate">
                              {templateQuery.data?.name || "Plantilla de documentos"}
                            </CardTitle>
                            {isDefaultTemplate ? (
                              <Badge className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50 font-medium">
                                Plantilla por Defecto
                              </Badge>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200 font-medium">
                                  Plantilla Personalizada
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md"
                                  onClick={() => {
                                    setEditTemplateTitle(templateQuery.data?.name || "");
                                    setIsRenameTemplateOpen(true);
                                  }}
                                  title="Renombrar plantilla"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}

                            {positionsUsingActiveTemplate.length > 1 && (
                              <Badge variant="outline" className="text-[11px] bg-slate-50 text-slate-700 border-slate-200 font-normal">
                                Asignada a {positionsUsingActiveTemplate.length} cargos
                              </Badge>
                            )}
                          </div>
                          <CardDescription className="text-xs text-slate-500">
                            Lista de documentos que se requerirán al candidato y se capturarán como snapshot inmutable en cada contratación.
                          </CardDescription>
                        </div>

                        {/* Stats pill and optional Delete action */}
                        <div className="flex flex-wrap items-center gap-3 shrink-0">
                          <div className="rounded-lg bg-slate-50 border border-slate-200/80 px-3.5 py-1.5 text-left sm:text-right">
                            <div className="text-xs font-semibold text-slate-800 whitespace-nowrap">
                              {templateQuery.data?.items.length || 0} documentos configurados
                            </div>
                            <div className="text-[11px] text-slate-500 whitespace-nowrap">
                              {templateQuery.data?.items.filter((i) => i.required).length || 0} obligatorios ·{" "}
                              {templateQuery.data?.items.filter((i) => !i.required).length || 0} opcionales
                            </div>
                          </div>

                          {/* Delete custom template button */}
                          {!isDefaultTemplate && selectedTemplateId && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (confirm(`¿Estás seguro de eliminar la plantilla "${templateQuery.data?.name}"?`)) {
                                  deleteTemplateMutation.mutate({
                                    companyId,
                                    templateId: selectedTemplateId,
                                  });
                                }
                              }}
                              className="h-9 text-xs font-medium text-red-600 border-red-200 bg-red-50/40 hover:bg-red-50 hover:text-red-700 hover:border-red-300 transition-colors"
                              title="Eliminar esta plantilla personalizada"
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5 text-red-500" />
                              Eliminar plantilla
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    {/* Inline Document Addition Form */}
                    <div className="bg-slate-50/80 p-4 border-b border-slate-200">
                      <p className="text-xs font-semibold text-slate-700 mb-2.5">
                        + Agregar documento a esta plantilla:
                      </p>
                      <form onSubmit={handleAddDocument} className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            placeholder="Título (ej. Certificado de Antecedentes)"
                            value={newDocTitle}
                            onChange={(e) => setNewDocTitle(e.target.value)}
                            className="bg-white text-xs"
                            required
                          />
                          <Input
                            placeholder="Descripción / Instrucciones (opcional)"
                            value={newDocDesc}
                            onChange={(e) => setNewDocDesc(e.target.value)}
                            className="bg-white text-xs"
                          />
                        </div>
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-0.5">
                          <DocumentFormatSelector
                            value={newDocFileType}
                            onChange={setNewDocFileType}
                            compact
                            label="Formato aceptado"
                          />
                          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md border border-slate-200">
                              <Switch
                                id="required-toggle"
                                checked={newDocRequired}
                                onCheckedChange={setNewDocRequired}
                              />
                              <Label htmlFor="required-toggle" className="text-xs cursor-pointer select-none">
                                {newDocRequired ? "Obligatorio" : "Opcional"}
                              </Label>
                            </div>
                            <Button
                              type="submit"
                              size="sm"
                              disabled={!newDocTitle.trim() || updateTemplateMutation.isPending}
                              className="bg-slate-900 text-white hover:bg-slate-800"
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" />
                              Agregar
                            </Button>
                          </div>
                        </div>
                      </form>
                    </div>

                    {/* Document List with Edit, Reorder and Delete Actions */}
                    <CardContent className="p-0 divide-y divide-slate-100">
                      {templateQuery.isLoading ? (
                        <div className="p-8 text-center text-sm text-slate-400">
                          <Clock className="mx-auto mb-2 h-5 w-5 animate-spin" />
                          Cargando documentos de la plantilla...
                        </div>
                      ) : !templateQuery.data?.items.length ? (
                        <div className="p-8 text-center text-sm text-slate-400">
                          No hay documentos en esta plantilla. Agrega uno arriba o restaura los documentos por defecto.
                        </div>
                      ) : (
                        templateQuery.data.items.map((item, index) => (
                          <div
                            key={item.id}
                            className="group flex items-center gap-3 p-4 transition-colors hover:bg-slate-50/80"
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                              {index + 1}
                            </span>
                            
                            {/* Reorder Buttons */}
                            <div className="flex flex-col gap-0.5 opacity-60 group-hover:opacity-100">
                              <button
                                type="button"
                                disabled={index === 0 || updateTemplateMutation.isPending}
                                onClick={() => handleMoveDoc(index, "up")}
                                className="text-slate-400 hover:text-slate-800 disabled:opacity-20"
                                title="Mover arriba"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                disabled={index === (templateQuery.data?.items.length || 0) - 1 || updateTemplateMutation.isPending}
                                onClick={() => handleMoveDoc(index, "down")}
                                className="text-slate-400 hover:text-slate-800 disabled:opacity-20"
                                title="Mover abajo"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-slate-800">
                                  {item.title}
                                </span>
                                {(() => {
                                  const badgeInfo = getFileTypeBadgeInfo(item.allowedMimeTypes);
                                  return (
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium border ${badgeInfo.badgeColor}`}
                                      title={badgeInfo.title}
                                    >
                                      <FileText className="h-3 w-3 shrink-0" />
                                      {badgeInfo.badgeText}
                                    </span>
                                  );
                                })()}
                              </div>
                              {item.description && (
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {item.description}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              {/* Edit Document Button */}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleOpenEditDoc(item)}
                                className="h-7 px-2 text-xs text-slate-600 hover:bg-slate-100"
                                title="Editar título y descripción"
                              >
                                <Pencil className="mr-1 h-3 w-3 text-slate-500" />
                                Editar
                              </Button>

                              {/* Toggle Required Button */}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleToggleRequired(item.id)}
                                title="Haz clic para alternar entre obligatorio y opcional"
                                className={`h-7 px-2.5 text-xs font-medium rounded-full transition ${
                                  item.required
                                    ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                }`}
                              >
                                {item.required ? "Obligatorio" : "Opcional"}
                              </Button>

                              {/* Delete Document Button */}
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleDeleteDocument(item.id)}
                                className="h-8 w-8 text-slate-400 hover:bg-red-50 hover:text-red-600 opacity-80 group-hover:opacity-100"
                                title="Eliminar documento de la plantilla"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="p-12 text-center border-dashed">
                <Briefcase className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">
                  Selecciona un cargo de la lista izquierda para gestionar sus plantillas y documentos.
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* DIALOG: Editar Documento Individual */}
      <Dialog open={isEditDocOpen} onOpenChange={setIsEditDocOpen}>
        <DialogContent className="sm:max-w-lg max-h-[min(90vh,760px)] p-0 flex flex-col overflow-hidden">
          <form onSubmit={handleSaveDocEdit} className="w-full min-w-0 flex flex-col max-h-[min(90vh,760px)]">
            <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
              <DialogTitle className="text-lg font-bold">Editar Documento</DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Modifica el título, las instrucciones y la obligatoriedad de este documento.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-6 py-2 overflow-y-auto min-w-0 flex-1">
              <div>
                <Label htmlFor="edit-doc-title" className="text-xs font-semibold">
                  Título del documento *
                </Label>
                <Input
                  id="edit-doc-title"
                  value={editingDocTitle}
                  onChange={(e) => setEditingDocTitle(e.target.value)}
                  placeholder="Ej. Certificado de Antecedentes Disciplinarios"
                  className="mt-1 text-xs h-9"
                  required
                />
              </div>

              <div>
                <Label htmlFor="edit-doc-desc" className="text-xs font-semibold">
                  Instrucciones o descripción (opcional)
                </Label>
                <Textarea
                  id="edit-doc-desc"
                  value={editingDocDesc}
                  onChange={(e) => setEditingDocDesc(e.target.value)}
                  placeholder="Instrucciones para el candidato sobre vigencia, formato o emisor..."
                  className="mt-1 resize-none text-xs min-h-[56px]"
                  rows={2}
                />
              </div>

              <DocumentFormatSelector
                value={editingDocFileType}
                onChange={setEditingDocFileType}
              />

              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-2.5 bg-slate-50">
                <div>
                  <Label htmlFor="edit-doc-req" className="text-xs font-semibold cursor-pointer">
                    Documento Obligatorio
                  </Label>
                  <p className="text-[11px] text-slate-500">
                    {editingDocRequired
                      ? "El candidato debe subirlo obligatoriamente para completar el proceso."
                      : "El candidato puede completar el proceso sin este documento."}
                  </p>
                </div>
                <Switch
                  id="edit-doc-req"
                  checked={editingDocRequired}
                  onCheckedChange={setEditingDocRequired}
                />
              </div>
            </div>

            <DialogFooter className="px-6 py-3 border-t border-slate-100 bg-slate-50/70 shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditDocOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!editingDocTitle.trim() || updateTemplateMutation.isPending}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {updateTemplateMutation.isPending ? "Guardando..." : "Guardar Cambios"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: Renombrar Plantilla */}
      <Dialog open={isRenameTemplateOpen} onOpenChange={setIsRenameTemplateOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="w-full min-w-0"
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedTemplateId || !editTemplateTitle.trim()) return;
              updateTemplateNameMutation.mutate({
                companyId,
                templateId: selectedTemplateId,
                name: editTemplateTitle.trim(),
              });
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">Renombrar Plantilla</DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Modifica el nombre identificativo de esta plantilla de documentos.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 w-full min-w-0">
              <Label htmlFor="template-new-name" className="text-xs font-semibold">
                Nombre de la plantilla *
              </Label>
              <Input
                id="template-new-name"
                value={editTemplateTitle}
                onChange={(e) => setEditTemplateTitle(e.target.value)}
                placeholder="Ej. Expediente Técnico Senior"
                className="mt-1.5"
                required
              />
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsRenameTemplateOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!editTemplateTitle.trim() || updateTemplateNameMutation.isPending}
                className="bg-slate-900 text-white hover:bg-slate-800"
              >
                {updateTemplateNameMutation.isPending ? "Guardando..." : "Guardar Nombre"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: Nuevo Cargo */}
      <Dialog open={isNewPositionOpen} onOpenChange={setIsNewPositionOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreatePosition} className="w-full min-w-0">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">Crear Nuevo Cargo</DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Registra un nuevo cargo o puesto de trabajo para tu organización.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 w-full min-w-0">
              <div>
                <Label htmlFor="position-name" className="text-xs font-semibold">
                  Nombre del cargo *
                </Label>
                <Input
                  id="position-name"
                  value={newPositionName}
                  onChange={(e) => setNewPositionName(e.target.value)}
                  placeholder="Ej. Desarrollador Frontend, Analista Financiero..."
                  className="mt-1.5 text-xs"
                  required
                />
              </div>

              <div>
                <Label htmlFor="position-desc" className="text-xs font-semibold">
                  Descripción o perfil del cargo (opcional)
                </Label>
                <Textarea
                  id="position-desc"
                  value={newPositionDescription}
                  onChange={(e) => setNewPositionDescription(e.target.value)}
                  placeholder="Responsabilidades principales o requisitos específicos del perfil..."
                  className="mt-1.5 resize-none text-xs"
                  rows={3}
                />
              </div>

              <div>
                <Label htmlFor="position-template" className="text-xs font-semibold">
                  Plantilla documental inicial (opcional)
                </Label>
                <Select
                  value={newPositionTemplateId}
                  onValueChange={setNewPositionTemplateId}
                >
                  <SelectTrigger id="position-template" className="mt-1.5 text-xs bg-white">
                    <SelectValue placeholder="Plantilla estándar de la empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {(templatesQuery.data || []).map((t) => (
                      <SelectItem key={t.id} value={String(t.id)} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span>{t.name}</span>
                          {t.name === DEFAULT_TEMPLATE_NAME && (
                            <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-blue-50 text-blue-700">
                              Estándar
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsNewPositionOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={newPositionName.trim().length < 2 || createPositionMutation.isPending}
                className="bg-slate-950 text-white hover:bg-slate-800"
              >
                {createPositionMutation.isPending ? "Creando..." : "Crear Cargo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: Nueva Plantilla Reutilizable */}
      <Dialog open={isNewTemplateOpen} onOpenChange={setIsNewTemplateOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateCustomTemplate} className="w-full min-w-0">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">
                Crear Nueva Plantilla de Documentos
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Crea una plantilla documental reutilizable para asignar a cualquier cargo de la organización.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 w-full min-w-0">
              <div>
                <Label htmlFor="template-name" className="text-xs font-semibold">
                  Nombre de la plantilla *
                </Label>
                <Input
                  id="template-name"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="Ej. Expediente Especializado con Certificaciones Cloud"
                  className="mt-1.5 text-xs"
                  required
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
                <div className="flex items-start gap-3">
                  <Switch
                    id="copy-standard"
                    checked={copyStandardDocs}
                    onCheckedChange={setCopyStandardDocs}
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="copy-standard" className="text-xs font-semibold cursor-pointer">
                      Pre-cargar documentos de la plantilla estándar de la empresa
                    </Label>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Incluye automáticamente los requisitos estándar actuales para que los personalices rápidamente.
                    </p>
                  </div>
                </div>

                {selectedPosition && (
                  <div className="flex items-start gap-3 pt-2.5 border-t border-slate-200">
                    <Switch
                      id="assign-to-current"
                      checked={assignNewTemplateToCargo}
                      onCheckedChange={setAssignNewTemplateToCargo}
                      className="mt-0.5"
                    />
                    <div>
                      <Label htmlFor="assign-to-current" className="text-xs font-semibold cursor-pointer">
                        Asignar de inmediato a "{selectedPosition.name}"
                      </Label>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Vinculará esta plantilla al cargo actualmente seleccionado.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsNewTemplateOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={newTemplateName.trim().length < 2 || createTemplateMutation.isPending}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {createTemplateMutation.isPending ? "Creando..." : "Crear Plantilla"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: Confirmar Eliminación de Cargo */}
      <Dialog open={isDeletePositionOpen} onOpenChange={setIsDeletePositionOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              <DialogTitle className="text-lg font-bold text-slate-900">
                Eliminar Cargo
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-500 pt-2">
              ¿Estás seguro de que deseas eliminar el cargo{" "}
              <span className="font-semibold text-slate-900">"{positionToDelete?.name}"</span>?
              Esta acción archivará el perfil del cargo sin afectar las plantillas globales compartidas.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeletePositionOpen(false)}
              disabled={deletePositionMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDeletePosition}
              disabled={deletePositionMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white shadow-sm"
            >
              {deletePositionMutation.isPending ? "Eliminando..." : "Eliminar Cargo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
