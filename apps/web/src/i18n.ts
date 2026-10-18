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
