// Root component mounted in the separate projects-manager BrowserWindow.
// main.tsx renders this instead of <App> when the renderer is loaded with a
// `#projects` hash. The native window frame provides move/resize/close.

import { ProjectsManager } from './ProjectsManager'

/** Full-window host for the projects manager. */
export function ProjectsManagerWindow(): JSX.Element {
  return <ProjectsManager />
}
