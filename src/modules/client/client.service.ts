import prisma from "../../lib/prisma";
import { formatPeriodEntitlements } from "../payment/visit-entitlement.service";

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

    const isEnrolledAndPaid = isExecutedAgreement && (isSubActive || paymentStatus === "PAID");
    const totalVisitsAllowed = isEnrolledAndPaid ? (c.hasCleaningAddon ? 18 : 12) : 0;
    const completedVisitsCount = 0;
    const remainingVisitsCount = isEnrolledAndPaid ? (c.hasCleaningAddon ? 18 : 12) : 0;

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
      totalVisitsAllowed,
      completedVisitsCount,
      remainingVisitsCount,
      nextVisitDate: safeFormatDate(nextAppt?.startAt),
      renewalDate: safeFormatDate(latestSub?.currentPeriodEnd),
      status: isEnrolledAndPaid ? "active" : isExecutedAgreement ? "pending_payment" : "pending_onboarding",
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
          periods: {
            orderBy: { startDate: "desc" },
            include: {
              allocations: true,
            },
          },
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
    totalVisitsAllowed: (() => {
      const isEnrolledAndPaid = isExecutedAgreement && (isSubActive || paymentStatus === "PAID");
      if (!isEnrolledAndPaid) return 0;
      const currentPeriod = latestSub?.periods?.[0];
      const entitlements = formatPeriodEntitlements(currentPeriod, client.appointments || []);
      if (entitlements.length > 0) {
        return entitlements.reduce((sum, item) => sum + item.allocated, 0);
      }
      return client.hasCleaningAddon ? 18 : 12;
    })(),
    completedVisitsCount: (() => {
      const isEnrolledAndPaid = isExecutedAgreement && (isSubActive || paymentStatus === "PAID");
      if (!isEnrolledAndPaid) return 0;
      const currentPeriod = latestSub?.periods?.[0];
      const entitlements = formatPeriodEntitlements(currentPeriod, client.appointments || []);
      if (entitlements.length > 0) {
        return entitlements.reduce((sum, item) => sum + item.completed, 0);
      }
      return client.appointments?.filter((a: any) => a.status === "COMPLETED").length || 0;
    })(),
    remainingVisitsCount: (() => {
      const isEnrolledAndPaid = isExecutedAgreement && (isSubActive || paymentStatus === "PAID");
      if (!isEnrolledAndPaid) return 0;
      const currentPeriod = latestSub?.periods?.[0];
      const entitlements = formatPeriodEntitlements(currentPeriod, client.appointments || []);
      if (entitlements.length > 0) {
        return entitlements.reduce((sum, item) => sum + item.remaining, 0);
      }
      return (client.hasCleaningAddon ? 18 : 12) - (client.appointments?.filter((a: any) => a.status === "COMPLETED").length || 0);
    })(),
    visitEntitlements: (() => {
      const isEnrolledAndPaid = isExecutedAgreement && (isSubActive || paymentStatus === "PAID");
      if (!isEnrolledAndPaid) return [];
      const currentPeriod = latestSub?.periods?.[0];
      return formatPeriodEntitlements(currentPeriod, client.appointments || []);
    })(),
    nextVisitDate: safeFormatDate(nextAppt?.startAt),
    renewalDate: safeFormatDate(latestSub?.currentPeriodEnd),
    status: isExecutedAgreement && (isSubActive || paymentStatus === "PAID") ? "active" : isExecutedAgreement ? "pending_payment" : "pending_onboarding",
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
  };
}

