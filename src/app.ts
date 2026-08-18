import "dotenv/config";
import express, { Application, Request, Response } from "express";
import cors from "cors";
import routes from "./routes";
import { setupSwagger } from "./config/swagger";

const app: Application = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

export default app;