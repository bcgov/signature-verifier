import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ValidationController } from './validation.controller'
import { ValidationService } from './validation.service'

@Module({
  imports: [ConfigModule],
  controllers: [ValidationController],
  providers: [ValidationService],
})
export class ValidationModule {}
