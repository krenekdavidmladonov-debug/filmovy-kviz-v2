import json
import pathlib
import os
import sys
import subprocess
from pypdf import PdfReader

directory = pathlib.Path(sys.argv[1]).resolve()
assert directory.name == 'evidence' and directory.parent.name == 'whole-evening'
secret, title = sys.argv[2:4]
evidence = {}
for kind in ['team-sheets', 'answer-key']:
    file = directory / (kind + '.pdf')
    reader = PdfReader(file)
    text = '\n'.join(page.extract_text() or '' for page in reader.pages)
    assert title in text, (kind, 'frozen title absent')
    if kind == 'team-sheets':
        assert secret not in text and 'PRIVATE_' not in text
        assert 'Synthetic print instructions' in text and 'Frozen footer' in text
    else:
        assert secret in text, 'answer key must contain privileged answers'
    subprocess.run([os.environ.get('WHOLE_EVENING_PDFTOPPM', 'pdftoppm'), '-png', '-r', '110', str(file), str(directory / (kind + '-page'))], check=True)
    evidence[kind] = {'pages': len(reader.pages), 'textCharacters': len(text), 'frozenTitle': True, 'playerAnswersAbsent': kind == 'team-sheets'}
(directory / 'pdf-evidence.json').write_text(json.dumps(evidence, indent=2), encoding='utf8')
print(json.dumps(evidence))
