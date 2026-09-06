import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, Plus, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCompanyId } from "@/hooks/useCompanyId";
import { cn } from "@/lib/utils";
import { getHiringStatusInfo } from "@/lib/statusFormatters";
import { DIRECCION_INICIAL, ordenarProcesos, type OrdenColumna } from "@/lib/hiringSort";

/** Tipografia de la fila de cabeceras, en una constante porque tiene que ir a la vez en el
 *  contenedor y en cada <button> ordenable.
 *
 *  El contenedor se la pasaba a todas por herencia mientras fueron <span>. En cuanto cinco
 *  pasaron a ser botones dejo de llegarles: los navegadores resetean la tipografia de los
 *  controles de formulario en su hoja de estilos -- `text-transform: none` incluido --, asi
 *  que las cinco columnas ordenables quedaron en caja mixta y a otro tamanio al lado de un
 *  "ACCIONES" que si seguia en versales.
 *
 *  11px y no 10: en versales y con tracking, por debajo de 11 cuesta leerlas.
 *
 *  `slate-600` y no `slate-400`, que es lo que habia: sobre blanco, slate-400 da 2,6:1 de
 *  contraste -- por debajo del 4,5:1 que la WCAG pide para texto normal -- y slate-600 da
 *  7,6:1. Un paso mas oscuro de lo que pediria una etiqueta suelta porque estas ya no lo
 *  son: desde que ordenan son controles, y un control con el contraste justo para pasar no
 *  invita a pulsarlo. Pero solo un paso: `slate-700` queda reservado a la columna activa, y
 *  mas oscuro que eso haria que los rotulos compitieran con los nombres de los candidatos,
 *  que es lo que la vista tiene que recorrer. Los 11px en versales y con tracking ya los
 *  separan de sobra de los 14px de los datos. */
const CABECERA = "text-[11px] font-semibold uppercase tracking-wider text-slate-600";

/** Cabecera pulsable de una columna.
 *
 *  Vive FUERA del componente a proposito: definida dentro seria un tipo nuevo en cada
 *  render, React desmontaria y volveria a montar el <button> justo al ordenar, y el foco
 *  del teclado se perderia despues de cada pulsacion -- que es precisamente cuando alguien
 *  que navega con teclado quiere seguir en la misma cabecera para invertir el orden. */
function CabeceraOrdenable({ etiqueta, activa, direccion, onClick }: {
  etiqueta: string;
  activa: boolean;
  direccion: "asc" | "desc";
  onClick: () => void;
}) {
  const Icono = !activa ? ArrowUpDown : direccion === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      // La tabla son <div>, no un <table>, asi que `aria-sort` no llegaria a anunciarse.
      // Hasta que la semantica se arregle, el estado va en el nombre accesible del boton.
      aria-label={`Ordenar por ${etiqueta.toLowerCase()}${activa ? (direccion === "asc" ? ", ascendente" : ", descendente") : ""}`}
      className={cn(
        CABECERA,
        "group flex items-center gap-1 rounded-sm text-left transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        // La columna activa se distingue por color ademas de por la flecha: con la base ya
        // en slate-600, slate-700 se quedaria corto y no se leeria como "esta es".
        activa && "text-slate-900"
      )}
    >
      {etiqueta}
      <Icono className={cn("h-3 w-3 transition-opacity", !activa && "opacity-0 group-hover:opacity-60")} />
    </button>
  );
}

/** Listado de procesos de contratacion: la MISMA tabla en el inicio (`HRDashboard`) y en
 *  `/hr/contrataciones` (`HiringPage`).
 *
 *  Antes el inicio tenia su propia copia reducida -- cinco filas, sin filtros, sin fecha
 *  limite y sin borrado. Dos tablas de los mismos datos se separan solas: el enlace
 *  estirado accesible, el borrado con confirmacion y las seis invalidaciones de cache
 *  solo llegaron a una de las dos, y el analista veia un estado distinto segun por donde
 *  entrara.
 *
 *  La empresa activa se resuelve DENTRO con `useCompanyId()`, no por props. Es la regla
 *  del repo (nunca hardcodear ni pasear `companyId`) y una prop es justo el sitio donde
 *  alguien acaba pasando un 0 -- que el zod del servidor rechaza -- o el id de otro
 *  tenant. No cuesta una peticion: `access.me`, `hiring.list` y `positions.list` ya se
 *  consultan en las paginas que montan esta tarjeta y react-query las deduplica por
 *  queryKey; esto solo anade observadores sobre la misma entrada de cache. */
