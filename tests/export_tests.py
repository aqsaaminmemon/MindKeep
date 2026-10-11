#!/usr/bin/env python3
"""Long-note PDF pagination/Unicode and Markdown structural checks."""
import os, pathlib, subprocess, sys, uuid
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from api_tests import Client
client=Client();client.register()
content='<h1>Long everyday note</h1><p>Café — اردو — مرحبا</p><ol><li>First item</li><li>Second item</li></ol><ul><li data-checked="true">Complete</li><li data-checked="false">Still to do</li></ul>'
content+=''.join(f'<h2>Thought {i}</h2><p>'+('A little room for the unexpected. Café and a quiet moment. '*10)+'</p>' for i in range(1,61))
note=client.request('/notes','POST',{'id':str(uuid.uuid4()),'title':'Long PDF verification','content':content},201)
pdf=client.request('/notes/'+note['id']+'/export?format=pdf',raw=True)
path=pathlib.Path('/tmp/mindkeep-long-export.pdf');path.write_bytes(pdf)
info=subprocess.check_output(['pdfinfo',str(path)],text=True)
import re
pages=int(re.search(r'Pages:\s+(\d+)',info)[1]);assert pages>1,info
text=subprocess.check_output(['pdftotext','-layout',str(path),'-'],text=True)
assert 'Thought 60' in text and 'Café' in text,text[-1000:]
markdown=client.request('/notes/'+note['id']+'/export?format=md',raw=True).decode()
assert '# Long everyday note' in markdown and '- [x] Complete' in markdown and '1. First item' in markdown and '2. Second item' in markdown
print(f'PASS: real PDF, {pages} pages, final paragraph and Unicode survive; Markdown headings/checklists preserved')
