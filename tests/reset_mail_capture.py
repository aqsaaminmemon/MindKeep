#!/usr/bin/env python3
"""Test double only. Never configure this as production email delivery."""
import json, os, sys
path=os.environ['MINDKEEP_TEST_MAIL_FILE']
with open(path,'w') as file:json.dump(json.load(sys.stdin),file)
os.chmod(path,0o600)
