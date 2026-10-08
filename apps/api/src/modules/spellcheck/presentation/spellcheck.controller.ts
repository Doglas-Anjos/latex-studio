import { Body, Controller, Inject, Post } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { RequireProjectRole } from '../../projects/presentation/guards/project-role.guard';
import { SpellcheckService } from '../application/spellcheck.service';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO class in design:paramtypes
import { SpellcheckDto, SuggestDto } from './spellcheck.dto';

// Called as the user types (debounced); cheap server-side but throttle to bound abuse.
const SPELL_RATE_LIMIT = { rateLimit: { max: 120, timeWindow: '1 minute' } };

@Controller('projects/:projectId/spellcheck')
export class SpellcheckController {
  constructor(@Inject(SpellcheckService) private readonly spellcheck: SpellcheckService) {}

  @RouteConfig(SPELL_RATE_LIMIT)
  @Post()
  @RequireProjectRole('viewer')
  check(@Body() dto: SpellcheckDto): Promise<{ bad: string[] }> {
    return this.spellcheck.check(dto.lang, dto.words);
  }

  @RouteConfig(SPELL_RATE_LIMIT)
  @Post('suggest')
  @RequireProjectRole('viewer')
  suggest(@Body() dto: SuggestDto): Promise<{ suggestions: string[] }> {
    return this.spellcheck.suggest(dto.lang, dto.word);
  }
}
