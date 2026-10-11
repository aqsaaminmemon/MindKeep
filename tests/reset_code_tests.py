#!/usr/bin/env python3
"""Code verification lifecycle using an isolated HTTP server and an explicit test mail adapter."""
import hashlib, json, os, pathlib, re, subprocess, sys, tempfile, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
import api_tests
api_tests.BASE='http://localhost:8084'
config=os.environ.copy()
for line in (ROOT/'data/dev.env').read_text().splitlines():
    if line.startswith('export '):
        key,value=line[7:].split('=',1);config[key]=value
with tempfile.TemporaryDirectory(prefix='mindkeep-reset-') as directory:
    mail=pathlib.Path(directory)/'mail.json'
    config.update(MINDKEEP_PORT='8084',MINDKEEP_PUBLIC_URL=api_tests.BASE,MINDKEEP_MAIL_COMMAND=f'{sys.executable} {ROOT}/tests/reset_mail_capture.py',MINDKEEP_TEST_MAIL_FILE=str(mail))
    server=subprocess.Popen([str(ROOT/'build/mindkeep')],cwd=ROOT,env=config,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        client=api_tests.Client()
        for attempt in range(100):
            try:client.request('/health');break
            except Exception:time.sleep(.1)
        client.register()
        def request_code(email=None):
            response=client.request('/auth/reset-request','POST',{'email':email or client.email,'format':'code'})
            assert len(response['request_id'])==64
            if email: return response,None
            delivered=json.loads(mail.read_text())
            code=re.search(r'code is: ([0-9]{6})',delivered['text'])[1]
            assert code not in json.dumps(response) and '#reset=' not in delivered['text']
            return response,code
        response,code=request_code()
        wrong='000000' if code!='000000' else '999999'
        client.request('/auth/reset-verify','POST',{'request_id':response['request_id'],'code':wrong},expect=400)
        verified=client.request('/auth/reset-verify','POST',{'request_id':response['request_id'],'code':code})
        client.request('/auth/reset-verify','POST',{'request_id':response['request_id'],'code':code},expect=400)
        new_password='new-code-test-password-12345'
        client.request('/auth/reset','POST',{'token':verified['token'],'password':new_password})
        client.request('/auth/session',expect=401)
        client.request('/auth/reset','POST',{'token':verified['token'],'password':new_password},expect=400)
        login=client.request('/auth/login','POST',{'email':client.email,'password':new_password});client.csrf=login['csrf']
        client.request('/auth/login','POST',{'email':client.email,'password':api_tests.PASSWORD},expect=401)
        print('PASS: email code verification, wrong-code rejection, single use, password replacement and session invalidation')
        old,oldcode=request_code();new,newcode=request_code()
        client.request('/auth/reset-verify','POST',{'request_id':old['request_id'],'code':oldcode},expect=400)
        client.request('/auth/reset-verify','POST',{'request_id':new['request_id'],'code':newcode})
        print('PASS: resend invalidates the previous code')
        limited,limitcode=request_code()
        wrong='000000' if limitcode!='000000' else '999999'
        for _ in range(5):
            client.request('/auth/reset-verify','POST',{'request_id':limited['request_id'],'code':wrong},expect=400)
        client.request('/auth/reset-verify','POST',{'request_id':limited['request_id'],'code':limitcode},expect=400)
        print('PASS: five incorrect guesses exhaust the code even with the right code afterward')
        expired,expiredcode=request_code()
        defaults=pathlib.Path(directory)/'mysql.cnf'
        defaults.write_text('[client]\nhost='+config['MINDKEEP_DB_HOST']+'\nport='+config['MINDKEEP_DB_PORT']+'\nuser='+config['MINDKEEP_DB_USER']+'\npassword='+config['MINDKEEP_DB_PASSWORD']+'\n')
        defaults.chmod(0o600)
        subprocess.run(['mysql','--defaults-extra-file='+str(defaults),config['MINDKEEP_DB_NAME']],input='UPDATE reset_codes SET expires_at=1 WHERE request_hash="'+hashlib.sha256(expired['request_id'].encode()).hexdigest()+'";',text=True,check=True,stdout=subprocess.DEVNULL)
        client.request('/auth/reset-verify','POST',{'request_id':expired['request_id'],'code':expiredcode},expect=400)
        unknown,_=request_code('does-not-exist@example.test')
        assert unknown['message']==response['message']
        print('PASS: expired codes fail and unknown accounts receive the same response')
    finally:
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
