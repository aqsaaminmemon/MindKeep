#!/usr/bin/env python3
"""Trash retention lifecycle using an isolated HTTP server and an explicit test mail adapter."""
import base64, hashlib, json, os, pathlib, re, subprocess, sys, tempfile, time, uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
import api_tests
api_tests.BASE='http://localhost:8086'
config=os.environ.copy()
for line in (ROOT/'data/dev.env').read_text().splitlines():
    if line.startswith('export '):
        key,value=line[7:].split('=',1);config[key]=value
with tempfile.TemporaryDirectory(prefix='mindkeep-reset-') as directory:
    mail=pathlib.Path(directory)/'mail.json'
    config.update(MINDKEEP_PORT='8086',MINDKEEP_PUBLIC_URL=api_tests.BASE,MINDKEEP_MAIL_COMMAND=f'{sys.executable} {ROOT}/tests/reset_mail_capture.py',MINDKEEP_TEST_MAIL_FILE=str(mail),MINDKEEP_DATA=directory)
    server=subprocess.Popen([str(ROOT/'build/mindkeep')],cwd=ROOT,env=config,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        client=api_tests.Client()
        for attempt in range(100):
            try:client.request('/health');break
            except Exception:time.sleep(.1)
        client.register()
        create=lambda name:client.request('/notes','POST',{'id':str(uuid.uuid4()),'title':name,'content':'<p>Trash retention test</p>'},201)
        expired=create('Expired trash test')
        png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=')
        expired=client.upload(expired['id'],png)
        expired=api_tests.save(client,expired,deleted=True)
        assert expired['trash_expires_at']-expired['deleted_at']==30*86400000
        deadline=expired['trash_expires_at']
        expired=api_tests.save(client,expired,title='Edited while in trash')
        assert expired['trash_expires_at']==deadline
        restored=api_tests.save(client,create('Restore before expiry'),deleted=True)
        restored=api_tests.save(client,restored,deleted=False)
        assert restored['deleted_at'] is None and restored['trash_expires_at'] is None
        retrash=api_tests.save(client,restored,deleted=True)
        assert retrash['deleted_at']>expired['deleted_at']
        restored=api_tests.save(client,retrash,deleted=False)
        recent=api_tests.save(client,create('Recent trash test'),deleted=True)
        active=create('Active note test')
        legacy=api_tests.save(client,create('Legacy trash test'),deleted=True)
        sequence=client.request('/notes')['sequence']
        defaults=pathlib.Path(directory)/'mysql.cnf'
        defaults.write_text('[client]\nhost='+config['MINDKEEP_DB_HOST']+'\nport='+config['MINDKEEP_DB_PORT']+'\nuser='+config['MINDKEEP_DB_USER']+'\npassword='+config['MINDKEEP_DB_PASSWORD']+'\n')
        defaults.chmod(0o600)
        def sql(query):
            return subprocess.run(['mysql','--defaults-extra-file='+str(defaults),'-N',config['MINDKEEP_DB_NAME']],input=query,text=True,check=True,capture_output=True).stdout.strip()
        key=sql('SELECT storage_key FROM attachments WHERE note_id="'+expired['id']+'";')
        assert (pathlib.Path(directory)/key).exists()
        sql('UPDATE trash_entries SET deleted_at=1 WHERE note_id="'+expired['id']+'"; UPDATE notes SET updated_at=1 WHERE id IN ("'+recent['id']+'","'+active['id']+'"); DELETE FROM trash_entries WHERE note_id="'+legacy['id']+'";')
        for _ in range(150):
            library={n['id']:n for n in client.request('/notes')['notes']}
            if expired['id'] not in library:break
            time.sleep(.1)
        assert expired['id'] not in library
        client.request('/notes/'+expired['id'],expect=404)
        assert not (pathlib.Path(directory)/key).exists()
        assert restored['id'] in library and not library[restored['id']]['deleted']
        assert recent['id'] in library and active['id'] in library
        assert library[legacy['id']]['trash_expires_at']>int(time.time()*1000)+29*86400000
        changes=client.request('/sync?since='+str(sequence))['changes']
        assert any(c['id']==expired['id'] and c['note'] is None for c in changes)
        print('PASS: 30-day expiry, attachment cleanup and sync deletion; restores cancel expiry; edits do not extend it; retrashing starts fresh; recent/active/legacy notes survive')
    finally:
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
