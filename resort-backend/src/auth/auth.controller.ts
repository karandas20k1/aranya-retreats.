import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@ApiTags('authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Sign in using email and password' })
  login(@Body() body: { email?: string; password?: string }) {
    return this.auth.login(body.email ?? '', body.password ?? '');
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a customer account' })
  register(@Body() body: { firstName?: string; lastName?: string; email?: string; password?: string }) {
    return this.auth.register({ firstName: body.firstName ?? '', lastName: body.lastName ?? '', email: body.email ?? '', password: body.password ?? '' });
  }

  @Get('bookings')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List reservations associated with the signed-in customer email' })
  bookings(@Req() request: AuthenticatedRequest) {
    return this.auth.getCustomerBookings(request.user.sub);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token' })
  refresh(@Body() body: { refreshToken?: string }) { return this.auth.refresh(body.refreshToken ?? ''); }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(@Body() body: { refreshToken?: string }) {
    await this.auth.logout(body.refreshToken ?? '');
    return { success: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the signed-in user identity and roles' })
  me(@Req() request: AuthenticatedRequest) { return request.user; }
}
