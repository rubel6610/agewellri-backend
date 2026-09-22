import { Response } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import * as familyService from "./family.service";
import {
  createFamilyMemberSchema,
  updateFamilyMemberSchema,
  acceptFamilyInviteSchema,
  sendReportToFamilySchema,
} from "./family.validation";

export async function handleGetFamilyMembers(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const result = await familyService.getFamilyMembers(req.user!.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to fetch family members.",
    });
  }
}

export async function handleGetFamilyMemberById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const member = await familyService.getFamilyMemberById(req.user!.id, req.params.id as string);
    res.status(200).json({
      success: true,
      data: member,
    });
  } catch (error: any) {
    res.status(404).json({
      success: false,
      message: error.message || "Family member not found.",
    });
  }
}

export async function handleCreateFamilyMember(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const parsed = createFamilyMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid input data.",
        errors: parsed.error.format(),
      });
      return;
    }

    const member = await familyService.createFamilyMember(req.user!.id, parsed.data);
    res.status(201).json({
      success: true,
      message: "Family member added successfully.",
      data: member,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to add family member.",
    });
  }
}

export async function handleUpdateFamilyMember(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const parsed = updateFamilyMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid input data.",
        errors: parsed.error.format(),
      });
      return;
    }

    const updated = await familyService.updateFamilyMember(req.user!.id, req.params.id as string, parsed.data);
    res.status(200).json({
      success: true,
      message: "Family member updated successfully.",
      data: updated,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to update family member.",
    });
  }
}

export async function handleDeleteFamilyMember(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const result = await familyService.deleteFamilyMember(req.user!.id, req.params.id as string);
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to remove family member.",
    });
  }
}

export async function handleInviteFamilyMember(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const password = req.body?.password as string | undefined;
    const result = await familyService.inviteFamilyMember(req.user!.id, req.params.id as string, password);
    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to send login credentials.",
    });
  }
}

export async function handleResendFamilyInvite(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const password = req.body?.password as string | undefined;
    const result = await familyService.resendFamilyInvite(req.user!.id, req.params.id as string, password);
    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to resend login credentials.",
    });
  }
}

export async function handleRevokeFamilyAccess(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const result = await familyService.revokeFamilyAccess(req.user!.id, req.params.id as string);
    res.status(200).json({
      success: true,
      message: result.message,
      data: result.member,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to revoke access.",
    });
  }
}

export async function handleVerifyFamilyInvite(req: any, res: Response): Promise<void> {
  try {
    const token = req.query.token as string;
    const email = req.query.email as string;

    if (!token) {
      res.status(400).json({
        success: false,
        message: "Invitation token is required.",
      });
      return;
    }

    const result = await familyService.verifyFamilyInvite(token, email);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Invalid or expired invitation.",
    });
  }
}

export async function handleAcceptFamilyInvite(req: any, res: Response): Promise<void> {
  try {
    const parsed = acceptFamilyInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid registration data.",
        errors: parsed.error.format(),
      });
      return;
    }

    const result = await familyService.acceptFamilyInvite(parsed.data);
    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to activate family account.",
    });
  }
}

export async function handleSendReportToFamily(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const parsed = sendReportToFamilySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid recipient selection.",
        errors: parsed.error.format(),
      });
      return;
    }

    const result = await familyService.sendReportToFamilyRecipients(
      req.user!.id,
      req.params.reportId as string,
      parsed.data
    );

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to dispatch report to family members.",
    });
  }
}
