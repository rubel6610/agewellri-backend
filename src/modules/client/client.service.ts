import prisma from "../../lib/prisma";
import { stripe } from "../../config/stripe";
import { formatPeriodEntitlements } from "../payment/visit-entitlement.service";
import {
  getFirstBillingDate,
  getEasternDateParts,
} from "../../utils/billing-dates.util";

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

  const unarchivedClients = (clients || []).filter(
    (c: any) => c.isArchived !== true,
  );

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

    const subscriptionStatus =
      latestSub?.status || (isSubActive ? "ACTIVE" : "PENDING");

    const isEnrolledAndPaid =
      isExecutedAgreement && (isSubActive || paymentStatus === "PAID");
    const totalVisitsAllowed = isEnrolledAndPaid
      ? c.hasCleaningAddon
        ? 18
        : 12
      : 0;
    const completedVisitsCount = 0;
    const remainingVisitsCount = isEnrolledAndPaid
      ? c.hasCleaningAddon
        ? 18
        : 12
      : 0;

    return {
      id: c.clientNumber || c.id,
      internalId: c.id,
      userId: c.userId,
      clientNumber: c.clientNumber || `AW-${c.id.slice(-4).toUpperCase()}`,
      firstName: c.user?.firstName,
      lastName: c.user?.lastName,
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
      planName: latestSub?.plan?.name || c.selectedPlan || "Unassigned",
      planCode: latestSub?.plan?.code || c.selectedPlan || "",
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
      renewalDate: safeFormatDate(
        latestSub?.nextRenewalDate &&
          getEasternDateParts(new Date(latestSub.nextRenewalDate)).day === 1 &&
          new Date(latestSub.nextRenewalDate) > (latestSub?.currentPeriodStart ? new Date(latestSub.currentPeriodStart) : new Date())
          ? latestSub.nextRenewalDate
          : latestSub?.currentPeriodStart
            ? getFirstBillingDate(new Date(latestSub.currentPeriodStart))
            : getFirstBillingDate(new Date())
      ),
      status: isEnrolledAndPaid
        ? "active"
        : isExecutedAgreement
          ? "pending_payment"
          : "pending_onboarding",
      createdAt: safeFormatDate(c.createdAt),
      // Onboarding Timeline Flags
      timeline: {
        welcomeSent: Boolean(latestInvitation || c.createdAt),
        accountCreated: true,
        signerSelected: Boolean(c.signerRole),
        emergencyContactAdded: Boolean(
          c.emergencyContactName && c.emergencyContactPhone,
        ),
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
    result = result.filter(
      (c: any) =>
        c.firstName.toLowerCase().includes(term) ||
        c.lastName.toLowerCase().includes(term) ||
        c.email.toLowerCase().includes(term) ||
        c.phone.toLowerCase().includes(term) ||
        c.clientNumber.toLowerCase().includes(term) ||
        c.address.street.toLowerCase().includes(term) ||
        c.address.city.toLowerCase().includes(term),
    );
  }

  if (query?.agreementStatus && query.agreementStatus !== "ALL") {
    result = result.filter(
      (c: any) => c.agreementStatus === query.agreementStatus,
    );
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
    orConditions.push({
      clientNumber: { contains: digits, mode: "insensitive" },
    });
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
    ["SCHEDULED", "CONFIRMED"].includes(a.status),
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
    planName: latestSub?.plan?.name || client.selectedPlan || "Unassigned",
    planCode: latestSub?.plan?.code || client.selectedPlan || "",
    hasCleaningAddon: client.hasCleaningAddon,
    onboardingStatus: client.onboardingStatus,
    onboardingStep: client.onboardingStep || 1,
    onboardingData: client.onboardingData,
    agreementStatus,
    agreementSignedDate: safeFormatDate(latestAgreement?.signedAt),
    agreementDeadline: safeFormatDate(latestAgreement?.cancellationDeadline),
    paymentStatus,
    subscriptionStatus:
      latestSub?.status || (isSubActive ? "ACTIVE" : "PENDING"),
    cardBrand: client.cardBrand,
    cardLast4: client.cardLast4,
    totalVisitsAllowed: (() => {
      const isEnrolledAndPaid =
        isExecutedAgreement && (isSubActive || paymentStatus === "PAID");
      if (!isEnrolledAndPaid) return 0;
      const currentPeriod = latestSub?.periods?.[0];
      const entitlements = formatPeriodEntitlements(
        currentPeriod,
        client.appointments || [],
      );
      if (entitlements.length > 0) {
        return entitlements.reduce((sum, item) => sum + item.allocated, 0);
      }
      return client.hasCleaningAddon ? 18 : 12;
    })(),
    completedVisitsCount: (() => {
      const isEnrolledAndPaid =
        isExecutedAgreement && (isSubActive || paymentStatus === "PAID");
      if (!isEnrolledAndPaid) return 0;
      const currentPeriod = latestSub?.periods?.[0];
      const entitlements = formatPeriodEntitlements(
        currentPeriod,
        client.appointments || [],
      );
      if (entitlements.length > 0) {
        return entitlements.reduce((sum, item) => sum + item.completed, 0);
      }
      return (
        client.appointments?.filter((a: any) => a.status === "COMPLETED")
          .length || 0
      );
    })(),
    remainingVisitsCount: (() => {
      const isEnrolledAndPaid =
        isExecutedAgreement && (isSubActive || paymentStatus === "PAID");
      if (!isEnrolledAndPaid) return 0;
      const currentPeriod = latestSub?.periods?.[0];
      const entitlements = formatPeriodEntitlements(
        currentPeriod,
        client.appointments || [],
      );
      if (entitlements.length > 0) {
        return entitlements.reduce((sum, item) => sum + item.remaining, 0);
      }
      return (
        (client.hasCleaningAddon ? 18 : 12) -
        (client.appointments?.filter((a: any) => a.status === "COMPLETED")
          .length || 0)
      );
    })(),
    visitEntitlements: (() => {
      const isEnrolledAndPaid =
        isExecutedAgreement && (isSubActive || paymentStatus === "PAID");
      if (!isEnrolledAndPaid) return [];
      const currentPeriod = latestSub?.periods?.[0];
      return formatPeriodEntitlements(currentPeriod, client.appointments || []);
    })(),
    nextVisitDate: safeFormatDate(nextAppt?.startAt),
    renewalDate: safeFormatDate(
      latestSub?.nextRenewalDate &&
        getEasternDateParts(new Date(latestSub.nextRenewalDate)).day === 1 &&
        new Date(latestSub.nextRenewalDate) > (latestSub?.currentPeriodStart ? new Date(latestSub.currentPeriodStart) : new Date())
        ? latestSub.nextRenewalDate
        : latestSub?.currentPeriodStart
          ? getFirstBillingDate(new Date(latestSub.currentPeriodStart))
          : getFirstBillingDate(new Date())
    ),
    status:
      isExecutedAgreement && (isSubActive || paymentStatus === "PAID")
        ? "active"
        : isExecutedAgreement
          ? "pending_payment"
          : "pending_onboarding",
    createdAt: safeFormatDate(client.createdAt) || "Recently",
    timeline: {
      welcomeSent: Boolean(client.invitations?.length || client.createdAt),
      accountCreated: true,
      signerSelected: Boolean(client.signerRole),
      emergencyContactAdded: Boolean(
        client.emergencyContactName && client.emergencyContactPhone,
      ),
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

export function formatAuditLogDescription(
  action: string,
  metadata: any,
): string {
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
    return p
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatRole = (r?: string) => {
    if (!r) return "";
    return r
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
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
    const deadline = data.cancellationDeadline
      ? formatDate(data.cancellationDeadline)
      : null;
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
    const price = data.totalPrice
      ? `$${Number(data.totalPrice).toFixed(2)}`
      : null;
    const method = data.billingMethod
      ? data.billingMethod === "AUTOMATIC"
        ? "billed automatically"
        : data.billingMethod.replace(/_/g, " ").toLowerCase()
      : "billed automatically";
    const invoice = data.invoiceNumber
      ? `Invoice #${data.invoiceNumber}`
      : null;
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
    const amount =
      data.amount || data.totalPrice
        ? `$${Number(data.amount || data.totalPrice).toFixed(2)}`
        : "Payment";
    const plan = data.plan ? ` for ${formatPlanName(data.plan)} plan` : "";
    const invoice = data.invoiceNumber
      ? ` (Invoice #${data.invoiceNumber})`
      : "";
    return `${amount} processed successfully${plan}${invoice}.`;
  }

  if (act.includes("REPORT_UPLOADED")) {
    const title = data.title || "Visit Report";
    const specialist = data.specialistName
      ? ` from ${data.specialistName}`
      : "";
    return `Official PDF report "${title}"${specialist} uploaded and published to member portal.`;
  }

  if (
    act.includes("APPOINTMENT_SCHEDULED") ||
    act.includes("VISIT_SCHEDULED")
  ) {
    const service = data.serviceType || "Visit";
    const date = data.date ? formatDate(data.date) : "scheduled date";
    const time = data.timeSlot ? ` (${data.timeSlot})` : "";
    const specialist = data.technicianName
      ? ` with specialist ${data.technicianName}`
      : "";
    return `${service} booked for ${date}${time}${specialist}.`;
  }

  if (
    act.includes("APPOINTMENT_COMPLETED") ||
    act.includes("VISIT_COMPLETED")
  ) {
    const service = data.serviceType || "Visit";
    return `${service} marked as completed.`;
  }

  if (
    act.includes("APPOINTMENT_CANCELLED") ||
    act.includes("VISIT_CANCELLED")
  ) {
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
      emergencyContactAdded: Boolean(
        client.emergencyContactName && client.emergencyContactPhone,
      ),
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

/**
 * Real-time Comprehensive Admin Dashboard Analytics & Overview Metrics
 */
export async function getAdminDashboardStats() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const next30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    allClients,
    upcomingAppointments,
    allAppointments,
    allAgreements,
    allInvoices,
    activeSubscriptions,
    upcomingRenewalsCount,
    allReports,
    recentAuditLogs,
  ] = await Promise.all([
    (prisma.client.findMany as any)({
      where: { isArchived: false },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { firstName: true, lastName: true, email: true, phone: true },
        },
        subscriptions: {
          where: { status: "ACTIVE" },
          take: 1,
          include: { plan: true },
        },
        agreements: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    (prisma.appointment.findMany as any)({
      where: {
        isArchived: false,
        status: { in: ["SCHEDULED", "CONFIRMED"] },
        startAt: { gte: now, lte: sevenDaysLater },
      },
      orderBy: { startAt: "asc" },
      take: 10,
      include: {
        client: { include: { user: true } },
        technician: true,
      },
    }),
    (prisma.appointment.findMany as any)({
      where: { isArchived: false },
      select: {
        id: true,
        status: true,
        startAt: true,
        clientId: true,
        serviceName: true,
        visit: { select: { id: true } },
      },
    }),
    ((prisma as any).serviceAgreement.findMany as any)({
      where: { isArchived: false },
      select: {
        id: true,
        status: true,
        state: true,
        signedAt: true,
        clientId: true,
        clientPrintedName: true,
        selectedPlan: true,
      },
    }),
    (prisma.invoice.findMany as any)({
      where: { isArchived: false },
      select: {
        id: true,
        status: true,
        amount: true,
        createdAt: true,
        paidAt: true,
      },
    }),
    (prisma.subscription.findMany as any)({
      where: { status: "ACTIVE" },
      include: { plan: true },
    }),
    prisma.subscription.count({
      where: {
        status: "ACTIVE",
        nextRenewalDate: { gte: now, lte: next30Days },
        autoRenew: true,
      },
    }),
    (prisma.report.findMany as any)({
      where: { isArchived: false },
      select: {
        id: true,
        visitId: true,
        createdAt: true,
        visit: { select: { id: true, appointmentId: true } },
      },
    }),
    (prisma.auditLog.findMany as any)({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        actorUser: {
          select: { firstName: true, lastName: true, email: true, role: true },
        },
      },
    }),
  ]);

  // Client Metrics
  const totalClients = allClients.length;
  const activeClients = allClients.filter(
    (c: any) =>
      c.onboardingStatus === "COMPLETED" ||
      c.subscriptions?.length > 0 ||
      c.agreements?.[0]?.status === "EXECUTED",
  );
  const pendingOnboarding = allClients.filter(
    (c: any) => !activeClients.some((ac: any) => ac.id === c.id),
  );
  const newClientsThisMonth = allClients.filter(
    (c: any) => new Date(c.createdAt) >= startOfMonth,
  ).length;

  // Appointment & Visit Metrics
  const completedVisits = allAppointments.filter(
    (a: any) => a.status === "COMPLETED",
  );
  const upcomingVisitsCount = upcomingAppointments.length;

  // Report Metrics
  const uploadedReportApptIds = new Set(
    allReports.map((r: any) => r.visit?.appointmentId).filter(Boolean),
  );
  const uploadedReportVisitIds = new Set(
    allReports.map((r: any) => r.visitId || r.visit?.id).filter(Boolean),
  );
  const reportsPendingCount = completedVisits.filter(
    (a: any) =>
      !uploadedReportApptIds.has(a.id) &&
      (!a.visit?.id || !uploadedReportVisitIds.has(a.visit.id)),
  ).length;

  // Agreement Metrics
  const executedAgreementsCount = allAgreements.filter(
    (a: any) =>
      a.status === "EXECUTED" || a.status === "SIGNED" || Boolean(a.signedAt),
  ).length;
  const pendingAgreementsCount = allAgreements.filter(
    (a: any) =>
      a.status === "DRAFT" || a.status === "PENDING_SIGNATURE" || !a.signedAt,
  ).length;

  // Billing & Invoices Metrics
  const paidInvoices = allInvoices.filter((i: any) => i.status === "PAID");
  const openInvoices = allInvoices.filter(
    (i: any) => i.status === "OPEN" || i.status === "DRAFT",
  );
  const totalRevenueCollected = paidInvoices.reduce(
    (sum: number, i: any) => sum + (i.amount || 0),
    0,
  );
  const totalPendingInvoicesAmount = openInvoices.reduce(
    (sum: number, i: any) => sum + (i.amount || 0),
    0,
  );

  // Plan Distribution Breakdown
  const planDistribution: Record<string, number> = {};
  allClients.forEach((c: any) => {
    const planName =
      c.subscriptions?.[0]?.plan?.name || c.selectedPlan || "Unassigned";
    planDistribution[planName] = (planDistribution[planName] || 0) + 1;
  });

  // State Jurisdiction (Rhode Island)
  const stateDistribution: Record<string, number> = { RI: allClients.length };

  // Format Attention Items dynamically
  const attentionItems: Array<{
    id: string;
    type: "AGREEMENT" | "REPORT" | "BILLING" | "ONBOARDING";
    title: string;
    description: string;
    actionLabel: string;
    actionHref: string;
    urgency: "HIGH" | "MEDIUM" | "LOW";
  }> = [];

  // 1. Pending agreements needing signature
  if (pendingAgreementsCount > 0) {
    attentionItems.push({
      id: "attn_agreements",
      type: "AGREEMENT",
      title: `${pendingAgreementsCount} Service Agreement${pendingAgreementsCount > 1 ? "s" : ""} Pending Signature`,
      description:
        "Members have not executed their state service agreements yet.",
      actionLabel: "View Agreements",
      actionHref: "/admin/agreements",
      urgency: "HIGH",
    });
  }

  // 2. Completed visits without reports
  if (reportsPendingCount > 0) {
    attentionItems.push({
      id: "attn_reports",
      type: "REPORT",
      title: `${reportsPendingCount} Completed Visit${reportsPendingCount > 1 ? "s" : ""} Missing Reports`,
      description:
        "Safety specialists have finished home visits requiring official PDF report uploads.",
      actionLabel: "View Completed Visits",
      actionHref: "/admin/appointments?tab=COMPLETED",
      urgency: "HIGH",
    });
  }

  // 3. Open invoices
  if (openInvoices.length > 0) {
    attentionItems.push({
      id: "attn_billing",
      type: "BILLING",
      title: `${openInvoices.length} Unpaid Invoice${openInvoices.length > 1 ? "s" : ""} ($${totalPendingInvoicesAmount.toFixed(2)})`,
      description: "Invoices awaiting member payment or Stripe processing.",
      actionLabel: "View Billing",
      actionHref: "/admin/billing",
      urgency: "MEDIUM",
    });
  }

  // 4. Pending onboarding
  if (pendingOnboarding.length > 0) {
    attentionItems.push({
      id: "attn_onboarding",
      type: "ONBOARDING",
      title: `${pendingOnboarding.length} Client${pendingOnboarding.length > 1 ? "s" : ""} Incomplete Onboarding`,
      description:
        "New members currently completing intake questionnaire or credentials.",
      actionLabel: "View Clients",
      actionHref: "/admin/clients",
      urgency: "LOW",
    });
  }

  return {
    kpis: {
      activeClientsCount: activeClients.length,
      totalClientsCount: totalClients,
      newClientsThisMonth,
      pendingOnboardingCount: pendingOnboarding.length,
      upcomingVisitsCount,
      completedVisitsCount: completedVisits.length,
      reportsPendingCount,
      totalReportsUploaded: allReports.length,
      executedAgreementsCount,
      pendingAgreementsCount,
      paymentsDueCount: openInvoices.length,
      totalPendingInvoicesAmount: `$${totalPendingInvoicesAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      totalRevenueCollected: `$${totalRevenueCollected.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      renewalsUpcomingCount: upcomingRenewalsCount,
      activeSubscriptionsCount: activeSubscriptions.length,
    },
    upcomingSchedule: upcomingAppointments.map((appt: any) => ({
      id: appt.id,
      clientName: appt.client?.user
        ? `${appt.client.user.firstName} ${appt.client.user.lastName}`.trim()
        : "Client",
      clientId: appt.client?.clientNumber || appt.clientId,
      serviceType: appt.serviceName || "Safety & Upkeep Visit",
      specialistName: appt.technician?.name || "Assigned Specialist",
      specialistColor: appt.technician?.color || "#294B68",
      dateFormatted: safeFormatDate(appt.startAt) || "Upcoming",
      timeSlot: appt.timeSlot || "Morning Visit",
      status: appt.status,
      address: appt.client?.address || "On File",
    })),
    recentClients: [...allClients]
      .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 6)
      .map((c: any) => ({
        id: c.clientNumber || c.id,
        internalId: c.id,
        name: `${c.user?.firstName || "Client"} ${c.user?.lastName || ""}`.trim(),
        email: c.user?.email || c.primaryContactEmail || "N/A",
        state: c.state || "RI",
        planName: (c.subscriptions?.[0]?.plan?.name || c.selectedPlan || "Unassigned")
          .replace(/\s*(Membership Statement|Manual Invoice)\s*$/i, "")
          .trim(),
        status:
          c.onboardingStatus === "ACTIVE" || c.onboardingStatus === "COMPLETED"
            ? "active"
            : c.onboardingStatus?.toLowerCase() || "pending_onboarding",
        createdAt: safeFormatDate(c.createdAt) || "Recently",
      })),
    attentionItems,
    planDistribution,
    stateDistribution,
    recentActivity: recentAuditLogs.map((log: any) => ({
      id: log.id,
      action: (log.action || "").replace(/_/g, " "),
      details: formatAuditLogDescription(log.action, log.metadata),
      performedBy: log.actorUser
        ? `${log.actorUser.firstName} ${log.actorUser.lastName}`
        : "System / Member",
      role: log.actorUser?.role || "SYSTEM",
      time: log.createdAt
        ? new Date(log.createdAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Recently",
      date: safeFormatDate(log.createdAt) || "Today",
    })),
  };
}

export interface ClientAccessMethod {
  id: string;
  type: "LOCKBOX" | "RESIDENT_ANSWERS" | "DIGITAL_CODE" | "OTHER";
  title: string;
  code?: string | null;
  instructions?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Resolves the client record for a given user ID or client ID.
 */
async function resolveClientRecord(userIdOrClientId: string) {
  return (prisma.client.findFirst as any)({
    where: {
      OR: [{ userId: userIdOrClientId }, { id: userIdOrClientId }],
    },
    include: { user: true },
  });
}

/**
 * GET Client Access Methods
 */
export async function getClientAccessMethods(userIdOrClientId: string): Promise<ClientAccessMethod[]> {
  const client = await resolveClientRecord(userIdOrClientId);
  if (!client) return [];

  let methods: ClientAccessMethod[] = [];
  if (client.accessMethods) {
    try {
      methods = typeof client.accessMethods === "string" ? JSON.parse(client.accessMethods) : (client.accessMethods as any);
    } catch {
      methods = [];
    }
  }

  // If no access methods are stored yet, generate the initial one from what was signed in the agreement
  if (!Array.isArray(methods) || methods.length === 0) {
    const defaultType: "LOCKBOX" | "RESIDENT_ANSWERS" | "DIGITAL_CODE" | "OTHER" =
      client.homeAccessType || "RESIDENT_ANSWERS";
    const defaultTitle =
      defaultType === "LOCKBOX"
        ? "Primary Home Lockbox"
        : defaultType === "DIGITAL_CODE"
        ? "Keypad Entry Code"
        : defaultType === "OTHER"
        ? "Custom Entry Method"
        : "Resident Answers Door";

    const initialMethod: ClientAccessMethod = {
      id: `acc_agreement_${client.id.slice(-6)}`,
      type: defaultType,
      title: defaultTitle,
      code: client.homeAccessCode || null,
      instructions: client.homeAccessInstructions || null,
      isDefault: true,
      createdAt: client.createdAt ? new Date(client.createdAt).toISOString() : new Date().toISOString(),
    };

    methods = [initialMethod];

    // Persist default into client record
    await (prisma.client.update as any)({
      where: { id: client.id },
      data: {
        accessMethods: methods as any,
      },
    });
  }

  return methods;
}

/**
 * ADD Client Access Method
 */
export async function addClientAccessMethod(
  userIdOrClientId: string,
  input: {
    type: "LOCKBOX" | "RESIDENT_ANSWERS" | "DIGITAL_CODE" | "OTHER";
    title: string;
    code?: string | null;
    instructions?: string | null;
    isDefault?: boolean;
  }
): Promise<{ success: boolean; method: ClientAccessMethod; accessMethods: ClientAccessMethod[] }> {
  const client = await resolveClientRecord(userIdOrClientId);
  if (!client) throw new Error("Client record not found.");

  const currentMethods = await getClientAccessMethods(client.id);
  const isFirst = currentMethods.length === 0;
  const isDefault = input.isDefault ?? isFirst;

  const newMethod: ClientAccessMethod = {
    id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: input.type,
    title: input.title.trim() || "Home Access Method",
    code: input.code?.trim() || null,
    instructions: input.instructions?.trim() || null,
    isDefault,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const updatedMethods = currentMethods.map((m) =>
    isDefault ? { ...m, isDefault: false } : m
  );
  updatedMethods.push(newMethod);

  const clientUpdate: any = { accessMethods: updatedMethods as any };
  if (isDefault) {
    clientUpdate.homeAccessType = newMethod.type;
    clientUpdate.homeAccessInstructions = newMethod.instructions;
    clientUpdate.homeAccessCode = newMethod.code;
  }

  await (prisma.client.update as any)({
    where: { id: client.id },
    data: clientUpdate,
  });

  return { success: true, method: newMethod, accessMethods: updatedMethods };
}

/**
 * UPDATE Client Access Method
 */
export async function updateClientAccessMethod(
  userIdOrClientId: string,
  methodId: string,
  input: Partial<{
    type: "LOCKBOX" | "RESIDENT_ANSWERS" | "DIGITAL_CODE" | "OTHER";
    title: string;
    code?: string | null;
    instructions?: string | null;
    isDefault?: boolean;
  }>
): Promise<{ success: boolean; method: ClientAccessMethod; accessMethods: ClientAccessMethod[] }> {
  const client = await resolveClientRecord(userIdOrClientId);
  if (!client) throw new Error("Client record not found.");

  const currentMethods = await getClientAccessMethods(client.id);
  const index = currentMethods.findIndex((m) => m.id === methodId);
  if (index === -1) throw new Error(`Access method with ID "${methodId}" not found.`);

  const existing = currentMethods[index];
  const isDefault = input.isDefault !== undefined ? input.isDefault : existing.isDefault;

  const updatedMethod: ClientAccessMethod = {
    ...existing,
    type: input.type || existing.type,
    title: input.title !== undefined ? input.title.trim() : existing.title,
    code: input.code !== undefined ? (input.code?.trim() || null) : existing.code,
    instructions: input.instructions !== undefined ? (input.instructions?.trim() || null) : existing.instructions,
    isDefault,
    updatedAt: new Date().toISOString(),
  };

  const updatedMethods = currentMethods.map((m) => {
    if (m.id === methodId) return updatedMethod;
    if (isDefault) return { ...m, isDefault: false };
    return m;
  });

  const clientUpdate: any = { accessMethods: updatedMethods as any };
  if (isDefault) {
    clientUpdate.homeAccessType = updatedMethod.type;
    clientUpdate.homeAccessInstructions = updatedMethod.instructions;
    clientUpdate.homeAccessCode = updatedMethod.code;
  }

  await (prisma.client.update as any)({
    where: { id: client.id },
    data: clientUpdate,
  });

  return { success: true, method: updatedMethod, accessMethods: updatedMethods };
}

/**
 * DELETE Client Access Method
 */
export async function deleteClientAccessMethod(
  userIdOrClientId: string,
  methodId: string
): Promise<{ success: boolean; accessMethods: ClientAccessMethod[] }> {
  const client = await resolveClientRecord(userIdOrClientId);
  if (!client) throw new Error("Client record not found.");

  const currentMethods = await getClientAccessMethods(client.id);
  const target = currentMethods.find((m) => m.id === methodId);
  if (!target) throw new Error(`Access method with ID "${methodId}" not found.`);

  let updatedMethods = currentMethods.filter((m) => m.id !== methodId);

  // If deleted method was default and others remain, make the first one default
  if (target.isDefault && updatedMethods.length > 0) {
    updatedMethods[0] = { ...updatedMethods[0], isDefault: true };
  }

  const clientUpdate: any = { accessMethods: updatedMethods as any };
  if (updatedMethods.length > 0) {
    const defaultMethod = updatedMethods.find((m) => m.isDefault) || updatedMethods[0];
    clientUpdate.homeAccessType = defaultMethod.type;
    clientUpdate.homeAccessInstructions = defaultMethod.instructions;
    clientUpdate.homeAccessCode = defaultMethod.code;
  }

  await (prisma.client.update as any)({
    where: { id: client.id },
    data: clientUpdate,
  });

  return { success: true, accessMethods: updatedMethods };
}

/**
 * SET Default Access Method
 */
export async function setDefaultClientAccessMethod(
  userIdOrClientId: string,
  methodId: string
): Promise<{ success: boolean; accessMethods: ClientAccessMethod[] }> {
  return updateClientAccessMethod(userIdOrClientId, methodId, { isDefault: true });
}

/**
 * DELETE Admin Client
 * Permanently removes a client, their user account, all associated resources, and cancels active subscriptions.
 * Frees the email so the client can re-register from scratch if needed.
 */
export async function deleteAdminClient(
  adminUserId: string,
  clientIdOrNumber: string
): Promise<{
  success: boolean;
  message: string;
  deletedClient: { id: string; clientNumber: string; email: string };
}> {
  const trimmed = (clientIdOrNumber || "").trim();
  if (!trimmed) {
    throw new Error("Client ID or Client Number is required.");
  }

  // 1. Build flexible search conditions to match by clientNumber (e.g. AW-1046), ObjectId, or userId
  const orConditions: any[] = [
    { clientNumber: trimmed },
    { clientNumber: { equals: trimmed, mode: "insensitive" } },
    { clientNumber: { contains: trimmed, mode: "insensitive" } },
    { user: { email: { equals: trimmed, mode: "insensitive" } } },
    { primaryContactEmail: { equals: trimmed, mode: "insensitive" } },
    { emergencyContactEmail: { equals: trimmed, mode: "insensitive" } },
  ];

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 3) {
    orConditions.push({ clientNumber: `AW-${digits}` });
    orConditions.push({
      clientNumber: { contains: digits, mode: "insensitive" },
    });
  }

  if (isValidObjectId(trimmed)) {
    orConditions.unshift({ id: trimmed });
    orConditions.push({ userId: trimmed });
  }

  // Fetch full client record
  const client = await (prisma.client.findFirst as any)({
    where: {
      OR: orConditions,
    },
    include: {
      user: true,
      subscriptions: true,
      appointments: true,
      agreements: true,
      invoices: true,
      payments: true,
      reports: true,
      familyMembers: true,
      invitations: true,
    },
  });

  if (!client) {
    throw new Error(`Client "${clientIdOrNumber}" was not found.`);
  }

  const realClientId = client.id;
  const userId = client.userId;
  const clientEmail = client.user?.email || "";
  const clientNumber = client.clientNumber || "";

  // 2. Cancel active Stripe subscriptions if any
  if (client.subscriptions && client.subscriptions.length > 0) {
    for (const sub of client.subscriptions) {
      if (sub.stripeSubscriptionId) {
        try {
          await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
        } catch (stripeErr: any) {
          console.warn(
            `[deleteAdminClient] Stripe subscription cancel warning for ${sub.stripeSubscriptionId}:`,
            stripeErr.message
          );
        }
      }
    }
  }

  // 3. Cascade delete all linked records in proper dependency order
  const subscriptionIds = (client.subscriptions || []).map((s: any) => s.id);
  const appointmentIds = (client.appointments || []).map((a: any) => a.id);

  // A. Get subscription period IDs
  let periodIds: string[] = [];
  if (subscriptionIds.length > 0) {
    const periods = await (prisma.subscriptionPeriod.findMany as any)({
      where: { subscriptionId: { in: subscriptionIds } },
      select: { id: true },
    });
    periodIds = periods.map((p: any) => p.id);
  }

  // B. Get visit IDs for appointments
  let visitIds: string[] = [];
  if (appointmentIds.length > 0) {
    const visits = await (prisma.visit.findMany as any)({
      where: { appointmentId: { in: appointmentIds } },
      select: { id: true },
    });
    visitIds = visits.map((v: any) => v.id);
  }

  // C. Get assessment IDs for visits
  let assessmentIds: string[] = [];
  if (visitIds.length > 0) {
    const assessments = await (prisma.assessment.findMany as any)({
      where: { visitId: { in: visitIds } },
      select: { id: true },
    });
    assessmentIds = assessments.map((a: any) => a.id);
  }

  // Delete AssessmentResponses
  if (assessmentIds.length > 0) {
    await (prisma.assessmentResponse.deleteMany as any)({
      where: { assessmentId: { in: assessmentIds } },
    });
  }

  // Delete Assessments
  if (visitIds.length > 0) {
    await (prisma.assessment.deleteMany as any)({
      where: { visitId: { in: visitIds } },
    });
  }

  // Delete Reports
  await (prisma.report.deleteMany as any)({
    where: {
      OR: [
        { clientId: realClientId },
        ...(visitIds.length > 0 ? [{ visitId: { in: visitIds } }] : []),
      ],
    },
  });

  // Delete CalendarEvents
  if (appointmentIds.length > 0) {
    await (prisma.calendarEvent.deleteMany as any)({
      where: { appointmentId: { in: appointmentIds } },
    });
  }

  // Delete Visits
  if (appointmentIds.length > 0) {
    await (prisma.visit.deleteMany as any)({
      where: { appointmentId: { in: appointmentIds } },
    });
  }

  // Delete Appointments
  await (prisma.appointment.deleteMany as any)({
    where: { clientId: realClientId },
  });

  // Delete Renewals
  if (subscriptionIds.length > 0) {
    await (prisma.renewal.deleteMany as any)({
      where: { subscriptionId: { in: subscriptionIds } },
    });
  }

  // Delete VisitAllocations
  if (periodIds.length > 0) {
    await (prisma.visitAllocation.deleteMany as any)({
      where: { subscriptionPeriodId: { in: periodIds } },
    });
  }

  // Delete SubscriptionPeriods
  if (subscriptionIds.length > 0) {
    await (prisma.subscriptionPeriod.deleteMany as any)({
      where: { subscriptionId: { in: subscriptionIds } },
    });
  }

  // Delete BillingNotificationLogs
  if (subscriptionIds.length > 0) {
    await (prisma.billingNotificationLog.deleteMany as any)({
      where: { subscriptionId: { in: subscriptionIds } },
    });
  }

  // Delete Invoices & Payments
  await (prisma.payment.deleteMany as any)({
    where: { clientId: realClientId },
  });

  await (prisma.invoice.deleteMany as any)({
    where: { clientId: realClientId },
  });

  // Delete Subscriptions
  await (prisma.subscription.deleteMany as any)({
    where: { clientId: realClientId },
  });

  // Delete ServiceAgreements
  await (prisma.serviceAgreement.deleteMany as any)({
    where: { clientId: realClientId },
  });

  // Delete FamilyMembers
  await (prisma.familyMember.deleteMany as any)({
    where: { clientId: realClientId },
  });

  // Delete Invitations
  await (prisma.invitation.deleteMany as any)({
    where: {
      OR: [
        { clientId: realClientId },
        ...(clientEmail
          ? [{ email: { equals: clientEmail, mode: "insensitive" } }]
          : []),
      ],
    },
  });

  // Delete User Notifications
  if (userId) {
    await (prisma.notification.deleteMany as any)({
      where: { userId },
    });
  }

  // Delete Client Profile
  await (prisma.client.delete as any)({
    where: { id: realClientId },
  });

  // Delete User Account (frees email and removes credentials)
  if (userId) {
    await (prisma.user.delete as any)({
      where: { id: userId },
    });
  }

  // Record an administrative audit log
  if (adminUserId) {
    try {
      await (prisma.auditLog.create as any)({
        data: {
          actorUserId: adminUserId,
          action: "CLIENT_PERMANENTLY_DELETED",
          entityType: "CLIENT",
          entityId: realClientId,
          metadata: {
            clientNumber,
            email: clientEmail,
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (auditErr: any) {
      console.warn("[deleteAdminClient] Audit log warning:", auditErr.message);
    }
  }

  return {
    success: true,
    message: `Client ${clientNumber || ""} (${clientEmail}) and all associated resources were permanently deleted.`,
    deletedClient: {
      id: realClientId,
      clientNumber,
      email: clientEmail,
    },
  };
}


