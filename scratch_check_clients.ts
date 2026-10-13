import prisma from './src/lib/prisma.js';

async function main() {
  const c = await prisma.client.findFirst({
    orderBy: { createdAt: 'desc' },
    include: {
      user: true,
      familyMembers: true,
      agreements: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        clientNumber: c?.clientNumber,
        userEmail: c?.user?.email,
        userName: `${c?.user?.firstName || ''} ${c?.user?.lastName || ''}`,
        primaryContactName: c?.primaryContactName,
        signerRole: c?.signerRole,
        repFullName: (c?.onboardingData as any)?.repFullName,
        repEmail: (c?.onboardingData as any)?.repEmail,
        repCapacity: (c?.onboardingData as any)?.representativeCapacity,
        authorityDocumentUrl: (c?.onboardingData as any)?.authorityDocumentUrl,
        signingData: (c?.onboardingData as any)?.signingData,
        agreements: c?.agreements.map((a) => ({
          signerRole: a.signerRole,
          signerName: a.signerName,
          signerEmail: a.signerEmail,
          authorizedRepName: a.authorizedRepName,
        })),
        familyMembers: c?.familyMembers,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
