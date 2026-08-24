import prisma from "../../lib/prisma";
import {
  BillingInterval,
  BillingMethod,
  NotificationType,
  SubscriptionStatus,
} from "@prisma/client";
import {
  sendBillingRenewalReminderEmail,
  sendInvoiceGeneratedEmail,
} from "../../utils/email";

/**
 * Core Renewal Reminder Processor.
 * Evaluates all active subscriptions and dispatches 7/14/30-day notices with strict duplicate protection.
 */
export async function checkAndSendRenewalReminders() {
  const now = new Date();
  console.log(`\n⏰ [RENEWAL SCHEDULER] Running renewal reminder checks at ${now.toISOString()}...`);

  try {
    // 1. Fetch all active subscriptions with upcoming renewal dates
    const subscriptions: any[] = await (prisma.subscription.findMany as any)({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, "ACTIVE"] },
        nextRenewalDate: {
          not: null,
          gte: now, // Must be today or future
        },
      },
      include: {
        client: {
          include: {
            user: true,
          },
        },
        plan: true,
        planVersion: true,
      },
    });

    let remindersSent = 0;
    let duplicateSkipped = 0;

    for (const sub of subscriptions) {
      if (!sub.nextRenewalDate || !sub.client || !sub.client.user) continue;

      const renewalDate = new Date(sub.nextRenewalDate);
      const diffMs = renewalDate.getTime() - now.getTime();
      const daysUntilRenewal = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      const interval = (sub.billingInterval || "QUARTERLY") as BillingInterval;

      // Determine reminder threshold window based on interval
      let thresholdDays = 14; // Default Quarterly = 14 days
      if (interval === BillingInterval.MONTHLY) {
        thresholdDays = 7;
      } else if (interval === BillingInterval.ANNUAL) {
        thresholdDays = 30;
      }

      // Check if subscription falls within notification threshold
      if (daysUntilRenewal > thresholdDays || daysUntilRenewal < 0) {
        continue;
      }

      const clientUser = sub.client.user;
      const clientName = `${clientUser.firstName || ""} ${clientUser.lastName || ""}`.trim() || "Valued Client";
      const planName = sub.planVersion?.name || sub.plan?.name || "Service Plan";
      const contractedPrice = sub.contractedPrice ?? sub.planVersion?.price ?? sub.plan?.price ?? 0;

      // Determine recipients: Primary client and designated authorized contact
      const recipients: { email: string; role: string; name?: string }[] = [];
      if (clientUser.email) {
        recipients.push({ email: clientUser.email, role: "CLIENT" });
      }

      if (sub.client.primaryContactEmail && sub.client.primaryContactEmail !== clientUser.email) {
        recipients.push({
          email: sub.client.primaryContactEmail,
          role: "REPRESENTATIVE",
          name: sub.client.primaryContactName || "Authorized Representative",
        });
      }

      for (const recipient of recipients) {
        // 2. Check duplicate log in BillingNotificationLog
        const existingLog = await (prisma as any).billingNotificationLog.findFirst({
          where: {
            subscriptionId: sub.id,
            notificationType: NotificationType.RENEWAL_REMINDER,
            recipientEmail: recipient.email,
            scheduledRenewalDate: renewalDate,
          },
        });

        if (existingLog) {
          duplicateSkipped++;
          continue;
        }

        // 3. Send dynamic reminder email
        try {
          const emailRes = await sendBillingRenewalReminderEmail({
            to: recipient.email,
            clientName,
            representativeName: recipient.role === "REPRESENTATIVE" ? recipient.name : undefined,
            planName,
            renewalDate,
            recurringPrice: contractedPrice,
            billingInterval: interval,
            billingMethod: sub.billingMethod || "AUTOMATIC",
            cardBrand: sub.client.cardBrand || "Card",
            cardLast4: sub.client.cardLast4 || "••••",
            daysBeforeNotice: daysUntilRenewal,
          });

          // 4. Record BillingNotificationLog to prevent duplicate sends
          await (prisma as any).billingNotificationLog.create({
            data: {
              subscriptionId: sub.id,
              notificationType: NotificationType.RENEWAL_REMINDER,
              recipientEmail: recipient.email,
              recipientRole: recipient.role,
              billingInterval: interval,
              scheduledRenewalDate: renewalDate,
              daysBeforeNotice: daysUntilRenewal,
              status: emailRes.success ? "SENT" : "FAILED",
              messageId: emailRes.messageId || null,
            },
          });

          // 5. Write Audit Log
          try {
            await (prisma.auditLog.create as any)({
              data: {
                actorUserId: null,
                action: "RENEWAL_REMINDER_SENT",
                entityType: "Subscription",
                entityId: sub.id,
                metadata: {
                  recipient: recipient.email,
                  daysBefore: daysUntilRenewal,
                  scheduledRenewalDate: renewalDate,
                  plan: planName,
                  amount: contractedPrice,
                },
              },
            });
          } catch {}

          remindersSent++;
        } catch (sendErr: any) {
          console.error(`❌ Failed sending reminder to ${recipient.email}:`, sendErr.message);
        }
      }
    }

    console.log(
      `✅ [RENEWAL SCHEDULER] Check completed. ${remindersSent} reminders sent, ${duplicateSkipped} duplicates skipped.`
    );

    return {
      success: true,
      remindersSent,
      duplicateSkipped,
      checkedAt: now,
    };
  } catch (err: any) {
    console.error("❌ [RENEWAL SCHEDULER] Error during reminder run:", err);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Start the background scheduler loop.
 * Runs on boot and every 6 hours thereafter.
 */
let schedulerIntervalId: NodeJS.Timeout | null = null;

export function initRenewalScheduler() {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
  }

  // Run initial check 10 seconds after server startup
  setTimeout(() => {
    checkAndSendRenewalReminders().catch((e) =>
      console.warn("⚠️ Initial scheduler check notice:", e.message)
    );
  }, 10000);

  // Run recurring check every 6 hours (21,600,000 ms)
  schedulerIntervalId = setInterval(() => {
    checkAndSendRenewalReminders().catch((e) =>
      console.warn("⚠️ Scheduled reminder notice:", e.message)
    );
  }, 6 * 60 * 60 * 1000);

  console.log("⏰ [RENEWAL SCHEDULER] Background renewal reminder scheduler initialized (every 6 hours).");
}
