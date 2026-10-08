import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { SpellcheckService } from './application/spellcheck.service';
import { SPELLER } from './domain/speller';
import { HunspellSpeller } from './infrastructure/hunspell-speller';
import { SpellcheckController } from './presentation/spellcheck.controller';

@Module({
  imports: [ProjectsModule],
  controllers: [SpellcheckController],
  providers: [SpellcheckService, { provide: SPELLER, useClass: HunspellSpeller }],
})
export class SpellcheckModule {}
