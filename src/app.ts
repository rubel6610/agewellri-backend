import "dotenv/config";
import express, { Application, Request, Response } from "express";
import cors from "cors";
import routes from "./routes";
import { setupSwagger } from "./config/swagger";
import { requestLogger, errorLogger } from "./middlewares/logger.middleware";

const app: Application = express();

// Middlewares
app.use(
  cors({
    origin: [process.env.FRONTEND_URL!,"https://arfanrubel3000.ilmifygroup.com", "http://localhost:3000", ],
    credentials: true,
  })
);
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Terminal Request Logger
app.use(requestLogger);

// Swagger UI Documentation
setupSwagger(app);

// Health Check / Base Route
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Age Well RI Backend is running",
    documentation: "/docs",
  });
});

// Global API v1 Routes
app.use("/api/v1", routes);

// Global Error Logger
app.use(errorLogger);

export default app;
