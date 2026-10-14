#!/usr/bin/env python3
"""Search scope, exclusions and saved searches against a running server; synthetic account only."""
import uuid
from api_tests import Client

def main():
    client = Client()
    client.register()
    folder = client.request('/folders', 'POST', {'name': 'Search test folder'})
    tag = client.request('/tags', 'POST', {'name': 'Search test tag'})
    rows = [
        ('title', 'Project', 'Quiet morning', {}),
        ('content', 'Notebook', 'Project café planning', {}),
        ('blocked', 'Project', 'Project café meeting', {}),
        ('archive', 'Archived plan', 'Project café planning', {'archived': True}),
        ('trash', 'Deleted plan', 'Project café planning', {'deleted': True}),
    ]
    notes = {}
    for key, title, content, fields in rows:
        notes[key] = client.request('/notes', 'POST', {
            'id': str(uuid.uuid4()), 'title': title, 'content': '<p>' + content + '</p>',
            'folder_id': folder['id'], 'tags': [tag['id']], **fields,
        }, 201)
    def search(query, filters):
        return {n['id'] for n in client.request('/search', 'POST', {'query': query, 'filters': filters})['results']}
    content_filters = {'scope': 'content', 'exclude': 'MEETING, draft',
                       'folder': folder['name'], 'tag': tag['name']}
    assert search('proj', content_filters) == {notes['content']['id']}
    assert search('"project café"', {'scope': 'content'}) == {notes['content']['id'], notes['blocked']['id']}
    assert search('project', {'scope': 'title'}) == {notes['title']['id'], notes['blocked']['id']}
    assert search('', {'exclude': 'project'}) == set()
    for category in ['archived', 'trash']:
        key = 'archive' if category == 'archived' else category
        filters = {**content_filters, 'category': category}
        assert search('project state:all', filters) == {notes[key]['id']}
        saved = client.request('/searches', 'POST', {'name': 'My ' + category + ' search', 'query': 'project', 'filters': filters})
        restored = next(s for s in client.request('/searches')['searches'] if s['id'] == saved['id'])
        assert restored['filters'] == filters
        assert search(restored['query'], restored['filters']) == {notes[key]['id']}
    for filters in [{'scope': 'invalid'}, {'exclude': []}, {'category': 'invalid'}]:
        client.request('/search', 'POST', {'query': 'project', 'filters': filters}, expect=400)
    print('PASS: real API content-only terms/phrases, whole-word exclusions, folder/tag combinations, Archive/Trash isolation and saved-search round trips')

if __name__ == '__main__':
    main()
