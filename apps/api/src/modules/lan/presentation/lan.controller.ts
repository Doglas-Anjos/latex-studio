import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Optional,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../auth/presentation/decorators';
import { DOCUMENT_SYNC, type DocumentSync } from '../../collab/domain/document-sync';
import type { Project } from '../../projects/domain/project';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import { LanService } from '../application/lan.service';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { CreateAccessDto, JoinDto } from './lan.dto';

/**
 * LAN share endpoints. The host (project owner) publishes and manages per-person PIN accesses; a
 * friend joins with a PIN (public, rate-limited) and gets a session token. Registered in
 * ProjectsModule so the owner guard resolves there.
 */
@Controller('projects/:projectId/lan')
export class LanController {
  constructor(
    @Inject(LanService) private readonly lan: LanService,
    @Optional() @Inject(DOCUMENT_SYNC) private readonly sync?: DocumentSync,
  ) {}

  @Get()
  @RequireProjectRole('owner')
  async status(@CurrentProject() project: Project) {
    return {
      published: await this.lan.isPublished(project.id),
      access: await this.lan.listAccess(project.id),
    };
  }

  @Post('publish')
  @RequireProjectRole('owner')
  async publish(@CurrentProject() project: Project) {
    await this.lan.publish(project.id);
    return { published: true };
  }

  @Post('unpublish')
  @RequireProjectRole('owner')
  async unpublish(@CurrentProject() project: Project) {
    await this.lan.unpublish(project.id);
    // roleOf denies LAN peers on the next HTTP request, but open docs keep accepting their edits
    // until the socket drops, so close those sockets now. revoke(projectId, userId) spares members.
    for (const userId of await this.lan.accessUserIds(project.id)) {
      this.sync?.revoke(project.id, userId);
    }
    return { published: false };
  }

  /** Creates a person's access; the plaintext PIN is returned once, here. */
  @Post('access')
  @RequireProjectRole('owner')
  createAccess(@CurrentProject() project: Project, @Body() dto: CreateAccessDto) {
    return this.lan.createAccess(project.id, dto.alias);
  }

  @Delete('access/:accessId')
  @RequireProjectRole('owner')
  async revoke(@CurrentProject() project: Project, @Param('accessId') accessId: string) {
    const userId = await this.lan.revokeAccess(project.id, accessId);
    // Close that peer's open sockets so they cannot keep editing the live doc after being revoked.
    if (userId) this.sync?.revoke(project.id, userId);
    return { ok: true };
  }

  /** A friend joins with a PIN: no session yet, so public and rate-limited; returns a LAN token. */
  @Post('join')
  @Public()
  @RouteConfig({ rateLimit: { max: 10, timeWindow: '1 minute' } })
  async join(
    @Param('projectId') projectId: string,
    @Body() dto: JoinDto,
    @Req() req: FastifyRequest,
  ) {
    const result = await this.lan.join(projectId, dto.pin, req.ip);
    if (!result) throw new UnauthorizedException('Invalid PIN or project unavailable');
    return result;
  }
}
