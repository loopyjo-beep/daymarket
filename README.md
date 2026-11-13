# daymarket 데모 (v6.2)

## 들어 있는 것
- `index.html` : 화면 전체. 주가는 아직 가상 데이터이고, 미국 주식 환율은 실제 데이터를 씁니다.
- `scripts/fetch-usdkrw.mjs` : 한국은행 ECOS에서 원/달러 매매기준율(일별)을 받아 `data/usdkrw.json`에 저장합니다.
- `.github/workflows/update-fx.yml` : 위 스크립트를 평일 하루 두 번(한국 시간 12:10, 18:10) 자동으로 실행합니다.

## 환율을 어디서 가져오나
1. `data/usdkrw.json` (한국은행 ECOS 매매기준율, 자동 갱신 파일) — 1순위
2. 파일이 없거나 최근 날짜가 3일 넘게 비면, 빈 날짜만 Frankfurter(유럽중앙은행 기준환율로 계산한 원/달러)로 채웁니다. 화면 하단 출처에 그렇게 표시됩니다.
3. 둘 다 안 되면 가상 환율로 계산하고 화면 위에 "가상 시세"라고 표시합니다.

환전 비용은 매매기준율에 0.5%를 가정합니다(살 때 +0.5%, 팔 때 -0.5%). 증권사 기본 스프레드 1%와 우대 95%(0.05%)의 중간값입니다. `index.html`의 `EX_SPREAD` 값 하나만 고치면 바뀝니다.

## 처음 한 번만 하는 설정 (약 20분)
1. 한국은행 ECOS 인증키 발급: https://ecos.bok.or.kr/api/ 에서 회원가입 후 "인증키 신청". 무료입니다.
2. GitHub에서 새 저장소를 만들고(공개 저장소면 Actions와 Pages가 무료) 이 폴더의 파일을 그대로 올립니다. `.github` 폴더도 함께 올려야 합니다.
3. 저장소 Settings > Secrets and variables > Actions > New repository secret
   - Name: `ECOS_KEY`
   - Secret: 1번에서 받은 키
4. Actions 탭 > update-fx > Run workflow 를 한 번 눌러 실행합니다. 처음에는 2010년부터 전부 받아 `data/usdkrw.json`이 생깁니다.
5. Settings > Pages > Source: Deploy from a branch, Branch: main / (root) 로 저장하면 몇 분 뒤 `https://<아이디>.github.io/<저장소>/` 주소로 열립니다.

## 확인 방법
- 화면 위 표시가 "데모 · 가상 주가 · 실제 환율"이면 정상입니다.
- 화면 맨 아래 "환율:" 뒤에 "한국은행 ECOS 원/달러 매매기준율"이 보이면 1순위 파일을 쓰는 중입니다.
- Actions 실행이 실패하면 기존 파일은 그대로 남고 화면은 계속 동작합니다. 로그 첫 줄의 "사용 항목"에 원/미국달러(매매기준율)가 찍혔는지 확인하세요.

## 아직 확인하지 못한 것
- ECOS 원/달러 매매기준율이 하루 중 언제 올라오는지. 그래서 하루 두 번 실행하도록 잡았습니다.
- ECOS 통계표 코드. 스크립트가 731Y001에서 "미국달러 + 매매기준율" 항목을 이름으로 찾고, 없으면 036Y001을 시도합니다.
