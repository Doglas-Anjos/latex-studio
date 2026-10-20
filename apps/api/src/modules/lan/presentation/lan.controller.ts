import { networkInterfaces } from 'node:os';
import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { LOCAL_IDENTITY } from '../../auth/application/identity.service';
import { CurrentUser, Public } from '../../auth/presentation/decorators';
import { DOCUMENT_SYNC, type DocumentSync } from '../../collab/domain/document-sync';
import type { Project } from '../../projects/domain/project';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import type { User } from '../../users/domain/user';
import { LanService, lanOrigins } from '../application/lan.service';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { CreateAccessDto, JoinDto, RemoteDto } from './lan.dto';

/**
 * The install-wide remote-access switch (off on every boot). Only the local host may read or flip
 * it; a LAN guest, a FasorX user or an install without LAN share gets a 404.
 */
@Controller('lan')
export class LanRemoteController {
  constructor(
    @Inject(LanService) private readonly lan: LanService,
    @Optional() @Inject(DOCUMENT_SYNC) private readonly sync?: DocumentSync,
  ) {}

  @Get()
  status(@CurrentUser() user: User) {
    this.assertHost(user);
    return { remote: this.lan.remote() };
  }

  @Post('remote')
  async setRemote(@CurrentUser() user: User, @Body() dto: RemoteDto) {
    this.assertHost(user);
    // Their tokens stop working at once; open docs would keep taking edits until the socket drops.
    for (const [projectId, userId] of await this.lan.setRemote(dto.on)) {
      this.sync?.revoke(projectId, userId);
    }
    return { remote: dto.on };
  }

  private assertHost(user: User): void {
    if (user.issuer !== LOCAL_IDENTITY.issuer || !this.lan.configured()) {
      throw new NotFoundException();
    }
  }
}

/**
 * LAN share endpoints. The host (project owner) publishes and manages per-person PIN accesses; a
 * friend joins with a PIN (public, rate-limited) and gets a session token. Registered in
 * ProjectsModule so the owner guard resolves there.
 */
@Controller('projects/:projectId/lan')
export class LanController {
  constructor(
    @Inject(LanService) private readonly lan: LanService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(DOCUMENT_SYNC) private readonly sync?: DocumentSync,
  ) {}

  @Get()
  @RequireProjectRole('owner')
  async status(@CurrentProject() project: Project) {
    return {
      enabled: this.lan.configured(),
      published: await this.lan.isPublished(project.id),
      access: await this.lan.listAccess(project.id),
      // LAN origins the host is reachable at, so the owner can copy a link a friend can open.
      urls: lanOrigins(this.config.APP_URL, networkInterfaces()),
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
    return this.lan.createAccess(project.id, dto.alias, dto.role);
  }

  @Delete('access/:accessId')
  @RequireProjectRole('owner')
  async revoke(
    @CurrentProject() project: Project,
    @Param('accessId', ParseUUIDPipe) accessId: string,
  ) {
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
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: JoinDto,
    @Req() req: FastifyRequest,
  ) {
    const result = await this.lan.join(projectId, dto.pin, req.ip);
    if (!result) throw new UnauthorizedException('Invalid PIN or project unavailable');
    return result;
  }
}
