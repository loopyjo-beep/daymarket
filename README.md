# daymarket (베타)

"그때 샀다면 지금 얼마일까?"를 원화와 환율까지 반영해 계산합니다.
웹: https://loopyjo-beep.github.io/daymarket/

## 들어 있는 것
| 파일 | 하는 일 |
|---|---|
| `index.html` | 화면 전체. 웹과 앱이 같은 파일을 씁니다 |
| `scripts/fetch-prices.mjs` | 지원 종목 19개의 일별 종가를 `data/prices/`에 저장 |
| `scripts/fetch-usdkrw.mjs` | 한국은행 ECOS 원/달러 매매기준율을 `data/usdkrw.json`에 저장 |
| `.github/workflows/update-prices.yml` | 시세 수집을 평일 한국 시간 14:10에 자동 실행 |
| `.github/workflows/update-fx.yml` | 환율 수집을 평일 12:10, 18:10에 자동 실행 |
| `.github/workflows/android.yml` | 안드로이드 앱 빌드. 테스트용 APK를 Releases에 올림 |
| `package.json`, `capacitor.config.json`, `assets/` | 안드로이드 앱 설정과 아이콘 |

## 데이터 출처
| 항목 | 출처 | 비용 | 범위 |
|---|---|---|---|
| 국내 주가 | 한국거래소(KRX) OPEN API 유가증권·코스닥 일별매매정보 | 무료(키당 하루 10,000건) | 2010년 1월 ~ 전일 |
| 미국 주가 | Marketstack Basic | 월 9.99달러 | 최근 10년 ~ 전 거래일 |
| 환율 | 한국은행 ECOS 매매기준율, 없으면 ECB(Frankfurter) | 무료 | 2010년 이후 |

- 모든 주가는 종가 기준이고, 배당은 넣지 않았습니다.
- 액면분할 보정: 미국은 Marketstack이 주는 분할 정보를 씁니다. 국내는 하루 가격제한폭(±30%)을 넘는 변화를 분할·병합으로 판단해 보정합니다. 보정한 날짜는 Actions 로그에 남습니다.
- 시세 파일이 없는 종목은 가상 주가로 계산하고, 결과 화면에 "실제 주가가 아니에요"라고 표시합니다.
- KRX OPEN API 약관: 비상업 목적으로만 쓸 수 있고 제3자 제공이 금지되며, 화면에 "한국거래소 통계정보"를 사용한 결과임을 명시해야 합니다(화면 하단 출처에 표시). 광고·구독 등 수익화 전에는 KRX·코스콤 정보이용계약을 따로 확인해야 합니다.

## 저장소에 등록할 비밀값
Settings > Secrets and variables > Actions > New repository secret

| 이름 | 어디서 받나 | 없으면 |
|---|---|---|
| `KRX_AUTH_KEY` | openapi.krx.co.kr 회원가입 → 인증키 신청 → 승인 후 "유가증권 일별매매정보", "코스닥 일별매매정보" API 이용 신청 | 국내 종목이 가상 주가로 남음 |
| `MARKETSTACK_KEY` | marketstack.com에서 Basic 플랜 결제 → 대시보드의 API Access Key | 미국 종목이 가상 주가로 남음 |
| `ECOS_KEY` | ecos.bok.or.kr/api 인증키 신청 | 환율은 ECB 기준으로 표시 |

키를 등록한 뒤 Actions 탭에서 update-prices, update-fx를 한 번씩 수동 실행하면 데이터가 생깁니다. 국내 첫 실행은 2010년부터 받느라 1시간 안팎 걸릴 수 있습니다.

## 안드로이드 앱
- 코드를 올릴 때마다 Actions의 android가 자동으로 돌고, Releases의 "안드로이드 테스트 빌드"에 `daymarket-debug.apk`가 올라갑니다.
- 휴대폰에서 그 파일을 받아 설치하면 됩니다. 설치할 때 "출처를 알 수 없는 앱 허용"을 한 번 켜야 합니다.
- 앱은 화면만 안에 들어 있고, 시세·환율은 위 웹 주소에서 매번 받아 옵니다. 데이터가 갱신되면 앱을 다시 설치하지 않아도 반영됩니다.

### Play 스토어에 올리려면 (나중에)
1. Google Play 개발자 계정(US$25, 한 번만)
2. 서명 키를 만들어 비밀값 4개 등록: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. 등록하면 android 빌드가 스토어용 `daymarket-release.aab`도 만듭니다(Actions 실행 결과의 Artifacts).
3. 2023-11-13 이후 만든 개인 계정은 테스터 12명이 14일 연속 참여하는 비공개 테스트를 거쳐야 정식 출시를 신청할 수 있습니다.
4. 신규 앱은 Android 16(API 36) 이상을 대상으로 해야 합니다. 이 프로젝트는 Capacitor 8로 API 36을 대상으로 빌드합니다.
