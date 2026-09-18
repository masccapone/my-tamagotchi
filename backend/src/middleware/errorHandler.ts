import { NextFunction, Request, Response } from "express";
import { DataGoKrApiError } from "../providers/car365/client";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof DataGoKrApiError) {
    return res.status(502).json({ error: "UPSTREAM_API_ERROR", message: err.message, source: err.source });
  }

  console.error(err);
  res.status(500).json({ error: "INTERNAL_ERROR", message: "서버 내부 오류가 발생했습니다." });
}
