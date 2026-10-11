#!/usr/bin/env python3
"""Favorite changes preserve content timestamps and library order; synthetic account only."""
import time, uuid
from api_tests import Client, save
client=Client();client.register()
folder=client.request('/folders','POST',{'name':'Ideas'})
tag=client.request('/tags','POST',{'name':'Personal'})
older=client.request('/notes','POST',{'id':str(uuid.uuid4()),'title':'Older thought','content':'Keep this in place.','folder_id':folder['id'],'tags':[tag['id']],'reminder':{'due_at':int(time.time()*1000)+3600000}},201)
time.sleep(.02)
newer=client.request('/notes','POST',{'id':str(uuid.uuid4()),'title':'Newer thought','content':'More recent.'},201)
order=lambda:[n['id'] for n in client.request('/notes')['notes']]
original_order=order(); original_time=older['updated_at']
for selected in [True,False,True]:
    revision=older['revision']
    older=save(client,older,favorite=selected)
    assert older['updated_at']==original_time and older['revision']==revision+1
    assert older['favorite']==selected and older['reminder']['due_at']>0 and older['tags'][0]['id']==tag['id']
    assert order()==original_order
    assert client.request('/notes/'+older['id'])['updated_at']==original_time
print('PASS: repeated favorite toggles preserve timestamp, revision sync, metadata and order after reload')
older=client.request('/notes/'+older['id'],'PUT',{'revision':older['revision'],'favorite':False})
assert older['updated_at']==original_time and order()==original_order
print('PASS: partial favorite updates preserve order')
time.sleep(.02)
older=save(client,older,title='An edited thought',favorite=True)
assert older['updated_at']>newer['updated_at'] and order()[0]==older['id']
print('PASS: real content edits still update modification time and sort normally')
