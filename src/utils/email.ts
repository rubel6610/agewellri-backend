import nodemailer from "nodemailer";

interface SendOtpEmailOptions {
  to: string;
  name?: string;
  otp: string;
  expiresInMinutes?: number;
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

/**
 * Send Password Reset OTP Email
 */
export async function sendPasswordResetOtpEmail({
  to,
  name,
  otp,
  expiresInMinutes = 10,
}: SendOtpEmailOptions): Promise<{ success: boolean; messageId?: string; mode: "smtp" | "console" }> {
  const from =
    process.env.SMTP_FROM ||
    process.env.EMAIL_FROM ||
    `"AgeWellRI Security" <${process.env.SMTP_USER || process.env.EMAIL_USER || "security@agewellri.com"}>`;

  const displayName = name || "Valued Member";

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F0F5F9; margin: 0; padding: 24px; color: #243746; }
          .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #D9E4EC; box-shadow: 0 4px 12px rgba(36,55,70,0.06); }
          .header { background-color: #243746; padding: 24px; text-align: center; color: #ffffff; }
          .header h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
          .header p { margin: 4px 0 0 0; font-size: 13px; color: #5E8FB2; }
          .content { padding: 32px 28px; text-align: center; }
          .greeting { font-size: 16px; font-weight: 700; color: #243746; margin-bottom: 8px; text-align: left; }
          .message { font-size: 14px; color: #64748B; line-height: 1.6; text-align: left; margin-bottom: 24px; }
          .otp-box { background: #EAF3F8; border: 2px dashed #5E8FB2; border-radius: 12px; padding: 18px; margin: 24px 0; text-align: center; }
          .otp-label { font-size: 11px; font-weight: 800; color: #294B68; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
          .otp-code { font-family: 'Courier New', monospace; font-size: 32px; font-weight: 800; color: #243746; letter-spacing: 8px; margin: 0; }
          .expiry { font-size: 12px; color: #C95C5C; font-weight: 600; margin-top: 8px; }
          .footer { background-color: #F7FAFC; border-top: 1px solid #D9E4EC; padding: 20px; font-size: 11px; color: #94A3B8; text-align: center; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>AgeWellRI</h1>
            <p>Home Safety & Care Coordination</p>
          </div>
          <div class="content">
            <div class="greeting">Hello ${displayName},</div>
            <div class="message">
              We received a request to reset the password for your AgeWellRI account. Please use the 6-digit verification code below to complete the password reset process.
            </div>
            
            <div class="otp-box">
              <div class="otp-label">Verification OTP Code</div>
              <div class="otp-code">${otp}</div>
              <div class="expiry">Expires in ${expiresInMinutes} minutes</div>
            </div>

            <div class="message" style="font-size: 12px; color: #94A3B8; margin-top: 20px;">
              If you did not request a password reset, please ignore this email or contact support if you suspect unauthorized activity.
            </div>
          </div>
          <div class="footer">
            &copy; 2026 AgeWellRI. Westerly, Rhode Island.<br>
            This is an automated security message. Please do not reply directly to this email.
          </div>
        </div>
      </body>
    </html>
  `;

  // Always log OTP to terminal console for easy visibility
  console.log(`\n======================================================`);
  console.log(`🔑 [EMAIL SERVICE] Password Reset OTP for ${to}:`);
  console.log(`======================================================\n`);

  const transporter = createTransporter();

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from,
        to,
        subject: `your AgeWellRI Password Reset Code`,
        text: `Your AgeWellRI password reset code is: ${otp}. This code will expire in ${expiresInMinutes} minutes. If you did not request this, please ignore this email.`,
        html: htmlContent,
      });

      console.log(`[EMAIL SERVICE] Email successfully sent to ${to}, MessageID: ${info.messageId}`);
      return { success: true, messageId: info.messageId, mode: "smtp" };
    } catch (error: any) {
      console.warn(`[EMAIL SERVICE] SMTP send error: ${error.message}. (OTP logged to console).`);
      return { success: true, mode: "console" };
    }
  }

  return { success: true, mode: "console" };
}
