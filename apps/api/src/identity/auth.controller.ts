import { Controller, Post, Get, Body, Headers, Inject, UseGuards, UnauthorizedException } from '@nestjs/common';
import { Public } from '../shared/public.decorator';
import type { AuthService } from '@projectx/identity';
import { JwtAuthGuard, TenantGuard, PermissionsGuard, CurrentUser, type RequestUser } from './auth.guard';

export interface AuthCallbackDto {
  idToken: string;
}

@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('auth')
export class AuthController {
  constructor(@Inject('AUTH_SERVICE') private readonly authService: AuthService) {}

  @Public()
  @Post('callback')
  async callback(
    @Body() dto: AuthCallbackDto,
    @Headers('x-correlation-id') correlationId?: string,
  ): Promise<{ accessToken: string; workspaceId: string }> {
    const result = await this.authService.authenticate(dto.idToken, correlationId);
    if (!result) {
      throw new UnauthorizedException('OIDC token could not be validated');
    }
    return {
      accessToken: result.accessToken,
      workspaceId: result.workspace.id,
    };
  }

  @Get('me')
  async me(@CurrentUser() user: RequestUser): Promise<RequestUser> {
    return user;
  }
}
