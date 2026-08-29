"""Send the Or-Pac quote PDF to the customer by email.

SMTP config comes from environment variables (set in start_proxy.bat, never
hardcoded here):
    SMTP_HOST      default: smtp.office365.com
    SMTP_PORT      default: 587
    SMTP_USERNAME  the mailbox that authenticates and sends
    SMTP_PASSWORD  its password / app password
    SMTP_FROM      the From address (defaults to SMTP_USERNAME)
"""

from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from pathlib import Path

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.office365.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USERNAME)


def is_configured() -> bool:
    return bool(SMTP_USERNAME and SMTP_PASSWORD)


def send_quote_email(
    to_email: str,
    customer_name: str,
    quote_number: str,
    pdf_path: Path,
) -> None:
    """Send pdf_path as an attachment to to_email. Raises on any failure --
    callers should catch and turn it into an HTTP error, not swallow it, so
    a failed send is never mistaken for a successful one."""
    if not is_configured():
        raise RuntimeError("SMTP_USERNAME / SMTP_PASSWORD are not configured on the server")

    msg = EmailMessage()
    msg["Subject"] = f"Your Quote #{quote_number}"
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(
        f"Hi {customer_name},\n\n"
        f"Attached is your quote (#{quote_number}).\n\n"
        f"Thank you,\nSan Lorenzo Lumber & Home Centers"
    )

    pdf_bytes = pdf_path.read_bytes()
    msg.add_attachment(
        pdf_bytes,
        maintype="application",
        subtype="pdf",
        filename=pdf_path.name,
    )

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
        server.starttls()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.send_message(msg)
