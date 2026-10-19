import { type SidebarView, type UiLang, useSettingsStore } from './settings-store';

/** The languages offered in the settings selector. */
export const UI_LANGS: { value: UiLang; label: string }[] = [
  { value: 'pt-BR', label: 'Português' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

/** Maps any BCP-47-ish tag to one of our languages; anything else falls back to pt-BR. */
export function normalizeLang(tag: string | null | undefined): UiLang {
  const l = (tag ?? '').toLowerCase();
  if (l.startsWith('en')) return 'en';
  if (l.startsWith('es')) return 'es';
  return 'pt-BR';
}

interface NavStrings {
  /** Short name, used as the sidebar panel heading. */
  labels: Record<SidebarView, string>;
  /** Fuller text for the nav button tooltip. */
  titles: Record<SidebarView, string>;
  settings: { label: string; title: string };
}

// Nav menu only (first i18n slice); the rest of the UI is still pt-BR.
const NAV: Record<UiLang, NavStrings> = {
  'pt-BR': {
    labels: {
      files: 'Arquivos',
      navigator: 'Navegador',
      map: 'Mapa',
      graph: 'Grafo de assuntos',
      changes: 'Mudanças',
      packages: 'Bibliotecas',
      comments: 'Comentários',
      history: 'Histórico',
      members: 'Membros',
    },
    titles: {
      files: 'Arquivos do projeto',
      navigator: 'Navegador do documento',
      map: 'Mapa do documento',
      graph: 'Grafo de assuntos',
      changes: 'Mudanças desde a última versão',
      packages: 'Bibliotecas e pacotes',
      comments: 'Comentários do texto',
      history: 'Histórico de versões',
      members: 'Membros do projeto',
    },
    settings: { label: 'Configurações', title: 'Configurações' },
  },
  en: {
    labels: {
      files: 'Files',
      navigator: 'Outline',
      map: 'Map',
      graph: 'Topic graph',
      changes: 'Changes',
      packages: 'Libraries',
      comments: 'Comments',
      history: 'History',
      members: 'Members',
    },
    titles: {
      files: 'Project files',
      navigator: 'Document outline',
      map: 'Document map',
      graph: 'Topic graph',
      changes: 'Changes since the last version',
      packages: 'Libraries and packages',
      comments: 'Text comments',
      history: 'Version history',
      members: 'Project members',
    },
    settings: { label: 'Settings', title: 'Settings' },
  },
  es: {
    labels: {
      files: 'Archivos',
      navigator: 'Esquema',
      map: 'Mapa',
      graph: 'Grafo de temas',
      changes: 'Cambios',
      packages: 'Bibliotecas',
      comments: 'Comentarios',
      history: 'Historial',
      members: 'Miembros',
    },
    titles: {
      files: 'Archivos del proyecto',
      navigator: 'Esquema del documento',
      map: 'Mapa del documento',
      graph: 'Grafo de temas',
      changes: 'Cambios desde la última versión',
      packages: 'Bibliotecas y paquetes',
      comments: 'Comentarios del texto',
      history: 'Historial de versiones',
      members: 'Miembros del proyecto',
    },
    settings: { label: 'Configuración', title: 'Configuración' },
  },
};

/** The UI language in effect: an explicit choice, else automatic. */
export function useUiLang(): UiLang {
  const saved = useSettingsStore((s) => s.uiLang);
  // Only the nav menu is translated so far, so "automatic" stays on the app's language instead of
  // following the browser — otherwise a non-pt browser would get a half-translated UI (nav in one
  // language, every panel body still pt-BR).
  // ponytail: when the FasorX token response (/api/token) or the JWT carries the account locale,
  // resolve it here with normalizeLang; add navigator.language once enough of the UI is translated
  // to switch wholesale. See [[identity-fasorx]].
  return saved || 'pt-BR';
}

/** Nav menu strings for the current language. */
export function useNav(): NavStrings {
  return NAV[useUiLang()];
}

interface DashStrings {
  /** BCP-47 tag for Intl date formatting. */
  locale: string;
  title: string;
  /** Singular / plural noun for the project count. */
  project: string;
  projects: string;
  admin: string;
  search: string;
  newProject: string;
  blankProject: string;
  importZip: string;
  importFolder: string;
  filterAll: string;
  filterMine: string;
  filterShared: string;
  filters: string;
  loading: string;
  loadError: string;
  guestEmpty: string;
  needPin: string;
  needLink: string;
  serverError: string;
  /** serverError plus the LAN hint, for a local install. */
  serverErrorLan: string;
  tryAgain: string;
  enterPin: string;
  projectUnavailable: string;
  /** projectUnavailable with the LAN-share reasons, for a local install. */
  projectUnavailableLan: string;
  backToProjects: string;
  recent: string;
  open: string;
  /** Prefixes the project name in the "continue" button's aria-label. */
  continuePrefix: string;
  emptyTitle: string;
  emptyText: string;
  createProject: string;
  importFiles: string;
  hintGit: string;
  hintCollab: string;
  hintCompile: string;
  noResultsTitle: string;
  noResultsText: string;
  clearSearch: string;
  paginationLabel: string;
  page: string;
  totalSuffix: string;
  previous: string;
  next: string;
  colTitle: string;
  colModified: string;
  actions: string;
  actOpen: string;
  actShare: string;
  actCopy: string;
  actDownload: string;
  actRemove: string;
  howItWorks: string;
  logout: string;
}

// Dashboard (projects page + app header). Second i18n slice, after the nav menu.
const DASH: Record<UiLang, DashStrings> = {
  'pt-BR': {
    locale: 'pt-BR',
    title: 'Projetos',
    project: 'projeto',
    projects: 'projetos',
    admin: 'Administração',
    search: 'Buscar projeto',
    newProject: 'Novo projeto',
    blankProject: 'Projeto em branco',
    importZip: 'Importar .zip',
    importFolder: 'Importar pasta',
    filterAll: 'Todos os projetos',
    filterMine: 'Meus projetos',
    filterShared: 'Compartilhados comigo',
    filters: 'Filtros',
    loading: 'Carregando…',
    loadError: 'Não foi possível carregar os projetos.',
    guestEmpty: 'Nenhum projeto compartilhado com você ainda.',
    needPin:
      'Para abrir este projeto compartilhado, digite o PIN que o anfitrião te enviou. Se já tinha entrado, sua sessão expirou — digite o PIN de novo.',
    needLink: 'Abra o link que o anfitrião compartilhou com você para digitar o PIN.',
    serverError: 'Não foi possível falar com o servidor. Tente de novo em instantes.',
    serverErrorLan:
      'Não foi possível falar com o servidor. Verifique se está na mesma rede e tente de novo.',
    tryAgain: 'Tentar de novo',
    enterPin: 'Digitar o PIN',
    projectUnavailable: 'Projeto não encontrado, ou você não tem acesso a ele.',
    projectUnavailableLan:
      'Este projeto não está disponível. Ele pode não existir, ou você não tem mais acesso (o anfitrião pode ter removido seu acesso ou parado de compartilhar).',
    backToProjects: 'Voltar aos projetos',
    recent: 'Último projeto',
    open: 'Abrir',
    continuePrefix: 'Continuar projeto',
    emptyTitle: 'Ainda não há projetos',
    emptyText: 'Crie um projeto em branco ou importe arquivos que você já tem.',
    createProject: 'Criar projeto',
    importFiles: 'Importar arquivos',
    hintGit:
      'Cada projeto é um repositório git, com histórico e versões salvas quando você quiser.',
    hintCollab: 'Edição colaborativa em tempo real, com cursores nomeados e comentários no texto.',
    hintCompile:
      'Compile com pdfLaTeX, XeLaTeX ou LuaLaTeX e ligue pacotes sem editar o preâmbulo.',
    noResultsTitle: 'Nenhum projeto encontrado',
    noResultsText: 'Tente outro termo ou escolha um filtro diferente.',
    clearSearch: 'Limpar busca e filtros',
    paginationLabel: 'Paginação de projetos',
    page: 'Página',
    totalSuffix: 'no total',
    previous: 'Anterior',
    next: 'Próxima',
    colTitle: 'Título',
    colModified: 'Última modificação',
    actions: 'Ações',
    actOpen: 'Abrir',
    actShare: 'Compartilhar',
    actCopy: 'Fazer uma cópia',
    actDownload: 'Baixar .zip',
    actRemove: 'Excluir',
    howItWorks: 'Como funciona',
    logout: 'Sair',
  },
  en: {
    locale: 'en',
    title: 'Projects',
    project: 'project',
    projects: 'projects',
    admin: 'Administration',
    search: 'Search project',
    newProject: 'New project',
    blankProject: 'Blank project',
    importZip: 'Import .zip',
    importFolder: 'Import folder',
    filterAll: 'All projects',
    filterMine: 'My projects',
    filterShared: 'Shared with me',
    filters: 'Filters',
    loading: 'Loading…',
    loadError: 'Could not load the projects.',
    guestEmpty: 'No projects have been shared with you yet.',
    needPin:
      'To open this shared project, enter the PIN your host sent you. If you were already in, your session expired — just enter the PIN again.',
    needLink: 'Open the link your host shared with you to enter the PIN.',
    serverError: "Couldn't reach the server. Try again in a moment.",
    serverErrorLan:
      "Couldn't reach the server. Make sure you're on the same network, then try again.",
    tryAgain: 'Try again',
    enterPin: 'Enter the PIN',
    projectUnavailable: "Project not found, or you don't have access to it.",
    projectUnavailableLan:
      "This project isn't available. It may not exist, or you no longer have access (the host may have removed your access or stopped sharing).",
    backToProjects: 'Back to projects',
    recent: 'Last project',
    open: 'Open',
    continuePrefix: 'Continue project',
    emptyTitle: 'No projects yet',
    emptyText: 'Create a blank project or import files you already have.',
    createProject: 'Create project',
    importFiles: 'Import files',
    hintGit: 'Each project is a git repository, with history and versions saved whenever you want.',
    hintCollab: 'Real-time collaborative editing, with named cursors and inline comments.',
    hintCompile:
      'Compile with pdfLaTeX, XeLaTeX or LuaLaTeX and toggle packages without editing the preamble.',
    noResultsTitle: 'No projects found',
    noResultsText: 'Try another term or pick a different filter.',
    clearSearch: 'Clear search and filters',
    paginationLabel: 'Project pagination',
    page: 'Page',
    totalSuffix: 'in total',
    previous: 'Previous',
    next: 'Next',
    colTitle: 'Title',
    colModified: 'Last modified',
    actions: 'Actions',
    actOpen: 'Open',
    actShare: 'Share',
    actCopy: 'Make a copy',
    actDownload: 'Download .zip',
    actRemove: 'Delete',
    howItWorks: 'How it works',
    logout: 'Log out',
  },
  es: {
    locale: 'es',
    title: 'Proyectos',
    project: 'proyecto',
    projects: 'proyectos',
    admin: 'Administración',
    search: 'Buscar proyecto',
    newProject: 'Nuevo proyecto',
    blankProject: 'Proyecto en blanco',
    importZip: 'Importar .zip',
    importFolder: 'Importar carpeta',
    filterAll: 'Todos los proyectos',
    filterMine: 'Mis proyectos',
    filterShared: 'Compartidos conmigo',
    filters: 'Filtros',
    loading: 'Cargando…',
    loadError: 'No se pudieron cargar los proyectos.',
    guestEmpty: 'Aún no se ha compartido ningún proyecto contigo.',
    needPin:
      'Para abrir este proyecto compartido, escribe el PIN que te envió el anfitrión. Si ya habías entrado, tu sesión caducó — escribe el PIN otra vez.',
    needLink: 'Abre el enlace que compartió contigo el anfitrión para escribir el PIN.',
    serverError: 'No se pudo contactar con el servidor. Inténtalo de nuevo en un momento.',
    serverErrorLan:
      'No se pudo contactar con el servidor. Comprueba que estás en la misma red e inténtalo de nuevo.',
    tryAgain: 'Intentar de nuevo',
    enterPin: 'Escribir el PIN',
    projectUnavailable: 'Proyecto no encontrado, o no tienes acceso a él.',
    projectUnavailableLan:
      'Este proyecto no está disponible. Puede que no exista o que ya no tengas acceso (el anfitrión pudo quitar tu acceso o dejar de compartir).',
    backToProjects: 'Volver a los proyectos',
    recent: 'Último proyecto',
    open: 'Abrir',
    continuePrefix: 'Continuar proyecto',
    emptyTitle: 'Aún no hay proyectos',
    emptyText: 'Crea un proyecto en blanco o importa archivos que ya tengas.',
    createProject: 'Crear proyecto',
    importFiles: 'Importar archivos',
    hintGit:
      'Cada proyecto es un repositorio git, con historial y versiones guardadas cuando quieras.',
    hintCollab:
      'Edición colaborativa en tiempo real, con cursores con nombre y comentarios en el texto.',
    hintCompile:
      'Compila con pdfLaTeX, XeLaTeX o LuaLaTeX y activa paquetes sin editar el preámbulo.',
    noResultsTitle: 'No se encontraron proyectos',
    noResultsText: 'Prueba otro término o elige un filtro distinto.',
    clearSearch: 'Limpiar búsqueda y filtros',
    paginationLabel: 'Paginación de proyectos',
    page: 'Página',
    totalSuffix: 'en total',
    previous: 'Anterior',
    next: 'Siguiente',
    colTitle: 'Título',
    colModified: 'Última modificación',
    actions: 'Acciones',
    actOpen: 'Abrir',
    actShare: 'Compartir',
    actCopy: 'Hacer una copia',
    actDownload: 'Descargar .zip',
    actRemove: 'Eliminar',
    howItWorks: 'Cómo funciona',
    logout: 'Salir',
  },
};

/** Dashboard (projects page + app header) strings for the current language. */
export function useDash(): DashStrings {
  return DASH[useUiLang()];
}

/** `n` projects, with the current language's singular/plural noun. */
export function projectCount(d: DashStrings, n: number): string {
  return `${n} ${n === 1 ? d.project : d.projects}`;
}

interface LanStrings {
  title: string;
  description: string;
  disabled: string;
  publish: string;
  unpublish: string;
  link: string;
  copy: string;
  copied: string;
  people: string;
  aliasPlaceholder: string;
  add: string;
  noPeople: string;
  remove: string;
  pinOnce: string;
  pickUrl: string;
  joinTitle: string;
  joinDescription: string;
  pinLabel: string;
  join: string;
  joinError: string;
  joinLocked: string;
}

const LAN: Record<UiLang, LanStrings> = {
  'pt-BR': {
    title: 'Compartilhar na rede local',
    description:
      'Publique este projeto para que amigos na mesma rede editem pelo navegador, com um PIN.',
    disabled: 'O compartilhamento em rede local está desligado neste servidor.',
    publish: 'Publicar na rede',
    unpublish: 'Parar de compartilhar',
    link: 'Link para compartilhar',
    copy: 'Copiar',
    copied: 'Copiado!',
    people: 'Pessoas com acesso',
    aliasPlaceholder: 'Nome do amigo',
    add: 'Adicionar',
    noPeople: 'Ninguém ainda. Adicione uma pessoa para gerar um PIN.',
    remove: 'Remover',
    pinOnce: 'Anote o PIN agora: ele aparece só uma vez.',
    pickUrl: 'Se o amigo não abrir, tente outro endereço da lista.',
    joinTitle: 'Entrar no projeto compartilhado',
    joinDescription: 'Digite o PIN de 4 dígitos que você recebeu.',
    pinLabel: 'PIN',
    join: 'Entrar',
    joinError: 'PIN inválido ou projeto indisponível.',
    joinLocked: 'Muitas tentativas erradas. Aguarde alguns minutos e tente de novo.',
  },
  en: {
    title: 'Share on the local network',
    description:
      'Publish this project so friends on the same network can edit it in a browser, with a PIN.',
    disabled: 'LAN sharing is turned off on this server.',
    publish: 'Publish to the network',
    unpublish: 'Stop sharing',
    link: 'Link to share',
    copy: 'Copy',
    copied: 'Copied!',
    people: 'People with access',
    aliasPlaceholder: "Friend's name",
    add: 'Add',
    noPeople: 'No one yet. Add a person to generate a PIN.',
    remove: 'Remove',
    pinOnce: 'Write the PIN down now: it is shown only once.',
    pickUrl: 'If a friend cannot open it, try another address from the list.',
    joinTitle: 'Join the shared project',
    joinDescription: 'Enter the 4-digit PIN you were given.',
    pinLabel: 'PIN',
    join: 'Join',
    joinError: 'Invalid PIN or project unavailable.',
    joinLocked: 'Too many wrong attempts. Wait a few minutes and try again.',
  },
  es: {
    title: 'Compartir en la red local',
    description:
      'Publica este proyecto para que amigos en la misma red lo editen en el navegador, con un PIN.',
    disabled: 'El uso compartido en red local está desactivado en este servidor.',
    publish: 'Publicar en la red',
    unpublish: 'Dejar de compartir',
    link: 'Enlace para compartir',
    copy: 'Copiar',
    copied: '¡Copiado!',
    people: 'Personas con acceso',
    aliasPlaceholder: 'Nombre del amigo',
    add: 'Añadir',
    noPeople: 'Nadie todavía. Añade una persona para generar un PIN.',
    remove: 'Quitar',
    pinOnce: 'Anota el PIN ahora: se muestra solo una vez.',
    pickUrl: 'Si un amigo no puede abrirlo, prueba otra dirección de la lista.',
    joinTitle: 'Entrar al proyecto compartido',
    joinDescription: 'Escribe el PIN de 4 dígitos que recibiste.',
    pinLabel: 'PIN',
    join: 'Entrar',
    joinError: 'PIN no válido o proyecto no disponible.',
    joinLocked: 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.',
  },
};

/** LAN-share strings for the current language. */
export function useLan(): LanStrings {
  return LAN[useUiLang()];
}