export function formatAuditLogDescription(action: string, metadata: any): string {
  if (!metadata) {
    return (action || "")
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  let data = metadata;
  if (typeof metadata === "string") {
    try {
      data = JSON.parse(metadata);
    } catch {
      return metadata;
    }
  }

  if (typeof data !== "object" || data === null) {
    return String(data);
  }

  const act = (action || "").toUpperCase().replace(/[\s_-]+/g, "_");

  const formatDate = (val: any) => {
    if (!val) return "";
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return String(val);
    }
  };

  const formatPlanName = (p?: string) => {
    if (!p) return "Membership";
    return p.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatRole = (r?: string) => {
    if (!r) return "";
    return r.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const stateNames: Record<string, string> = {
    RI: "Rhode Island",
    MA: "Massachusetts",
    CT: "Connecticut",
  };

  if (act.includes("AGREEMENT_EXECUTED")) {
    const signer = data.signerName || "Member";
    const role = formatRole(data.signerRole);
    const state = stateNames[data.state] || data.state || "Rhode Island";
    const deadline = data.cancellationDeadline ? formatDate(data.cancellationDeadline) : null;
    let text = `Service agreement executed for ${state} by ${signer}${role ? ` (${role})` : ""}.`;
    if (deadline) {
      text += ` Statutory cancellation deadline: ${deadline}.`;
    }
    return text;
  }

  if (act.includes("AGREEMENT_CREATED") || act.includes("AGREEMENT_SENT")) {
    const state = stateNames[data.state] || data.state || "Rhode Island";
    const version = data.templateVersion || "v2.0";
    return `Client service agreement initiated (${version} for ${state}).`;
  }

  if (act.includes("SUBSCRIPTION_ACTIVATED")) {
    const plan = formatPlanName(data.plan);
    const price = data.totalPrice ? `$${Number(data.totalPrice).toFixed(2)}` : null;
    const method = data.billingMethod
      ? data.billingMethod === "AUTOMATIC"
        ? "billed automatically"
        : data.billingMethod.replace(/_/g, " ").toLowerCase()
      : "billed automatically";
    const invoice = data.invoiceNumber ? `Invoice #${data.invoiceNumber}` : null;
    const parts = [
      `${plan} plan subscription activated`,
      price ? `(${price} / ${method})` : null,
      invoice ? `• ${invoice}` : null,
    ].filter(Boolean);
    return parts.join(" ");
  }

  if (act.includes("PAYMENT_STARTED")) {
    const plan = formatPlanName(data.plan);
    const addon = data.hasCleaningAddon ? " with House Cleaning add-on" : "";
    return `Payment checkout initiated for ${plan} plan${addon}.`;
  }

  if (act.includes("PAYMENT_PROCESSED") || act.includes("PAYMENT_SUCCEEDED")) {
    const amount = data.amount || data.totalPrice ? `$${Number(data.amount || data.totalPrice).toFixed(2)}` : "Payment";
    const plan = data.plan ? ` for ${formatPlanName(data.plan)} plan` : "";
    const invoice = data.invoiceNumber ? ` (Invoice #${data.invoiceNumber})` : "";
    return `${amount} processed successfully${plan}${invoice}.`;
  }

  if (act.includes("REPORT_UPLOADED")) {
    const title = data.title || "Visit Report";
    const specialist = data.specialistName ? ` from ${data.specialistName}` : "";
    return `Official PDF report "${title}"${specialist} uploaded and published to member portal.`;
  }

  if (act.includes("APPOINTMENT_SCHEDULED") || act.includes("VISIT_SCHEDULED")) {
    const service = data.serviceType || "Visit";
    const date = data.date ? formatDate(data.date) : "scheduled date";
    const time = data.timeSlot ? ` (${data.timeSlot})` : "";
    const specialist = data.technicianName ? ` with specialist ${data.technicianName}` : "";
    return `${service} booked for ${date}${time}${specialist}.`;
  }

  if (act.includes("APPOINTMENT_COMPLETED") || act.includes("VISIT_COMPLETED")) {
    const service = data.serviceType || "Visit";
    return `${service} marked as completed.`;
  }

  if (act.includes("APPOINTMENT_CANCELLED") || act.includes("VISIT_CANCELLED")) {
    const reason = data.reason ? ` Reason: ${data.reason}` : "";
    return `Visit appointment was cancelled.${reason}`;
  }

  if (act.includes("INVITATION_SENT")) {
    const email = data.email ? ` to ${data.email}` : "";
    return `Onboarding welcome invitation sent${email}.`;
  }

  if (act.includes("ACCOUNT_CREATED") || act.includes("USER_REGISTERED")) {
    return `Member user account registration completed.`;
  }

  // Generic fallback: strip IDs and format dates nicely
  const cleanParts: string[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (
      key.toLowerCase().endsWith("id") ||
      key.toLowerCase() === "id" ||
      key.toLowerCase().includes("token") ||
      key.toLowerCase().includes("hash")
    ) {
      continue;
    }

    if (val === null || val === undefined || val === "") continue;

    const label = key
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());

    if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val)) {
      cleanParts.push(`${label}: ${formatDate(val)}`);
    } else if (typeof val === "boolean") {
      cleanParts.push(val ? label : `No ${label}`);
    } else if (
      typeof val === "number" &&
      (key.toLowerCase().includes("price") ||
        key.toLowerCase().includes("amount") ||
        key.toLowerCase().includes("cost"))
    ) {
      cleanParts.push(`${label}: $${val.toFixed(2)}`);
    } else if (typeof val === "object") {
      continue;
    } else {
      const formattedVal = String(val).replace(/_/g, " ");
      cleanParts.push(`${label}: ${formattedVal}`);
    }
  }

  if (cleanParts.length > 0) {
    return cleanParts.join(" • ");
  }

  return (action || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format Admin Client Detailed View
 */
export function formatClientDetail(client: any, auditLogs: any[] = []): any {
  const latestAgreement = client.agreements?.[0] || null;
  const isExecutedAgreement = latestAgreement?.status === "EXECUTED";

  const isSubActive =
    client.subscriptionStatus === "ACTIVE" ||
    client.subscriptions?.some((s: any) => s.status === "ACTIVE");

  const paymentStatus =
    client.invoices?.some((i: any) => i.status === "PAID") ||
    client.paymentStatus === "PAID"
      ? "PAID"
      : client.paymentStatus || "PENDING";

  return {
    ...client,
    timeline: {
      welcomeSent: true,
      accountCreated: Boolean(client.user?.id),
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
      details: formatAuditLogDescription(log.action, log.metadata),
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
