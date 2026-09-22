import nodemailer from "nodemailer";

interface SendOtpEmailOptions {
  to: string;
  name?: string;
  otp: string;
  expiresInMinutes?: number;
}

export interface SendRenewalReminderEmailOptions {
  to: string;
  clientName: string;
  representativeName?: string;
  planName: string;
  renewalDate: Date;
  recurringPrice: number;
  billingInterval: "MONTHLY" | "ONE_TIME" | string;
  billingMethod: "AUTOMATIC" | "INVOICE" | string;
  cardBrand?: string;
  cardLast4?: string;
  daysBeforeNotice: number;
  portalUrl?: string;
  supportPhone?: string;
  supportEmail?: string;
}

export interface SendPaymentSuccessEmailOptions {
  to: string;
  clientName: string;
  planName: string;
  amount: number;
  currency?: string;
  paidAt: Date;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  nextRenewalDate?: Date | null;
  invoiceNumber?: string;
  receiptUrl?: string;
  portalUrl?: string;
}

export interface SendPaymentFailureEmailOptions {
  to: string;
  clientName: string;
  planName: string;
  amount: number;
  failedAt: Date;
  failureReason?: string;
  portalUrl?: string;
}

export interface SendInvoiceGeneratedEmailOptions {
  to: string;
  clientName: string;
  invoiceNumber: string;
  planName: string;
  amount: number;
  dueDate: Date;
  paymentUrl?: string;
  portalUrl?: string;
}

export interface SendAdminBillingAlertOptions {
  adminEmail?: string;
  alertType: "PAYMENT_FAILED" | "RENEWAL_FAILED" | "INVOICE_OVERDUE";
  clientName: string;
  clientEmail: string;
  clientNumber?: string;
  planName: string;
  amount: number;
  details?: string;
}

export interface SendPlanPurchaseConfirmationEmailOptions {
  to: string | string[];
  clientName: string;
  clientNumber?: string;
  signerName?: string;
  signerRole?: string;
  serviceAddress?: string;
  planName: string;
  planCode?: string;
  planDescription?: string;
  features?: string[];
  services?: Array<{
    serviceName: string;
    allocatedVisits: number;
    unit?: string;
    description?: string;
  }>;
  hasCleaningAddon?: boolean;
  amount: number;
  currency?: string;
  billingInterval?: "MONTHLY" | "ONE_TIME" | string;
  billingMethod?: "AUTOMATIC" | "INVOICE" | string;
  paymentStatus?: "PAID" | "PENDING_INVOICE" | string;
  cardBrand?: string;
  cardLast4?: string;
  invoiceNumber?: string;
  paidAt?: Date | null;
  coveragePeriodStart?: Date | null;
  coveragePeriodEnd?: Date | null;
  nextRenewalDate?: Date | null;
  cancellationDeadline?: Date | null;
  cancellationDeadlineRule?: string | null;
  portalUrl?: string;
  supportPhone?: string;
  supportEmail?: string;
}

/**
 * Configure Nodemailer Transporter
 */
function createTransporter() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }

  return null;
}

function getDefaultFromAddress(senderTitle = "AgeWellRI LLC") {
  return (
    process.env.SMTP_FROM ||
    process.env.EMAIL_FROM ||
    `"${senderTitle}" <${process.env.SMTP_USER || process.env.EMAIL_USER || "agewellri@gmail.com"}>`
  );
}

/**
 * Common Base HTML Template Wrapper
 */
