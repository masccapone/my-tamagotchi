import { env } from "../../config/env";
import { MaintenanceRecord } from "../../types/vehicle";
import { fetchDataGoKrItems } from "./client";

const SOURCE = "자동차 정비이력정보";

function mapItem(item: Record<string, unknown>): MaintenanceRecord {
  return {
    serviceDate: str(item.serviceDate ?? item.mntncDt) ?? "",
    mileageKm: num(item.mileageKm ?? item.travDstc),
    workshopName: str(item.workshopName ?? item.entpNm),
    workType: str(item.workType ?? item.mntncPartNm),
    description: str(item.description ?? item.mntncCtt),
    cost: num(item.cost ?? item.mntncCost),
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

export async function getMaintenanceHistory(plateNumber: string): Promise<MaintenanceRecord[]> {
  const items = await fetchDataGoKrItems({
    baseUrl: env.CAR365_MAINTENANCE_BASE_URL,
    path: env.CAR365_MAINTENANCE_PATH,
    query: { carNo: plateNumber },
    source: SOURCE,
  });

  return items
    .map(mapItem)
    .sort((a, b) => (a.serviceDate < b.serviceDate ? 1 : -1));
}
