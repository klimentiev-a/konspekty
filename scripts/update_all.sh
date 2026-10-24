#!/usr/bin/env bash
# Одно полное обновление данных сайта Hub:
#   рынки (markets.json) → лента новостей (news.json, news_text*.json) → [расписание, если SCHED=1] → коммит в main;
#   история цен и архив новостей по бумагам → ветка data.
# Запускают workflow «Автообновление данных» (каждый час, непрерывно) и «Обновить рынки» (при изменении скриптов).
set -u
cd "$(git rev-parse --show-toplevel)"
export GIT_AUTHOR_NAME=hub-bot GIT_AUTHOR_EMAIL=hub-bot@users.noreply.github.com GIT_COMMITTER_NAME=hub-bot GIT_COMMITTER_EMAIL=hub-bot@users.noreply.github.com
REPO_URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
t0=$(date +%s)

python3 update_markets.py || echo "::warning::update_markets.py завершился с ошибкой"
python3 update_news.py    || echo "::warning::update_news.py завершился с ошибкой"
python3 update_world.py   || echo "::warning::update_world.py завершился с ошибкой"   # карта мира, раз в сутки
python3 update_extra.py   || echo "::warning::update_extra.py завершился с ошибкой"   # дивиденды, отчётность, сводка недели
python3 update_mcap.py    || echo "::warning::update_mcap.py завершился с ошибкой"   # капитализация: раз в 3 дня или сразу при жёстких новостях
if [ "${SCHED:-0}" = 1 ] && [ -f update_schedule.py ]; then python3 update_schedule.py || echo "::warning::расписание не обновилось"; fi

FILES="markets.json news.json news_text.json news_text_arch.json schedule.json schedule_debug.txt world.json world_debug.txt corp_cal.json fin.json digest.json digest_hist.json extra_debug.txt world/mcap.json"
EXIST=""; for f in $FILES; do [ -e "$f" ] && EXIST="$EXIST $f"; done   # git add падает целиком, если указан несуществующий файл
CH=$(git status --porcelain -- $EXIST 2>/dev/null)
if [ -n "$CH" ]; then
  git add -- $EXIST
  git commit -qm "Данные обновлены"
  for i in 1 2 3 4; do
    git pull -q --rebase -X theirs origin main && git push -q "$REPO_URL" HEAD:main && break
    echo "повтор отправки $i"; sleep $((i*5))
  done
fi

rm -rf hist
git clone -q --depth 1 -b data "$REPO_URL" hist 2>/dev/null || mkdir -p hist
python3 update_history.py hist || echo "::warning::история цен не обновилась"
python3 update_enews.py hist   || echo "::warning::архив новостей не обновился"
if [ "$(cat hist/.changed 2>/dev/null || echo 0)" != "0" ]; then
  (cd hist && rm -rf .git .changed && git init -q && git checkout -q -b data && git add -A && git commit -qm "Данные истории цен" && git push -q -f "$REPO_URL" data) \
    || echo "::warning::ветка data не отправилась"
fi
# «Финансы 2»: снимок облигаций и акций — отдельный workflow (ветка fin2-data), запускаем раз в час отсюда
if command -v gh >/dev/null 2>&1 && [ -n "${GITHUB_REPOSITORY:-}" ]; then
  gh workflow run fin2.yml --ref main -R "$GITHUB_REPOSITORY" >/dev/null 2>&1 || echo "::warning::не удалось запустить fin2.yml"
fi
rm -rf hist
echo "обновление заняло $(( $(date +%s) - t0 )) с"
