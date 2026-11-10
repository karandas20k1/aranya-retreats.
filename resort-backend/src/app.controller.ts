import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Post, Body, Param, Query, Req, UseGuards, Headers } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Prisma } from './generated/prisma/client.js';
import { hashSync } from 'bcryptjs';
import { RoleKey } from './generated/prisma/client.js';
import { AppService } from './app.service.js';
import { PrismaService } from './database/prisma.service.js';
import { AuthGuard, type AuthenticatedRequest } from './auth/auth.guard.js';

@ApiTags('system')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService, private readonly prisma: PrismaService) {}

  @Get('health')
  @ApiOperation({ summary: 'Check API availability' })
  getHealth(): string {
    return this.appService.getHello();
  }

  @Get('notifications')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List recent in-app notifications for the signed-in user' })
  async listNotifications(@Req() request: AuthenticatedRequest) {
    return this.prisma.notification.findMany({ where: { userId: request.user.sub, channel: 'IN_APP' }, orderBy: { createdAt: 'desc' }, take: 30,
      select: { id: true, subject: true, templateKey: true, payload: true, status: true, createdAt: true, readAt: true } });
  }

  @Post('notifications/:id/read')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Mark one in-app notification as read' })
  async readNotification(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const changed = await this.prisma.notification.updateMany({ where: { id, userId: request.user.sub, channel: 'IN_APP' }, data: { status: 'READ', readAt: new Date() } });
    if (!changed.count) throw new BadRequestException('Notification not found.');
    return { success: true };
  }

  @Get('admin/audit-logs')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List recent audit events for resort managers' })
  async listAuditLogs(@Req() request: AuthenticatedRequest) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER']);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) return [];
    return this.prisma.auditLog.findMany({ where: { propertyId: property.id }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, action: true, entityType: true, entityId: true, after: true, createdAt: true, actor: { select: { firstName: true, lastName: true, email: true } } } });
  }

  @Get('admin/overview')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get an operations overview for authorized staff' })
  async getAdminOverview(@Req() request: AuthenticatedRequest) {
    const allowed = ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST'];
    if (!request.user.roles.some((role) => allowed.includes(role))) {
      throw new ForbiddenException('Your account cannot view the staff dashboard.');
    }
    const property = await this.prisma.property.findFirst({
      where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort', status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    if (!property) throw new BadRequestException('The resort is not configured.');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [rooms, bookings, arrivals, departures, guests] = await Promise.all([
      this.prisma.room.count({ where: { propertyId: property.id, operationalStatus: 'ACTIVE' } }),
      this.prisma.booking.count({ where: { propertyId: property.id, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN'] } } }),
      this.prisma.booking.count({ where: { propertyId: property.id, checkIn: today, status: 'CONFIRMED' } }),
      this.prisma.booking.count({ where: { propertyId: property.id, checkOut: today, status: 'CHECKED_IN' } }),
      this.prisma.guestProfile.count({ where: { propertyId: property.id } }),
    ]);
    const activeStays = await this.prisma.booking.count({ where: { propertyId: property.id, checkIn: { lte: today }, checkOut: { gt: today }, status: 'CHECKED_IN' } });
    return { property: property.name, date: today.toISOString().slice(0, 10), rooms, bookings, arrivals, departures, activeStays, guests };
  }

  @Get('admin/bookings')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List recent reservations for front desk staff' })
  async listBookings(@Req() request: AuthenticatedRequest) {
    this.requireFrontDesk(request);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) return [];
    return this.prisma.booking.findMany({
      where: { propertyId: property.id }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, confirmationNumber: true, status: true, checkIn: true, checkOut: true, totalAmount: true, currency: true,
        guestProfile: { select: { firstName: true, lastName: true, email: true, phone: true } },
        items: { select: { id: true, roomTypeId: true, roomTypeNameSnapshot: true, quantity: true, roomAssignments: { select: { id: true, status: true, room: { select: { roomNumber: true } } } } } } },
    });
  }

  @Get('admin/cancellations')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List cancellation requests for resort managers' })
  async listCancellationRequests(@Req() request: AuthenticatedRequest) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST']);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) return [];
    return this.prisma.cancellationRequest.findMany({ where: { propertyId: property.id }, orderBy: { requestedAt: 'desc' }, take: 100,
      select: { id: true, status: true, reason: true, decisionNote: true, requestedAt: true,
        booking: { select: { confirmationNumber: true, status: true, checkIn: true, checkOut: true, amountPaid: true, currency: true,
          guestProfile: { select: { firstName: true, lastName: true, email: true }, },
          payments: { select: { refunds: { select: { status: true, amount: true, currency: true } } } },
        } },
        requestedBy: { select: { firstName: true, lastName: true } },
      } });
  }

  @Get('bookings/:confirmationNumber/invoice')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get an invoice for its guest or authorized resort staff' })
  async getInvoice(@Req() request: AuthenticatedRequest, @Param('confirmationNumber') confirmationNumber: string) {
    const isStaff = request.user.roles.some((role) => ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST'].includes(role));
    if (!isStaff && (!request.user.roles.includes('CUSTOMER') || !request.user.email)) throw new ForbiddenException('Sign in with the account used for this reservation to view its invoice.');
    const booking = await this.prisma.booking.findFirst({
      where: { confirmationNumber, property: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, ...(isStaff ? {} : { guestProfile: { email: request.user.email! } }) },
      include: { property: true, guestProfile: true, invoice: true, items: true, payments: { where: { status: { in: ['SUCCESS', 'REFUNDED', 'PARTIALLY_REFUNDED'] } }, orderBy: { createdAt: 'asc' } } },
    });
    if (!booking?.invoice) throw new BadRequestException('Invoice not found for this reservation.');
    return {
      invoiceNumber: booking.invoice.invoiceNumber, issuedAt: booking.invoice.issuedAt, currency: booking.invoice.currency,
      subtotal: Number(booking.invoice.subtotal), discountAmount: Number(booking.invoice.discountAmount), taxAmount: Number(booking.invoice.taxAmount), totalAmount: Number(booking.invoice.totalAmount),
      confirmationNumber: booking.confirmationNumber, status: booking.status, checkIn: booking.checkIn, checkOut: booking.checkOut,
      property: { name: booking.property.name, email: booking.property.email, phone: booking.property.phone, addressLine1: booking.property.addressLine1, addressLine2: booking.property.addressLine2, city: booking.property.city, state: booking.property.state, postalCode: booking.property.postalCode, countryCode: booking.property.countryCode },
      guest: { firstName: booking.guestProfile.firstName, lastName: booking.guestProfile.lastName, email: booking.guestProfile.email },
      items: booking.items.map((item) => ({ name: item.roomTypeNameSnapshot, quantity: item.quantity, nights: Math.round((booking.checkOut.getTime() - booking.checkIn.getTime()) / 86_400_000), unitPrice: Number(item.unitPriceSnapshot), total: Number(item.totalAmount) })),
      payments: booking.payments.map((payment) => ({ amount: Number(payment.amount), currency: payment.currency, status: payment.status, paidAt: payment.verifiedAt })),
    };
  }

  @Post('bookings/:confirmationNumber/cancellation')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Request cancellation of an upcoming customer reservation' })
  async requestCancellation(@Req() request: AuthenticatedRequest, @Param('confirmationNumber') confirmationNumber: string, @Body() body: { reason?: string }) {
    if (!request.user.roles.includes('CUSTOMER') || !request.user.email) throw new ForbiddenException('Sign in with a customer account to request cancellation.');
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) throw new BadRequestException('The resort is not configured.');
    const booking = await this.prisma.booking.findFirst({ where: { confirmationNumber, propertyId: property.id, guestProfile: { email: request.user.email } },
      include: { cancellationRequests: { where: { status: 'PENDING' }, select: { id: true } } } });
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    if (!booking || !['CONFIRMED', 'PENDING_PAYMENT'].includes(booking.status) || booking.checkIn < today) {
      throw new ConflictException('This reservation is not eligible for cancellation online. Contact the resort for assistance.');
    }
    if (booking.cancellationRequests.length) throw new ConflictException('A cancellation request is already awaiting review.');
    const reason = body.reason?.trim().slice(0, 1000) || null;
    const created = await this.prisma.$transaction(async (tx) => {
      const result = await tx.cancellationRequest.create({ data: { propertyId: property.id, bookingId: booking.id, requestedById: request.user.sub, reason } });
      const changed = await tx.booking.updateMany({ where: { id: booking.id, status: booking.status }, data: { status: 'CANCELLATION_REQUESTED' } });
      if (changed.count !== 1) throw new ConflictException('The reservation status changed. Refresh and try again.');
      return result;
    });
    await this.writeAudit(request, property.id, 'booking.cancellation_requested', 'Booking', booking.id, { confirmationNumber, reason });
    await this.notifyStaff(property.id, ['SUPER_ADMIN', 'MANAGER'], 'cancellation.requested', 'A guest requested a cancellation', { confirmationNumber, reason });
    return { id: created.id, status: created.status, confirmationNumber };
  }

  @Post('admin/cancellations/:id/decision')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Approve or reject a cancellation request; approved paid bookings are refunded through Razorpay' })
  async decideCancellation(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: { decision?: string; note?: string }) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER']);
    if (!['APPROVE', 'REJECT'].includes(body.decision ?? '')) throw new BadRequestException('Choose APPROVE or REJECT.');
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    const cancellation = await this.prisma.cancellationRequest.findFirst({ where: { id, propertyId: property?.id, status: 'PENDING' },
      include: { booking: { include: { items: true, payments: { where: { status: 'SUCCESS' }, orderBy: { createdAt: 'desc' }, take: 1 }, roomAssignments: { where: { status: 'ASSIGNED' } } } } } });
    if (!cancellation || cancellation.booking.status !== 'CANCELLATION_REQUESTED') throw new ConflictException('This cancellation request is no longer pending.');
    const booking = cancellation.booking;
    const note = body.note?.trim().slice(0, 1000) || null;

    let refundRecord: { id: string; status: string } | null = null;
    const successfulPayment = booking.payments[0];
    if (body.decision === 'APPROVE' && successfulPayment) {
      const payment = successfulPayment;
      const keyId = process.env['RAZORPAY_KEY_ID']; const keySecret = process.env['RAZORPAY_KEY_SECRET'];
      if (!payment?.gatewayPaymentId || !keyId || !keySecret) throw new ConflictException('A paid booking requires configured Razorpay credentials and a captured payment before cancellation.');
      const idempotencyKey = `cancel-${cancellation.id}`;
      const existingRefund = await this.prisma.refund.findUnique({ where: { idempotencyKey }, select: { id: true, status: true, gatewayRefundId: true } });
      if (existingRefund?.status === 'PROCESSED') {
        refundRecord = existingRefund;
      } else {
        const refund = existingRefund ?? await this.prisma.refund.create({ data: { propertyId: booking.propertyId, paymentId: payment.id, amount: payment.amount, currency: booking.currency, status: 'PENDING', idempotencyKey, reason: cancellation.reason ?? 'Booking cancellation approved' }, select: { id: true, status: true } });
        const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(payment.gatewayPaymentId)}/refund`, {
          method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, 'Content-Type': 'application/json', 'X-Refund-Idempotency': idempotencyKey },
          body: JSON.stringify({ amount: Math.round(Number(payment.amount) * 100), receipt: idempotencyKey, notes: { confirmationNumber: booking.confirmationNumber, cancellationRequestId: cancellation.id } }),
        });
        const result = await response.json() as { id?: string; status?: string; error?: { description?: string } };
        if (!response.ok || !result.id) {
          await this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'FAILED', reason: result.error?.description ?? cancellation.reason ?? 'Razorpay refund request failed' } });
          throw new ConflictException(result.error?.description ?? 'Razorpay could not issue this refund. The cancellation remains pending.');
        }
        const refundStatus = result.status === 'processed' ? 'PROCESSED' : 'PENDING';
        refundRecord = await this.prisma.refund.update({ where: { id: refund.id }, data: { gatewayRefundId: result.id, status: refundStatus, processedAt: refundStatus === 'PROCESSED' ? new Date() : null }, select: { id: true, status: true } });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const requestChanged = await tx.cancellationRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedById: request.user.sub, decidedAt: new Date(), decisionNote: note } });
      if (requestChanged.count !== 1) throw new ConflictException('This request was already reviewed.');
      if (body.decision === 'REJECT') {
        await tx.booking.update({ where: { id: booking.id }, data: { status: successfulPayment ? 'CONFIRMED' : 'PENDING_PAYMENT', amountPaid: successfulPayment?.amount ?? 0 } });
        return;
      }
      for (const item of booking.items) {
        for (let date = booking.checkIn; date < booking.checkOut; date = new Date(date.getTime() + 86_400_000)) {
          const released = await tx.roomInventory.updateMany({ where: { propertyId: booking.propertyId, roomTypeId: item.roomTypeId, inventoryDate: date, bookedRooms: { gte: item.quantity } }, data: { bookedRooms: { decrement: item.quantity }, version: { increment: 1 } } });
          if (released.count !== 1) throw new ConflictException('Could not release inventory consistently. The request remains unchanged; contact support.');
        }
      }
      await tx.roomAssignment.updateMany({ where: { bookingId: booking.id, status: 'ASSIGNED' }, data: { status: 'RELEASED' } });
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED', cancellationReason: note ?? cancellation.reason ?? 'Cancellation approved' } });
      if (refundRecord?.status === 'PROCESSED' && booking.payments[0]) await tx.payment.update({ where: { id: booking.payments[0].id }, data: { status: 'REFUNDED' } });
    });
    await this.writeAudit(request, booking.propertyId, `booking.cancellation_${body.decision?.toLowerCase()}`, 'Booking', booking.id, { confirmationNumber: booking.confirmationNumber, note, refundStatus: refundRecord?.status ?? null });
    if (cancellation.requestedById) await this.notifyUser(booking.propertyId, cancellation.requestedById, 'cancellation.reviewed', `Cancellation request ${body.decision === 'APPROVE' ? 'approved' : 'declined'}`, { confirmationNumber: booking.confirmationNumber, decision: body.decision, note });
    return { success: true, decision: body.decision, refundStatus: refundRecord?.status ?? null };
  }

  @Get('admin/rooms')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List active physical rooms for front desk allocation' })
  async listAdminRooms(@Req() request: AuthenticatedRequest) {
    this.requireFrontDesk(request);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) return [];
    return this.prisma.room.findMany({ where: { propertyId: property.id, operationalStatus: 'ACTIVE' },
      select: { id: true, roomNumber: true, roomTypeId: true, roomType: { select: { name: true } } }, orderBy: { roomNumber: 'asc' } });
  }

  @Get('admin/room-types')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List room categories and physical room inventory for managers' })
  async listRoomTypes(@Req() request: AuthenticatedRequest) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER']);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) return [];
    return this.prisma.roomType.findMany({ where: { propertyId: property.id }, orderBy: { basePrice: 'asc' },
      select: { id: true, name: true, description: true, basePrice: true, maxOccupancy: true, active: true,
        rooms: { select: { id: true, roomNumber: true, operationalStatus: true, housekeepingStatus: true }, orderBy: { roomNumber: 'asc' } } } });
  }

  @Post('admin/room-types')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Create a room category, physical rooms, and initial inventory' })
  async createRoomType(@Req() request: AuthenticatedRequest, @Body() body: { name?: string; description?: string; bedConfiguration?: string; maxAdults?: number; maxChildren?: number; maxOccupancy?: number; basePrice?: number; roomNumbers?: string[] }) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER']);
    const name = body.name?.trim();
    const description = body.description?.trim();
    const bedConfiguration = body.bedConfiguration?.trim();
    const roomNumbers = [...new Set((body.roomNumbers ?? []).map((number) => number.trim()).filter(Boolean))];
    const maxAdults = Number(body.maxAdults); const maxChildren = Number(body.maxChildren ?? 0); const maxOccupancy = Number(body.maxOccupancy); const basePrice = Number(body.basePrice);
    if (!name || !description || !bedConfiguration || name.length > 100 || description.length > 2000 ||
      !Number.isInteger(maxAdults) || maxAdults < 1 || !Number.isInteger(maxChildren) || maxChildren < 0 ||
      !Number.isInteger(maxOccupancy) || maxOccupancy < 1 || maxOccupancy > 20 || maxAdults + maxChildren > maxOccupancy ||
      !Number.isFinite(basePrice) || basePrice <= 0 || roomNumbers.length < 1 || roomNumbers.length > 100) {
      throw new BadRequestException('Provide valid room details, occupancy, positive nightly price, and 1–100 unique room numbers.');
    }
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) throw new BadRequestException('The resort is not configured.');
    const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    return this.prisma.$transaction(async (tx) => {
      const ratePlan = await tx.ratePlan.findFirst({ where: { propertyId: property.id, active: true }, orderBy: { createdAt: 'asc' } });
      const created = await tx.roomType.create({ data: { propertyId: property.id, name, slug: `${slug}-${randomBytes(3).toString('hex')}`,
        description, bedConfiguration, maxAdults, maxChildren, maxOccupancy, basePrice,
        rooms: { create: roomNumbers.map((roomNumber) => ({ propertyId: property.id, roomNumber })) } },
        include: { rooms: { select: { id: true } } } });
      await tx.roomInventory.createMany({ data: Array.from({ length: 366 }, (_, index) => ({ propertyId: property.id, roomTypeId: created.id,
        inventoryDate: new Date(start.getTime() + index * 86_400_000), totalRooms: created.rooms.length })) });
      if (ratePlan) await tx.dailyRate.createMany({ data: Array.from({ length: 366 }, (_, index) => ({ propertyId: property.id, roomTypeId: created.id, ratePlanId: ratePlan.id,
        rateDate: new Date(start.getTime() + index * 86_400_000), amount: basePrice, currency: 'INR' })) });
      return { id: created.id, name: created.name, roomsCreated: created.rooms.length };
    });
  }

  @Get('admin/rates/catalog')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List rate plans and daily rates for property managers' })
  async getRateCatalog(@Req() request: AuthenticatedRequest) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER']);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) return { roomTypes: [], ratePlans: [], rates: [] };
    const from = new Date(); from.setUTCHours(0, 0, 0, 0);
    const until = new Date(from.getTime() + 90 * 86_400_000);
    const [roomTypes, ratePlans, rates] = await Promise.all([
      this.prisma.roomType.findMany({ where: { propertyId: property.id, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.ratePlan.findMany({ where: { propertyId: property.id, active: true }, select: { id: true, name: true, currency: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.dailyRate.findMany({ where: { propertyId: property.id, rateDate: { gte: from, lt: until } }, orderBy: [{ rateDate: 'asc' }, { roomTypeId: 'asc' }], take: 1000,
        select: { id: true, roomTypeId: true, ratePlanId: true, rateDate: true, amount: true, currency: true, minimumStay: true, maximumStay: true, roomType: { select: { name: true } }, ratePlan: { select: { name: true } } } }),
    ]);
    return { roomTypes, ratePlans, rates: rates.map((rate) => ({ ...rate, amount: Number(rate.amount) })) };
  }

  @Post('admin/rates/bulk')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Set a nightly rate across a date range' })
  async setDailyRates(@Req() request: AuthenticatedRequest, @Body() body: { roomTypeId?: string; ratePlanId?: string; startDate?: string; endDate?: string; amount?: number; minimumStay?: number; maximumStay?: number }) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER']);
    const startDate = this.parseDate(body.startDate ?? '', 'startDate');
    const endDate = this.parseDate(body.endDate ?? '', 'endDate');
    const amount = Number(body.amount);
    const nights = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
    if (!body.roomTypeId || !body.ratePlanId || endDate <= startDate || nights > 366 || !Number.isFinite(amount) || amount <= 0 ||
      (body.minimumStay !== undefined && (!Number.isInteger(body.minimumStay) || body.minimumStay < 1 || body.minimumStay > 30)) ||
      (body.maximumStay !== undefined && (!Number.isInteger(body.maximumStay) || body.maximumStay < 1 || body.maximumStay > 30)) ||
      (body.minimumStay !== undefined && body.maximumStay !== undefined && body.minimumStay > body.maximumStay)) {
      throw new BadRequestException('Choose a room and rate plan, valid dates (up to 366 nights), a positive rate, and valid stay limits.');
    }
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true, currency: true } });
    if (!property) throw new BadRequestException('The resort is not configured.');
    const [roomType, ratePlan] = await Promise.all([
      this.prisma.roomType.findFirst({ where: { id: body.roomTypeId, propertyId: property.id }, select: { id: true, name: true } }),
      this.prisma.ratePlan.findFirst({ where: { id: body.ratePlanId, propertyId: property.id, active: true }, select: { id: true } }),
    ]);
    if (!roomType || !ratePlan) throw new BadRequestException('Select an active room category and rate plan from this resort.');
    const operations = Array.from({ length: nights }, (_, index) => {
      const rateDate = new Date(startDate.getTime() + index * 86_400_000);
      return this.prisma.dailyRate.upsert({ where: { roomTypeId_ratePlanId_rateDate: { roomTypeId: roomType.id, ratePlanId: ratePlan.id, rateDate } },
        create: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, rateDate, amount, currency: property.currency, minimumStay: body.minimumStay, maximumStay: body.maximumStay },
        update: { amount, currency: property.currency, minimumStay: body.minimumStay, maximumStay: body.maximumStay } });
    });
    await this.prisma.$transaction(operations);
    await this.writeAudit(request, property.id, 'rates.bulk_updated', 'RoomType', roomType.id, { roomType: roomType.name, startDate: body.startDate, endDate: body.endDate, amount, nights });
    return { success: true, updated: nights };
  }

  @Get('admin/promotions')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List resort promotions' })
  async listPromotions(@Req() request: AuthenticatedRequest) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER']);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) return [];
    const promotions = await this.prisma.promotion.findMany({ where: { propertyId: property.id }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { roomTypes: { select: { roomType: { select: { id: true, name: true } } } } } });
    return promotions.map((promotion) => ({ ...promotion, discountValue: Number(promotion.discountValue), roomTypes: promotion.roomTypes.map((entry) => entry.roomType) }));
  }

  @Post('admin/promotions')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Create a promotion code' })
  async createPromotion(@Req() request: AuthenticatedRequest, @Body() body: { code?: string; name?: string; description?: string; discountType?: string; discountValue?: number; startsAt?: string; endsAt?: string; minimumNights?: number; usageLimit?: number; roomTypeIds?: string[] }) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER']);
    const code = body.code?.trim().toUpperCase(); const name = body.name?.trim(); const discountType = body.discountType;
    const discountValue = Number(body.discountValue); const startsAt = new Date(body.startsAt ?? ''); const endsAt = new Date(body.endsAt ?? '');
    const minimumNights = Number(body.minimumNights ?? 1); const usageLimit = body.usageLimit === undefined || body.usageLimit === null ? null : Number(body.usageLimit);
    const roomTypeIds = [...new Set(body.roomTypeIds ?? [])];
    if (!code || !/^[A-Z0-9_-]{3,32}$/.test(code) || !name || name.length > 100 ||
      !['PERCENTAGE', 'FIXED_AMOUNT'].includes(discountType ?? '') || !Number.isFinite(discountValue) || discountValue <= 0 ||
      (discountType === 'PERCENTAGE' && discountValue > 100) || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt ||
      !Number.isInteger(minimumNights) || minimumNights < 1 || minimumNights > 30 || (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1))) {
      throw new BadRequestException('Enter a valid code, discount, active date range, minimum stay, and optional usage limit.');
    }
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) throw new BadRequestException('The resort is not configured.');
    if (roomTypeIds.length) {
      const count = await this.prisma.roomType.count({ where: { propertyId: property.id, id: { in: roomTypeIds } } });
      if (count !== roomTypeIds.length) throw new BadRequestException('One or more selected room categories are invalid.');
    }
    try {
      const promotion = await this.prisma.promotion.create({ data: { propertyId: property.id, code, name, description: body.description?.trim() || null,
        discountType: discountType as 'PERCENTAGE' | 'FIXED_AMOUNT', discountValue, startsAt, endsAt, minimumNights, usageLimit,
        roomTypes: roomTypeIds.length ? { create: roomTypeIds.map((roomTypeId) => ({ roomTypeId })) } : undefined }, select: { id: true, code: true, name: true } });
      await this.writeAudit(request, property.id, 'promotion.created', 'Promotion', promotion.id, { code, name, discountType, discountValue, startsAt, endsAt });
      return promotion;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw new ConflictException('A promotion with this code already exists.');
      throw error;
    }
  }

  @Post('admin/promotions/:id/active')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Enable or disable a promotion code' })
  async setPromotionActive(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: { active?: boolean }) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER']);
    if (typeof body.active !== 'boolean') throw new BadRequestException('Provide active as true or false.');
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) throw new BadRequestException('The resort is not configured.');
    const result = await this.prisma.promotion.updateMany({ where: { id, propertyId: property.id }, data: { active: body.active } });
    if (!result.count) throw new BadRequestException('Promotion not found.');
    await this.writeAudit(request, property.id, body.active ? 'promotion.enabled' : 'promotion.disabled', 'Promotion', id, { active: body.active });
    return { success: true, active: body.active };
  }

  @Get('admin/staff')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List staff accounts for super administrators' })
  async listStaff(@Req() request: AuthenticatedRequest) {
    this.requireOperations(request, ['SUPER_ADMIN']);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) return [];
    return this.prisma.user.findMany({
      where: { userRoles: { some: { OR: [
        { propertyId: property.id },
        { propertyId: null, role: { key: RoleKey.SUPER_ADMIN } },
      ] } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, email: true, firstName: true, lastName: true, status: true, userRoles: {
        where: { OR: [{ propertyId: property.id }, { propertyId: null, role: { key: RoleKey.SUPER_ADMIN } }] },
        select: { role: { select: { key: true, displayName: true } } },
      } },
    });
  }

  @Post('admin/staff')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Create a staff account and assign a property role' })
  async createStaff(@Req() request: AuthenticatedRequest, @Body() body: { email?: string; password?: string; firstName?: string; lastName?: string; role?: string }) {
    this.requireOperations(request, ['SUPER_ADMIN']);
    const email = body.email?.trim().toLowerCase(); const password = body.password ?? ''; const firstName = body.firstName?.trim(); const lastName = body.lastName?.trim();
    const role = body.role as RoleKey;
    const allowedRoles: RoleKey[] = [RoleKey.MANAGER, RoleKey.RECEPTIONIST, RoleKey.HOUSEKEEPER, RoleKey.MAINTENANCE];
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || !firstName || !lastName ||
      !allowedRoles.includes(role)) {
      throw new BadRequestException('Enter a valid email, a password of at least 8 characters, a name, and an allowed staff role.');
    }
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) throw new BadRequestException('The resort is not configured.');
    if (await this.prisma.user.findFirst({ where: { OR: [{ normalizedEmail: email }, { email }] }, select: { id: true } })) throw new ConflictException('An account with this email already exists.');
    const created = await this.prisma.user.create({ data: { email, normalizedEmail: email, passwordHash: hashSync(password, 12), firstName, lastName,
      userRoles: { create: { property: { connect: { id: property.id } }, grantedBy: { connect: { id: request.user.sub } }, role: { connect: { key: role } } } } }, select: { id: true, email: true, firstName: true, lastName: true } });
    await this.writeAudit(request, property.id, 'staff.created', 'User', created.id, { email: created.email, role });
    return created;
  }

  @Post('admin/bookings/:id/check-in')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Assign a room and check in a confirmed reservation' })
  async checkInBooking(@Req() request: AuthenticatedRequest, @Param('id') bookingId: string, @Body() body: { roomId?: string; bookingItemId?: string }) {
    this.requireFrontDesk(request);
    if (!body.roomId || !body.bookingItemId) throw new BadRequestException('Select a room and booking item.');
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, propertyId: property?.id, status: 'CONFIRMED' }, include: { items: true } });
    if (!booking) throw new ConflictException('Only confirmed reservations can be checked in.');
    const item = booking.items.find(({ id }) => id === body.bookingItemId);
    if (!item || item.quantity !== 1) throw new BadRequestException('Select a valid single-room booking item.');
    const room = await this.prisma.room.findFirst({ where: { id: body.roomId, propertyId: booking.propertyId, roomTypeId: item.roomTypeId, operationalStatus: 'ACTIVE' } });
    if (!room) throw new BadRequestException('That room is not an active room of the booked category.');
    const result = await this.prisma.$transaction(async (tx) => {
      const collision = await tx.roomAssignment.findFirst({ where: { roomId: room.id, status: { in: ['ASSIGNED', 'CHECKED_IN'] }, checkIn: { lt: booking.checkOut }, checkOut: { gt: booking.checkIn } } });
      if (collision) throw new ConflictException('That room is already assigned during this stay.');
      await tx.roomAssignment.create({ data: { propertyId: booking.propertyId, bookingId: booking.id, bookingItemId: item.id,
        roomId: room.id, roomTypeId: item.roomTypeId, checkIn: booking.checkIn, checkOut: booking.checkOut, status: 'CHECKED_IN', checkedInAt: new Date() } });
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'CHECKED_IN', checkedInAt: new Date() } });
      return { success: true, roomNumber: room.roomNumber };
    }, { isolationLevel: 'Serializable' });
    await this.writeAudit(request, booking.propertyId, 'booking.checked_in', 'Booking', booking.id, { roomNumber: room.roomNumber });
    return result;
  }

  @Post('admin/bookings/:id/check-out')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Check out an in-house reservation' })
  async checkOutBooking(@Req() request: AuthenticatedRequest, @Param('id') bookingId: string) {
    this.requireFrontDesk(request);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, propertyId: property?.id, status: 'CHECKED_IN' }, include: { roomAssignments: { where: { status: 'CHECKED_IN' }, select: { roomId: true } } } });
    if (!booking) throw new ConflictException('This reservation is not checked in.');
    await this.prisma.$transaction(async (tx) => {
      await tx.roomAssignment.updateMany({ where: { bookingId, status: 'CHECKED_IN' }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date() } });
      await tx.booking.update({ where: { id: bookingId }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date() } });
      for (const assignment of booking.roomAssignments) {
        await tx.room.update({ where: { id: assignment.roomId }, data: { housekeepingStatus: 'DIRTY' } });
        await tx.housekeepingTask.create({ data: { propertyId: booking.propertyId, roomId: assignment.roomId, taskType: 'CHECKOUT_CLEANING', notes: `Checkout cleaning for ${booking.confirmationNumber}` } });
      }
    });
    await this.writeAudit(request, booking.propertyId, 'booking.checked_out', 'Booking', booking.id, { confirmationNumber: booking.confirmationNumber, rooms: booking.roomAssignments.length });
    return { success: true };
  }

  @Get('operations/housekeeping')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List housekeeping tasks for authorized operations staff' })
  async listHousekeeping(@Req() request: AuthenticatedRequest) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER', 'HOUSEKEEPER']);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) return [];
    return this.prisma.housekeepingTask.findMany({ where: { propertyId: property.id }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, taskType: true, status: true, notes: true, createdAt: true, room: { select: { id: true, roomNumber: true, roomType: { select: { name: true } } } }, assignedTo: { select: { id: true, firstName: true, lastName: true } } } });
  }

  @Post('operations/housekeeping/:id/complete')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Complete a housekeeping task' })
  async completeHousekeeping(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: { inspectionNote?: string }) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER', 'HOUSEKEEPER']);
    const task = await this.prisma.housekeepingTask.findUnique({ where: { id }, select: { id: true, propertyId: true, roomId: true, status: true } });
    if (!task || task.status === 'COMPLETED' || task.status === 'CANCELLED') throw new ConflictException('This task is no longer open.');
    const property = await this.prisma.property.findFirst({ where: { id: task.propertyId, slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) throw new BadRequestException('Task not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.housekeepingTask.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), completedById: request.user.sub, inspectionNote: body.inspectionNote?.trim() || null } });
      await tx.room.update({ where: { id: task.roomId }, data: { housekeepingStatus: 'CLEAN' } });
    });
    await this.writeAudit(request, property.id, 'housekeeping.completed', 'HousekeepingTask', task.id, { inspectionNote: body.inspectionNote?.trim() || null });
    return { success: true };
  }

  @Get('operations/maintenance')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List maintenance requests for authorized operations staff' })
  async listMaintenance(@Req() request: AuthenticatedRequest) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE']);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) return [];
    return this.prisma.maintenanceRequest.findMany({ where: { propertyId: property.id }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: 100,
      select: { id: true, title: true, description: true, priority: true, status: true, createdAt: true, room: { select: { roomNumber: true, roomType: { select: { name: true } } } }, assignedTo: { select: { firstName: true, lastName: true } } } });
  }

  @Get('operations/rooms')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List resort rooms for operations staff' })
  async listOperationsRooms(@Req() request: AuthenticatedRequest) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST', 'HOUSEKEEPER', 'MAINTENANCE']);
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) return [];
    return this.prisma.room.findMany({ where: { propertyId: property.id }, orderBy: { roomNumber: 'asc' },
      select: { id: true, roomNumber: true, operationalStatus: true, roomType: { select: { name: true } } } });
  }

  @Post('operations/maintenance')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Report a maintenance request for a resort room' })
  async createMaintenance(@Req() request: AuthenticatedRequest, @Body() body: { roomId?: string; title?: string; description?: string; priority?: string }) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE', 'RECEPTIONIST']);
    const title = body.title?.trim();
    const description = body.description?.trim();
    const priority = body.priority ?? 'NORMAL';
    if (!body.roomId || !title || title.length > 120 || !description || description.length > 2000 || !['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority)) {
      throw new BadRequestException('Select a room, provide a short title and description, and choose a valid priority.');
    }
    const property = await this.prisma.property.findFirst({ where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) throw new BadRequestException('The resort is not configured.');
    const room = await this.prisma.room.findFirst({ where: { id: body.roomId, propertyId: property.id }, select: { id: true } });
    if (!room) throw new BadRequestException('Room not found.');
    const [task] = await this.prisma.$transaction([
      this.prisma.maintenanceRequest.create({ data: { propertyId: property.id, roomId: room.id, title, description, priority: priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' }, select: { id: true, title: true, status: true } }),
      this.prisma.room.update({ where: { id: room.id }, data: { operationalStatus: 'MAINTENANCE' } }),
    ]);
    await this.writeAudit(request, property.id, 'maintenance.created', 'MaintenanceRequest', task.id, { title, priority, roomId: room.id });
    await this.notifyStaff(property.id, ['SUPER_ADMIN', 'MANAGER'], 'maintenance.created', 'A maintenance request was reported', { title, priority });
    return task;
  }

  @Post('operations/maintenance/:id/status')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Update an open maintenance request' })
  async updateMaintenance(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: { status?: string; resolutionNote?: string }) {
    this.requireOperations(request, ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE']);
    const status = body.status;
    if (!['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(status ?? '')) throw new BadRequestException('Choose a valid maintenance status.');
    const task = await this.prisma.maintenanceRequest.findUnique({ where: { id }, select: { id: true, propertyId: true, roomId: true, status: true } });
    if (!task || ['COMPLETED', 'CANCELLED'].includes(task.status)) throw new ConflictException('This request is already closed.');
    const property = await this.prisma.property.findFirst({ where: { id: task.propertyId, slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort' }, select: { id: true } });
    if (!property) throw new BadRequestException('Request not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.maintenanceRequest.update({ where: { id }, data: { status: status as 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED', assignedToId: request.user.sub, assignedAt: task.status === 'OPEN' ? new Date() : undefined, completedById: status === 'COMPLETED' ? request.user.sub : undefined, completedAt: status === 'COMPLETED' ? new Date() : undefined, resolutionNote: body.resolutionNote?.trim() || undefined } });
      if (status === 'COMPLETED' || status === 'CANCELLED') {
        const activeRequests = await tx.maintenanceRequest.count({ where: { id: { not: id }, roomId: task.roomId, status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } } });
        if (!activeRequests) await tx.room.update({ where: { id: task.roomId }, data: { operationalStatus: 'ACTIVE' } });
      }
    });
    await this.writeAudit(request, property.id, 'maintenance.updated', 'MaintenanceRequest', id, { status, resolutionNote: body.resolutionNote?.trim() || null });
    return { success: true };
  }

  @Get('availability')
  @ApiOperation({ summary: 'Search room types available for a date range' })
  @ApiQuery({ name: 'checkIn', example: '2026-12-12' })
  @ApiQuery({ name: 'checkOut', example: '2026-12-15' })
  @ApiQuery({ name: 'guests', required: false, example: 2 })
  async getAvailability(
    @Query('checkIn') checkInValue: string,
    @Query('checkOut') checkOutValue: string,
    @Query('guests') guestsValue = '2',
  ) {
    const checkIn = this.parseDate(checkInValue, 'checkIn');
    const checkOut = this.parseDate(checkOutValue, 'checkOut');
    const guests = Number(guestsValue);
    if (checkOut <= checkIn) throw new BadRequestException('Check-out must be after check-in.');
    if (!Number.isInteger(guests) || guests < 1 || guests > 12) {
      throw new BadRequestException('Guests must be a whole number between 1 and 12.');
    }
    const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
    if (nights > 30) throw new BadRequestException('A stay can be at most 30 nights.');

    const property = await this.prisma.property.findFirst({
      where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort', status: 'ACTIVE' },
      select: { id: true, currency: true },
    });
    if (!property) return { checkIn: checkInValue, checkOut: checkOutValue, nights, rooms: [] };
    await this.expireOldHolds(property.id);
    const ratePlan = await this.prisma.ratePlan.findFirst({ where: { propertyId: property.id, active: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });

    const roomTypes = await this.prisma.roomType.findMany({
      where: { propertyId: property.id, active: true, maxOccupancy: { gte: guests } },
      include: {
        rooms: { where: { operationalStatus: 'ACTIVE' }, select: { id: true } },
        inventories: {
          where: { inventoryDate: { gte: checkIn, lt: checkOut } },
          select: { totalRooms: true, maintenanceBlockedRooms: true, heldRooms: true, bookedRooms: true },
        },
        dailyRates: { where: { rateDate: { gte: checkIn, lt: checkOut }, ...(ratePlan ? { ratePlanId: ratePlan.id } : {}) }, select: { rateDate: true, amount: true, minimumStay: true, maximumStay: true } },
      },
      orderBy: { basePrice: 'asc' },
    });

    const rooms = roomTypes.map(({ rooms: physicalRooms, inventories, dailyRates, ...type }) => {
      const available = inventories.length === nights
        ? Math.max(0, Math.min(...inventories.map((day) => Math.min(
          physicalRooms.length,
          day.totalRooms - day.maintenanceBlockedRooms - day.heldRooms - day.bookedRooms,
        ))))
        : 0;
      const ratesByDate = new Map(dailyRates.map((rate) => [rate.rateDate.toISOString().slice(0, 10), Number(rate.amount)]));
      const nightlyPrices = Array.from({ length: nights }, (_, index) => ratesByDate.get(new Date(checkIn.getTime() + index * 86_400_000).toISOString().slice(0, 10)) ?? Number(type.basePrice));
      const stayRules = dailyRates.filter((rate) => rate.minimumStay !== null || rate.maximumStay !== null);
      const meetsStayRules = stayRules.every((rate) => (rate.minimumStay === null || nights >= rate.minimumStay) && (rate.maximumStay === null || nights <= rate.maximumStay));
      return {
        id: type.id,
        name: type.name,
        description: type.description,
        bedConfiguration: type.bedConfiguration,
        maxOccupancy: type.maxOccupancy,
        basePrice: nightlyPrices.reduce((sum, amount) => sum + amount, 0) / nights,
        currency: property.currency,
        availableRooms: meetsStayRules ? available : 0,
        estimatedTotal: nightlyPrices.reduce((sum, amount) => sum + amount, 0),
        imageUrl: type.imageUrls[0] ?? null,
      };
    }).filter((room) => room.availableRooms > 0);

    return { checkIn: checkInValue, checkOut: checkOutValue, nights, rooms };
  }

  @Post('booking-holds')
  @ApiTags('bookings')
  @ApiOperation({ summary: 'Temporarily hold one available room for a date range' })
  async createBookingHold(@Body() body: { roomTypeId?: string; checkIn?: string; checkOut?: string; guests?: number }) {
    const checkIn = this.parseDate(body.checkIn ?? '', 'checkIn');
    const checkOut = this.parseDate(body.checkOut ?? '', 'checkOut');
    const guests = Number(body.guests);
    if (checkOut <= checkIn) throw new BadRequestException('Check-out must be after check-in.');
    if (!body.roomTypeId || !Number.isInteger(guests) || guests < 1 || guests > 12) {
      throw new BadRequestException('A room type and a guest count from 1 to 12 are required.');
    }
    const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
    if (nights > 30) throw new BadRequestException('A stay can be at most 30 nights.');
    const property = await this.prisma.property.findFirst({
      where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!property) throw new BadRequestException('The resort is not configured.');
    await this.expireOldHolds(property.id);
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const reference = `AR-${randomBytes(5).toString('hex').toUpperCase()}`;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const roomType = await tx.roomType.findFirst({
          where: { id: body.roomTypeId, propertyId: property.id, active: true, maxOccupancy: { gte: guests } },
          select: { id: true },
        });
        if (!roomType) throw new BadRequestException('This room type cannot accommodate the selected guests.');
        const inventory = await tx.roomInventory.findMany({
          where: { propertyId: property.id, roomTypeId: roomType.id, inventoryDate: { gte: checkIn, lt: checkOut } },
          select: { id: true, totalRooms: true, maintenanceBlockedRooms: true, heldRooms: true, bookedRooms: true },
        });
        if (inventory.length !== nights) throw new ConflictException('Inventory is not open for all selected dates.');
        for (const day of inventory) {
          const changed = await tx.roomInventory.updateMany({
            where: { id: day.id, heldRooms: day.heldRooms, bookedRooms: day.bookedRooms, maintenanceBlockedRooms: day.maintenanceBlockedRooms,
              totalRooms: { gte: day.heldRooms + day.bookedRooms + day.maintenanceBlockedRooms + 1 } },
            data: { heldRooms: { increment: 1 }, version: { increment: 1 } },
          });
          if (changed.count !== 1) throw new ConflictException('That room was just taken. Please search again.');
        }
        const hold = await tx.bookingHold.create({
          data: { propertyId: property.id, reference, checkIn, checkOut, expiresAt,
            items: { create: { roomTypeId: roomType.id, quantity: 1, adults: guests, children: 0 } } },
          select: { reference: true, expiresAt: true },
        });
        return hold;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
      throw error;
    }
  }

  @Post('booking-holds/:reference/guest')
  @ApiTags('bookings')
  @ApiOperation({ summary: 'Save lead guest contact details to an active room hold' })
  async addGuestDetails(
    @Param('reference') reference: string,
    @Body() body: { firstName?: string; lastName?: string; email?: string; phone?: string },
  ) {
    const firstName = body.firstName?.trim();
    const lastName = body.lastName?.trim();
    const email = body.email?.trim().toLowerCase();
    const phone = body.phone?.trim();
    if (!firstName || !lastName || !email || !phone || firstName.length > 80 || lastName.length > 80 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?[0-9 ()-]{7,20}$/.test(phone)) {
      throw new BadRequestException('Enter a valid first name, last name, email, and phone number.');
    }
    const property = await this.prisma.property.findFirst({
      where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!property) throw new BadRequestException('The resort is not configured.');
    const hold = await this.prisma.bookingHold.findFirst({
      where: { reference, propertyId: property.id, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!hold) throw new ConflictException('This room hold has expired. Please search and hold a room again.');
    const guest = await this.prisma.guestProfile.create({
      data: { propertyId: property.id, firstName, lastName, email, phone },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    await this.prisma.bookingHold.update({ where: { id: hold.id }, data: { guestProfileId: guest.id } });
    return { reference, guest };
  }

  @Post('booking-holds/:reference/confirm')
  @ApiTags('bookings')
  @ApiOperation({ summary: 'Convert a guest-completed room hold to a pending-payment booking' })
  async confirmBooking(@Param('reference') reference: string, @Body() body: { promotionCode?: string }) {
    const property = await this.prisma.property.findFirst({
      where: { slug: process.env['PROPERTY_SLUG'] ?? 'demo-resort', status: 'ACTIVE' },
      select: { id: true, currency: true },
    });
    if (!property) throw new BadRequestException('The resort is not configured.');
    const hold = await this.prisma.bookingHold.findFirst({
      where: { reference, propertyId: property.id, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      include: { items: { include: { roomType: true } }, guestProfile: { select: { email: true } } },
    });
    if (!hold || !hold.guestProfileId || hold.items.length !== 1) {
      throw new ConflictException('A valid room hold and guest details are required.');
    }
    const nights = Math.round((hold.checkOut.getTime() - hold.checkIn.getTime()) / 86_400_000);
    const promotionCode = body.promotionCode?.trim().toUpperCase() || null;
    const bookingNumber = `AR-${randomBytes(6).toString('hex').toUpperCase()}`;
    const paymentIdempotencyKey = `booking-${randomBytes(16).toString('hex')}`;
    const invoiceNumber = `INV-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const createdBooking = await this.prisma.$transaction(async (tx) => {
      const ratePlan = await tx.ratePlan.findFirst({ where: { propertyId: property.id, active: true }, orderBy: { createdAt: 'asc' } });
      const dailyRates = ratePlan ? await tx.dailyRate.findMany({ where: { propertyId: property.id, roomTypeId: hold.items[0]!.roomTypeId, ratePlanId: ratePlan.id, rateDate: { gte: hold.checkIn, lt: hold.checkOut } }, select: { rateDate: true, amount: true, minimumStay: true, maximumStay: true } }) : [];
      const ratesByDate = new Map(dailyRates.map((rate) => [rate.rateDate.toISOString().slice(0, 10), Number(rate.amount)]));
      const nightlyPrices = Array.from({ length: nights }, (_, index) => ratesByDate.get(new Date(hold.checkIn.getTime() + index * 86_400_000).toISOString().slice(0, 10)) ?? Number(hold.items[0]!.roomType.basePrice));
      const stayRules = dailyRates.filter((rate) => rate.minimumStay !== null || rate.maximumStay !== null);
      if (!stayRules.every((rate) => (rate.minimumStay === null || nights >= rate.minimumStay) && (rate.maximumStay === null || nights <= rate.maximumStay))) {
        throw new ConflictException('This stay does not meet the minimum or maximum night rule for the selected dates.');
      }
      const quantity = hold.items[0]!.quantity;
      const subtotal = Math.round(nightlyPrices.reduce((sum, price) => sum + price * quantity, 0) * 100) / 100;
      let promotion: { id: string; discountType: 'PERCENTAGE' | 'FIXED_AMOUNT'; discountValue: Prisma.Decimal; usageLimit: number | null; usageCount: number; minimumNights: number; roomTypes: { roomTypeId: string }[] } | null = null;
      if (promotionCode) {
        promotion = await tx.promotion.findFirst({ where: { propertyId: property.id, code: promotionCode, active: true, startsAt: { lte: new Date() }, endsAt: { gte: new Date() }, minimumNights: { lte: nights } }, include: { roomTypes: { select: { roomTypeId: true } } } });
        if (!promotion || (promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) || (promotion.roomTypes.length > 0 && !promotion.roomTypes.some((item) => item.roomTypeId === hold.items[0]!.roomTypeId))) {
          throw new BadRequestException('This promotion code is invalid, expired, fully used, or not available for this room or stay.');
        }
        const usage = await tx.promotion.updateMany({ where: { id: promotion.id, usageCount: promotion.usageCount, ...(promotion.usageLimit !== null ? { usageLimit: { gt: promotion.usageCount } } : {}) }, data: { usageCount: { increment: 1 } } });
        if (usage.count !== 1) throw new ConflictException('This promotion was just used up. Try another code.');
      }
      const discountAmount = promotion ? Math.round(Math.min(subtotal, promotion.discountType === 'PERCENTAGE' ? subtotal * Number(promotion.discountValue) / 100 : Number(promotion.discountValue)) * 100) / 100 : 0;
      const totalAmount = Math.round((subtotal - discountAmount) * 100) / 100;
      const unitPrice = Math.round((subtotal / (nights * quantity)) * 100) / 100;
      const perNightDiscount = Math.round((discountAmount / nights) * 100) / 100;
      const currentHold = await tx.bookingHold.updateMany({
        where: { id: hold.id, status: 'ACTIVE', expiresAt: { gt: new Date() }, guestProfileId: hold.guestProfileId },
        data: { status: 'CONVERTED' },
      });
      if (currentHold.count !== 1) throw new ConflictException('This room hold is no longer active.');
      for (let date = hold.checkIn; date < hold.checkOut; date = new Date(date.getTime() + 86_400_000)) {
        const changed = await tx.roomInventory.updateMany({
          where: { propertyId: property.id, roomTypeId: hold.items[0]!.roomTypeId, inventoryDate: date, heldRooms: { gte: hold.items[0]!.quantity } },
          data: { heldRooms: { decrement: hold.items[0]!.quantity }, bookedRooms: { increment: hold.items[0]!.quantity }, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ConflictException('Inventory changed. Please start a new booking.');
      }
      const booking = await tx.booking.create({
        data: {
          propertyId: property.id, guestProfileId: hold.guestProfileId!, promotionId: promotion?.id, confirmationNumber: bookingNumber,
          status: 'PENDING_PAYMENT', source: 'WEBSITE', checkIn: hold.checkIn, checkOut: hold.checkOut,
          currency: property.currency, subtotal, discountAmount, totalAmount, paymentDueAt: hold.expiresAt,
          items: { create: {
            propertyId: property.id, roomTypeId: hold.items[0]!.roomTypeId, ratePlanId: ratePlan?.id,
            quantity: hold.items[0]!.quantity, adults: hold.items[0]!.adults, children: hold.items[0]!.children,
            roomTypeNameSnapshot: hold.items[0]!.roomType.name, ratePlanNameSnapshot: ratePlan?.name,
            mealPlanSnapshot: ratePlan?.mealPlan ?? 'ROOM_ONLY', unitPriceSnapshot: unitPrice,
            subtotal, discountAmount, totalAmount, currency: property.currency,
            nights: { create: Array.from({ length: nights }, (_, index) => {
              const stayDate = new Date(hold.checkIn.getTime() + index * 86_400_000);
              const baseAmountSnapshot = nightlyPrices[index]! * quantity;
              const discountSnapshot = index === nights - 1 ? Math.round((discountAmount - perNightDiscount * (nights - 1)) * 100) / 100 : perNightDiscount;
              return { propertyId: property.id, stayDate, baseAmountSnapshot, discountSnapshot,
                totalSnapshot: baseAmountSnapshot - discountSnapshot, currency: property.currency };
            }) },
          } },
          payments: { create: { propertyId: property.id, amount: totalAmount, currency: property.currency, status: 'CREATED', idempotencyKey: paymentIdempotencyKey } },
          invoice: { create: { propertyId: property.id, invoiceNumber, currency: property.currency,
            subtotal, totalAmount, discountAmount, taxAmount: 0 } },
        },
        select: { id: true, confirmationNumber: true, status: true, totalAmount: true, discountAmount: true, currency: true, paymentDueAt: true },
      });
      return { ...booking, totalAmount: Number(booking.totalAmount), discountAmount: Number(booking.discountAmount), paymentStatus: 'CREATED' };
    }, { isolationLevel: 'Serializable' });
    await this.notifyCustomer(property.id, hold.guestProfile?.email ?? null, 'booking.created', 'Your reservation is awaiting payment', { confirmationNumber: createdBooking.confirmationNumber, totalAmount: createdBooking.totalAmount, currency: property.currency });
    return createdBooking;
  }

  @Post('payments/:confirmationNumber/order')
  @ApiTags('payments')
  @ApiOperation({ summary: 'Create a Razorpay test/live order for a pending reservation' })
  async createPaymentOrder(@Param('confirmationNumber') confirmationNumber: string) {
    const keyId = process.env['RAZORPAY_KEY_ID'];
    const keySecret = process.env['RAZORPAY_KEY_SECRET'];
    if (!keyId || !keySecret) throw new BadRequestException('Online payment is not configured yet. Set the Razorpay test credentials in resort-backend/.env.');
    const propertySlug = process.env['PROPERTY_SLUG'] ?? 'demo-resort';
    const booking = await this.prisma.booking.findFirst({ where: { confirmationNumber, property: { slug: propertySlug }, status: 'PENDING_PAYMENT', paymentDueAt: { gt: new Date() } }, include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!booking || !booking.payments[0]) throw new ConflictException('This reservation is not awaiting payment or its payment window has expired.');
    const payment = booking.payments[0];
    if (payment.gatewayOrderId) return { keyId, orderId: payment.gatewayOrderId, amount: Math.round(Number(payment.amount) * 100), currency: payment.currency, confirmationNumber };
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Math.round(Number(payment.amount) * 100), currency: payment.currency, receipt: confirmationNumber, notes: { confirmationNumber } }),
    });
    const result = await response.json() as { id?: string; amount?: number; currency?: string; error?: { description?: string } };
    if (!response.ok || !result.id) throw new BadRequestException(result.error?.description ?? 'Razorpay could not create a payment order.');
    await this.prisma.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: result.id, status: 'PENDING' } });
    return { keyId, orderId: result.id, amount: result.amount, currency: result.currency, confirmationNumber };
  }

  @Post('payments/verify')
  @ApiTags('payments')
  @ApiOperation({ summary: 'Verify Razorpay checkout response and confirm a captured reservation payment' })
  async verifyPayment(@Body() body: { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string }) {
    const secret = process.env['RAZORPAY_KEY_SECRET'];
    if (!secret) throw new BadRequestException('Online payment is not configured.');
    const orderId = body.razorpay_order_id ?? ''; const paymentId = body.razorpay_payment_id ?? ''; const signature = body.razorpay_signature ?? '';
    if (!orderId || !paymentId || !/^[a-f0-9]{64}$/i.test(signature)) throw new BadRequestException('The payment response is incomplete.');
    const expected = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new BadRequestException('Payment signature verification failed.');
    const payment = await this.prisma.payment.findUnique({ where: { gatewayOrderId: orderId }, include: { booking: true } });
    if (!payment) throw new BadRequestException('Payment order not found.');
    if (payment.status === 'SUCCESS') return { success: true, confirmationNumber: payment.booking.confirmationNumber, status: payment.booking.status };
    const keyId = process.env['RAZORPAY_KEY_ID'];
    const statusResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString('base64')}` },
    });
    const gatewayPayment = await statusResponse.json() as { order_id?: string; amount?: number; currency?: string; status?: string; error?: { description?: string } };
    if (!statusResponse.ok || gatewayPayment.order_id !== orderId || gatewayPayment.amount !== Math.round(Number(payment.amount) * 100) || gatewayPayment.currency !== payment.currency || gatewayPayment.status !== 'captured') {
      throw new ConflictException(gatewayPayment.error?.description ?? 'Payment is not captured yet. Your reservation remains pending.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCESS', gatewayPaymentId: paymentId, verifiedAt: new Date() } });
      await tx.booking.updateMany({ where: { id: payment.bookingId, status: { in: ['PENDING_PAYMENT', 'CANCELLATION_REQUESTED'] } }, data: { status: payment.booking.status === 'CANCELLATION_REQUESTED' ? 'CANCELLATION_REQUESTED' : 'CONFIRMED', confirmedAt: new Date(), amountPaid: payment.amount } });
    });
    return { success: true, confirmationNumber: payment.booking.confirmationNumber, status: 'CONFIRMED' };
  }

  @Post('payments/webhook')
  @ApiTags('payments')
  @ApiOperation({ summary: 'Receive signed Razorpay payment webhooks' })
  async razorpayWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature = '',
    @Headers('x-razorpay-event-id') eventIdHeader = '',
    @Body() body: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string; status?: string } }; refund?: { entity?: { id?: string; payment_id?: string; status?: string } } } },
  ) {
    const webhookSecret = process.env['RAZORPAY_WEBHOOK_SECRET'];
    const rawBody = request.rawBody;
    if (!webhookSecret || !rawBody || !/^[a-f0-9]{64}$/i.test(signature)) throw new BadRequestException('Webhook signature is missing or invalid.');
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new BadRequestException('Webhook signature verification failed.');

    const eventId = eventIdHeader || createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    const eventType = body.event ?? 'unknown';
    const entity = body.payload?.payment?.entity;
    const refundEntity = body.payload?.refund?.entity;
    const payment = entity?.order_id ? await this.prisma.payment.findUnique({ where: { gatewayOrderId: entity.order_id }, select: { id: true, propertyId: true, bookingId: true, amount: true, currency: true, status: true, booking: { select: { status: true } } } }) : null;
    try {
      await this.prisma.paymentWebhookEvent.create({ data: {
        eventId, eventType, payload: body as Prisma.InputJsonValue,
        propertyId: payment?.propertyId, paymentId: payment?.id,
      } });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return { received: true, duplicate: true };
      throw error;
    }

    if (eventType === 'payment.captured' && payment && entity?.id &&
      entity.amount === Math.round(Number(payment.amount) * 100) && entity.currency === payment.currency) {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.updateMany({ where: { id: payment.id, status: { not: 'SUCCESS' } }, data: { status: 'SUCCESS', gatewayPaymentId: entity.id, verifiedAt: new Date() } });
        await tx.booking.updateMany({ where: { id: payment.bookingId, status: { in: ['PENDING_PAYMENT', 'CANCELLATION_REQUESTED'] } }, data: { status: payment.booking.status === 'CANCELLATION_REQUESTED' ? 'CANCELLATION_REQUESTED' : 'CONFIRMED', confirmedAt: new Date(), amountPaid: payment.amount } });
      });
    } else if (eventType === 'payment.failed' && payment && entity?.id) {
      await this.prisma.payment.updateMany({ where: { id: payment.id, status: { in: ['CREATED', 'PENDING'] } }, data: { status: 'FAILED', gatewayPaymentId: entity.id } });
    } else if ((eventType === 'refund.processed' || eventType === 'refund.failed') && refundEntity?.id) {
      const refund = await this.prisma.refund.findUnique({ where: { gatewayRefundId: refundEntity.id }, select: { id: true, paymentId: true } });
      if (refund) {
        const processed = eventType === 'refund.processed';
        await this.prisma.$transaction(async (tx) => {
          await tx.refund.update({ where: { id: refund.id }, data: { status: processed ? 'PROCESSED' : 'FAILED', processedAt: processed ? new Date() : null } });
          if (processed) await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUNDED' } });
        });
      }
    }
    await this.prisma.paymentWebhookEvent.update({ where: { eventId }, data: { processedAt: new Date() } });
    return { received: true };
  }

  private parseDate(value: string, field: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
      throw new BadRequestException(`${field} must use YYYY-MM-DD format.`);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${field} is not a valid calendar date.`);
    }
    return date;
  }

  private async writeAudit(request: AuthenticatedRequest | null, propertyId: string, action: string, entityType: string, entityId: string, after: unknown): Promise<void> {
    const jsonAfter = JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue;
    await this.prisma.auditLog.create({ data: {
      propertyId, actorId: request?.user.sub ?? null, action, entityType, entityId,
      ipAddress: request?.ip?.slice(0, 64) ?? null,
      userAgent: request?.headers['user-agent']?.toString().slice(0, 500) ?? null,
      after: jsonAfter,
    } });
  }

  private async notifyCustomer(propertyId: string, email: string | null, templateKey: string, subject: string, payload: Record<string, unknown>): Promise<void> {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) return;
    const user = await this.prisma.user.findFirst({ where: { normalizedEmail, status: 'ACTIVE' }, select: { id: true, email: true } });
    if (!user) return;
    await this.prisma.notification.create({ data: { propertyId, userId: user.id, channel: 'IN_APP', status: 'QUEUED', recipient: user.email ?? normalizedEmail,
      subject, templateKey, payload: payload as Prisma.InputJsonValue } });
  }

  private async notifyUser(propertyId: string, userId: string, templateKey: string, subject: string, payload: Record<string, unknown>): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, status: 'ACTIVE' }, select: { id: true, email: true } });
    if (!user) return;
    await this.prisma.notification.create({ data: { propertyId, userId: user.id, channel: 'IN_APP', status: 'QUEUED', recipient: user.email ?? user.id,
      subject, templateKey, payload: payload as Prisma.InputJsonValue } });
  }

  private async notifyStaff(propertyId: string, roles: string[], templateKey: string, subject: string, payload: Record<string, unknown>): Promise<void> {
    const users = await this.prisma.user.findMany({ where: { status: 'ACTIVE', userRoles: { some: { propertyId, role: { key: { in: roles as RoleKey[] } } } } }, select: { id: true, email: true } });
    if (!users.length) return;
    await this.prisma.notification.createMany({ data: users.map((user) => ({ propertyId, userId: user.id, channel: 'IN_APP' as const, status: 'QUEUED' as const,
      recipient: user.email ?? user.id, subject, templateKey, payload: payload as Prisma.InputJsonValue })) });
  }

  private requireFrontDesk(request: AuthenticatedRequest): void {
    if (!request.user.roles.some((role) => ['SUPER_ADMIN', 'MANAGER', 'RECEPTIONIST'].includes(role))) {
      throw new ForbiddenException('Your account does not have front desk access.');
    }
  }

  private requireOperations(request: AuthenticatedRequest, allowed: string[]): void {
    if (!request.user.roles.some((role) => allowed.includes(role))) throw new ForbiddenException('Your account does not have access to this operations area.');
  }

  private async expireOldHolds(propertyId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const expired = await tx.bookingHold.findMany({
        where: { propertyId, status: 'ACTIVE', expiresAt: { lte: now } },
        include: { items: true },
      });
      for (const hold of expired) {
        const changed = await tx.bookingHold.updateMany({
          where: { id: hold.id, status: 'ACTIVE', expiresAt: { lte: now } },
          data: { status: 'EXPIRED' },
        });
        if (changed.count !== 1) continue;
        for (const item of hold.items) {
          for (let date = hold.checkIn; date < hold.checkOut; date = new Date(date.getTime() + 86_400_000)) {
            await tx.roomInventory.updateMany({
              where: { propertyId, roomTypeId: item.roomTypeId, inventoryDate: date, heldRooms: { gte: item.quantity } },
              data: { heldRooms: { decrement: item.quantity }, version: { increment: 1 } },
            });
          }
        }
      }
    });
  }
}