function wrapHtmlEmail(title: string, contentHtml: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F0F5F9; margin: 0; padding: 24px; color: #243746; }
          .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #D9E4EC; box-shadow: 0 4px 16px rgba(36,55,70,0.06); }
          .header { background-color: #243746; padding: 28px 24px; text-align: center; color: #ffffff; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 900; letter-spacing: -0.5px; }
          .header p { margin: 6px 0 0 0; font-size: 13px; color: #5E8FB2; font-weight: 500; }
          .content { padding: 32px 28px; text-align: left; }
          .greeting { font-size: 17px; font-weight: 800; color: #243746; margin-bottom: 12px; }
          .message { font-size: 14px; color: #475569; line-height: 1.65; margin-bottom: 24px; }
          .highlight-card { background: #F0F5F9; border: 1px solid #D9E4EC; border-radius: 14px; padding: 20px; margin: 20px 0; }
          .item-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 13px; }
          .item-row:last-child { margin-bottom: 0; }
          .item-label { color: #64748B; font-weight: 600; }
          .item-val { color: #243746; font-weight: 800; text-align: right; }
          .btn-primary { display: inline-block; background-color: #294B68; color: #ffffff !important; font-size: 14px; font-weight: 700; text-decoration: none; padding: 14px 28px; border-radius: 12px; margin: 12px 0 20px 0; text-align: center; }
          .btn-secondary { display: inline-block; background-color: #EAF3F8; color: #294B68 !important; font-size: 13px; font-weight: 700; text-decoration: none; padding: 10px 20px; border-radius: 10px; margin-top: 8px; }
          .footer { background-color: #F8FAFC; border-top: 1px solid #D9E4EC; padding: 24px 20px; font-size: 11px; color: #94A3B8; text-align: center; line-height: 1.6; }
          .footer a { color: #5E8FB2; text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>AgeWellRI</h1>
            <p>Home Safety Coordination</p>
          </div>
          <div class="content">
            ${contentHtml}
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} AgeWellRI LLC. Westerly, Rhode Island.<br>
            Questions? Contact Support: <a href="mailto:agewellri@gmail.com">agewellri@gmail.com</a> | (401) 212-3002
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Send Password Reset OTP Email
 */
export async function sendPasswordResetOtpEmail({
  to,
  name,
  otp,
  expiresInMinutes = 10,
}: SendOtpEmailOptions): Promise<{
  success: boolean;
  messageId?: string;
  mode: "smtp" | "console";
}> {
  const from = getDefaultFromAddress("AgeWellRI Security");
  const displayName = name || "Valued Member";

  const content = `
    <div class="greeting">Hello ${displayName},</div>
    <div class="message">
      We received a request to reset the password for your AgeWellRI account. Please use the 6-digit verification code below to complete the password reset process.
    </div>
    
    <div style="background: #EAF3F8; border: 2px dashed #5E8FB2; border-radius: 12px; padding: 18px; margin: 24px 0; text-align: center;">
      <div style="font-size: 11px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Verification OTP Code</div>
      <div style="font-family: 'Courier New', monospace; font-size: 32px; font-weight: 800; color: #243746; letter-spacing: 8px; margin: 0;">${otp}</div>
      <div style="font-size: 12px; color: #C95C5C; font-weight: 600; margin-top: 8px;">Expires in ${expiresInMinutes} minutes</div>
    </div>

    <div class="message" style="font-size: 12px; color: #94A3B8; margin-top: 20px;">
      If you did not request a password reset, please ignore this email or contact support if you suspect unauthorized activity.
    </div>
  `;

  const htmlContent = wrapHtmlEmail("Password Reset Code", content);

  console.log(`\n======================================================`);
  console.log(`🔑 [EMAIL SERVICE] Password Reset OTP for ${to}: ${otp}`);
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from,
        to,
        subject: `Your AgeWellRI Password Reset Code`,
        text: `Your AgeWellRI password reset code is: ${otp}. This code will expire in ${expiresInMinutes} minutes.`,
        html: htmlContent,
      });

      console.log(
        `[EMAIL SERVICE] OTP sent to ${to}, MessageID: ${info.messageId}`,
      );
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (error: any) {
      console.warn(`[EMAIL SERVICE] SMTP error: ${error.message}`);
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

/**
 * 7/14/30-Day Automated Renewal Reminder Email
 */
export async function sendBillingRenewalReminderEmail(
  options: SendRenewalReminderEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    clientName,
    representativeName,
    planName,
    renewalDate,
    recurringPrice,
    billingInterval,
    billingMethod,
    cardBrand,
    cardLast4,
    daysBeforeNotice,
    portalUrl = process.env.FRONTEND_URL || "0",
    supportPhone = "(401) 212-3002",
    supportEmail = "agewellri@gmail.com",
  } = options;

  const formattedDate = new Date(renewalDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const intervalLabel =
    billingInterval === "ONE_TIME" ? "One-Time Service" : "Monthly";

  const isAuto = billingMethod === "AUTOMATIC";

  const subject =
    billingInterval === "ONE_TIME"
      ? `AgeWellRI One-Time Service Confirmation`
      : `Upcoming Renewal Notice: Your AgeWellRI Monthly Service Contract`;

  const content = `
    <div class="greeting">Hello ${representativeName ? `${representativeName} (on behalf of ${clientName})` : clientName},</div>
    <div class="message">
      This is a courtesy notice that your <strong>AgeWellRI ${planName}</strong> (${intervalLabel}) is scheduled to renew in <strong>${daysBeforeNotice} days</strong> on <strong>${formattedDate}</strong>.
    </div>

    <div class="highlight-card">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Membership Plan:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${planName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Renewal Amount:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 14px; text-align: right;">$${recurringPrice.toFixed(2)} USD</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Renewal Date:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Payment Method:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">
            ${isAuto ? `${cardBrand || "Card"} ending in ${cardLast4 || "••••"} (Automatic Auto-Pay)` : "Invoice Statement"}
          </td>
        </tr>
      </table>
    </div>

    <div class="message">
      ${
        isAuto
          ? `Your card on file will be automatically billed on <strong>${formattedDate}</strong>. No action is required to maintain continuous safety oversight and home safety coordination.`
          : `An invoice statement with online payment instructions will be available in your portal on <strong>${formattedDate}</strong>.`
      }
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl}/dashboard/billing" class="btn-primary">View Billing &amp; Manage Plan</a>
    </div>

    <div style="background: #F8FAFC; border: 1px solid #D9E4EC; border-radius: 12px; padding: 14px; font-size: 12px; color: #64748B; line-height: 1.5;">
      <strong>Need to make changes or suspend service?</strong><br>
      You can update payment methods or pause/cancel renewal anytime prior to ${formattedDate} directly in your <a href="${portalUrl}/dashboard/billing" style="color: #294B68; font-weight: 700;">Client Portal</a>, or call our local team at <strong>${supportPhone}</strong>.
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);

  console.log(`\n======================================================`);
  console.log(
    `📬 [EMAIL SERVICE] Renewal Reminder (${daysBeforeNotice} days) sent to ${to}`,
  );
  console.log(
    `Plan: ${planName} | Renewal: ${formattedDate} | Amount: $${recurringPrice}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI LLC Billing Services"),
        to,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] Renewal reminder SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

/**
 * Payment Confirmation Success Email
 */
export async function sendPaymentSuccessEmail(
  options: SendPaymentSuccessEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    clientName,
    planName,
    amount,
    currency = "USD",
    paidAt,
    billingPeriodStart,
    billingPeriodEnd,
    nextRenewalDate,
    invoiceNumber,
    receiptUrl,
    portalUrl = process.env.FRONTEND_URL || "http://localhost:3000",
  } = options;

  const paidDateFormatted = new Date(paidAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const periodFormatted = `${new Date(billingPeriodStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(billingPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const subject = `Payment Confirmed: Your AgeWellRI Service Plan is Active`;

  const content = `
    <div class="greeting">Hello ${clientName},</div>
    <div class="message">
      Thank you for your payment. Your membership payment for <strong>AgeWellRI ${planName}</strong> has been successfully confirmed.
    </div>

    <div class="highlight-card">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Amount Paid:</td>
          <td style="padding: 6px 0; color: #3F8F6B; font-weight: 900; font-size: 16px; text-align: right;">$${amount.toFixed(2)} ${currency}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Payment Date:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${paidDateFormatted}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Active Coverage Period:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${periodFormatted}</td>
        </tr>
        ${
          invoiceNumber
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Invoice Ref:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${invoiceNumber}</td>
              </tr>`
            : ""
        }
        ${
          nextRenewalDate
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Next Renewal:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${new Date(nextRenewalDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</td>
              </tr>`
            : ""
        }
      </table>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl}/dashboard/billing" class="btn-primary">View Billing &amp; Invoices</a>
      ${receiptUrl && receiptUrl !== "#" ? `<br><a href="${receiptUrl}" class="btn-secondary" target="_blank">Download Stripe Receipt</a>` : ""}
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);

  console.log(`\n======================================================`);
  console.log(`💳 [EMAIL SERVICE] Payment Success Receipt sent to ${to}`);
  console.log(
    `Amount: $${amount} | Plan: ${planName} | Date: ${paidDateFormatted}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI LLC Billing Services"),
        to,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] Payment success SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

/**
 * Payment Failure Alert Email
 */
export async function sendPaymentFailureEmail(
  options: SendPaymentFailureEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    clientName,
    planName,
    amount,
    failedAt,
    failureReason = "Card issuer declined transaction",
    portalUrl = process.env.FRONTEND_URL || "http://localhost:3000",
  } = options;

  const subject = `Action Required: Payment Failed for Your AgeWellRI Service Plan`;

  const content = `
    <div class="greeting">Hello ${clientName},</div>
    <div class="message" style="color: #C95C5C; font-weight: 700;">
      Your scheduled renewal payment of $${amount.toFixed(2)} for ${planName} could not be processed.
    </div>

    <div class="highlight-card" style="border-color: #F87171; background: #FEF2F2;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Membership Plan:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${planName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Attempted Amount:</td>
          <td style="padding: 6px 0; color: #C95C5C; font-weight: 900; font-size: 14px; text-align: right;">$${amount.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Decline Reason:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 700; font-size: 13px; text-align: right;">${failureReason}</td>
        </tr>
      </table>
    </div>

    <div class="message">
      To ensure uninterrupted home visits and safety oversight, please update your payment method in your secure portal.
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl}/dashboard/billing" class="btn-primary" style="background-color: #C95C5C;">Update Payment Method Now</a>
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);

  console.log(`\n======================================================`);
  console.log(`⚠️ [EMAIL SERVICE] Payment Failure Alert sent to ${to}`);
  console.log(`Amount: $${amount} | Reason: ${failureReason}`);
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI LLC Billing Services"),
        to,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] Payment failure SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

/**
 * Invoice Statement Generated Email
 */
export async function sendInvoiceGeneratedEmail(
  options: SendInvoiceGeneratedEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    clientName,
    invoiceNumber,
    planName,
    amount,
    dueDate,
    paymentUrl,
    portalUrl = process.env.FRONTEND_URL || "http://localhost:3000",
  } = options;

  const dueFormatted = new Date(dueDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const subject = `New Invoice Statement: ${invoiceNumber} for AgeWellRI ${planName}`;

  const content = `
    <div class="greeting">Hello ${clientName},</div>
    <div class="message">
      Your new billing statement <strong>${invoiceNumber}</strong> for <strong>AgeWellRI ${planName}</strong> is ready for review and payment.
    </div>

    <div class="highlight-card">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Invoice Number:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Total Amount Due:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 900; font-size: 16px; text-align: right;">$${amount.toFixed(2)} USD</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Payment Due Date:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${dueFormatted}</td>
        </tr>
      </table>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${paymentUrl || `${portalUrl}/dashboard/billing`}" class="btn-primary">Pay Invoice Online</a>
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI LLC Billing Services"),
        to,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(`[EMAIL SERVICE] Invoice email error: ${err.message}`);
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

/**
 * Alert Admin of Critical Billing Failures
 */
export async function sendAdminBillingAlertEmail(
  options: SendAdminBillingAlertOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const adminEmail =
    options.adminEmail ||
    process.env.ADMIN_EMAIL ||
    process.env.SMTP_USER ||
    "billing-ops@agewellri.com";
  const subject = `🚨 [BILLING ALERT] ${options.alertType}: ${options.clientName}`;

  const content = `
    <div class="greeting" style="color: #C95C5C;">Internal Billing Alert: ${options.alertType}</div>
    <div class="message">
      A critical billing issue requires staff attention.
    </div>

    <div class="highlight-card" style="border-color: #C95C5C;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 4px 0; color: #64748B; font-size: 12px;">Client:</td>
          <td style="padding: 4px 0; color: #243746; font-weight: bold; font-size: 12px; text-align: right;">${options.clientName} (${options.clientEmail})</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #64748B; font-size: 12px;">Plan:</td>
          <td style="padding: 4px 0; color: #243746; font-weight: bold; font-size: 12px; text-align: right;">${options.planName} ($${options.amount})</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #64748B; font-size: 12px;">Details:</td>
          <td style="padding: 4px 0; color: #C95C5C; font-weight: bold; font-size: 12px; text-align: right;">${options.details || "Charge failed"}</td>
        </tr>
      </table>
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);

  console.log(`\n======================================================`);
  console.log(
    `🚨 [EMAIL SERVICE] Admin Billing Alert for ${adminEmail}: ${options.alertType} on ${options.clientName}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI System"),
        to: adminEmail,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(`[EMAIL SERVICE] Admin alert SMTP error: ${err.message}`);
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

/**
 * Plan / Service Purchase Confirmation & Agreement Execution Email
 * Sent immediately after payment is confirmed or invoice billing agreement is finalized.
 */
export async function sendPlanPurchaseConfirmationEmail(
  options: SendPlanPurchaseConfirmationEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    clientName,
    clientNumber,
    signerName,
    signerRole,
    serviceAddress,
    planName,
    planDescription,
    features = [],
    services = [],
    hasCleaningAddon = false,
    amount,
    currency = "USD",
    billingInterval = "MONTHLY",
    billingMethod = "AUTOMATIC",
    paymentStatus = "PAID",
    cardBrand,
    cardLast4,
    invoiceNumber,
    paidAt,
    coveragePeriodStart,
    coveragePeriodEnd,
    nextRenewalDate,
    cancellationDeadline,
    cancellationDeadlineRule,
    portalUrl = process.env.FRONTEND_URL || "http://localhost:3000",
    supportPhone = "(401) 212-3002",
    supportEmail = "agewellri@gmail.com",
  } = options;

  const isPaid = paymentStatus === "PAID";
  const intervalLabel =
    billingInterval === "ONE_TIME" ? "One-Time Service" : "Monthly";

  const paidDateFormatted = paidAt
    ? new Date(paidAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });

  const coveragePeriodFormatted =
    coveragePeriodStart && coveragePeriodEnd
      ? `${new Date(coveragePeriodStart).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })} – ${new Date(coveragePeriodEnd).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`
      : null;

  const nextRenewalDateFormatted =
    nextRenewalDate && billingInterval !== "ONE_TIME"
      ? new Date(nextRenewalDate).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : billingInterval === "ONE_TIME"
        ? "N/A (Single Purchase)"
        : null;

  const cancellationDeadlineFormatted = cancellationDeadline
    ? new Date(cancellationDeadline).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const subject = isPaid
    ? `Confirmation & Receipt: Your AgeWellRI ${planName} Plan is Active`
    : `Agreement Confirmed & Invoice Issued: AgeWellRI ${planName}`;

  const displayName =
    signerName && signerName !== clientName
      ? `${signerName} (on behalf of ${clientName})`
      : clientName;

  // Build Services breakdown rows
  let servicesListHtml = "";
  if (services && services.length > 0) {
    servicesListHtml = `
      <div style="margin-top: 8px;">
        ${services
          .map(
            (s) => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 7px 0; border-bottom: 1px dashed #E2E8F0; font-size: 13px;">
            <span style="color: #243746; font-weight: 700;">• ${s.serviceName}:</span>
            <span style="color: #294B68; font-weight: 800; background: #EAF3F8; padding: 2px 8px; border-radius: 6px;">${s.allocatedVisits} ${s.unit || "visits"}</span>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  } else {
    servicesListHtml = `
      <div style="padding: 6px 0; font-size: 13px; color: #475569;">
        • Complete Senior Safety Oversight &amp; Home Wellness Visits
      </div>
    `;
  }

  // Build Features list
  let featuresListHtml = "";
  if (features && features.length > 0) {
    featuresListHtml = `
      <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #E2E8F0;">
        <div style="font-size: 11px; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Key Plan Inclusions:</div>
        <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #475569; line-height: 1.6;">
          ${features.map((f) => `<li>${f}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  const content = `
    <div class="greeting">Hello ${displayName},</div>

    <div style="background: ${isPaid ? "#EBF8F2" : "#EFF6FF"}; border: 1px solid ${isPaid ? "#86EFAC" : "#93C5FD"}; border-radius: 12px; padding: 14px 18px; margin: 16px 0 24px 0;">
      <div style="font-size: 13px; font-weight: 800; color: ${isPaid ? "#166534" : "#1E40AF"}; text-transform: uppercase; letter-spacing: 0.5px;">
        ${isPaid ? "✓ Service Agreement Executed &amp; Membership Active" : "✓ Service Agreement Executed &amp; Invoice Statement Issued"}
      </div>
      <div style="font-size: 13px; color: #334155; margin-top: 4px; line-height: 1.5;">
        ${
          isPaid
            ? `Thank you for partnering with AgeWellRI. Your payment for <strong>AgeWellRI ${planName}</strong> has been confirmed, and your membership is now active.`
            : `Thank you for partnering with AgeWellRI. Your service agreement for <strong>AgeWellRI ${planName}</strong> has been executed. An invoice statement has been generated and sent for payment.`
        }
      </div>
    </div>

    <!-- Plan & Billing Overview Card -->
    <div class="highlight-card">
      <div style="font-size: 12px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 0.75px; margin-bottom: 12px; border-bottom: 1px solid #D9E4EC; padding-bottom: 6px;">
        📋 Membership &amp; Billing Summary
      </div>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Membership Plan:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${planName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Billing Interval:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${intervalLabel}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Amount ${isPaid ? "Paid" : "Due"}:</td>
          <td style="padding: 6px 0; color: ${isPaid ? "#166534" : "#1E40AF"}; font-weight: 900; font-size: 15px; text-align: right;">$${amount.toFixed(2)} ${currency}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Payment Status:</td>
          <td style="padding: 6px 0; color: ${isPaid ? "#166534" : "#B45309"}; font-weight: 800; font-size: 13px; text-align: right;">
            ${isPaid ? `PAID (${cardBrand || "Card"} ending in ${cardLast4 || "••••"})` : "Invoice Statement Open (Due in 14 Days)"}
          </td>
        </tr>
        ${
          invoiceNumber
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Invoice Ref:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${invoiceNumber}</td>
              </tr>`
            : ""
        }
        ${
          coveragePeriodFormatted
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Coverage Period:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${coveragePeriodFormatted}</td>
              </tr>`
            : ""
        }
        ${
          nextRenewalDateFormatted
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Next Renewal Date:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${nextRenewalDateFormatted}</td>
              </tr>`
            : ""
        }
        ${
          clientNumber
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Client ID:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 800; font-size: 13px; text-align: right;">${clientNumber}</td>
              </tr>`
            : ""
        }
        ${
          serviceAddress
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600; font-size: 13px;">Service Address:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 700; font-size: 13px; text-align: right;">${serviceAddress}</td>
              </tr>`
            : ""
        }
      </table>
    </div>

    <!-- Included safety & Service Breakdown Card -->
    <div class="highlight-card" style="background: #FFFFFF; border: 1px solid #CBD5E1;">
      <div style="font-size: 12px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 0.75px; margin-bottom: 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px;">
        🛡️ Included safety Services &amp; Quotas
      </div>
      ${planDescription ? `<div style="font-size: 13px; color: #334155; margin-bottom: 8px; font-style: italic;">${planDescription}</div>` : ""}
      ${servicesListHtml}
      ${
        hasCleaningAddon
          ? `<div style="margin-top: 8px; font-size: 13px; color: #166534; font-weight: 700; background: #F0FDF4; padding: 6px 10px; border-radius: 6px;">
              ✨ Home Cleaning Add-on: Included (+6 Additional Visits)
             </div>`
          : ""
      }
      ${featuresListHtml}
    </div>

    <!-- Statutory Cancellation Notice (Rhode Island Law) -->
    ${
      cancellationDeadlineFormatted
        ? `<div style="background: #F8FAFC; border-left: 4px solid #5E8FB2; border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 20px 0; font-size: 12px; color: #475569; line-height: 1.5;">
            <strong>Notice of Right of Cancellation (Rhode Island Law):</strong><br>
            Under Rhode Island Law, you have three (3) business days from agreement signing to cancel this contract without penalty. Your cancellation deadline is <strong>${cancellationDeadlineFormatted}</strong>. ${cancellationDeadlineRule || ""}
          </div>`
        : ""
    }

    <!-- CTA Buttons -->
    <div style="text-align: center; margin: 24px 0 16px 0;">
      <a href="${portalUrl}/dashboard" class="btn-primary" style="margin: 0 6px 8px 6px;">Access Client Portal</a>
      <a href="${portalUrl}/dashboard/calendar" class="btn-primary" style="background-color: #3F8F6B; margin: 0 6px 8px 6px;">View &amp; Schedule Visits</a>
    </div>
    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${portalUrl}/dashboard/billing" class="btn-secondary">View Billing &amp; Invoices</a>
    </div>

    <!-- Next Steps -->
    <div style="background: #F0F5F9; border-radius: 12px; padding: 16px; font-size: 12px; color: #475569; line-height: 1.6;">
      <strong style="color: #243746; font-size: 13px;">What to Expect Next:</strong><br>
      1. <strong>safety Specialist Assignment:</strong> A dedicated, certified Rhode Island AgeWell Specialist is being matched with your home.<br>
      2. <strong>First Visit Scheduling:</strong> Your coordinator will reach out to schedule your initial Comprehensive Home Safety Audit, or you can book online anytime.<br>
      3. <strong>Live Family Portal:</strong> Family members  can view real-time visit reports and photo logs from any device.<br>
      <br>
      Need assistance? Contact our local Westerly, RI team: <strong>${supportPhone}</strong> | <a href="mailto:${supportEmail}" style="color: #294B68; font-weight: 700;">${supportEmail}</a>
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);

  const recipientString = Array.isArray(to) ? to.join(", ") : to;

  console.log(`\n======================================================`);
  console.log(
    `💳 [EMAIL SERVICE] Plan Purchase Confirmation Email dispatched to: ${recipientString}`,
  );
  console.log(
    `Plan: ${planName} | Amount: $${amount} | Status: ${paymentStatus} | Method: ${billingMethod}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI LLC"),
        to: recipientString,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] Plan purchase confirmation SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

export interface SendWelcomeInvitationEmailOptions {
  to: string;
  clientName?: string;
  invitationLink: string;
  expiresAt: Date;
  invitedBy?: string;
  planName?: string;
  state?: string;
  supportPhone?: string;
  supportEmail?: string;
}

/**
 * Send Welcome Invitation Email to client / family member
 */
export async function sendWelcomeInvitationEmail(
  options: SendWelcomeInvitationEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    clientName = "Valued Member",
    invitationLink,
    expiresAt,
    planName,
    state = "RI",
    supportPhone = "(401) 212-3002",
    supportEmail = "agewellri@gmail.com",
  } = options;

  const formattedExpiry = new Date(expiresAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const subject = `Welcome to the AgeWellRI Family — Set Up Your Account`;

  const content = `
    <div class="greeting">Hello ${clientName},</div>
    <div class="message">
      Welcome to the AgeWellRI family! You have been invited to set up your member account and complete your official Service Agreement.
    </div>

    <div class="highlight-card">
      <div style="font-size: 13px; font-weight: 800; color: #243746; margin-bottom: 8px;">
        🌟 Your AgeWellRI Membership Details
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Service Region:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${state === "RI" ? "Rhode Island" : ""}</td>
        </tr>
        ${
          planName
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B;">Recommended Plan:</td>
                <td style="padding: 6px 0; color: #294B68; font-weight: 800; text-align: right;">${planName}</td>
              </tr>`
            : ""
        }
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Invitation Expiration:</td>
          <td style="padding: 6px 0; color: #C95C5C; font-weight: 700; text-align: right;">${formattedExpiry}</td>
        </tr>
      </table>
    </div>

    <div class="message">
      Click the button below to get started. You will be able to confirm whether you are signing as the Resident or as an Authorized Family Member  review the state-specific agreement, and activate your safety coverage.
    </div>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${invitationLink}" class="btn-primary" style="padding: 16px 36px; font-size: 15px;">
        Accept Invitation &amp; Start Onboarding →
      </a>
    </div>

    <div style="background: #F8FAFC; border: 1px solid #D9E4EC; border-radius: 12px; padding: 14px; font-size: 12px; color: #64748B; line-height: 1.5;">
      <strong>Note for Family Members:</strong> If you are managing safety for a loved one, you can specify your legal authority (e.g., Power of Attorney or Authorized Representative) during the onboarding steps.<br><br>
      Questions? Contact our team anytime: <strong>${supportPhone}</strong> | <a href="mailto:${supportEmail}" style="color: #294B68; font-weight: 700;">${supportEmail}</a>
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);

  console.log(`\n======================================================`);
  console.log(`✉️ [EMAIL SERVICE] Welcome Invitation sent to ${to}`);
  console.log(`Link: ${invitationLink}`);
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI LLC"),
        to,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] Welcome invitation SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

export interface SendAgreementExecutedEmailOptions {
  to: string | string[];
  clientName: string;
  clientNumber?: string;
  signerName?: string;
  signerRole?: string;
  legalAuthority?: string;
  serviceAddress?: string;
  state: string;
  templateVersion: string;
  signedDate: Date;
  cancellationDeadline: Date;
  cancellationDeadlineRule?: string;
  selectedPlan?: string;
  planName?: string;
  planCode?: string;
  planDescription?: string;
  features?: string[];
  services?: Array<{
    serviceName: string;
    allocatedVisits: number;
    unit?: string;
    description?: string;
  }>;
  hasCleaningAddon?: boolean;
  amount?: number;
  currency?: string;
  billingInterval?: "MONTHLY" | "ONE_TIME" | string;
  billingMethod?: "AUTOMATIC" | "INVOICE" | string;
  cardBrand?: string;
  cardLast4?: string;
  invoiceNumber?: string;
  firstBillingDate?: Date | null;
  portalUrl?: string;
  supportPhone?: string;
  supportEmail?: string;
}

/**
 * Send Executed Agreement & Membership Plan Confirmation Email (All-In-One)
 */
export async function sendAgreementExecutedEmail(
  options: SendAgreementExecutedEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    clientName,
    clientNumber,
    signerName,
    signerRole,
    legalAuthority,
    serviceAddress,
    state,
    templateVersion,
    signedDate,
    cancellationDeadline,
    cancellationDeadlineRule,
    selectedPlan = "AgeWellRI Membership",
    planName,
    planDescription,
    features = [],
    services = [],
    hasCleaningAddon = false,
    amount,
    currency = "USD",
    billingMethod = "AUTOMATIC",
    cardBrand,
    cardLast4,
    invoiceNumber,
    firstBillingDate,
    portalUrl = process.env.FRONTEND_URL || "http://localhost:3000",
    supportPhone = "(401) 212-3002",
    supportEmail = "agewellri@gmail.com",
  } = options;

  const resolvedPlanName = planName || selectedPlan || "AgeWellRI Membership";

  const signedDateFormatted = new Date(signedDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const deadlineFormatted = new Date(cancellationDeadline).toLocaleDateString(
    "en-US",
    {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    },
  );

  const firstBillingDateFormatted = firstBillingDate
    ? new Date(firstBillingDate).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "the 1st of next month";

  const isRep = Boolean(signerName && signerName !== clientName);
  const displayName = isRep
    ? `${signerName} (on behalf of ${clientName})`
    : clientName;

  const subject = `Your Executed AgeWellRI Service Agreement & Plan Confirmation (${state} - ${templateVersion})`;

  let stateLawName = "Rhode Island Law (RIGL § 6-28-3)";
  if (state === "CT") stateLawName = "Connecticut Law (CGS § 42-134a)";
  else if (state === "MA") stateLawName = "Massachusetts Law (MGL c. 93 § 48)";

  // Build Services breakdown rows
  let servicesListHtml = "";
  if (services && services.length > 0) {
    servicesListHtml = `
      <div style="margin-top: 8px;">
        ${services
          .map(
            (s) => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 7px 0; border-bottom: 1px dashed #E2E8F0; font-size: 13px;">
            <span style="color: #243746; font-weight: 700;">• ${s.serviceName}:</span>
            <span style="color: #294B68; font-weight: 800; background: #EAF3F8; padding: 2px 8px; border-radius: 6px;">${s.allocatedVisits} ${s.unit || "visits"}</span>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  } else {
    servicesListHtml = `
      <div style="padding: 6px 0; font-size: 13px; color: #475569;">
        • Complete Senior Safety Oversight &amp; Home Wellness Visits
      </div>
    `;
  }

  // Build Features list
  let featuresListHtml = "";
  if (features && features.length > 0) {
    featuresListHtml = `
      <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #E2E8F0;">
        <div style="font-size: 11px; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Key Plan Inclusions:</div>
        <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #475569; line-height: 1.6;">
          ${features.map((f) => `<li>${f}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  const content = `
    <div class="greeting">Hello ${displayName},</div>

    <div style="background: #EBF8F2; border: 1px solid #86EFAC; border-radius: 12px; padding: 16px 20px; margin: 16px 0 24px 0;">
      <div style="font-size: 13px; font-weight: 800; color: #166534; text-transform: uppercase; letter-spacing: 0.5px;">
        ✓ Service Agreement Executed &amp; Membership Active
      </div>
      <div style="font-size: 13px; color: #334155; margin-top: 6px; line-height: 1.5;">
        Thank you for partnering with AgeWellRI. Your <strong>Member Service Agreement</strong> has been fully executed by both parties. Your recurring monthly membership for <strong>${resolvedPlanName}</strong> is confirmed. You were <strong>not charged today ($0.00 charged at signup)</strong>, and your first billing and scheduled service start date is <strong>${firstBillingDateFormatted}</strong>.
      </div>
    </div>

    <!-- 1. Executed Agreement Details Card -->
    <div class="highlight-card">
      <div style="font-size: 12px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 0.75px; margin-bottom: 12px; border-bottom: 1px solid #D9E4EC; padding-bottom: 6px;">
        📄 Executed Agreement Details
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Primary Client (Resident):</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${clientName}</td>
        </tr>
        ${
          clientNumber
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Client ID:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${clientNumber}</td>
              </tr>`
            : ""
        }
        ${
          isRep
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Authorized Signer:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${signerName} (${signerRole || "Family Representative"}${legalAuthority ? ` - ${legalAuthority}` : ""})</td>
              </tr>`
            : ""
        }
        ${
          serviceAddress
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Service Address:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 700; text-align: right;">${serviceAddress}</td>
              </tr>`
            : ""
        }
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Agreement State &amp; Version:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${state} (${templateVersion})</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Execution Date:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${signedDateFormatted}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Agreement Status:</td>
          <td style="padding: 6px 0; color: #166534; font-weight: 900; text-align: right;">EXECUTED ✓</td>
        </tr>
      </table>
    </div>

    <!-- 2. Membership & Billing Schedule Card -->
    <div class="highlight-card">
      <div style="font-size: 12px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 0.75px; margin-bottom: 12px; border-bottom: 1px solid #D9E4EC; padding-bottom: 6px;">
        💳 Membership &amp; Billing Schedule
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Selected Membership Plan:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${resolvedPlanName}</td>
        </tr>
        ${
          amount !== undefined
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Monthly Membership Fee:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">$${amount.toFixed(2)} ${currency} / month</td>
              </tr>`
            : ""
        }
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Charged Today:</td>
          <td style="padding: 6px 0; color: #166534; font-weight: 900; font-size: 14px; text-align: right;">$0.00 (No Charge Today)</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">First Billing &amp; Service Start:</td>
          <td style="padding: 6px 0; color: #1E40AF; font-weight: 800; text-align: right;">${firstBillingDateFormatted}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Payment Method:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">
            ${
              billingMethod === "INVOICE"
                ? "Direct Invoice Statement (Due in 14 days)"
                : `Automatic Monthly (${cardBrand || "Card"} ending in ${cardLast4 || "••••"})`
            }
          </td>
        </tr>
        ${
          invoiceNumber
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Initial Invoice Reference:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${invoiceNumber}</td>
              </tr>`
            : ""
        }
      </table>
    </div>

    <!-- 3. Included safety Services & Visit Quotas Card -->
    <div class="highlight-card" style="background: #FFFFFF; border: 1px solid #CBD5E1;">
      <div style="font-size: 12px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 0.75px; margin-bottom: 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px;">
        🛡️ Included safety Services &amp; Visit Allocations
      </div>
      ${planDescription ? `<div style="font-size: 13px; color: #334155; margin-bottom: 8px; font-style: italic;">${planDescription}</div>` : ""}
      ${servicesListHtml}
     
      ${featuresListHtml}
    </div>

    <!-- 4. Official 3-Business-Day Cancellation Notice -->
    <div style="background: #F8FAFC; border-left: 4px solid #5E8FB2; border-radius: 0 8px 8px 0; padding: 14px 18px; margin: 20px 0; font-size: 12px; color: #475569; line-height: 1.6;">
      <strong style="color: #243746; font-size: 13px;">Official Notice of Right of Cancellation (${stateLawName}):</strong><br>
      Under state law, you may cancel this transaction without penalty not later than midnight of the third business day after agreement signing.<br>
      <strong>OFFICIAL DEADLINE DATE: NOT LATER THAN MIDNIGHT OF: ${deadlineFormatted}</strong><br>
      <span style="font-size: 11px; color: #64748B;">${cancellationDeadlineRule || "Sundays and recognized legal holidays are excluded from calculation."}</span>
    </div>

    <!-- 5. CTA Action Buttons -->
    <div style="text-align: center; margin: 28px 0 16px 0;">
      <a href="${portalUrl}/dashboard/agreements" class="btn-primary" style="margin: 0 6px 8px 6px;">
        View Executed Agreement &amp; Download PDF →
      </a>
      <a href="${portalUrl}/dashboard" class="btn-primary" style="background-color: #3F8F6B; margin: 0 6px 8px 6px;">
        Access Client Portal
      </a>
    </div>
    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${portalUrl}/dashboard/billing" class="btn-secondary">
        View Billing &amp; Invoices
      </a>
    </div>

    <!-- 6. Next Steps & Support -->
    <div style="background: #F0F5F9; border-radius: 12px; padding: 16px; font-size: 12px; color: #475569; line-height: 1.6;">
      <strong style="color: #243746; font-size: 13px;">What to Expect Next:</strong><br>
      • Your dedicated AgeWellRI LLC will contact you prior to <strong>${firstBillingDateFormatted}</strong> to introduce your safety team and schedule your first home visit.<br>
      • A permanent digital copy of your signed agreement and billing records is stored in your <a href="${portalUrl}/dashboard/agreements" style="color: #294B68; font-weight: 700;">Client Portal</a>.<br><br>
      Questions or need support? Contact our team: <strong>${supportPhone}</strong> | <a href="mailto:${supportEmail}" style="color: #294B68; font-weight: 700;">${supportEmail}</a>
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);
  const recipientString = Array.isArray(to) ? to.join(", ") : to;

  console.log(`\n======================================================`);
  console.log(
    `📜 [EMAIL SERVICE] Executed Agreement & Plan Confirmation Email dispatched to: ${recipientString}`,
  );
  console.log(
    `Client: ${clientName} | Plan: ${resolvedPlanName}${amount ? ` ($${amount}/mo)` : ""} | First Billing: ${firstBillingDateFormatted} | Deadline: ${deadlineFormatted}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI LLC"),
        to: recipientString,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] Agreement executed SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

export interface SendReportAvailableEmailOptions {
  to: string | string[];
  clientName: string;
  serviceType: string;
  visitDate: Date | string;
  specialistName?: string;
  reportTitle?: string;
  portalUrl?: string;
  supportPhone?: string;
  supportEmail?: string;
}

/**
 * Send Visit Report Available Notification Email to Client
 */
export async function sendReportAvailableEmail(
  options: SendReportAvailableEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    clientName,
    serviceType,
    visitDate,
    specialistName = "AgeWellRI Specialist",
    reportTitle = "Completed Visit Report",
    portalUrl = process.env.FRONTEND_URL || "http://localhost:3000",
    supportPhone = "(401) 212-3002",
    supportEmail = "agewellri@gmail.com",
  } = options;

  const formattedDate = new Date(visitDate).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const subject = `Your Visit Report is Ready — ${serviceType} (${formattedDate})`;

  const content = `
    <div class="greeting">Hello ${clientName},</div>
    <div class="message">
      Your official visit report for your completed <strong>${serviceType}</strong> on <strong>${formattedDate}</strong> is now available in your AgeWellRI member portal.
    </div>

    <div class="highlight-card">
      <div style="font-size: 13px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; border-bottom: 1px solid #D9E4EC; padding-bottom: 6px;">
        📄 Visit Report Summary
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Client:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${clientName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Service Provided:</td>
          <td style="padding: 6px 0; color: #294B68; font-weight: 800; text-align: right;">${serviceType}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Visit Date:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Assigned Specialist:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${specialistName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Report Status:</td>
          <td style="padding: 6px 0; color: #166534; font-weight: 900; text-align: right;">UPLOADED &amp; READY ✓</td>
        </tr>
      </table>
    </div>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${portalUrl}/dashboard/reports" class="btn-primary">
        View &amp; Download Report PDF →
      </a>
    </div>

    <div style="background: #F0F5F9; border-radius: 12px; padding: 16px; font-size: 12px; color: #475569; line-height: 1.6;">
      <strong>Access Anytime:</strong><br>
      You can securely view, print, or download all of your completed visit reports from the Reports section in your member portal at any time.<br><br>
      Questions or need assistance? Contact our team: <strong>${supportPhone}</strong> | <a href="mailto:${supportEmail}" style="color: #294B68; font-weight: 700;">${supportEmail}</a>
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);
  const recipientString = Array.isArray(to) ? to.join(", ") : to;

  console.log(`\n======================================================`);
  console.log(
    `📑 [EMAIL SERVICE] Visit Report Available Email dispatched to: ${recipientString}`,
  );
  console.log(
    `Client: ${clientName} | Service: ${serviceType} | Date: ${formattedDate}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI LLC"),
        to: recipientString,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] Report available SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

export interface SendMONTHLYRenewalActiveEmailOptions {
  to: string | string[];
  clientName: string;
  planName: string;
  periodStartDate: Date;
  periodEndDate: Date;
  periodNumber?: number;
  billingInterval?: string;
  allocatedVisits?: Array<{
    serviceName: string;
    count: number;
    durationMinutes?: number;
  }>;
  totalVisits?: number;
  portalUrl?: string;
  supportPhone?: string;
  supportEmail?: string;
}

export async function sendMONTHLYRenewalActiveEmail(
  options: SendMONTHLYRenewalActiveEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: string }> {
  const {
    to,
    clientName,
    planName,
    periodStartDate,
    periodEndDate,
    periodNumber,
    billingInterval = "MONTHLY",
    allocatedVisits = [],
    totalVisits = 4,
    portalUrl = process.env.FRONTEND_URL || "https://agewellri.com",
    supportPhone = "(401) 212-3002",
    supportEmail = "agewellri@gmail.com",
  } = options;

  const intervalTitle = "Monthly";
  const subject = `Your New AgeWellRI Monthly Service Period is Active — Schedule Your Visits`;

  const formattedStart = periodStartDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedEnd = periodEndDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const visitRowsHtml =
    allocatedVisits.length > 0
      ? allocatedVisits
          .map(
            (v) => `
        <tr>
          <td style="padding: 8px 0; color: #243746; font-weight: 700; font-size: 13px;">${v.serviceName}:</td>
          <td style="padding: 8px 0; color: #294B68; font-weight: 800; font-size: 13px; text-align: right;">${v.count} Included Visits</td>
        </tr>
      `,
          )
          .join("")
      : `
        <tr>
          <td style="padding: 8px 0; color: #243746; font-weight: 700; font-size: 13px;">Total Included Visits:</td>
          <td style="padding: 8px 0; color: #294B68; font-weight: 800; font-size: 13px; text-align: right;">${totalVisits} Visits</td>
        </tr>
      `;

  const content = `
    <h2 style="font-size: 20px; font-weight: 800; color: #243746; margin: 0 0 12px 0;">
      Your New Service Period Is Active!
    </h2>
    <p style="font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
      Hello <strong>${clientName}</strong>,<br><br>
      Your <strong>${planName}</strong> subscription has successfully renewed for the upcoming service period (<strong>${formattedStart} – ${formattedEnd}</strong>). Your fresh visit allocations are ready to be scheduled.
    </p>

    <div class="highlight-card">
      <div style="font-size: 13px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; border-bottom: 1px solid #D9E4EC; padding-bottom: 6px;">
        🗓️ Active Period Visit Entitlements
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Plan:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${planName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Service Period:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${formattedStart} – ${formattedEnd}</td>
        </tr>
        ${visitRowsHtml}
      </table>
    </div>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${portalUrl}/dashboard" class="btn-primary">
        Schedule Your Visits Now →
      </a>
    </div>

    <div style="background: #F0F5F9; border-radius: 12px; padding: 16px; font-size: 12px; color: #475569; line-height: 1.6;">
      <strong>safety Scheduling Notice:</strong><br>
      You can select your preferred dates, times, and specialists directly from your member portal. If you need any assistance scheduling, our agewellri team is available at <strong>${supportPhone}</strong> or <a href="mailto:${supportEmail}" style="color: #294B68; font-weight: 700;">${supportEmail}</a>.
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);
  const recipientString = Array.isArray(to) ? to.join(", ") : to;

  console.log(`\n======================================================`);
  console.log(
    `🎉 [EMAIL SERVICE] Renewal Active Email dispatched to: ${recipientString}`,
  );
  console.log(
    `Client: ${clientName} | Plan: ${planName} | Period: ${formattedStart} – ${formattedEnd}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI LLC"),
        to: recipientString,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] MONTHLY renewal active SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

export interface SendFamilyMemberInvitationEmailOptions {
  to: string;
  familyMemberName: string;
  clientName: string;
  relationship: string;
  invitationLink: string;
  expiresAt: Date;
  permissions: {
    reportAccess: boolean;
    portalAccess: boolean;
    billingAccess: boolean;
  };
  supportPhone?: string;
  supportEmail?: string;
}

export interface SendFamilyMemberCredentialsEmailOptions {
  to: string;
  familyMemberName: string;
  clientName: string;
  relationship: string;
  loginEmail: string;
  password: string;
  loginUrl?: string;
  supportPhone?: string;
  supportEmail?: string;
}

export async function sendFamilyMemberCredentialsEmail(
  options: SendFamilyMemberCredentialsEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    familyMemberName,
    clientName,
    relationship,
    loginEmail,
    password,
    loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`,
    supportPhone = "(401) 212-3002",
    supportEmail = "agewellri@gmail.com",
  } = options;

  const subject = `Your AgeWellRI Portal Login Credentials (Access for ${clientName})`;

  const content = `
    <div class="greeting">Hello ${familyMemberName},</div>
    <div class="message">
      <strong>${clientName}</strong> has granted you direct access to their <strong>AgeWellRI Member &amp; Family Portal</strong> as their designated <strong>${relationship}</strong>.
    </div>

    <div class="highlight-card" style="background: #F0F5F9; border: 2px solid #294B68; border-radius: 14px; padding: 20px; margin: 20px 0;">
      <div style="font-size: 13px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; border-bottom: 1px solid #D9E4EC; padding-bottom: 8px;">
        🔑 Your Portal Login Credentials
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; color: #64748B; font-weight: 600;">Sign In Page:</td>
          <td style="padding: 8px 0; color: #294B68; font-weight: 800; text-align: right;"><a href="${loginUrl}" style="color: #294B68; font-weight: 800; text-decoration: underline;">${loginUrl}</a></td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748B; font-weight: 600;">Login Email:</td>
          <td style="padding: 8px 0; color: #243746; font-weight: 800; text-align: right; font-family: monospace; font-size: 15px;">${loginEmail}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748B; font-weight: 600;">Password:</td>
          <td style="padding: 8px 0; color: #294B68; font-weight: 900; text-align: right; font-family: monospace; font-size: 16px; background: #EAF3F8; padding: 4px 10px; border-radius: 6px; display: inline-block;">${password}</td>
        </tr>
      </table>
    </div>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${loginUrl}" class="btn-primary" style="display: inline-block; padding: 14px 32px; background: #294B68; color: #ffffff !important; text-decoration: none; font-weight: 800; font-size: 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(41,75,104,0.25);">
        Log In to Member Portal →
      </a>
    </div>

    <div style="font-size: 13px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
      <strong>What you can do in the portal:</strong>
      <ul style="margin: 8px 0 0 0; padding-left: 20px;">
        <li>View upcoming and past home safety visits</li>
        <li>Review official specialist inspection reports and photos</li>
        <li>Oversee safety records just like the primary member</li>
      </ul>
    </div>

    <div style="background: #F8FAFC; border-radius: 12px; padding: 16px; font-size: 12px; color: #64748B; line-height: 1.6; border: 1px solid #D9E4EC;">
      <strong>Security Recommendation:</strong> For your security, you may change your password anytime under Profile Settings after logging in.<br><br>
      AgeWellRI Rhode Island Support: <strong>${supportPhone}</strong> | <a href="mailto:${supportEmail}" style="color: #294B68; font-weight: 700;">${supportEmail}</a>
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);

  console.log(`\n======================================================`);
  console.log(
    `🔑 [EMAIL SERVICE] Family Member Credentials Email dispatched to: ${to}`,
  );
  console.log(
    `Member: ${familyMemberName} | Client: ${clientName} | Password: ${password}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI Member Support"),
        to,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(`[EMAIL SERVICE] Credentials SMTP error: ${err.message}`);
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

export interface SendFamilyMemberInvitationEmailOptions {
  to: string;
  familyMemberName: string;
  clientName: string;
  relationship: string;
  invitationLink: string;
  expiresAt: Date;
  permissions: {
    reportAccess: boolean;
    portalAccess: boolean;
    billingAccess: boolean;
  };
  supportPhone?: string;
  supportEmail?: string;
}

export async function sendFamilyMemberInvitationEmail(
  options: SendFamilyMemberInvitationEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    familyMemberName,
    clientName,
    relationship,
    invitationLink,
    expiresAt,
    permissions,
    supportPhone = "(401) 712-3012",
    supportEmail = "agewellri@gmail.com",
  } = options;

  const formattedExpiry = new Date(expiresAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const subject = `You've been invited to the AgeWellRI Family Portal for ${clientName}`;

  const permissionBadges = [];
  if (permissions.reportAccess)
    permissionBadges.push("📄 View Safety Reports & Photo Documentation");
  if (permissions.portalAccess)
    permissionBadges.push("🔑 Client Portal Access");
  if (permissions.billingAccess)
    permissionBadges.push("💳 View & Pay Invoices / Billing");

  const permissionsListHtml = permissionBadges
    .map(
      (p) =>
        `<tr><td style="padding: 6px 0; color: #166534; font-weight: 700; font-size: 13px;">✓ ${p}</td></tr>`,
    )
    .join("");

  const content = `
    <div class="greeting">Hello ${familyMemberName},</div>
    <div class="message">
      <strong>${clientName}</strong> has invited you to join their <strong>AgeWellRI Member &amp; Family Portal</strong> as their designated <strong>${relationship}</strong>.
    </div>

    <div class="highlight-card">
      <div style="font-size: 13px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; border-bottom: 1px solid #D9E4EC; padding-bottom: 6px;">
        🛡️ Granted Family Access Permissions
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        ${permissionsListHtml || '<tr><td style="padding: 6px 0; color: #64748B;">Standard Family Access</td></tr>'}
      </table>
    </div>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${invitationLink}" class="btn-primary" style="display: inline-block; padding: 14px 28px; background: #294B68; color: #ffffff; text-decoration: none; font-weight: 800; font-size: 14px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        Activate Family Portal Account →
      </a>
    </div>

    <div style="background: #F0F5F9; border-radius: 12px; padding: 16px; font-size: 12px; color: #475569; line-height: 1.6;">
      <strong>Security &amp; Expiration Notice:</strong><br>
      This invitation link is unique to you and will expire on <strong>${formattedExpiry}</strong>. If you did not expect this invitation, please contact our support team.<br><br>
      AgeWellRI Rhode Island Support: <strong>${supportPhone}</strong> | <a href="mailto:${supportEmail}" style="color: #294B68; font-weight: 700;">${supportEmail}</a>
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);

  console.log(`\n======================================================`);
  console.log(
    `💌 [EMAIL SERVICE] Family Member Invitation Email dispatched to: ${to}`,
  );
  console.log(
    `Family Member: ${familyMemberName} | Client: ${clientName} | Link: ${invitationLink}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI Family Safety"),
        to,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] Family member invitation SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

export interface SendReportToFamilyRecipientEmailOptions {
  to: string | string[];
  recipientName: string;
  clientName: string;
  serviceType: string;
  visitDate: Date;
  specialistName?: string;
  reportTitle?: string;
  customNote?: string | null;
  reportId: string;
  portalUrl?: string;
  supportPhone?: string;
  supportEmail?: string;
}

export async function sendReportToFamilyRecipientEmail(
  options: SendReportToFamilyRecipientEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    recipientName,
    clientName,
    serviceType,
    visitDate,
    specialistName = "AgeWellRI Specialist",
    reportTitle = "Completed Safety Visit Report",
    customNote,
    reportId,
    portalUrl = process.env.FRONTEND_URL || "http://localhost:3000",
    supportPhone = "(401) 712-3012",
    supportEmail = "agewellri@gmail.com",
  } = options;

  const formattedDate = new Date(visitDate).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const subject = `Home Safety Visit Report for ${clientName} (${formattedDate})`;

  const customNoteHtml = customNote
    ? `
      <div style="background: #FEF3C7; border-left: 4px solid #D97706; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; color: #92400E;">
        <strong>Personal Note from ${clientName}:</strong><br>
        "${customNote}"
      </div>
    `
    : "";

  const content = `
    <div class="greeting">Hello ${recipientName},</div>
    <div class="message">
      A new visit report for <strong>${clientName}</strong> has been shared with you regarding their completed <strong>${serviceType}</strong> on <strong>${formattedDate}</strong>.
    </div>

    ${customNoteHtml}

    <div class="highlight-card">
      <div style="font-size: 13px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; border-bottom: 1px solid #D9E4EC; padding-bottom: 6px;">
        📄 Safety Visit Summary
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Resident:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${clientName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Service:</td>
          <td style="padding: 6px 0; color: #294B68; font-weight: 800; text-align: right;">${serviceType}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Visit Date:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Specialist:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${specialistName}</td>
        </tr>
      </table>
    </div>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${portalUrl}/dashboard/reports/${reportId}" class="btn-primary" style="display: inline-block; padding: 14px 28px; background: #294B68; color: #ffffff; text-decoration: none; font-weight: 800; font-size: 14px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        View Full Report &amp; Photos →
      </a>
    </div>

    <div style="background: #F0F5F9; border-radius: 12px; padding: 16px; font-size: 12px; color: #475569; line-height: 1.6;">
      <strong>Authorized Recipient Communication:</strong><br>
      You are receiving this update because you are registered as an authorized family contact for ${clientName}.<br><br>
      AgeWellRI Support: <strong>${supportPhone}</strong> | <a href="mailto:${supportEmail}" style="color: #294B68; font-weight: 700;">${supportEmail}</a>
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);
  const recipientString = Array.isArray(to) ? to.join(", ") : to;

  console.log(`\n======================================================`);
  console.log(
    `📑 [EMAIL SERVICE] Report Sent to Family Member dispatched to: ${recipientString}`,
  );
  console.log(
    `Recipient: ${recipientName} | Client: ${clientName} | Report: ${reportTitle}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI Safety Oversight"),
        to: recipientString,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] Report to family SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

export interface SendSubscriptionCancelledEmailOptions {
  to: string | string[];
  clientName: string;
  planName: string;
  serviceEndDate: Date | string;
  portalUrl?: string;
  supportPhone?: string;
  supportEmail?: string;
}

/**
 * Subscription Cancellation Confirmation Email
 */
export async function sendSubscriptionCancelledEmail(
  options: SendSubscriptionCancelledEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    clientName,
    planName,
    serviceEndDate,
    portalUrl = process.env.FRONTEND_URL || "http://localhost:3000",
    supportPhone = "(401) 712-3012",
    supportEmail = "agewellri@gmail.com",
  } = options;

  const formattedEndDate =
    typeof serviceEndDate === "string" && isNaN(Date.parse(serviceEndDate))
      ? serviceEndDate
      : new Date(serviceEndDate).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        });

  const subject = "Your AgeWellRI Plan Cancellation Has Been Received";

  const content = `
    <div class="greeting">Hello ${clientName},</div>
    <div class="message" style="font-size: 15px; font-weight: 700; color: #243746; margin-bottom: 12px;">
      Your cancellation has been received.
    </div>
    <div class="message" style="margin-bottom: 20px;">
      Your service will end on <strong>${formattedEndDate}</strong>. You won't be charged again.
    </div>

    <div class="highlight-card" style="border-left: 4px solid #C28A3A; background: #FFFBEB;">
      <div style="font-size: 13px; font-weight: 800; color: #92400E; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; border-bottom: 1px solid #FDE68A; padding-bottom: 6px;">
        📋 Cancellation Details
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Client:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${clientName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Plan:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${planName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Service End Date:</td>
          <td style="padding: 6px 0; color: #92400E; font-weight: 800; text-align: right;">${formattedEndDate}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Auto-Renewal Status:</td>
          <td style="padding: 6px 0; color: #92400E; font-weight: 800; text-align: right;">Turned Off (No Future Charges)</td>
        </tr>
      </table>
    </div>

    <div class="message" style="font-size: 13px; color: #475569; line-height: 1.6; margin-bottom: 16px;">
      A confirmation of your cancellation has been recorded. Your scheduled safety visits and support continue through the end of your current paid period (<strong>${formattedEndDate}</strong>).
    </div>

    <div style="background: #F0F5F9; border-radius: 12px; padding: 16px; font-size: 13px; color: #294B68; line-height: 1.6; margin-bottom: 24px;">
      <strong>We're sorry to see you go — you're always welcome back.</strong><br>
      You can sign in again anytime to reactivate your plan or manage your safety coordination services.
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl}/dashboard/billing" class="btn-primary" style="display: inline-block; padding: 14px 28px; background: #294B68; color: #ffffff; text-decoration: none; font-weight: 800; font-size: 14px; border-radius: 12px;">
        View Client Portal →
      </a>
    </div>

    <div style="font-size: 12px; color: #64748B; line-height: 1.5; border-top: 1px solid #D9E4EC; padding-top: 16px;">
      Questions or need assistance? Our local Rhode Island team is here for you at <strong>${supportPhone}</strong> or <a href="mailto:${supportEmail}" style="color: #294B68; font-weight: 700;">${supportEmail}</a>.
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);
  const recipientString = Array.isArray(to) ? to.join(", ") : to;

  console.log(`\n======================================================`);
  console.log(
    `🛑 [EMAIL SERVICE] Cancellation Confirmation dispatched to: ${recipientString}`,
  );
  console.log(
    `Client: ${clientName} | Plan: ${planName} | Service Ends: ${formattedEndDate}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI LLC Billing Services"),
        to: recipientString,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] Subscription cancelled SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

export interface SendSubscriptionReactivatedEmailOptions {
  to: string | string[];
  clientName: string;
  planName: string;
  nextBillingDate?: Date | string | null;
  recurringAmount?: number | string | null;
  portalUrl?: string;
  supportPhone?: string;
  supportEmail?: string;
}

/**
 * Subscription Reactivation Confirmation Email
 */
export async function sendSubscriptionReactivatedEmail(
  options: SendSubscriptionReactivatedEmailOptions,
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const {
    to,
    clientName,
    planName,
    nextBillingDate,
    recurringAmount,
    portalUrl = process.env.FRONTEND_URL || "http://localhost:3000",
    supportPhone = "(401) 712-3012",
    supportEmail = "agewellri@gmail.com",
  } = options;

  const formattedBillingDate = nextBillingDate
    ? typeof nextBillingDate === "string" && isNaN(Date.parse(nextBillingDate))
      ? nextBillingDate
      : new Date(nextBillingDate).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
    : null;

  const subject = "Your AgeWellRI Plan Has Been Reactivated";

  const content = `
    <div class="greeting">Hello ${clientName},</div>
    <div class="message" style="font-size: 15px; font-weight: 700; color: #166534; margin-bottom: 12px;">
      Your AgeWellRI plan has been successfully reactivated.
    </div>

    <div class="highlight-card" style="border-left: 4px solid #16A34A; background: #F0FDF4;">
      <div style="font-size: 13px; font-weight: 800; color: #166534; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; border-bottom: 1px solid #BBF7D0; padding-bottom: 6px;">
        🛡️ Reactivated Membership Plan
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Client:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${clientName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Plan:</td>
          <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${planName}</td>
        </tr>
        ${
          formattedBillingDate
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Next Billing Date:</td>
                <td style="padding: 6px 0; color: #166534; font-weight: 800; text-align: right;">${formattedBillingDate}</td>
              </tr>`
            : ""
        }
        ${
          recurringAmount
            ? `<tr>
                <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Recurring Amount:</td>
                <td style="padding: 6px 0; color: #243746; font-weight: 800; text-align: right;">${typeof recurringAmount === "number" ? `$${recurringAmount.toFixed(2)} USD` : recurringAmount}</td>
              </tr>`
            : ""
        }
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Auto-Renewal Status:</td>
          <td style="padding: 6px 0; color: #166534; font-weight: 800; text-align: right;">Active (Auto-Pay)</td>
        </tr>
      </table>
    </div>

    <div class="message" style="font-size: 13px; color: #475569; line-height: 1.6; margin-bottom: 16px;">
      Your service will continue according to your active subscription.<br><br>
      Auto-renewal is now turned back on, and your upcoming billing will proceed according to your subscription schedule.<br><br>
      You can continue using your AgeWellRI services as scheduled.
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl}/dashboard/billing" class="btn-primary" style="display: inline-block; padding: 14px 28px; background: #294B68; color: #ffffff; text-decoration: none; font-weight: 800; font-size: 14px; border-radius: 12px;">
        Manage Subscription &amp; Visits →
      </a>
    </div>

    <div style="font-size: 12px; color: #64748B; line-height: 1.5; border-top: 1px solid #D9E4EC; padding-top: 16px;">
      Questions or need assistance? Our local team is here to help at <strong>${supportPhone}</strong> or <a href="mailto:${supportEmail}" style="color: #294B68; font-weight: 700;">${supportEmail}</a>.
    </div>
  `;

  const htmlContent = wrapHtmlEmail(subject, content);
  const recipientString = Array.isArray(to) ? to.join(", ") : to;

  console.log(`\n======================================================`);
  console.log(
    `✅ [EMAIL SERVICE] Reactivation Confirmation dispatched to: ${recipientString}`,
  );
  console.log(
    `Client: ${clientName} | Plan: ${planName} | Next Billing: ${formattedBillingDate || "Scheduled"}`,
  );
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI LLC Billing Services"),
        to: recipientString,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(
        `[EMAIL SERVICE] Subscription reactivated SMTP error: ${err.message}`,
      );
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}
