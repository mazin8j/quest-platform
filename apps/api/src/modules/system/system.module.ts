import { Module } from '@nestjs/common';

import { SystemController } from './api/system.controller';

@Module({ controllers: [SystemController] })
export class SystemModule {}
