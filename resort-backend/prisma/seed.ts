import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashSync } from 'bcryptjs';
import { PrismaClient, RoleKey } from '../src/generated/prisma/client.js';

const databaseUrl = process.env['DATABASE_URL'];
function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set before seeding.`);
  return value;
}

const adminEmail = requiredEnvironmentVariable('INITIAL_ADMIN_EMAIL').trim().toLowerCase();
const adminPassword = requiredEnvironmentVariable('INITIAL_ADMIN_PASSWORD');

if (!databaseUrl) throw new Error('DATABASE_URL is required to seed the database.');
if (adminPassword.length < 8) {
  throw new Error('INITIAL_ADMIN_PASSWORD must be at least 8 characters.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const roleNames: Record<RoleKey, string> = {
  [RoleKey.SUPER_ADMIN]: 'Super administrator',
  [RoleKey.MANAGER]: 'Manager',
  [RoleKey.RECEPTIONIST]: 'Receptionist',
  [RoleKey.HOUSEKEEPER]: 'Housekeeper',
  [RoleKey.MAINTENANCE]: 'Maintenance',
  [RoleKey.CUSTOMER]: 'Customer',
};

const categories = [
  {
    name: 'Standard Room',
    slug: 'standard-room',
    description: 'A comfortable base for a relaxing resort stay.',
    maxAdults: 2,
    maxChildren: 1,
    maxOccupancy: 3,
    bedConfiguration: '1 queen bed',
    basePrice: '4500.00',
    roomNumbers: ['STD-101', 'STD-102'],
    amenities: ['Wi-Fi', 'Air conditioning'],
  },
  {
    name: 'Deluxe Room',
    slug: 'deluxe-room',
    description: 'A spacious room with upgraded furnishings and a garden view.',
    maxAdults: 2,
    maxChildren: 2,
    maxOccupancy: 4,
    bedConfiguration: '1 king bed',
    basePrice: '6800.00',
    roomNumbers: ['DLX-201', 'DLX-202'],
    amenities: ['Wi-Fi', 'Air conditioning', 'Balcony'],
  },
  {
    name: 'Cottage',
    slug: 'cottage',
    description: 'A private cottage with generous indoor and outdoor space.',
    maxAdults: 4,
    maxChildren: 2,
    maxOccupancy: 6,
    bedConfiguration: '1 king bed and 2 twin beds',
    basePrice: '11200.00',
    roomNumbers: ['COT-301', 'COT-302'],
    amenities: ['Wi-Fi', 'Air conditioning', 'Balcony'],
  },
  {
    name: 'Suite',
    slug: 'suite',
    description: 'A premium suite with a separate lounge and resort views.',
    maxAdults: 2,
    maxChildren: 2,
    maxOccupancy: 4,
    bedConfiguration: '1 king bed',
    basePrice: '14500.00',
    roomNumbers: ['STE-401', 'STE-402'],
    amenities: ['Wi-Fi', 'Air conditioning', 'Balcony', 'Private plunge pool'],
  },
] as const;

const amenities = ['Wi-Fi', 'Air conditioning', 'Balcony', 'Private plunge pool'];

async function seed(): Promise<void> {
  const passwordHash = hashSync(adminPassword, 12);
  const propertySlug = process.env['PROPERTY_SLUG']?.trim() || 'demo-resort';
  const propertyName = process.env['PROPERTY_NAME']?.trim() || 'Demo Resort';

  await prisma.$transaction(async (tx) => {
    const property = await tx.property.upsert({
      where: { slug: propertySlug },
      update: { name: propertyName },
      create: { name: propertyName, slug: propertySlug },
    });

    const roleIds = new Map<RoleKey, string>();
    for (const key of Object.values(RoleKey)) {
      const role = await tx.role.upsert({
        where: { key },
        update: { displayName: roleNames[key] },
        create: { key, displayName: roleNames[key] },
      });
      roleIds.set(key, role.id);
    }

    const policy = await tx.cancellationPolicy.upsert({
      where: {
        propertyId_name: { propertyId: property.id, name: 'Standard Cancellation' },
      },
      update: {},
      create: {
        propertyId: property.id,
        name: 'Standard Cancellation',
        description: 'Cancellation terms are confirmed with the selected rate plan.',
        freeCancellationHours: 48,
        penaltyType: 'PERCENTAGE',
        penaltyValue: '50.00',
      },
    });

    await tx.ratePlan.upsert({
      where: { propertyId_slug: { propertyId: property.id, slug: 'room-only' } },
      update: { cancellationPolicyId: policy.id },
      create: {
        propertyId: property.id,
        cancellationPolicyId: policy.id,
        name: 'Room Only',
        slug: 'room-only',
        description: 'Accommodation without meals.',
        mealPlan: 'ROOM_ONLY',
        advancePaymentPercent: '100.00',
      },
    });
    for (const name of amenities) {
      const slug = name.toLowerCase().replaceAll(' ', '-');
      await tx.amenity.upsert({
        where: { propertyId_slug: { propertyId: property.id, slug } },
        update: { name },
        create: { propertyId: property.id, name, slug },
      });
    }

    for (const category of categories) {
      const roomType = await tx.roomType.upsert({
        where: {
          propertyId_slug: { propertyId: property.id, slug: category.slug },
        },
        update: {
          name: category.name,
          description: category.description,
          maxAdults: category.maxAdults,
          maxChildren: category.maxChildren,
          maxOccupancy: category.maxOccupancy,
          bedConfiguration: category.bedConfiguration,
          basePrice: category.basePrice,
        },
        create: {
          propertyId: property.id,
          name: category.name,
          slug: category.slug,
          description: category.description,
          maxAdults: category.maxAdults,
          maxChildren: category.maxChildren,
          maxOccupancy: category.maxOccupancy,
          bedConfiguration: category.bedConfiguration,
          basePrice: category.basePrice,
        },
      });

      for (const amenityName of category.amenities) {
        const amenitySlug = amenityName.toLowerCase().replaceAll(' ', '-');
        const amenity = await tx.amenity.findUniqueOrThrow({
          where: {
            propertyId_slug: { propertyId: property.id, slug: amenitySlug },
          },
        });
        await tx.roomTypeAmenity.upsert({
          where: {
            roomTypeId_amenityId: { roomTypeId: roomType.id, amenityId: amenity.id },
          },
          update: {},
          create: { roomTypeId: roomType.id, amenityId: amenity.id },
        });
      }

      for (const roomNumber of category.roomNumbers) {
        await tx.room.upsert({
          where: { propertyId_roomNumber: { propertyId: property.id, roomNumber } },
          update: { roomTypeId: roomType.id },
          create: {
            propertyId: property.id,
            roomTypeId: roomType.id,
            roomNumber,
          },
        });
      }

      const inventoryStart = new Date();
      inventoryStart.setUTCHours(0, 0, 0, 0);
      const openRooms = await tx.room.count({
        where: {
          propertyId: property.id,
          roomTypeId: roomType.id,
          operationalStatus: 'ACTIVE',
        },
      });
      await tx.roomInventory.createMany({
        data: Array.from({ length: 366 }, (_, offset) => ({
          propertyId: property.id,
          roomTypeId: roomType.id,
          inventoryDate: new Date(inventoryStart.getTime() + offset * 86_400_000),
          totalRooms: openRooms,
        })),
        skipDuplicates: true,
      });
    }

    const admin = await tx.user.upsert({
      where: { email: adminEmail },
      update: {
        normalizedEmail: adminEmail,
        status: 'ACTIVE',
      },
      create: {
        email: adminEmail,
        normalizedEmail: adminEmail,
        passwordHash,
        firstName: process.env['INITIAL_ADMIN_FIRST_NAME']?.trim() || 'Resort',
        lastName: process.env['INITIAL_ADMIN_LAST_NAME']?.trim() || 'Administrator',
        status: 'ACTIVE',
      },
    });

    const superAdminRoleId = roleIds.get(RoleKey.SUPER_ADMIN);
    if (!superAdminRoleId) throw new Error('SUPER_ADMIN role was not seeded.');
    const existingRole = await tx.userRole.findFirst({
      where: { userId: admin.id, roleId: superAdminRoleId, propertyId: null },
    });
    if (!existingRole) {
      await tx.userRole.create({
        data: { userId: admin.id, roleId: superAdminRoleId },
      });
    }
  });
}

try {
  await seed();
  console.info('Database seed completed.');
} finally {
  await prisma.$disconnect();
}
