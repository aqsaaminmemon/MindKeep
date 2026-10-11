#!/usr/bin/env python3
"""Token lifecycle using an isolated HTTP server and an explicit test mail adapter."""
import hashlib, json, os, pathlib, re, subprocess, sys, tempfile, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
import api_tests
api_tests.BASE='http://localhost:8082'
config=os.environ.copy()
for line in (ROOT/'data/dev.env').read_text().splitlines():
    if line.startswith('export '):
        key,value=line[7:].split('=',1);config[key]=value
with tempfile.TemporaryDirectory(prefix='mindkeep-reset-') as directory:
    mail=pathlib.Path(directory)/'mail.json'
    config.update(MINDKEEP_PORT='8082',MINDKEEP_PUBLIC_URL=api_tests.BASE,MINDKEEP_MAIL_COMMAND=f'{sys.executable} {ROOT}/tests/reset_mail_capture.py',MINDKEEP_TEST_MAIL_FILE=str(mail))
    server=subprocess.Popen([str(ROOT/'build/mindkeep')],cwd=ROOT,env=config,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        client=api_tests.Client()
        for attempt in range(100):
            try:client.request('/health');break
            except Exception:time.sleep(.1)
        client.register()
        client.request('/auth/reset-request','POST',{'email':client.email})
        token=re.search(r'#reset=([a-f0-9]{64})',json.loads(mail.read_text())['text'])[1]
        new_password='new-test-only-password-12345'
        client.request('/auth/reset','POST',{'token':token,'password':new_password})
        client.request('/auth/session',expect=401)
        client.request('/auth/reset','POST',{'token':token,'password':new_password},expect=400)
        login=client.request('/auth/login','POST',{'email':client.email,'password':new_password})
        client.csrf=login['csrf']
        client.request('/auth/login','POST',{'email':client.email,'password':api_tests.PASSWORD},expect=401)
        print('PASS: reset replaces password, invalidates sessions, rejects reuse and old password')
        client.request('/auth/reset-request','POST',{'email':client.email})
        expired=re.search(r'#reset=([a-f0-9]{64})',json.loads(mail.read_text())['text'])[1]
        # Expiry setup through a private MySQL defaults file, never credentials on argv.
        defaults=pathlib.Path(directory)/'mysql.cnf'
        defaults.write_text('[client]\nhost='+config['MINDKEEP_DB_HOST']+'\nport='+config['MINDKEEP_DB_PORT']+'\nuser='+config['MINDKEEP_DB_USER']+'\npassword='+config['MINDKEEP_DB_PASSWORD']+'\n')
        defaults.chmod(0o600)
        subprocess.run(['mysql','--defaults-extra-file='+str(defaults),config['MINDKEEP_DB_NAME']],input='UPDATE reset_tokens SET expires_at=1 WHERE token_hash="'+hashlib.sha256(expired.encode()).hexdigest()+'";',text=True,check=True,stdout=subprocess.DEVNULL)
        client.request('/auth/reset','POST',{'token':expired,'password':api_tests.PASSWORD},expect=400)
        print('PASS: expired reset tokens are rejected')
    finally:
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
