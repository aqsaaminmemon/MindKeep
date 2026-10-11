#!/usr/bin/env python3
"""Optional development examples. Uses real C++ APIs; never runs automatically."""
import os, sys, uuid
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..','tests'))
from api_tests import Client
email=os.environ.get('MINDKEEP_SEED_EMAIL')
password=os.environ.get('MINDKEEP_SEED_PASSWORD')
if not email or not password:
    sys.exit('Set MINDKEEP_SEED_EMAIL and MINDKEEP_SEED_PASSWORD for a development-only account.')
client=Client()
try:
    response=client.request('/auth/register','POST',{'email':email,'password':password,'name':'MindKeep preview'})
except AssertionError:
    response=client.request('/auth/login','POST',{'email':email,'password':password})
client.csrf=response['csrf'];client.user=response['user']
if client.request('/notes')['notes']:
    print('Account already contains notes; seed skipped to preserve its data.')
    sys.exit()
folder=client.request('/folders','POST',{'name':'Personal'})
tags={name:client.request('/tags','POST',{'name':name}) for name in ['Little ideas','Everyday','Personal']}
examples=[
 ('Weekend, without a plan','<p>Find a little bookshop. Order something new. Take the long way home.</p><p>Leave a little room for the unexpected. 🌿</p>',True,'blue',['Little ideas']),
 ('A few things to pick up','<ul><li data-checked="true">Fresh bread</li><li data-checked="false">Oat milk</li><li data-checked="false">Something green for the windowsill</li><li data-checked="false">Coffee beans</li></ul>',True,'white',['Everyday']),
 ('A spark of an idea','<p>A tiny collection of the places, sounds, and moments that make an ordinary day feel special.</p><p>Start with one photo a week.</p>',False,'violet',['Little ideas']),
 ('The little details','<p>The plant by the kitchen window likes a little water on Sundays.</p><p>Less is more. Let the soil dry out first.</p>',False,'white',['Personal']),
 ('Something worth remembering','<p>“Almost everything will work again if you unplug it for a few minutes, including you.”</p><p>Make time for a quiet afternoon.</p>',False,'white',[]),
 ('Places for a slow Sunday','<ul><li>The park before it gets busy</li><li>That café with the blue door</li><li>The used bookshop around the corner</li></ul>',False,'mint',['Personal']),
]
for title,content,pinned,color,names in examples:
    client.request('/notes','POST',{'id':str(uuid.uuid4()),'title':title,'content':content,'pinned':pinned,'color':color,'folder_id':folder['id'] if 'Personal'in names else None,'tags':[tags[t]['id'] for t in names]},201)
print('Created 6 example notes in the selected development account.')
