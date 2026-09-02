import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { GraphChangeNotification, GraphChangeNotificationPayload } from '@projectx/outreach';
import { GraphInboundOrchestratorService } from './graph-inbound-orchestrator.service';

/**
 * Microsoft Graph webhook ingress boundary.
 *
 * A single POST endpoint handles both cases Graph uses:
 *  - Subscription validation handshake: Graph POSTs with a `validationToken`
 *    query parameter and expects it echoed back as `text/plain` within 10s.
 *  - Actual change notifications: Graph POSTs `{ value: GraphChangeNotification[] }`.
 *
 * No real Graph subscription is created anywhere in this milestone — this
 * endpoint is reachable but nothing external is registered to call it.
 */
@Controller('webhooks/graph/email')
export class GraphEmailWebhookController {
  constructor(private readonly orchestrator: GraphInboundOrchestratorService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async handle(
    @Query('validationToken') validationToken: string | undefined,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    if (validationToken) {
      res.status(HttpStatus.OK).type('text/plain').send(validationToken);
      return;
    }

    const payload = body as Partial<GraphChangeNotificationPayload>;
    if (!payload || !Array.isArray(payload.value)) {
      throw new BadRequestException({ reasonCode: 'MALFORMED', reason: 'Request body must be { value: GraphChangeNotification[] }' });
    }

    const results = await Promise.all(
      payload.value.map((notification: GraphChangeNotification) => this.orchestrator.processNotification(notification)),
    );

    res.status(HttpStatus.ACCEPTED).json({ results });
  }
}
