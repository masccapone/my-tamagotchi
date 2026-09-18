import type { ApiErrorBody, VehicleReport } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  readonly body: ApiErrorBody;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.body = body;
  }
}

export async function fetchVehicleReport(plateNumber: string): Promise<VehicleReport> {
  const response = await fetch(`${API_BASE_URL}/api/vehicles/${encodeURIComponent(plateNumber)}`);

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(body ?? { error: "UNKNOWN_ERROR", message: "요청 처리 중 오류가 발생했습니다." });
  }

  return (await response.json()) as VehicleReport;
}
