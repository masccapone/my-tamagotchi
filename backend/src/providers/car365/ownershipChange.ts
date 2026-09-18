import { env } from "../../config/env";
import { OwnershipChangeRecord } from "../../types/vehicle";
import { fetchDataGoKrItems } from "./client";

const SOURCE = "자동차 변경등록정보";

function mapItem(item: Record<string, unknown>): OwnershipChangeRecord {
  return {
    changeDate: str(item.changeDate ?? item.chgDt) ?? "",
    changeType: str(item.changeType ?? item.chgKndNm) ?? "변경",
    region: str(item.region ?? item.ldongNm),
  };
}

function str(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}

export async function getOwnershipChangeHistory(plateNumber: string): Promise<OwnershipChangeRecord[]> {
  const items = await fetchDataGoKrItems({
    baseUrl: env.CAR365_OWNERSHIP_CHANGE_BASE_URL,
    path: env.CAR365_OWNERSHIP_CHANGE_PATH,
    query: { carNo: plateNumber },
    source: SOURCE,
  });

  return items
    .map(mapItem)
    .sort((a, b) => (a.changeDate < b.changeDate ? 1 : -1));
}
