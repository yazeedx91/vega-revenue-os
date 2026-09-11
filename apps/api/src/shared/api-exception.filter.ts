import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    const name = error instanceof Error ? error.name : '';
    const status = name === 'ConcurrencyConflictError'
      ? HttpStatus.CONFLICT
      : name === 'AuthorizationError' || name === 'TenantIsolationError'
        ? HttpStatus.FORBIDDEN
        : name === 'ValidationError'
          ? HttpStatus.BAD_REQUEST
          : HttpStatus.INTERNAL_SERVER_ERROR;
    response.status(status).json({ statusCode: status, message: status === HttpStatus.INTERNAL_SERVER_ERROR ? 'Internal server error' : 'Request could not be completed' });
  }
}
