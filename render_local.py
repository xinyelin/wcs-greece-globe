# Re-renders index.html and classic.html from templates/ after a UI edit,
# reusing the artist data already in the checked-out index.html — so a design
# change goes live immediately on push instead of waiting for the weekly
# sheet sync (api/sync-sheet.js), and never touches the data itself.
#
#   edit templates/globe.html  ->  python render_local.py  ->  git push
#
# The Google Sheet stays the only source of truth for artists: this script
# will refuse to run if it can't find the ARTISTS array to carry over.
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
p = lambda *parts: os.path.join(HERE, *parts)


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def render(template, data_js, landmask):
    start = template.index('/*__DATA__*/')
    end = template.index('/*__END__*/') + len('/*__END__*/')
    html = template[:start] + data_js + template[end:]
    if landmask:
        html = html.replace('/*__LANDMASK__*/', landmask)
    return html


m = re.search(r'const ARTISTS = (\[.*?\]);\n', read(p('index.html')), re.S)
if not m:
    sys.exit('ABORT: could not find the ARTISTS array in index.html — '
             'restore it from git (git checkout -- index.html) and retry.')
data_js = m.group(1)
artists = json.loads(data_js)  # validates the carried-over data parses

landmask = read(p('data', 'landmask.txt')).strip()

with open(p('index.html'), 'w', encoding='utf-8') as f:
    f.write(render(read(p('templates', 'globe.html')), data_js, landmask))
with open(p('classic.html'), 'w', encoding='utf-8') as f:
    f.write(render(read(p('templates', 'classic.html')), data_js, None))

print(f're-rendered index.html + classic.html with {len(artists)} artists')
