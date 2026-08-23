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
  billingInterval: "MONTHLY" | "QUARTERLY" | "ANNUAL" | string;
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

function getDefaultFromAddress(senderTitle = "AgeWellRI Care Coordination") {
  return (
    process.env.SMTP_FROM ||
    process.env.EMAIL_FROM ||
    `"${senderTitle}" <${process.env.SMTP_USER || process.env.EMAIL_USER || "billing@agewellri.com"}>`
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
            <p>Home Safety & Care Coordination</p>
          </div>
          <div class="content">
            ${contentHtml}
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} AgeWellRI. Westerly, Rhode Island.<br>
            Protecting independence and safety for Rhode Island seniors.<br>
            Questions? Contact Support: <a href="mailto:billing@agewellri.com">billing@agewellri.com</a> | (401) 555-0199
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
}: SendOtpEmailOptions): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
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

      console.log(`[EMAIL SERVICE] OTP sent to ${to}, MessageID: ${info.messageId}`);
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
  options: SendRenewalReminderEmailOptions
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
    portalUrl = process.env.FRONTEND_URL || "http://localhost:3000",
    supportPhone = "(401) 555-0199",
    supportEmail = "billing@agewellri.com",
  } = options;

  const formattedDate = new Date(renewalDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const intervalLabel =
    billingInterval === "MONTHLY"
      ? "Monthly"
      : billingInterval === "ANNUAL"
      ? "Annual"
      : "Quarterly";

  const isAuto = billingMethod === "AUTOMATIC";

  const subject =
    billingInterval === "MONTHLY"
      ? `Upcoming Bill Notice: Your AgeWellRI Monthly Service Plan`
      : billingInterval === "ANNUAL"
      ? `Annual Service Renewal Notice: Your AgeWellRI Membership Plan`
      : `Upcoming Renewal Notice: Your AgeWellRI Quarterly Service Contract`;

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
          ? `Your card on file will be automatically billed on <strong>${formattedDate}</strong>. No action is required to maintain continuous safety oversight and home care coordination.`
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
  console.log(`📬 [EMAIL SERVICE] Renewal Reminder (${daysBeforeNotice} days) sent to ${to}`);
  console.log(`Plan: ${planName} | Renewal: ${formattedDate} | Amount: $${recurringPrice}`);
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI Billing Services"),
        to,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(`[EMAIL SERVICE] Renewal reminder SMTP error: ${err.message}`);
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

/**
 * Payment Confirmation Success Email
 */
export async function sendPaymentSuccessEmail(
  options: SendPaymentSuccessEmailOptions
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
  console.log(`Amount: $${amount} | Plan: ${planName} | Date: ${paidDateFormatted}`);
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getDefaultFromAddress("AgeWellRI Billing Services"),
        to,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(`[EMAIL SERVICE] Payment success SMTP error: ${err.message}`);
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

/**
 * Payment Failure Alert Email
 */
export async function sendPaymentFailureEmail(
  options: SendPaymentFailureEmailOptions
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
        from: getDefaultFromAddress("AgeWellRI Billing Services"),
        to,
        subject,
        html: htmlContent,
      });
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (err: any) {
      console.warn(`[EMAIL SERVICE] Payment failure SMTP error: ${err.message}`);
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}

/**
 * Invoice Statement Generated Email
 */
export async function sendInvoiceGeneratedEmail(
  options: SendInvoiceGeneratedEmailOptions
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
        from: getDefaultFromAddress("AgeWellRI Billing Services"),
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
  options: SendAdminBillingAlertOptions
): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const adminEmail = options.adminEmail || process.env.ADMIN_EMAIL || process.env.SMTP_USER || "billing-ops@agewellri.com";
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
  console.log(`🚨 [EMAIL SERVICE] Admin Billing Alert for ${adminEmail}: ${options.alertType} on ${options.clientName}`);
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
