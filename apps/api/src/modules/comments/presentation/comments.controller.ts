import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/presentation/decorators';
import type { Project } from '../../projects/domain/project';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import type { User } from '../../users/domain/user';
import { CommentsService } from '../application/comments.service';
import type { Comment, Reply } from '../domain/comment';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { CreateCommentDto, ReplyDto, UpdateCommentDto } from './comments.dto';

@Controller('projects/:projectId/comments')
export class CommentsController {
  constructor(@Inject(CommentsService) private readonly comments: CommentsService) {}

  @Get()
  @RequireProjectRole('viewer')
  list(
    @CurrentProject() project: Project,
    @Query('path') path: string = '',
    @Query('resolved') resolved?: string,
  ): Promise<Comment[]> {
    return this.comments.list(project, path, resolved !== 'false');
  }

  @Post()
  @RequireProjectRole('reviewer')
  create(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Body() dto: CreateCommentDto,
  ): Promise<Comment> {
    return this.comments.create(project, user, dto);
  }

  @Patch(':id')
  @RequireProjectRole('reviewer')
  update(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommentDto,
  ): Promise<Comment> {
    return this.comments.update(project, user, id, dto);
  }

  @Delete(':id')
  @RequireProjectRole('reviewer')
  @HttpCode(204)
  remove(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.comments.remove(project, user, id);
  }

  @Post(':id/replies')
  @RequireProjectRole('reviewer')
  reply(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyDto,
  ): Promise<Reply> {
    return this.comments.reply(project, user, id, dto.body);
  }

  @Delete(':id/replies/:replyId')
  @RequireProjectRole('reviewer')
  @HttpCode(204)
  removeReply(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('replyId', ParseUUIDPipe) replyId: string,
  ): Promise<void> {
    return this.comments.removeReply(project, user, id, replyId);
  }
}
