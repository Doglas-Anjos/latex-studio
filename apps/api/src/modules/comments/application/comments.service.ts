import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { checkPath } from '../../projects/application/project-files';
import type { Project } from '../../projects/domain/project';
import { PROJECT_STORAGE, type ProjectStorage } from '../../projects/domain/project-storage';
import type { User } from '../../users/domain/user';
import type { Comment, Reply } from '../domain/comment';
import { COMMENT_REPOSITORY, type CommentRepository } from '../domain/comment.repository';

export interface CreateCommentInput {
  path: string;
  anchor: { start: string; end: string };
  quote: string;
  line?: number;
  body: string;
}

@Injectable()
export class CommentsService {
  constructor(
    @Inject(COMMENT_REPOSITORY) private readonly comments: CommentRepository,
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
  ) {}

  list(project: Project, path: string, includeResolved: boolean): Promise<Comment[]> {
    checkPath(this.storage.open(project.id), path);
    return this.comments.listForFile(project.id, path, includeResolved);
  }

  async create(project: Project, user: User, input: CreateCommentInput): Promise<Comment> {
    checkPath(this.storage.open(project.id), input.path);
    return this.comments.create({
      ...input,
      projectId: project.id,
      authorId: user.id,
      line: input.line ?? null,
    });
  }

  private async find(project: Project, id: string): Promise<Comment> {
    const comment = await this.comments.findById(project.id, id);
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }

  async setResolved(project: Project, id: string, resolved: boolean): Promise<Comment> {
    const updated = await this.comments.setResolved(project.id, id, resolved);
    if (!updated) throw new NotFoundException('Comment not found');
    return updated;
  }

  async remove(project: Project, user: User, id: string): Promise<void> {
    const comment = await this.find(project, id);
    if (comment.author?.id !== user.id && project.ownerId !== user.id) {
      throw new ForbiddenException('Only the author or the project owner can delete a comment');
    }
    await this.comments.delete(project.id, id);
  }

  async reply(project: Project, user: User, id: string, body: string): Promise<Reply> {
    await this.find(project, id);
    return this.comments.addReply(id, user.id, body);
  }

  async removeReply(project: Project, user: User, id: string, replyId: string): Promise<void> {
    const comment = await this.find(project, id);
    const reply = comment.replies.find((r) => r.id === replyId);
    if (!reply) throw new NotFoundException('Reply not found');
    if (reply.author?.id !== user.id && project.ownerId !== user.id) {
      throw new ForbiddenException('Only the author or the project owner can delete a reply');
    }
    await this.comments.deleteReply(id, replyId);
  }
}
