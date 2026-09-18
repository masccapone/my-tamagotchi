import { createApp } from "./app";
import { env, isServiceKeyConfigured } from "./config/env";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`중고차 안전 구매 지원 API 서버가 http://localhost:${env.PORT} 에서 실행 중입니다.`);
  if (!isServiceKeyConfigured()) {
    console.warn(
      "[경고] DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다. .env 파일을 확인하세요 (backend/.env.example 참고).",
    );
  }
});
