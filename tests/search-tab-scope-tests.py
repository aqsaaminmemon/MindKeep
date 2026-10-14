#!/usr/bin/env python3
"""Tab-specific searches against C++ with an isolated synthetic account."""
import time,uuid
from api_tests import Client

def main():
    c=Client();c.register();notes={}
    for i in range(8):
        fields={'favorite':i in [0,1,6,7], 'archived':i==6, 'deleted':i==7}
        if i in [1,6,7]:fields['reminder']={'due_at':int(time.time()*1000)+86400000}
        n=c.request('/notes','POST',{'id':str(uuid.uuid4()),'title':'Project '+str(i),'content':'<p>project task</p>',**fields},201)
        notes[i]=n['id']
    def result(category,query='project state:all'):
        return {n['id'] for n in c.request('/search','POST',{'query':query,'filters':{'category':category}})['results']}
    assert result('active')=={notes[i] for i in range(6)}
    assert result('favorites')=={notes[0],notes[1]}
    assert result('reminders')=={notes[1]}
    assert result('archived')=={notes[6]}
    assert result('trash')=={notes[7]}
    assert result('recent')==set()
    for i in range(6):
        c.request('/notes/'+notes[i]);time.sleep(.01)
    assert result('recent')=={notes[i] for i in range(1,6)}
    assert result('recent','"project task"')=={notes[i] for i in range(1,6)}
    c.request('/notes/'+notes[0]);assert result('recent')=={notes[i] for i in [0,2,3,4,5]}
    for category in ['favorites','recent','reminders']:
        saved=c.request('/searches','POST',{'name':category,'query':'project','filters':{'category':category}})
        row=next(s for s in c.request('/searches')['searches'] if s['id']==saved['id'])
        assert row['filters']['category']==category
    print('PASS: actual Favorites, Reminders, All Notes, Archive, Trash and latest-five Recent scope; inline states cannot escape; saved searches remember tabs')

if __name__=='__main__':main()
