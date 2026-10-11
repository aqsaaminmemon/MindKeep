#!/usr/bin/env python3
"""Synthetic account check for multiple note trash moves and restoration."""
import uuid
from api_tests import Client, save
client=Client();client.register()
notes=[client.request('/notes','POST',{'id':str(uuid.uuid4()),'title':'Batch '+str(i),'content':'<p>Preserve '+str(i)+'</p>'},201) for i in range(3)]
for note in notes[:2]:
    moved=save(client,note,deleted=True)
    assert moved['deleted'] and moved['content']==note['content']
    assert moved['revision']==note['revision']+1
library={n['id']:n for n in client.request('/notes')['notes']}
assert all(library[n['id']]['deleted'] for n in notes[:2])
assert not library[notes[2]['id']]['deleted']
for note in notes[:2]:
    restored=save(client,library[note['id']],deleted=False)
    assert not restored['deleted'] and restored['content']==note['content']
print('PASS: multiple selected notes persist in Trash; unselected note is untouched; both notes restore with content intact')
