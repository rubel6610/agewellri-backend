import "dotenv/config";
import express, { Application, Request, Response } from "express";

const app: Application = express();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check / Base Route
app.get("/", (req: Request, res: Response) => {
  res.status(200).send("Age Well RI Backend is running");
});

export default app;