#!/usr/bin/env python3
"""Partial-word search and batched result metadata on an isolated local server."""
import base64, os, pathlib, subprocess, sys, time, uuid
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
import api_tests
api_tests.BASE = 'http://localhost:8087'
config = os.environ.copy()
for line in (ROOT / 'data/dev.env').read_text().splitlines():
    if line.startswith('export '):
        key, value = line[7:].split('=', 1)
        config[key] = value
config.update(MINDKEEP_PORT='8087', MINDKEEP_PUBLIC_URL=api_tests.BASE)
server = subprocess.Popen([str(ROOT / 'build/mindkeep')], cwd=ROOT, env=config,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    client = api_tests.Client()
    for _ in range(100):
        try:
            client.request('/health')
            break
        except Exception:
            time.sleep(.1)
    client.register()
    folder = client.request('/folders', 'POST', {'name': 'Search regression'})
    tag = client.request('/tags', 'POST', {'name': 'Morning'})
    def create(title, content, **fields):
        return client.request('/notes', 'POST', {'id': str(uuid.uuid4()), 'title': title,
                                               'content': content, **fields}, 201)
    note = create('Morning idea', '<p>Watch the sun rise slowly</p>', folder_id=folder['id'],
                  tags=[tag['id']], reminder={'due_at': int(time.time()*1000)+86400000}, favorite=True)
    title = create('Watch the sunrise', '<p>A project idea</p>')
    other = create('Unrelated', '<p>A quiet evening</p>')
    def search(query, **filters):
        return client.request('/search', 'POST', {'query': query, 'filters': filters})['results']
    assert [n['id'] for n in search('RiS')] == [note['id']]
    assert [n['id'] for n in search('sunr', scope='title')] == [title['id']]
    assert not search('ris', scope='title')
    assert len(search('ris slow', folder=folder['name'], tag=tag['name'])) == 1
    assert not search('"ris"') and len(search('"sun rise"')) == 1
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=')
    note = client.upload(note['id'], png)
    full = client.request('/notes/'+note['id'])
    result = search('RiS')[0]
    result.pop('score'); result.pop('snippet')
    assert result == full, 'Batched results must preserve complete note/action metadata'
    print('PASS: mixed-case body/title prefixes, scoped AND filters, exact phrases and complete result metadata')
    locked = api_tests.save(client, note, locked=True)
    # Expire only this synthetic note grant by locking the app and unlocking the account.
    client.request('/auth/lock', 'POST', {})
    client.request('/auth/unlock', 'POST', {'password': api_tests.PASSWORD})
    assert not search('ris')
    client.request('/notes/'+note['id']+'/unlock', 'POST', {'password': api_tests.PASSWORD})
    assert len(search('ris')) == 1
    print('PASS: locked note exclusion and verified unlock during batched search')
    batch_ids = set()
    for i in range(201):
        batch_ids.add(create('Batch result '+str(i), '<p>batchprefix regression</p>')['id'])
    started = time.perf_counter()
    results = search('batchpre')
    elapsed = (time.perf_counter()-started)*1000
    assert {n['id'] for n in results} == batch_ids and len(results) == 201
    assert all(n['attachments'] == [] and n['tags'] == [] and not n['protected'] for n in results)
    print(f'PASS: 201 results cross the batch boundary without omissions; local API response {elapsed:.1f} ms')
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill(); server.wait()
