import prisma from "../lib/prisma";

/**
 * Generate the next sequential client number in the standard format `AW-XXXX` (e.g. AW-1001, AW-1002, etc.).
 *
 * It scans all existing client records to find the highest numerical suffix,
 * increments it by 1, and verifies that the candidate client number does not collide with any existing record.
 */
export async function generateNextClientNumber(): Promise<string> {
  // Fetch existing client numbers
  const clients = await (prisma.client.findMany as any)({
    select: { clientNumber: true },
  });

  let maxNumber = 1000;

  for (const client of clients) {
    if (client?.clientNumber) {
      const match = String(client.clientNumber).trim().match(/^AW-(\d+)$/i);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }
  }

  let nextCandidate = maxNumber + 1;
  let candidateClientNumber = `AW-${nextCandidate}`;

  // Double-check against DB to guarantee uniqueness even if gaps or anomalies exist
  while (
    await (prisma.client.findUnique as any)({
      where: { clientNumber: candidateClientNumber },
      select: { id: true },
    })
  ) {
    nextCandidate++;
    candidateClientNumber = `AW-${nextCandidate}`;
  }

  return candidateClientNumber;
}
