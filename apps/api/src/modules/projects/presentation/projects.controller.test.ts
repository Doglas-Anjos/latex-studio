import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../../users/domain/user';
import type { ProjectsService } from '../application/projects.service';
import type { Project } from '../domain/project';
import { ProjectsController } from './projects.controller';

const user = { id: randomUUID(), email: 'ana@example.com', name: 'Ana', createdAt: new Date() };
const project: Project = {
  id: randomUUID(),
  ownerId: user.id,
  name: 'Thesis',
  mainFile: 'main.tex',
  engine: 'pdflatex',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ProjectsController', () => {
  const request = (role: FastifyRequest['projectRole']) =>
    ({ projectRole: role }) as FastifyRequest;

  it('answers a project read with the caller role', () => {
    const controller = new ProjectsController({} as ProjectsService);
    expect(controller.get(request('reviewer'), project).role).toBe('reviewer');
  });

  // The web client caches this response as the project and derives permissions from its role, so
  // dropping the role here reads as the caller losing access until the next read.
  it('answers an engine change with the saved project and the caller role', async () => {
    const service = {
      update: vi.fn().mockResolvedValue({ ...project, engine: 'lualatex' }),
    } as unknown as ProjectsService;
    const controller = new ProjectsController(service);

    const updated = await controller.update(request('editor'), user as User, project, {
      engine: 'lualatex',
    });

    expect(service.update).toHaveBeenCalledWith(project, user, { engine: 'lualatex' });
    expect(updated).toMatchObject({ id: project.id, engine: 'lualatex', role: 'editor' });
  });
});
