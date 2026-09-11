import { Module } from '@nestjs/common';
import { OperatorApiController } from './operator-api.controller';
import { OperatorApiService } from './operator-api.service';
import { IdentityModule } from '../identity/identity.module';

@Module({ imports: [IdentityModule], controllers: [OperatorApiController], providers: [OperatorApiService] })
export class OperatorApiModule {}
