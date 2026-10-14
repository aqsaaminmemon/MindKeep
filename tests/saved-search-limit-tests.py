#!/usr/bin/env python3
"""Synthetic-account API checks for the five-search cap, races, restore and deletion."""
from concurrent.futures import ThreadPoolExecutor
from api_tests import Client

def main():
    c=Client(); c.register()
    def create(name, expect=200):
        return c.request('/searches','POST',{'name':name,'query':'project','filters':{'scope':'content'}},expect=expect)
    ids=[create('Saved '+str(i))['id'] for i in range(5)]
    create('Sixth',409)
    assert len(c.request('/searches')['searches'])==5
    backup={'format':'mindkeep-library','version':1,'folders':[],'tags':[],'notes':[],
            'searches':[{'name':'Backup search','query':'project','filters':{}}]}
    c.request('/restore','POST',backup,expect=409)
    assert len(c.request('/searches')['searches'])==5
    c.request('/searches/'+ids[0],'DELETE')
    def concurrent(i):
        try: create('Concurrent '+str(i)); return 200
        except AssertionError as error:
            assert "409" in str(error),str(error)
            return 409
    with ThreadPoolExecutor(max_workers=3) as pool:
        statuses=list(pool.map(concurrent,range(3)))
    assert statuses.count(200)==1 and statuses.count(409)==2,statuses
    assert len(c.request('/searches')['searches'])==5
    c.request('/searches/'+ids[1],'DELETE')
    c.request('/restore','POST',backup)
    assert len(c.request('/searches')['searches'])==5
    other=Client();other.register()
    other.request('/searches','POST',{'name':'Independent account','query':'project'})
    assert len(other.request('/searches')['searches'])==1
    print('PASS: five-search account cap, sixth rejected, concurrent creation serialized, deletion frees a slot, restore honors cap and accounts remain independent')

if __name__=='__main__':main()
