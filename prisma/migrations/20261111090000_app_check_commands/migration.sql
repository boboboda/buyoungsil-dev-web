-- 병렬화 C 보완: 앱별 합치기·최종 점검 검사 명령(factory_settings 의 appCheckCommands 한 칸, 스키마 변경 없음). 추가만 한다.
-- game-toolkit(nestjs 로 등록돼 tsc 만 돌던 앱)에는 이 PC 에서 실제로 도는 시험 명령을 처음 값으로 넣는다. 이미 값이 있으면 건드리지 않는다.
-- (pytest 는 설치돼 있지 않고 시험이 unittest 기반이라 'python -m unittest discover -s tests -q' 를 쓴다. 확인: 256개 통과, 깨끗한 사본에서도 통과)
INSERT INTO "factory_settings" ("key", "value", "updatedAt") VALUES ('appCheckCommands', '{"game-toolkit":["python -m unittest discover -s tests -q"]}', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
