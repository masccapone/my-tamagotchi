import { env } from "../../config/env";
import { VehicleBasicInfo } from "../../types/vehicle";
import { fetchDataGoKrItems } from "./client";

const SOURCE = "자동차 신규등록정보";

// data.go.kr 표준 필드명 규격을 따른 추정 매핑입니다. 실제 발급받은 키로 호출한 뒤
// 포털의 "미리보기" 응답을 보고 필드명이 다르면 이 함수만 수정하면 됩니다.
function mapItem(item: Record<string, unknown>, plateNumber: string): VehicleBasicInfo {
  return {
    plateNumber,
    vin: str(item.vinNo ?? item.vin),
    manufacturer: str(item.manufacturerName ?? item.mkrNm),
    modelName: str(item.modelName ?? item.carNm),
    modelYear: num(item.modelYear ?? item.yrMdl),
    firstRegistrationDate: str(item.firstRegistrationDate ?? item.frDate),
    fuelType: str(item.fuelType ?? item.fuelNm),
    displacement: num(item.displacement ?? item.dspAmt),
    usageType: str(item.usageType ?? item.useNm),
    vehicleType: str(item.vehicleType ?? item.carTonNm),
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

export async function getVehicleBasicInfo(plateNumber: string): Promise<VehicleBasicInfo | null> {
  const items = await fetchDataGoKrItems({
    baseUrl: env.CAR365_REGISTRATION_BASE_URL,
    path: env.CAR365_REGISTRATION_PATH,
    query: { carNo: plateNumber },
    source: SOURCE,
  });

  if (items.length === 0) return null;
  return mapItem(items[0], plateNumber);
}
