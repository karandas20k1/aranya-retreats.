import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import type { PrismaService } from './database/prisma.service.js';

describe('AppController', () => {
  it('returns the health response from the app service', () => {
    const controller = new AppController(new AppService(), {} as PrismaService);

    expect(controller.getHealth()).toBe('Hello World!');
  });
});
