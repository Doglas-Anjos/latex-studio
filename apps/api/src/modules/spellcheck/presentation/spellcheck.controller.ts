import { Body, Controller, Inject, Post } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { RequireProjectRole } from '../../projects/presentation/guards/project-role.guard';
import { SpellcheckService } from '../application/spellcheck.service';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO class in design:paramtypes
import { SpellcheckDto, SuggestDto } from './spellcheck.dto';

// Called as the user types (debounced); cheap server-side but throttle to bound abuse.
const SPELL_RATE_LIMIT = { rateLimit: { max: 120, timeWindow: '1 minute' } };
// Only on right-click, and Hunspell's suggest blocks the event loop for up to ~0.8 s on the pt
// dictionary even for short words (measured), so it gets a far tighter limit.
// ponytail: still on the event loop; move Hunspell to a worker thread if it shows in latency.
const SUGGEST_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

@Controller('projects/:projectId/spellcheck')
export class SpellcheckController {
  constructor(@Inject(SpellcheckService) private readonly spellcheck: SpellcheckService) {}

  @RouteConfig(SPELL_RATE_LIMIT)
  @Post()
  @RequireProjectRole('viewer')
  check(@Body() dto: SpellcheckDto): Promise<{ bad: string[] }> {
    return this.spellcheck.check(dto.lang, dto.words);
  }

  @RouteConfig(SUGGEST_RATE_LIMIT)
  @Post('suggest')
  @RequireProjectRole('viewer')
  suggest(@Body() dto: SuggestDto): Promise<{ suggestions: string[] }> {
    return this.spellcheck.suggest(dto.lang, dto.word);
  }
}
