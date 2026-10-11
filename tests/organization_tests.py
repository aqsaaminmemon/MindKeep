#!/usr/bin/env python3
"""Organization deletion preserves notes, using a synthetic account only."""
import uuid
from api_tests import Client
client=Client();client.register()
folder=client.request('/folders','POST',{'name':'Delete test folder'})
tag=client.request('/tags','POST',{'name':'Delete test tag'})
note=client.request('/notes','POST',{'id':str(uuid.uuid4()),'title':'Keep this note','content':'<p>Keep this content.</p>','folder_id':folder['id'],'tags':[tag['id']]},201)
for kind,item in [('folders',folder),('tags',tag)]:
    client.request('/'+kind+'/'+item['id'],'DELETE')
    assert all(x['id']!=item['id'] for x in client.request('/'+kind)[kind])
    saved=client.request('/notes/'+note['id'])
    assert saved['title']==note['title'] and saved['content']==note['content']
    assert not saved['deleted'] and saved['revision']>note['revision']
    if kind=='folders': assert not saved['folder_id'] and saved['tags'][0]['id']==tag['id']
    else: assert not saved['tags']
    note=saved
print('PASS: deleting folders and tags keeps notes and content, detaches organization, and advances sync revisions')
