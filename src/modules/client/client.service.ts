import prisma from "../../lib/prisma";

export interface AdminClientsQuery {
  search?: string;
  state?: string;
  onboardingStatus?: string;
  agreementStatus?: string;
  page?: number;
  limit?: number;
}

function safeFormatDate(dateVal?: any): string | null {
  if (!dateVal) return null;
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

/**
 * Get All Admin Clients from Database
 */
export async function getAllAdminClients(query?: AdminClientsQuery) {
  const where: any = {};

  if (query?.state && query.state !== "ALL") {
    where.state = query.state.toUpperCase();
  }

  if (query?.onboardingStatus && query.onboardingStatus !== "ALL") {
    where.onboardingStatus = query.onboardingStatus;
  }

  const clients = await (prisma.client.findMany as any)({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
        },
      },
      agreements: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      invoices: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      appointments: {
        where: { status: { in: ["SCHEDULED", "CONFIRMED"] } },
        orderBy: { startAt: "asc" },
        take: 1,
      },
      invitations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const unarchivedClients = (clients || []).filter((c: any) => c.isArchived !== true);

  const mapped = unarchivedClients.map((c: any) => {
    const latestAgreement = c.agreements?.[0] || null;
    const latestSub = c.subscriptions?.[0] || null;
    const latestInvoice = c.invoices?.[0] || null;
    const nextAppt = c.appointments?.[0] || null;
    const latestInvitation = c.invitations?.[0] || null;

    const isExecutedAgreement =
      latestAgreement?.status === "EXECUTED" ||
      latestAgreement?.status === "SIGNED" ||
      c.hasCompletedAgreement;

    const agreementStatus = isExecutedAgreement
      ? "EXECUTED"
      : latestAgreement?.status || "PENDING_SIGNATURE";

    const isSubActive = latestSub?.status === "ACTIVE";
    const paymentStatus = isSubActive
      ? "PAID"
      : latestInvoice?.status === "PAID"
      ? "PAID"
      : latestInvoice?.status === "OPEN"
      ? "OPEN_INVOICE"
      : "PENDING_PAYMENT";

    const subscriptionStatus = latestSub?.status || (isSubActive ? "ACTIVE" : "PENDING");

    return {
      id: c.clientNumber || c.id,
      internalId: c.id,
      userId: c.userId,
      clientNumber: c.clientNumber || `AW-${c.id.slice(-4).toUpperCase()}`,
      firstName: c.user?.firstName || "Unknown",
      lastName: c.user?.lastName || "Member",
      email: c.user?.email || c.primaryContactEmail || "",
      phone: c.user?.phone || c.primaryContactPhone || "",
      address: {
        street: c.address || "",
        city: c.city || "",
        state: c.state || "RI",
        zip: c.postalCode || "",
      },
      dateOfBirth: c.dateOfBirth || null,
      state: c.state || "RI",
      signerRole: c.signerRole || "RESIDENT",
      legalAuthority: c.legalAuthority,
      legalAuthorityOther: c.legalAuthorityOther,
      emergencyContactName: c.emergencyContactName,
      emergencyContactPhone: c.emergencyContactPhone,
      emergencyContactEmail: c.emergencyContactEmail,
      emergencyContactRelation: c.emergencyContactRelation,
      homeAccessType: c.homeAccessType,
      homeAccessInstructions: c.homeAccessInstructions,
      planName: latestSub?.plan?.name || c.selectedPlan || "Guardian Plus",
      planCode: latestSub?.plan?.code || c.selectedPlan || "GUARDIAN_PLUS",
      hasCleaningAddon: Boolean(c.hasCleaningAddon),
      onboardingStatus: c.onboardingStatus || "INVITED",
      onboardingStep: c.onboardingStep || 1,
      agreementStatus,
      agreementSignedDate: safeFormatDate(latestAgreement?.signedAt),
      agreementDeadline: safeFormatDate(latestAgreement?.cancellationDeadline),
      paymentStatus,
      subscriptionStatus,
      cardBrand: c.cardBrand,
      cardLast4: c.cardLast4,
      totalVisitsAllowed: c.hasCleaningAddon ? 18 : 12,
      completedVisitsCount: 0,
      remainingVisitsCount: c.hasCleaningAddon ? 18 : 12,
      nextVisitDate: safeFormatDate(nextAppt?.startAt),
      renewalDate: safeFormatDate(latestSub?.currentPeriodEnd),
      status: isSubActive ? "active" : isExecutedAgreement ? "active" : "pending_onboarding",
      createdAt: safeFormatDate(c.createdAt) || "Recently",
      // Onboarding Timeline Flags
      timeline: {
        welcomeSent: Boolean(latestInvitation || c.createdAt),
        accountCreated: true,
        signerSelected: Boolean(c.signerRole),
        emergencyContactAdded: Boolean(c.emergencyContactName && c.emergencyContactPhone),
        stateSelected: Boolean(c.state),
        agreementSent: Boolean(latestAgreement || isExecutedAgreement),
        agreementSigned: isExecutedAgreement,
        paymentProcessed: paymentStatus === "PAID",
        subscriptionActive: isSubActive,
      },
    };
  });

  let result = mapped;

  if (query?.search && query.search.trim()) {
    const term = query.search.trim().toLowerCase();
    result = result.filter((c: any) =>
      c.firstName.toLowerCase().includes(term) ||
      c.lastName.toLowerCase().includes(term) ||
      c.email.toLowerCase().includes(term) ||
      c.phone.toLowerCase().includes(term) ||
      c.clientNumber.toLowerCase().includes(term) ||
      c.address.street.toLowerCase().includes(term) ||
      c.address.city.toLowerCase().includes(term)
    );
  }

  if (query?.agreementStatus && query.agreementStatus !== "ALL") {
    result = result.filter((c: any) => c.agreementStatus === query.agreementStatus);
  }

  if (query?.page && query?.limit) {
    const page = Math.max(1, Number(query.page));
    const limit = Math.max(1, Number(query.limit));
    const startIndex = (page - 1) * limit;
    return result.slice(startIndex, startIndex + limit);
  }

  return result;
}

function isValidObjectId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Get Admin Client Detail by ID, clientNumber (e.g. AW-1015), email, or other slugs
 */
export async function getAdminClientById(clientIdOrNumber: string) {
  const trimmed = (clientIdOrNumber || "").trim();
  if (!trimmed) {
    return null;
  }

  const orConditions: any[] = [
    { clientNumber: trimmed },
    { clientNumber: { equals: trimmed, mode: "insensitive" } },
    { clientNumber: { contains: trimmed, mode: "insensitive" } },
    { user: { email: { equals: trimmed, mode: "insensitive" } } },
    { primaryContactEmail: { equals: trimmed, mode: "insensitive" } },
    { emergencyContactEmail: { equals: trimmed, mode: "insensitive" } },
  ];

  // If slug has digits e.g. "1015" or "AW1015", also match "AW-1015"
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 3) {
    orConditions.push({ clientNumber: `AW-${digits}` });
    orConditions.push({ clientNumber: { contains: digits, mode: "insensitive" } });
  }

  // If valid 24-character hexadecimal MongoDB ObjectId, match id or userId
  if (isValidObjectId(trimmed)) {
    orConditions.push({ id: trimmed });
    orConditions.push({ userId: trimmed });
  }

  const client = await (prisma.client.findFirst as any)({
    where: {
      OR: orConditions,
    },
    include: {
      user: true,
      agreements: {
        orderBy: { createdAt: "desc" },
        include: {
          planVersion: true,
          agreementVersion: true,
        },
      },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        include: {
          periods: { orderBy: { startDate: "desc" } },
        },
      },
      invoices: {
        orderBy: { createdAt: "desc" },
      },
      appointments: {
        orderBy: { startAt: "desc" },
        include: {
          serviceType: true,
        },
      },
      reports: {
        orderBy: { createdAt: "desc" },
      },
      invitations: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!client) {
    return null;
  }

  // Retrieve Audit Logs for this client
  const auditLogs = await (prisma.auditLog.findMany as any)({
    where: {
      OR: [
        { entityId: client.id },
        { entityId: client.userId },
        { actorUserId: client.userId },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      actorUser: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          role: true,
        },
      },
    },
  });

  const latestAgreement = client.agreements?.[0] || null;
  const latestSub = client.subscriptions?.[0] || null;
  const latestInvoice = client.invoices?.[0] || null;
  const nextAppt = client.appointments?.find((a: any) =>
    ["SCHEDULED", "CONFIRMED"].includes(a.status)
  );

  const isExecutedAgreement =
    latestAgreement?.status === "EXECUTED" ||
    latestAgreement?.status === "SIGNED" ||
    client.hasCompletedAgreement;

  const agreementStatus = isExecutedAgreement
    ? "EXECUTED"
    : latestAgreement?.status || "PENDING_SIGNATURE";

  const isSubActive = latestSub?.status === "ACTIVE";
  const paymentStatus = isSubActive
    ? "PAID"
    : latestInvoice?.status === "PAID"
    ? "PAID"
    : latestInvoice?.status === "OPEN"
    ? "OPEN_INVOICE"
    : "PENDING_PAYMENT";

  return {
    id: client.clientNumber || client.id,
    internalId: client.id,
    userId: client.userId,
    clientNumber: client.clientNumber,
    firstName: client.user?.firstName || "Unknown",
    lastName: client.user?.lastName || "Member",
    email: client.user?.email || client.primaryContactEmail || "",
    phone: client.user?.phone || client.primaryContactPhone || "",
    address: {
      street: client.address || "",
      city: client.city || "",
      state: client.state || "RI",
      zip: client.postalCode || "",
    },
    dateOfBirth: client.dateOfBirth,
    state: client.state || "RI",
    signerRole: client.signerRole || "RESIDENT",
    legalAuthority: client.legalAuthority,
    legalAuthorityOther: client.legalAuthorityOther,
    primaryContactName: client.primaryContactName,
    primaryContactPhone: client.primaryContactPhone,
    primaryContactEmail: client.primaryContactEmail,
    primaryContactRelation: client.primaryContactRelation,
    emergencyContactName: client.emergencyContactName,
    emergencyContactPhone: client.emergencyContactPhone,
    emergencyContactEmail: client.emergencyContactEmail,
    emergencyContactRelation: client.emergencyContactRelation,
    homeAccessType: client.homeAccessType,
    homeAccessInstructions: client.homeAccessInstructions,
    homeAccessCode: client.homeAccessCode,
    planName: latestSub?.plan?.name || client.selectedPlan || "Guardian Plus",
    planCode: latestSub?.plan?.code || client.selectedPlan || "GUARDIAN_PLUS",
    hasCleaningAddon: client.hasCleaningAddon,
    onboardingStatus: client.onboardingStatus,
    onboardingStep: client.onboardingStep || 1,
    onboardingData: client.onboardingData,
    agreementStatus,
    agreementSignedDate: safeFormatDate(latestAgreement?.signedAt),
    agreementDeadline: safeFormatDate(latestAgreement?.cancellationDeadline),
    paymentStatus,
    subscriptionStatus: latestSub?.status || (isSubActive ? "ACTIVE" : "PENDING"),
    cardBrand: client.cardBrand,
    cardLast4: client.cardLast4,
    totalVisitsAllowed: client.hasCleaningAddon ? 18 : 12,
    completedVisitsCount: client.appointments?.filter((a: any) => a.status === "COMPLETED").length || 0,
    remainingVisitsCount: (client.hasCleaningAddon ? 18 : 12) - (client.appointments?.filter((a: any) => a.status === "COMPLETED").length || 0),
    nextVisitDate: safeFormatDate(nextAppt?.startAt),
    renewalDate: safeFormatDate(latestSub?.currentPeriodEnd),
    status: isSubActive ? "active" : isExecutedAgreement ? "active" : "pending_onboarding",
    createdAt: safeFormatDate(client.createdAt) || "Recently",
    timeline: {
      welcomeSent: Boolean(client.invitations?.length || client.createdAt),
      accountCreated: true,
      signerSelected: Boolean(client.signerRole),
      emergencyContactAdded: Boolean(client.emergencyContactName && client.emergencyContactPhone),
      stateSelected: Boolean(client.state),
      agreementSent: Boolean(latestAgreement || isExecutedAgreement),
      agreementSigned: isExecutedAgreement,
      paymentProcessed: paymentStatus === "PAID",
      subscriptionActive: isSubActive,
    },
    agreements: client.agreements,
    latestAgreement,
    subscriptions: client.subscriptions,
    invoices: client.invoices,
    appointments: client.appointments,
    reports: client.reports,
    invitations: client.invitations,
    auditLogs: (auditLogs || []).map((log: any) => ({
      id: log.id,
      action: (log.action || "").replace(/_/g, " "),
      details: log.metadata ? JSON.stringify(log.metadata) : log.action,
      performedBy: log.actorUser
        ? `${log.actorUser.firstName} ${log.actorUser.lastName} (${log.actorUser.role})`
        : "System / Member",
      timestamp: log.createdAt
        ? new Date(log.createdAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Recently",
    })),
  };
}
