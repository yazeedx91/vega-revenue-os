import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthProbe, HealthReport, SecretReadinessIndicator } from '@projectx/infrastructure';

@Controller('/')
export class HealthController {
  private readonly healthProbe: HealthProbe;

  constructor() {
    this.healthProbe = new HealthProbe();
    this.healthProbe.add(new SecretReadinessIndicator({ name: 'secrets' }));
  }

  @Get('/healthz')
  @HttpCode(HttpStatus.OK)
  healthz(): { status: string } {
    return { status: 'ok' };
  }

  @Get('/readyz')
  @HttpCode(HttpStatus.OK)
  async readyz(): Promise<HealthReport> {
    return this.healthProbe.checkAll();
  }
}
