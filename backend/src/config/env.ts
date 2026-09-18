import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  DATA_GO_KR_SERVICE_KEY: z.string().default(""),

  CAR365_INSPECTION_BASE_URL: z.string().default("https://apis.data.go.kr/1613000/InspectHistoryService"),
  CAR365_INSPECTION_PATH: z.string().default("/getInspectHistoryList"),

  CAR365_MAINTENANCE_BASE_URL: z.string().default("https://apis.data.go.kr/1613000/MaintenanceHistoryService"),
  CAR365_MAINTENANCE_PATH: z.string().default("/getMaintenanceHistoryList"),

  CAR365_REGISTRATION_BASE_URL: z.string().default("https://apis.data.go.kr/1613000/NewRegistInfoService"),
  CAR365_REGISTRATION_PATH: z.string().default("/getNewRegistInfoList"),

  CAR365_OWNERSHIP_CHANGE_BASE_URL: z.string().default("https://apis.data.go.kr/1613000/ChangeRegistInfoService"),
  CAR365_OWNERSHIP_CHANGE_PATH: z.string().default("/getChangeRegistInfoList"),

  RECALL_BASE_URL: z.string().default("https://apis.data.go.kr/1613000/RecallInfoService"),
  RECALL_PATH: z.string().default("/getRecallInfoList"),
});

export const env = envSchema.parse(process.env);

export const isServiceKeyConfigured = () => env.DATA_GO_KR_SERVICE_KEY.trim().length > 0;
