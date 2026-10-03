export type ProjectRole = 'owner' | 'editor' | 'reviewer' | 'viewer';
export type ProjectEngine = 'pdflatex' | 'xelatex' | 'lualatex';

export const ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  reviewer: 1,
  editor: 2,
  owner: 3,
};

export const INVALID_PROJECT_NAME = 'name must be 1-100 characters without control characters';

/** The trimmed name if it is 1..100 characters without control characters, else null. */
export function parseProjectName(value: unknown): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  return /^[^\p{C}]{1,100}$/u.test(name) ? name : null;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  mainFile: string;
  engine: ProjectEngine;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectWithRole extends Project {
  role: ProjectRole;
}
