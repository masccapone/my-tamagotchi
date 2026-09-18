import { env } from "../../config/env";
import { InspectionRecord } from "../../types/vehicle";
import { fetchDataGoKrItems } from "./client";

const SOURCE = "자동차 검사이력정보";

function mapItem(item: Record<string, unknown>): InspectionRecord {
  const defectRaw = item.defectContent ?? item.inspctRsltCtt;
  return {
    inspectionDate: str(item.inspectionDate ?? item.inspctDt) ?? "",
    inspectionType: str(item.inspectionType ?? item.inspctKndNm),
    result: str(item.result ?? item.inspctRsltNm) ?? "확인불가",
    mileageKm: num(item.mileageKm ?? item.travDstc),
    defectItems: defectRaw ? String(defectRaw).split(/[,;]\s*/).filter(Boolean) : undefined,
  };
}

function str(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}
function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

export async function getInspectionHistory(plateNumber: string): Promise<InspectionRecord[]> {
  const items = await fetchDataGoKrItems({
    baseUrl: env.CAR365_INSPECTION_BASE_URL,
    path: env.CAR365_INSPECTION_PATH,
    query: { carNo: plateNumber },
    source: SOURCE,
  });

  return items
    .map(mapItem)
    .sort((a, b) => (a.inspectionDate < b.inspectionDate ? 1 : -1));
}
