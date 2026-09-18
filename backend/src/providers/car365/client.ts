import axios, { AxiosError } from "axios";
import { XMLParser } from "fast-xml-parser";
import { env } from "../../config/env";

/**
 * 공공데이터포털(data.go.kr)의 대부분 OpenAPI는 아래와 같은 공통 응답 규격을 따릅니다.
 *   XML: <response><header><resultCode/><resultMsg/></header><body><items><item>...</item></items></body></response>
 *   JSON(_type=json 파라미터): { response: { header: {...}, body: { items: { item: [...] } } } }
 * resultCode가 "00"이 아니면 에러로 취급합니다.
 */

const xmlParser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });

export class DataGoKrApiError extends Error {
  constructor(
    message: string,
    public readonly resultCode?: string,
    public readonly source?: string,
  ) {
    super(message);
    this.name = "DataGoKrApiError";
  }
}

interface CommonResponseBody {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: { item?: unknown } };
  };
}

function normalizeItems(item: unknown): Record<string, unknown>[] {
  if (item == null) return [];
  return Array.isArray(item) ? (item as Record<string, unknown>[]) : [item as Record<string, unknown>];
}

export async function fetchDataGoKrItems(params: {
  baseUrl: string;
  path: string;
  query: Record<string, string | number | undefined>;
  source: string;
}): Promise<Record<string, unknown>[]> {
  if (!env.DATA_GO_KR_SERVICE_KEY) {
    throw new DataGoKrApiError(
      "DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다. .env 파일에 공공데이터포털에서 발급받은 인증키를 넣어주세요.",
      undefined,
      params.source,
    );
  }

  const url = `${params.baseUrl}${params.path}`;

  try {
    const response = await axios.get(url, {
      params: {
        serviceKey: env.DATA_GO_KR_SERVICE_KEY,
        pageNo: 1,
        numOfRows: 100,
        _type: "json",
        ...params.query,
      },
      timeout: 10_000,
      // data.go.kr는 종종 JSON 요청에도 XML 에러를 반환하므로 text로 받아 직접 파싱한다.
      responseType: "text",
      transformResponse: (data) => data,
    });

    const raw = response.data as string;
    const parsed: CommonResponseBody = raw.trim().startsWith("<")
      ? xmlParser.parse(raw)
      : JSON.parse(raw);

    const header = parsed.response?.header;
    if (header?.resultCode && header.resultCode !== "00") {
      throw new DataGoKrApiError(
        `${params.source} 응답 오류: ${header.resultMsg ?? "알 수 없는 오류"}`,
        header.resultCode,
        params.source,
      );
    }

    return normalizeItems(parsed.response?.body?.items?.item);
  } catch (error) {
    if (error instanceof DataGoKrApiError) throw error;
    const axiosError = error as AxiosError;
    throw new DataGoKrApiError(
      `${params.source} 호출 실패: ${axiosError.message}`,
      undefined,
      params.source,
    );
  }
}