export default function HiringProcessesCard({
  conBotonNuevaContratacion = false,
  conEnlaceVerContrataciones = false,
}: {
  /** Solo el inicio. En `/hr/contrataciones` ya estan el boton de la cabecera de pagina y
   *  el formulario de alta justo encima de esta tarjeta. */
  conBotonNuevaContratacion?: boolean;
  /** Idem: ir a `/hr/contrataciones` desde `/hr/contrataciones` no lleva a ningun sitio. */
  conEnlaceVerContrataciones?: boolean;
}) {
  const { companyId, ready, isLoading: cargandoEmpresa, error: errorEmpresa } = useCompanyId();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const hiring = trpc.hiring.list.useQuery({ companyId }, { enabled: ready });
  const positions = trpc.positions.list.useQuery({ companyId }, { enabled: ready });
  const [statusFilter, setStatusFilter] = useState("all"); const [positionFilter, setPositionFilter] = useState("all");
  // Arranca igual que venia el servidor (`orderBy(desc(createdAt))` en `listHiring`), asi
  // que hasta que alguien pulse una cabecera no cambia nada de lo que ya se veia.
  const [orden, setOrden] = useState<OrdenColumna>("createdAt"); const [direccion, setDireccion] = useState<"asc" | "desc">("desc");
  const [processToDelete, setProcessToDelete] = useState<{ id: number; candidateName: string } | null>(null);
  const ordenarPor = (campo: OrdenColumna) => {
    if (campo === orden) { setDireccion(d => (d === "asc" ? "desc" : "asc")); return; }
    setOrden(campo);
    setDireccion(DIRECCION_INICIAL[campo]);
  };

  // El borrado es fisico y arrastra tablas que alimentan otras cuatro vistas, asi que hay
  // que invalidar todas: `hr.stats` son las tarjetas del dashboard (se calculan con el
  // mismo `listHiring`), y los enlaces, los insights y las notificaciones de este proceso
  // dejan de existir. Sin esto el dashboard sigue contando una fila que ya no esta -- y
  // ahora que esta tabla vive tambien en el inicio, las tarjetas y la fila fantasma se
  // desmienten en la misma pantalla.
  const remove = trpc.hiring.delete.useMutation({
    onSuccess: result => {
      utils.hiring.list.invalidate(); utils.hr.stats.invalidate(); utils.hiring.expiringLinks.invalidate(); utils.hiring.notifications.invalidate(); utils.ai.insights.invalidate(); utils.hiring.detail.invalidate();
      setProcessToDelete(null);
      // El aviso importa: el proceso ya no existe, pero quedaron documentos personales en
      // el almacenamiento que la aplicacion ya no puede localizar.
      if (result.avisoAlmacenamiento) toast.warning("Contratación eliminada, pero algunos archivos no pudieron borrarse del almacenamiento. Queda registrado para el equipo técnico.");
      else toast.success("Contratación eliminada");
    },
    onError: error => toast.error(error.message || "No fue posible eliminar la contratación"),
  });

  const filtradas = hiring.data?.filter(row => (statusFilter === "all" || row.status === statusFilter) && (positionFilter === "all" || String(row.positionId) === positionFilter)) || [];
  const rows = ordenarProcesos(filtradas, orden, direccion);
  // El subtitulo decia "N proceso(s) en este tenant.": "tenant" es jerga de programador
  // delante del usuario, el "(s)" es un plural perezoso y el numero era el de las filas ya
  // filtradas mientras el texto sugeria el total de la empresa. Con filtro puesto ahora se
  // dicen las dos cifras, que es justo cuando la diferencia importa.
  const total = hiring.data?.length ?? 0;
  const hayFiltro = statusFilter !== "all" || positionFilter !== "all";
  const resumen = hayFiltro
    ? `${rows.length} de ${total} ${total === 1 ? "proceso" : "procesos"}`
    : `${total} ${total === 1 ? "proceso" : "procesos"}`;
  // `isLoading` de react-query v5 es `isPending && isFetching`: con `enabled: false` vale
  // FALSE, asi que mientras se resolvia la empresa activa la tabla se pintaba vacia --
  // "No hay procesos con estos filtros" -- y luego saltaba a las filas. Se suma el
  // `isLoading` de `access.me`, y no `!ready`, porque el `companyId` del servidor es
  // `number | null`: con `!ready` el usuario que de verdad no tiene empresa activa se
  // quedaria mirando un esqueleto para siempre.
  const cargando = cargandoEmpresa || hiring.isLoading;
  const hayError = Boolean(errorEmpresa || hiring.error);

  return (
    <>
      <Card>
        {/* `flex flex-col` explicito, como en HiringDetailPage y PositionsPage: `CardHeader`
            trae `display: grid`, asi que el `sm:flex-row` que habia aqui no hacia nada --
            tailwind-merge conserva las dos clases porque no chocan y gana el grid. Resultado:
            los filtros caian debajo del titulo y pegados a la izquierda en vez de ir a la
            derecha, en la misma linea. */}
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Procesos recientes</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {cargando ? "Cargando procesos…" : resumen}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="pending">Pendiente</SelectItem>
                <SelectItem value="in_review">En revisión</SelectItem>
                <SelectItem value="complete">Completo</SelectItem>
              </SelectContent>
            </Select>
            <Select value={positionFilter} onValueChange={setPositionFilter}>
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="Cargo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los cargos</SelectItem>
                {positions.data?.map(position => (
                  <SelectItem key={position.id} value={String(position.id)}>
                    {position.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {conBotonNuevaContratacion && (
              <>
                {/* Crear no es filtrar. El boton es lo mas pesado de la tarjeta -- negro
                    solido junto a dos selects neutros -- y en fila con ellos se leia como
                    un tercer filtro. El separador lo saca del grupo sin mandarlo a otra
                    esquina. Se oculta por debajo de `sm`, donde la cabecera se apila y una
                    linea vertical suelta no separaria nada. */}
                <span className="mx-1 hidden h-6 w-px shrink-0 bg-slate-200 sm:block" aria-hidden="true" />
                <Button
                  size="sm"
                  onClick={() => setLocation("/hr/contrataciones")}
                  className="bg-slate-950 text-white hover:bg-slate-800"
                >
                  <Plus />Nueva contratación
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* La cabecera solo existe a partir de `sm`, asi que en movil no hay como
              ordenar. Es la misma carencia que ya tenian las etiquetas de columna -- abajo
              de 640px la fila se apila sin decir que es cada valor -- y arreglarla pide
              rehacer la fila en modo tarjeta, que es otro trabajo. */}
          <div className={cn("hidden grid-cols-[1.4fr_1fr_0.8fr_0.8fr_0.8fr_76px] gap-3 border-b px-5 py-3 sm:grid", CABECERA)}>
            <CabeceraOrdenable etiqueta="Candidato" activa={orden === "candidateName"} direccion={direccion} onClick={() => ordenarPor("candidateName")} />
            <CabeceraOrdenable etiqueta="Cargo" activa={orden === "positionName"} direccion={direccion} onClick={() => ordenarPor("positionName")} />
            <CabeceraOrdenable etiqueta="Progreso" activa={orden === "progress"} direccion={direccion} onClick={() => ordenarPor("progress")} />
            <CabeceraOrdenable etiqueta="Estado" activa={orden === "status"} direccion={direccion} onClick={() => ordenarPor("status")} />
            {/* Ordena por la fecha de creacion, que es el valor grande de la celda y el que
                nombra la columna. La linea "Límite:" que va debajo es una segunda fecha, y
                una sola cabecera no puede ordenar honestamente por las dos: para eso hace
                falta separarlas en dos columnas. */}
            <CabeceraOrdenable etiqueta="Fecha" activa={orden === "createdAt"} direccion={direccion} onClick={() => ordenarPor("createdAt")} />
            <span className="text-right">Acciones</span>
          </div>
          {cargando ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : hayError ? (
            <p className="p-6 text-sm text-rose-600">No se pudo cargar la información de contratación.</p>
          ) : rows.length ? (
            rows.map(process => {
              const statusInfo = getHiringStatusInfo(process.status, process.requiredCount, process.receivedCount);
              return (
                <div
                  key={process.id}
                  className="relative grid gap-2 border-b px-5 py-4 text-sm transition hover:bg-slate-50 sm:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_0.8fr_76px] sm:items-center"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <UserRound className="h-4 w-4 text-slate-400" />
                    {/* El enlace se estira sobre toda la fila en vez de envolverla: el
                        boton de eliminar tiene que ser HERMANO del enlace, no
                        descendiente suyo. Un <button> dentro de un <a> es HTML invalido
                        y deja dos controles anidados en el arbol de accesibilidad;
                        ademas asi no hace falta ningun stopPropagation, que es una
                        correccion facil de perder el dia que alguien envuelva el boton
                        en un Tooltip o en un DialogTrigger. */}
                    <Link
                      href={`/hr/contrataciones/${process.id}`}
                      className="rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      {process.candidateName}
                    </Link>
                  </span>
                  <span className="text-slate-500">{process.positionName}</span>
                  <span className="text-slate-500">
                    {process.receivedCount}/{process.requiredCount}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn("w-fit font-normal", statusInfo.className)}
                  >
                    {statusInfo.label}
                  </Badge>
                  <div className="flex flex-col text-xs text-slate-400">
                    <span>{new Date(process.createdAt).toLocaleDateString("es-CO")}</span>
                    {process.documentDeadline && (
                      <span className="text-[11px] text-amber-600 font-medium">
                        Límite: {new Date(process.documentDeadline).toLocaleDateString("es-CO")}
                      </span>
                    )}
                  </div>
                  {/* `relative z-10` levanta la celda por encima del enlace estirado:
                      sin esto el overlay del ::after se comeria el clic del boton.
                      Aqui hubo una flecha decorativa (`aria-hidden`) que parecia el boton
                      de abrir el detalle y no lo era: quien abre la fila es el enlace
                      estirado, asi que el icono solo prometia un clic que no existia. */}
                  <div className="relative z-10 flex items-center justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      // Con solo "Eliminar" un lector de pantalla anuncia N botones identicos.
                      aria-label={`Eliminar la contratación de ${process.candidateName}`}
                      onClick={() => setProcessToDelete({ id: process.id, candidateName: process.candidateName })}
                      className="text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          ) : hiring.data?.length ? (
            <div className="p-8 text-center text-sm text-slate-500">No hay procesos con estos filtros.</div>
          ) : (
            // Vacio real distinto de vacio por filtro: "No hay procesos con estos filtros"
            // es falso -- y desorienta -- cuando la empresa todavia no tiene ninguno.
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-700">Aún no hay procesos registrados</p>
              <p className="mt-1 text-xs text-slate-400">Crea el primer proceso para iniciar el seguimiento de expedientes.</p>
            </div>
          )}

          {conEnlaceVerContrataciones && (
            // Antes era un enlace fantasma en `text-xs` flotando en el hueco bajo la ultima
            // fila: se leia como texto suelto y no como algo pulsable. Ahora es un boton
            // `outline` como los demas del dashboard, alineado con el `px-5` de las filas y
            // sin relleno inferior, porque la <Card> ya aporta el suyo (`py-6`).
            <div className="flex justify-end px-5 pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation("/hr/contrataciones")}
                className="group text-slate-600 hover:text-slate-900"
              >
                Ver contrataciones
                {/* `ArrowRight` y no `ArrowUpRight`: no se abre nada aparte, se continua
                    hacia el listado. Se le quitaron el `ml-1` -- que peleaba con el
                    `gap-1.5` de la variante `sm` -- y el `h-3.5 w-3.5`, que no llegaba a
                    aplicarse: `[&_svg:not([class*='size-'])]:size-4` del boton gana por
                    especificidad. */}
                <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DIALOG: Confirmar eliminacion de la contratacion. El borrado es fisico, asi que
          el texto tiene que enumerar lo que se pierde: al analista no le queda ningun
          sitio donde recuperarlo. Va fuera de la <Card> porque Radix lo portea al body de
          todos modos y asi no hereda el overflow ni el z-index de la tarjeta. */}
      <Dialog open={Boolean(processToDelete)} onOpenChange={open => { if (!open && !remove.isPending) setProcessToDelete(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              <DialogTitle className="text-lg font-bold text-slate-900">
                Eliminar contratación
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-500 pt-2">
              Se eliminará de forma permanente el proceso de{" "}
              <span className="font-semibold text-slate-900">"{processToDelete?.candidateName}"</span>:
              los documentos que cargó, el enlace del portal, el historial de comunicaciones y los
              análisis de IA asociados.{" "}
              <span className="font-semibold text-slate-900">Esta acción no se puede deshacer.</span>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setProcessToDelete(null)}
              disabled={remove.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => processToDelete && remove.mutate({ companyId, processId: processToDelete.id })}
              disabled={remove.isPending}
              className="bg-red-600 hover:bg-red-700 text-white shadow-sm"
            >
              {remove.isPending ? "Eliminando..." : "Eliminar contratación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
