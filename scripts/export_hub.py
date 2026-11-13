#!/usr/bin/env python3
"""Выгрузка Hub для Артёма в /mnt/user-data/outputs/hub-export (потом device_commit_files в
C:\\Users\\Aristotel\\Desktop\\Hub\\Выгрузка). Запуск: python3 scripts/export_hub.py [id конспекта ...]
Всегда пишет hub-repo.zip, Конспекты.zip, CLAUDE.md, README.txt; отдельные md — только для указанных id
(или для всех, если указать all). В конце печатает JSON для device_commit_files."""
import json, os, re, shutil, subprocess, sys, zipfile, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = '/mnt/user-data/outputs/hub-export'
DEV = 'C:\\Users\\Aristotel\\Desktop\\Hub\\Выгрузка\\'
ids = set(sys.argv[1:])
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT + '/Конспекты')
subprocess.check_call(['git', 'archive', '--format=zip', '-o', OUT + '/hub-repo.zip', 'HEAD'], cwd=ROOT)
shutil.copy(ROOT + '/CLAUDE.md', OUT + '/CLAUDE.md')
# локальный запуск: двойной щелчок по «Открыть сайт.bat» (PowerShell есть в любой Windows, Python не нужен)
open(OUT + '/serve.ps1', 'w', encoding='utf-8-sig', newline='\r\n').write(open(ROOT + '/scripts/local/serve.ps1', encoding='utf-8').read())
VBS = ('Set fso = CreateObject("Scripting.FileSystemObject")\r\nSet sh = CreateObject("WScript.Shell")\r\n'
 'd = fso.GetParentFolderName(WScript.ScriptFullName)\r\ns = d & "\\serve.ps1"\r\n'
 'If Not fso.FileExists(s) Then\r\n  For Each f In fso.GetFolder(d).SubFolders\r\n    If fso.FileExists(f.Path & "\\serve.ps1") Then s = f.Path & "\\serve.ps1"\r\n  Next\r\nEnd If\r\n'
 'If Not fso.FileExists(s) Then\r\n  MsgBox "serve.ps1 not found"\r\n  WScript.Quit\r\nEnd If\r\n'
 'If Not fso.FolderExists(fso.GetParentFolderName(s) & "\\" & ChrW(1057) & ChrW(1072) & ChrW(1081) & ChrW(1090)) Then sh.Popup "First start: unpacking, wait about a minute", 4, "Hub", 64\r\n'
 'sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & s & """", 0, False\r\n')
open(OUT + '/Открыть сайт.vbs', 'w', encoding='ascii', newline='').write(VBS)
ver = re.search(r"hub-v(\d+)", open(ROOT + '/sw.js', encoding='utf-8').read()).group(0)
open(OUT + '/README.txt', 'w', encoding='utf-8').write(
    f"Выгрузка Hub Артёма, {datetime.date.today()}, версия сайта {ver}.\n"
    "hub-repo.zip: весь сайт (исходники, страницы, данные, скрипты), без истории git (история на GitHub klimentiev-a/konspekty).\n"
    "Конспекты.zip: все конспекты Учёбы md-файлами по предметам.\n"
    "Конспекты/: отдельные md, обновляются только изменённые.\nCLAUDE.md: правила работы с репозиторием.\n")
safe = lambda s: re.sub(r'[\\/:*?"<>|]+', '-', s).strip()[:80]
d = json.load(open(ROOT + '/src/data.json', encoding='utf-8'))
items = [OUT + '/' + f for f in ('hub-repo.zip', 'CLAUDE.md', 'README.txt', 'serve.ps1', 'Открыть сайт.vbs')]
zf = zipfile.ZipFile(OUT + '/Конспекты.zip', 'w', zipfile.ZIP_DEFLATED)
items.append(OUT + '/Конспекты.zip')
for s in d['subjects']:
    sn = safe(s['name'].split(':')[0])
    if s.get('about'):
        zf.writestr(f'{sn}/00 О предмете.md', f"# {s['name']}\n\n{s['about']}")
    for i, n in enumerate(s['notes'], 1):
        body = f"# {n['title']}\n\n*{s['name']} · {n.get('date','')} · id: {n['id']}*\n\n" + n['md']
        rel = f"{sn}/{i:02d} {safe(n['title'])}.md"
        zf.writestr(rel, body)
        if 'all' in ids or n['id'] in ids:
            p = f'{OUT}/Конспекты/{rel}'; os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, 'w', encoding='utf-8').write(body); items.append(p)
zf.close()
print(json.dumps([{'devicePath': DEV + p[len(OUT) + 1:].replace('/', '\\'), 'stagedPath': p} for p in items], ensure_ascii=False))
