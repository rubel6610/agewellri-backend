import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import paymentRoutes from "../modules/payment/payment.routes";
import planRoutes from "../modules/plan/plan.routes";
import specialistRoutes from "../modules/specialist/specialist.routes";
import invitationRoutes from "../modules/invitation/invitation.routes";
import agreementRoutes from "../modules/agreement/agreement.routes";
import clientRoutes from "../modules/client/client.routes";
import appointmentRoutes from "../modules/appointment/appointment.routes";
import reportRoutes from "../modules/report/report.routes";
import familyRoutes from "../modules/family/family.routes";
import notificationRoutes from "../modules/notification/notification.routes";

const router = Router();

interface ModuleRoute {
  path: string;
  route: Router;
}

const moduleRoutes: ModuleRoute[] = [
  {
    path: "/auth",
    route: authRoutes,
  },
  {
    path: "/invitations",
    route: invitationRoutes,
  },
  {
    path: "/agreements",
    route: agreementRoutes,
  },
  {
    path: "/clients",
    route: clientRoutes,
  },
  {
    path: "/payments",
    route: paymentRoutes,
  },
  {
    path: "/plans",
    route: planRoutes,
  },
  {
    path: "/specialists",
    route: specialistRoutes,
  },
  {
    path: "/appointments",
    route: appointmentRoutes,
  },
  {
    path: "/reports",
    route: reportRoutes,
  },
  {
    path: "/family-members",
    route: familyRoutes,
  },
  {
    path: "/notifications",
    route: notificationRoutes,
  },
];

moduleRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;
