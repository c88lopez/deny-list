import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service.js';

// The kubelet's probes (k8s/api/20-deployment.yaml). They're left out of
// request logs, metrics and traces, which would otherwise be mostly probes.
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // Liveness: the process is up and serving. It doesn't check dependencies,
  // so a Postgres outage doesn't get every pod restarted.
  @Get('healthz')
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Readiness: whether this pod should get traffic.
  @Get('readyz')
  async readyz(@Res({ passthrough: true }) res: Response): Promise<object> {
    const { code, body } = await this.health.readiness();
    res.status(code);

    return body;
  }
}
