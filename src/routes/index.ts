import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import paymentRoutes from "../modules/payment/payment.routes";
import planRoutes from "../modules/plan/plan.routes";
import specialistRoutes from "../modules/specialist/specialist.routes";

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
];

moduleRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;
