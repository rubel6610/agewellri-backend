import "dotenv/config";
import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import routes from "./routes";
import { setupSwagger } from "./config/swagger";
import { requestLogger, errorLogger } from "./middlewares/logger.middleware";
import { globalErrorHandler, notFoundHandler } from "./middlewares/error.middleware";

const app: Application = express();

// Middlewares
app.use(
  cors({
    origin: [process.env.FRONTEND_URL!, "https://arfanrubel3000.ilmifygroup.com", "http://localhost:3000"],
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

// Static Assets Uploads
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Global API v1 Routes
app.use("/api/v1", routes);

// 404 Route Not Found Middleware
app.use(notFoundHandler);

// Global Error Logger
app.use(errorLogger);

// Global Human-Readable JSON Error Responder
app.use(globalErrorHandler);

export default app;
