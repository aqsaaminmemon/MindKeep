#!/usr/bin/env python3
"""Delivery adapter only: reset-token generation/validation remain in C++."""
import json, os, smtplib, ssl, sys
from email.message import EmailMessage
try:
    payload = json.load(sys.stdin)
    message = EmailMessage()
    message['From'] = os.environ['SMTP_FROM']
    message['To'] = payload['to']
    message['Subject'] = payload['subject']
    message.set_content(payload['text'])
    with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.getenv('SMTP_PORT', '587')), timeout=20) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        smtp.login(os.environ['SMTP_USERNAME'], os.environ['SMTP_PASSWORD'])
        smtp.send_message(message)
except Exception:
    print('MindKeep reset email delivery failed; check SMTP configuration.', file=sys.stderr)
    sys.exit(1)
