"""테스트용 단일 페이지(claude.ai 아티팩트) 빌드: index.html 의 본문만 추출하고 템플릿 다운로드 링크를 뺀다.
사용: python3 tools/build_artifact.py <출력 디렉터리>   (출력 디렉터리에 index.html 과 js/ 가 생긴다)"""
import re, shutil, sys, os

root = os.path.join(os.path.dirname(__file__), '..')
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
s = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
style = re.search(r'<style>(.*?)</style>', s, re.S).group(1)
m = re.search(r'@media \(prefers-color-scheme: dark\) \{\s*:root:where\(:not\(\[data-theme="light"\]\)\) \{(.*?)\n  \}\n\}', style, re.S)
style = style.replace(m.group(0), m.group(0) + '\n:root[data-theme="dark"] {' + m.group(1) + '\n}')
body = re.search(r'<body>(.*?)</body>', s, re.S).group(1)
body = re.sub(r'\s*<div class="links">.*?</div>\n', '\n', body, flags=re.S)
body = body.replace('(통장 기준 잔액 입력값만 이 브라우저에 저장됩니다.)', '이 페이지는 외부로 데이터를 보내지 못하도록 막혀 있습니다. (통장 기준 잔액 입력값만 이 브라우저에 저장됩니다.)')
body = body.replace('vendor/xlsx.full.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js').replace('vendor/chart.umd.js', 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js')
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write('<title>경영정보 질문 도구</title>\n<style>' + style + '</style>\n' + body)
shutil.rmtree(os.path.join(out, 'js'), ignore_errors=True)
shutil.copytree(os.path.join(root, 'js'), os.path.join(out, 'js'))
print('built', out)
