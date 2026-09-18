# 중고차 안전구매 도우미

차량번호만 입력하면 검사/정비 이력, 리콜 정보, 위험 신호, 적정 가치 추정, 비교 차량까지
한 번에 보여주는 중고차 안전 구매 지원 서비스입니다.

## 구조

```
backend/   Express + TypeScript API 서버
frontend/  React + Vite 프론트엔드
```

### 백엔드 (`backend/`)

- `src/providers/car365/` — 공공데이터포털(data.go.kr) "한국교통안전공단_자동차종합정보" 계열
  API 연동 (신규등록정보, 검사이력정보, 정비이력정보, 변경등록정보)
- `src/providers/recall/` — 국토교통부 자동차 리콜정보 API 연동
- `src/valuation/` — 적정 가치 추정 엔진 + 비교 차량 추천
- `src/services/vehicleReportService.ts` — 위 모든 데이터를 모아 하나의 리포트로 조합
- `src/routes/vehicles.ts` — `GET /api/vehicles/:plateNumber`

### 프론트엔드 (`frontend/`)

차량번호 입력 폼과 리포트(기본정보 / 위험 신호 / 적정 가치 / 비교 차량 / 이력 테이블)를 보여주는 SPA.

## 실행 방법

```bash
# 백엔드
cd backend
cp .env.example .env   # 아래 "API 키 발급" 참고하여 값 채우기
npm install
npm run dev             # http://localhost:4000

# 프론트엔드 (새 터미널)
cd frontend
cp .env.example .env
npm install
npm run dev              # http://localhost:5173
```

API 키가 없어도 서버는 정상적으로 동작합니다. 다만 조회 결과에 "데이터 조회 안내" 섹션으로
`DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다`라는 경고가 표시되고, 실제 차량 데이터 대신
빈 이력이 반환됩니다.

## 공공데이터포털(data.go.kr) API 키 발급

1. [data.go.kr](https://www.data.go.kr) 회원가입 및 로그인
2. 아래 API들을 각각 "활용신청"
   - 한국교통안전공단_자동차 종합정보 검사정보 서비스
   - 한국교통안전공단_자동차 종합정보 정비이력정보 서비스
   - 한국교통안전공단_자동차종합정보 신규등록정보 서비스
   - 한국교통안전공단_자동차 종합정보 변경등록정보 서비스
   - 국토교통부_자동차 리콜정보 API 서비스
3. 승인 후 마이페이지 > 개발계정에서 "일반 인증키(Decoding)" 값을 복사
4. `backend/.env`의 `DATA_GO_KR_SERVICE_KEY`에 붙여넣기

> ⚠️ **중요**: 위 API들의 정확한 요청 파라미터명과 응답 필드명은 이 저장소를 만들 당시
> 네트워크 제약으로 공식 문서를 직접 확인하지 못해, 공공데이터포털의 표준 규격을 따른
> **추정값**으로 구현되어 있습니다 (`backend/src/providers/**/*.ts`). 인증키를 발급받은 뒤
> 포털의 "미리보기" 기능으로 실제 응답을 확인하고, 필드명이 다르면 각 provider 파일의
> `mapItem` 함수만 수정하면 됩니다. Base URL / path는 `backend/.env`에서 바로 조정할 수
> 있습니다.

## 적정 가치 추정 & 비교 차량 데이터에 대하여

`backend/src/data/sampleMarketPrices.json`은 실거래 시세 API가 아직 연동되지 않은 상태에서
감가 곡선과 비교 차량 추천 기능을 시연하기 위한 **샘플 데이터**입니다. 실제 서비스로
운영하려면 엔카/KB차차차 등 실매물 시세 데이터 소스와 계약 후 이 파일(또는 해당 모듈)을
교체해야 합니다.

## 알려진 한계

- 자동차 성능/사고 이력의 "정확한" 원천인 카히스토리(보험개발원)·자동차365 서비스는
  사업자 계약이 필요한 유료 API로, 이번 스캐폴드에는 포함되지 않았습니다.
- 공공데이터포털의 차량 이력 API 상당수는 개인정보 보호를 위해 차량 소유자 본인 인증을
  요구할 수 있습니다. 실제 서비스 적용 전 각 API의 이용 약관과 본인인증 요건을 확인하세요.
- 정비 이력 텍스트 기반 침수/사고 키워드 탐지는 보조 신호일 뿐이며, 확정적인 판정이
  아닙니다.
