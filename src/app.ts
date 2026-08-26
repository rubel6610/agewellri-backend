import "dotenv/config";
import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import routes from "./routes";
import { setupSwagger } from "./config/swagger";
import { requestLogger, errorLogger } from "./middlewares/logger.middleware";

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
app.use((req:Request,res:Response,next:NextFunction)=>{
  console.log("Request URL:", req.url);
  console.log("Request Headers:", req.headers);
  console.log("Request ip:", req.ip);
  console.log("Request user agent:", req.headers['user-agent']);
  // console.log("Request Body:", req.);
  next();
})
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

// Global JSON Error Responder
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal Server Error";
  res.status(statusCode).json({
    success: false,
    message,
    statusCode,
    ...(process.env.NODE_ENV === "development" ? { stack: err.stack } : {}),
  });
});

export default app;
