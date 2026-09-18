import { env } from "../../config/env";
import { RecallRecord } from "../../types/vehicle";
import { fetchDataGoKrItems } from "../car365/client";

const SOURCE = "자동차 리콜정보";

function mapItem(item: Record<string, unknown>): RecallRecord {
  return {
    recallDate: str(item.recallDate ?? item.rcllDt) ?? "",
    manufacturer: str(item.manufacturer ?? item.mkrNm) ?? "",
    modelName: str(item.modelName ?? item.carNm) ?? "",
    reason: str(item.reason ?? item.rcllRsnCtt) ?? "",
    remedy: str(item.remedy ?? item.rcllMthCtt),
  };
}

function str(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}

/**
 * 리콜정보 API는 차량번호가 아닌 제작사/모델명 기준으로 조회하는 것이 일반적입니다.
 * (자동차종합정보 API로 먼저 기본정보를 조회해 제작사/모델명을 얻은 뒤 사용)
 */
export async function getRecallsByModel(manufacturer: string, modelName: string): Promise<RecallRecord[]> {
  if (!manufacturer && !modelName) return [];

  const items = await fetchDataGoKrItems({
    baseUrl: env.RECALL_BASE_URL,
    path: env.RECALL_PATH,
    query: { mkrNm: manufacturer, carNm: modelName },
    source: SOURCE,
  });

  return items.map(mapItem).sort((a, b) => (a.recallDate < b.recallDate ? 1 : -1));
}
