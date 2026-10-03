import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { CommentsService } from './application/comments.service';
import { COMMENT_REPOSITORY } from './domain/comment.repository';
import { DrizzleCommentRepository } from './infrastructure/drizzle-comment.repository';
import { CommentsController } from './presentation/comments.controller';

@Module({
  imports: [ProjectsModule],
  controllers: [CommentsController],
  providers: [CommentsService, { provide: COMMENT_REPOSITORY, useClass: DrizzleCommentRepository }],
})
export class CommentsModule {}
