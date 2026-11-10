import { Injectable, UnauthorizedException } from '@nestjs/common';
import { compareSync } from 'bcryptjs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { RoleKey } from '../generated/prisma/client.js';

type TokenPayload = { sub: string; email: string | null; roles: string[]; exp: number };
const encode = (value: string) => Buffer.from(value).toString('base64url');

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(body: { firstName: string; lastName: string; email: string; password: string }) {
    const firstName = body.firstName?.trim(); const lastName = body.lastName?.trim(); const email = body.email?.trim().toLowerCase(); const password = body.password ?? '';
    if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) {
      throw new UnauthorizedException('Enter your name, a valid email, and a password between 8 and 128 characters.');
    }
    if (await this.prisma.user.findFirst({ where: { OR: [{ email }, { normalizedEmail: email }] }, select: { id: true } })) {
      throw new UnauthorizedException('An account with this email already exists.');
    }
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort', status: 'ACTIVE' }, select: { id: true } });
    if (!property) throw new UnauthorizedException('Customer registration is temporarily unavailable.');
    await this.prisma.user.create({ data: {
      email, normalizedEmail: email, passwordHash: (await import('bcryptjs')).hashSync(password, 12), firstName, lastName,
      userRoles: { create: { property: { connect: { id: property.id } }, role: { connect: { key: RoleKey.CUSTOMER } } } },
      guestProfiles: { create: { propertyId: property.id, firstName, lastName, email } },
    }, select: { id: true } });
    return this.login(email, password);
  }

  async getCustomerBookings(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, normalizedEmail: true } });
    if (!user?.email) return [];
    return this.prisma.booking.findMany({ where: { guestProfile: { email: user.email }, property: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' } },
      orderBy: { createdAt: 'desc' }, take: 50, select: { confirmationNumber: true, status: true, checkIn: true, checkOut: true, totalAmount: true, currency: true,
        items: { select: { roomTypeNameSnapshot: true, quantity: true } },
        cancellationRequests: { orderBy: { requestedAt: 'desc' }, take: 1, select: { status: true, reason: true, decisionNote: true } } } });
  }

  async login(emailInput: string, password: string) {
    const email = emailInput?.trim().toLowerCase();
    if (!email || !password) throw new UnauthorizedException('Email or password is incorrect.');
    const user = await this.prisma.user.findFirst({
      where: { normalizedEmail: email, status: 'ACTIVE' },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user?.passwordHash || !compareSync(password, user.passwordHash)) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    const roles = user.userRoles.map(({ role }) => role.key);
    const accessToken = this.sign({ sub: user.id, email: user.email, roles, exp: Date.now() + 15 * 60_000 });
    const refreshToken = randomBytes(48).toString('base64url');
    const familyId = randomBytes(16).toString('hex');
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: this.hash(refreshToken), familyId, expiresAt: new Date(Date.now() + 30 * 86_400_000) },
    });
    return { accessToken, refreshToken, expiresIn: 900, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, roles } };
  }

  async refresh(token: string) {
    if (!token) throw new UnauthorizedException('Refresh token is required.');
    const current = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hash(token) }, include: { user: { include: { userRoles: { include: { role: true } } } } } });
    if (!current || current.revokedAt || current.expiresAt <= new Date() || current.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    const nextToken = randomBytes(48).toString('base64url');
    const nextId = randomBytes(16).toString('hex');
    const accessToken = this.sign({ sub: current.user.id, email: current.user.email,
      roles: current.user.userRoles.map(({ role }) => role.key), exp: Date.now() + 15 * 60_000 });
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({ where: { id: current.id, revokedAt: null }, data: { revokedAt: new Date(), replacedByTokenId: nextId } });
      if (revoked.count !== 1) throw new UnauthorizedException('Refresh token was already used.');
      await tx.refreshToken.create({ data: { id: nextId, userId: current.user.id, tokenHash: this.hash(nextToken), familyId: current.familyId, expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
    });
    return { accessToken, refreshToken: nextToken, expiresIn: 900 };
  }

  async logout(token: string): Promise<void> {
    if (token) await this.prisma.refreshToken.updateMany({ where: { tokenHash: this.hash(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async authenticate(header: string | undefined): Promise<TokenPayload> {
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('A valid access token is required.');
    const body = `${parts[0]}.${parts[1]}`;
    const expected = createHmac('sha256', this.secret()).update(body).digest();
    let supplied: Buffer;
    try { supplied = Buffer.from(parts[2]!, 'base64url'); } catch { throw new UnauthorizedException('Invalid access token.'); }
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new UnauthorizedException('Invalid access token.');
    let payload: TokenPayload;
    try { payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as TokenPayload; } catch { throw new UnauthorizedException('Invalid access token.'); }
    if (!payload.sub || payload.exp <= Date.now()) throw new UnauthorizedException('Access token expired.');
    return payload;
  }

  private sign(payload: TokenPayload): string {
    const body = `${encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${encode(JSON.stringify(payload))}`;
    return `${body}.${createHmac('sha256', this.secret()).update(body).digest('base64url')}`;
  }
  private hash(value: string): string { return createHmac('sha256', this.secret()).update(value).digest('hex'); }
  private secret(): string {
    const secret = process.env['JWT_SECRET'];
    if (!secret || secret.length < 32) throw new Error('Set JWT_SECRET to a unique value of at least 32 characters.');
    return secret;
  }
}
