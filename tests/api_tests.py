#!/usr/bin/env python3
"""Integration tests against a running local server; only synthetic test accounts."""
import base64, http.cookiejar, json, os, time, urllib.request, urllib.error, uuid, io, wave
BASE=os.getenv('MINDKEEP_TEST_URL','http://localhost:8080')
PASSWORD='test-only-correct-horse-battery'
passed=0
class Client:
    def __init__(self):
        self.cookies=http.cookiejar.CookieJar()
        self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.csrf=''
    def request(self,path,method='GET',body=None,expect=200,raw=False):
        headers={'Origin':BASE}
        if hasattr(self,'user'):headers['X-Account-ID']=self.user['id']
        if method!='GET': headers['X-CSRF-Token']=self.csrf
        if body is not None:
            headers['Content-Type']='application/json'
            body=json.dumps(body).encode()
        req=urllib.request.Request(BASE+'/api'+path,data=body,method=method,headers=headers)
        try:
            response=self.opener.open(req,timeout=40)
            status=response.status; content=response.read()
        except urllib.error.HTTPError as error:
            status=error.code;content=error.read()
        assert status==expect,(path,status,content[:500])
        return content if raw else json.loads(content)
    def register(self):
        email='test-'+uuid.uuid4().hex+'@example.test'
        response=self.request('/auth/register','POST',{'email':email,'name':'Integration test','password':PASSWORD},200)
        self.csrf=response['csrf'];self.user=response['user'];self.email=email
        return response
    def upload(self,note,data,mime='image/png',operation_id=None):
        boundary='mindkeep-'+uuid.uuid4().hex
        body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: {mime}\r\n\r\n'.encode()+data+f'\r\n--{boundary}--\r\n'.encode())
        req=urllib.request.Request(BASE+'/api/notes/'+note+'/attachments',method='POST',data=body,headers={'Origin':BASE,'X-Account-ID':self.user['id'],'X-CSRF-Token':self.csrf,'Content-Type':'multipart/form-data; boundary='+boundary,**({'X-Upload-ID':operation_id} if operation_id else {})})
        return json.load(self.opener.open(req,timeout=20))
def check(condition,label):
    global passed
    assert condition,label
    passed+=1;print('PASS:',label)
def save(client,n,**fields):
    body=dict(n);body.update(fields)
    body['tags']=[t['id'] if isinstance(t,dict) else t for t in body.get('tags',[])]
    return client.request('/notes/'+n['id'],'PUT',body)
