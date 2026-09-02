import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { GraphEmailWebhookController } from '../graph-email-webhook.controller';
import type { GraphInboundOrchestratorService } from '../graph-inbound-orchestrator.service';

function makeMockResponse(): jest.Mocked<Pick<Response, 'status' | 'type' | 'send' | 'json'>> {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.type = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('GraphEmailWebhookController', () => {
  it('echoes the validationToken as text/plain with 200 during the Graph subscription handshake', async () => {
    const orchestrator = { processNotification: jest.fn() } as unknown as GraphInboundOrchestratorService;
    const controller = new GraphEmailWebhookController(orchestrator);
    const res = makeMockResponse();

    await controller.handle('the-validation-token', undefined, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('the-validation-token');
    expect(orchestrator.processNotification).not.toHaveBeenCalled();
  });

  it('processes each notification in body.value and responds 202 with the results', async () => {
    const outcome = { status: 'PROCESSED' as const, conversationId: 'conv-1', requiresApproval: false, leadStatusChanged: false };
    const orchestrator = { processNotification: jest.fn().mockResolvedValue(outcome) } as unknown as GraphInboundOrchestratorService;
    const controller = new GraphEmailWebhookController(orchestrator);
    const res = makeMockResponse();

    const notification = { subscriptionId: 'sub-1', changeType: 'created', resource: 'Users/x/Messages/1' };
    await controller.handle(undefined, { value: [notification] }, res as unknown as Response);

    expect(orchestrator.processNotification).toHaveBeenCalledWith(notification);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ results: [outcome] });
  });

  it('processes multiple notifications in a single batch', async () => {
    const orchestrator = { processNotification: jest.fn().mockResolvedValue({ status: 'DUPLICATE' }) } as unknown as GraphInboundOrchestratorService;
    const controller = new GraphEmailWebhookController(orchestrator);
    const res = makeMockResponse();

    const notifications = [
      { subscriptionId: 'sub-1', changeType: 'created', resource: 'Users/x/Messages/1' },
      { subscriptionId: 'sub-1', changeType: 'created', resource: 'Users/x/Messages/2' },
    ];
    await controller.handle(undefined, { value: notifications }, res as unknown as Response);

    expect(orchestrator.processNotification).toHaveBeenCalledTimes(2);
  });

  it('throws a BadRequestException for a malformed body (missing value array)', async () => {
    const orchestrator = { processNotification: jest.fn() } as unknown as GraphInboundOrchestratorService;
    const controller = new GraphEmailWebhookController(orchestrator);
    const res = makeMockResponse();

    await expect(controller.handle(undefined, {}, res as unknown as Response)).rejects.toThrow(BadRequestException);
    expect(orchestrator.processNotification).not.toHaveBeenCalled();
  });

  it('throws a BadRequestException when the body is missing entirely', async () => {
    const orchestrator = { processNotification: jest.fn() } as unknown as GraphInboundOrchestratorService;
    const controller = new GraphEmailWebhookController(orchestrator);
    const res = makeMockResponse();

    await expect(controller.handle(undefined, undefined, res as unknown as Response)).rejects.toThrow(BadRequestException);
  });
});
