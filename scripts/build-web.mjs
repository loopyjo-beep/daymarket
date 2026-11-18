// 앱에 넣을 화면 파일을 www/ 로 복사한다. 시세·환율 데이터는 앱 안에 넣지 않고 웹 주소에서 매번 받아 온다.
import { mkdir, copyFile, rm } from 'node:fs/promises';
await rm('www', { recursive: true, force: true });
await mkdir('www', { recursive: true });
await copyFile('index.html', 'www/index.html');
console.log('www/index.html 준비 완료');