def main():
    a,b=Client(),Client();a.register();b.register()
    check(a.request('/auth/session')['user']['id']!=b.user['id'],'Separate accounts')
    original_user=a.user
    a.user=b.user
    a.request('/notes',expect=401)
    a.user=original_user
    check(True,'Cross-tab account guard prevents local library mixing')
    folder=a.request('/folders','POST',{'name':'Personal ideas'});tag=a.request('/tags','POST',{'name':'Everyday'})
    noteid=str(uuid.uuid4())
    n=a.request('/notes','POST',{'id':noteid,'title':'Weekend ideas','content':'<h2>Little things</h2><p>take the scenic route café اردو</p><ul><li data-checked="true">Buy flowers</li></ul>','folder_id':folder['id'],'tags':[tag['id']]},201)
    again=a.request('/notes','POST',{'id':noteid,'title':'Retry','content':'retry'},201)
    check(n['revision']==1 and again['title']=='Weekend ideas','Idempotent create retains original')
    a.request('/notes/'+noteid,raw=False)
    opened=a.request('/notes/'+noteid)
    check(opened['updated_at']==n['updated_at'],'Opening does not modify content timestamp')
    check(b.request('/notes')['notes']==[],'Private library isolation')
    b.request('/notes/'+noteid,expect=404)
    check(not b.request('/search','POST',{'query':'scenic'})['results'],'Private search isolation')
    check(len(a.request('/search','POST',{'query':'"the scenic route" tag:Everyday folder:"Personal ideas"'})['results'])==1,'C++ phrase and organization search')
    a.request('/search','POST',{'query':'before:2025-02-30'},expect=400)
    check(True,'Invalid search syntax returns error')
    foreign=b.request('/folders','POST',{'name':'Other account'})
    a.request('/notes/'+noteid,'PUT',{'revision':n['revision'],'folder_id':foreign['id']},expect=400)
    check(True,'Cross-account folder rejected')
    n=save(a,n,title='Weekend plans',pinned=True,favorite=True)
    conflict=a.request('/notes/'+noteid,'PUT',{'revision':1,'title':'Old device'},expect=409)
    check(conflict['conflict'] and conflict['server']['title']=='Weekend plans','Revision conflicts preserve server version')
    png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=')
    operation_id=str(uuid.uuid4())
    n=a.upload(noteid,png,operation_id=operation_id)
    retry=a.upload(noteid,png,operation_id=operation_id)
    check(len(retry['attachments'])==1 and retry['revision']==n['revision'],'Idempotent media retry preserves one attachment and revision')
    attachment=n['attachments'][0]['id']
    check(a.request('/attachments/'+attachment,raw=True)==png,'Authorized original attachment bytes')
    audio=io.BytesIO()
    with wave.open(audio,'wb') as wav:
        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(8000);wav.writeframes(b'\0\0'*800)
    n=a.upload(noteid,audio.getvalue(),mime='audio/wav')
    audio_id=next(item['id'] for item in n['attachments'] if item['kind']=='audio')
    check(a.request('/attachments/'+audio_id,raw=True)==audio.getvalue(),'Authorized real WAV audio bytes')
    b.request('/attachments/'+attachment,expect=404)
    share=a.request('/notes/'+noteid+'/share','POST',{})['url'];token=share.rsplit('/',1)[1]
    public=Client()
    check(public.request('/shared/'+token)['title']=='Weekend plans','Read-only selected note sharing')
    check(public.request('/shared/'+token+'/attachments/'+attachment,raw=True)==png,'Share attachment scoping')
    a.request('/notes/'+noteid+'/share','DELETE')
    public.request('/shared/'+token,expect=404)
    check(True,'Sharing revocation')
    duplicate=a.request('/notes/'+noteid+'/duplicate','POST',{})
    check(duplicate['id']!=noteid and duplicate['attachments'][0]['id']!=attachment,'Duplication copies attachment independently')
    for format in ['txt','md','html','pdf']:
        content=a.request('/notes/'+noteid+'/export?format='+format,raw=True)
        if format=='html':check(b'<audio controls' in content,'HTML export embeds original audio')
        if format=='pdf':
            check(content.startswith(b'%PDF-'),'Actual PDF bytes')
            open('/tmp/mindkeep-test-export.pdf','wb').write(content)
        else: check(bool(content),'Actual '+format+' output')
    backup=a.request('/backup','POST',{'password':PASSWORD})
    check(backup['version']==1 and 'password_hash' not in json.dumps(backup) and 'token_hash' not in json.dumps(backup),'Versioned backup excludes credentials')
    restored=b.request('/restore','POST',backup)
    check(restored['restored_notes']==2 and restored['restored_attachments']==4,'Validated cross-account restore remaps IDs')
    malformed=dict(backup);malformed['version']=99
    b.request('/restore','POST',malformed,expect=400)
    check(True,'Unsupported backup rejected')
    n=save(a,n,locked=True)
    a.request('/auth/lock','POST',{})
    a.request('/notes',expect=423);a.request('/attachments/'+attachment,expect=423);a.request('/search','POST',{'query':'route'},expect=423)
    check(True,'App lock blocks authoritative backend and media')
    a.request('/auth/unlock','POST',{'password':PASSWORD})
    locked=[r for r in a.request('/notes')['notes'] if r['id']==noteid][0]
    check(locked['protected'] and locked['title']=='Locked note' and not locked['content'] and not locked['attachments'],'Locked-note listing redacts content and media')
    a.request('/notes/'+noteid,expect=423);a.request('/attachments/'+attachment,expect=423);a.request('/notes/'+noteid+'/export?format=txt',expect=423)
    check(not a.request('/search','POST',{'query':'route','filters':{'state':'all'}})['results'] or all(r['id']!=noteid for r in a.request('/search','POST',{'query':'route','filters':{'state':'all'}})['results']),'Locked-note search excludes protected content')
    n=a.request('/notes/'+noteid+'/unlock','POST',{'password':PASSWORD})
    check(n['title']=='Weekend plans','Additional verification unlocks individual note')
    a.request('/notes/'+noteid+'/share','POST',{},expect=400)
    token=a.request('/notes/'+noteid+'/share','POST',{'authorize_locked':True})['url'].rsplit('/',1)[1]
    check(public.request('/shared/'+token)['title']=='Weekend plans','Explicit owner authorization shares locked note')
    n=save(a,n,reminder={'due_at':int(time.time()*1000)-1000})
    time.sleep(11)
    events=a.request('/reminders/events')['events']
    check(any(e['note_id']==noteid for e in events),'Backend reminder scheduling')
    for event in events:a.request('/reminders/events/'+event['id']+'/ack','POST',{})
    check(not a.request('/reminders/events')['events'],'Reminder acknowledgement prevents redelivery')
    n=save(a,n,deleted=True)
    public.request('/shared/'+token,expect=404)
    check(True,'Trash revokes share access')
    n=save(a,n,deleted=False)
    check(not n['deleted'],'Trash recovery')
    n=save(a,n,deleted=True)
    a.request('/notes/'+noteid,'DELETE')
    a.request('/notes/'+noteid,expect=404)
    check(any(c['id']==noteid and c['note'] is None for c in a.request('/sync?since=0')['changes']),'Permanent deletion creates sync tombstone')
    a.request('/auth/reset-request','POST',{'email':a.email},expect=503)
    check(True,'Unconfigured reset email is honestly unavailable')
    # Test accounts are synthetic and deliberately isolated; no existing user data is touched.
    print(f'\n{passed} integration checks passed.')
if __name__=='__main__':main()
