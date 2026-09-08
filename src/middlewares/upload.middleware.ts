import multer from "multer";
import path from "path";
import fs from "fs";
import { Request, Response, NextFunction } from "express";

// Ensure reports upload directory exists
const REPORTS_UPLOAD_DIR = path.join(process.cwd(), "uploads", "reports");
if (!fs.existsSync(REPORTS_UPLOAD_DIR)) {
  fs.mkdirSync(REPORTS_UPLOAD_DIR, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(REPORTS_UPLOAD_DIR)) {
      fs.mkdirSync(REPORTS_UPLOAD_DIR, { recursive: true });
    }
    cb(null, REPORTS_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `report-${uniqueSuffix}-${cleanOriginalName}`);
  },
});

// File validation filter
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const isPdfExt = ext === ".pdf";
  const isPdfMime = file.mimetype === "application/pdf" || file.mimetype === "application/x-pdf";

  if (!isPdfExt || !isPdfMime) {
    return cb(new Error("Invalid file format. Only PDF documents (.pdf) are allowed for visit reports."));
  }

  cb(null, true);
};

// Multer upload instance
export const uploadReportMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB
    files: 1,
  },
});

/**
 * Express middleware wrapper to handle multer errors gracefully for reports
 */
export function handleReportFileUpload(req: Request, res: Response, next: NextFunction) {
  const upload = uploadReportMiddleware.single("file");

  upload(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "Uploaded file is too large. Maximum allowed size is 15MB.",
        });
      }
      return res.status(400).json({
        success: false,
        message: `File upload error: ${err.message}`,
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || "Failed to process uploaded file.",
      });
    }

    next();
  });
}

// Ensure authority documents upload directory exists
const AUTHORITY_DOCS_UPLOAD_DIR = path.join(process.cwd(), "uploads", "authority-documents");
if (!fs.existsSync(AUTHORITY_DOCS_UPLOAD_DIR)) {
  fs.mkdirSync(AUTHORITY_DOCS_UPLOAD_DIR, { recursive: true });
}

// Storage configuration for authority documents
const authorityDocStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(AUTHORITY_DOCS_UPLOAD_DIR)) {
      fs.mkdirSync(AUTHORITY_DOCS_UPLOAD_DIR, { recursive: true });
    }
    cb(null, AUTHORITY_DOCS_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `poa-${uniqueSuffix}-${cleanOriginalName}`);
  },
});

// File validation filter for authority docs (PDF, PNG, JPG, JPEG)
const authorityDocFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = [".pdf", ".png", ".jpg", ".jpeg"];
  const isAllowedExt = allowedExts.includes(ext);

  if (!isAllowedExt) {
    return cb(
      new Error(
        "Invalid file format. Only PDF, JPG, or PNG files are accepted for legal authority documents."
      )
    );
  }

  cb(null, true);
};

export const uploadAuthorityDocMiddleware = multer({
  storage: authorityDocStorage,
  fileFilter: authorityDocFileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB
    files: 1,
  },
});

export function handleAuthorityDocFileUpload(req: Request, res: Response, next: NextFunction) {
  const upload = uploadAuthorityDocMiddleware.single("file");

  upload(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "Uploaded file is too large. Maximum allowed size is 15MB.",
        });
      }
      return res.status(400).json({
        success: false,
        message: `File upload error: ${err.message}`,
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || "Failed to process uploaded file.",
      });
    }

    next();
  });
}

