import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { TerminusModule } from '@nestjs/terminus'
import { HealthController } from './health.controller'

describe('HealthController', () => {
  let controller: HealthController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
    }).compile()

    controller = module.get<HealthController>(HealthController)
  })

  it('should return healthy status', async () => {
    const result = await controller.check()
    expect(result.status).toBe('ok')
    expect(result.info).toEqual({ app: { status: 'up' } })
  })
})
