import prisma from "../../lib/prisma";
import { SendMessageInput } from "./contact.validation";
import { sendClientDirectMessageToAdminEmail } from "../../utils/email";

/**
 * Handle sending direct message from client portal to admin Gmail inbox
 */
export async function sendContactMessage(
  userId: string | null | undefined,
  input: SendMessageInput,
) {
  let clientName = input.senderName || "Valued Client";
  let clientEmail = input.senderEmail || "client@agewellri.com";
  let clientPhone = input.senderPhone || "";
  let clientNumber = "";
  let senderRole = "Client";

  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        client: true,
        familyMemberships: {
          include: {
            client: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (user) {
      clientName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || clientName;
      clientEmail = user.email || clientEmail;
      clientPhone = user.phone || clientPhone;

      if (user.client) {
        clientNumber = user.client.clientNumber || "";
        clientPhone = clientPhone || user.client.primaryContactPhone || "";
        senderRole = "Primary Client / Resident";
      } else if (user.familyMemberships && user.familyMemberships.length > 0) {
        const primaryMembership = user.familyMemberships[0];
        senderRole = `Authorized Family Member (${primaryMembership.relationship || "Family"})`;
        if (primaryMembership.client) {
          const primaryName = `${primaryMembership.client.user?.firstName || ""} ${primaryMembership.client.user?.lastName || ""}`.trim();
          clientNumber = `${primaryMembership.client.clientNumber || ""} (For: ${primaryName})`;
        }
      }
    }
  }

  // Dispatch email directly to admin inbox
  const result = await sendClientDirectMessageToAdminEmail({
    clientName,
    clientEmail,
    clientPhone: clientPhone || undefined,
    clientNumber: clientNumber || undefined,
    subject: input.subject,
    message: input.message,
    senderRole,
  });

  return {
    success: true,
    message: "Your message has been sent directly to our team. We will reply to your email address.",
    clientEmail,
    mode: result.mode,
  };
}
