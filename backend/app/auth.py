import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from email_validator import validate_email, EmailNotValidError
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from . import db
from .config import settings

bearer = HTTPBearer(auto_error=False)


def hash_token(value):
    return hashlib.sha256(value.encode()).hexdigest()


def hash_password(password):
    salt = secrets.token_hex(16)
    hashed = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return f"scrypt${salt}${hashed}"


def password_matches(password, stored):
    try:
        _, salt, expected = stored.split("$")
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def normalize_email(value):
    try:
        return validate_email(value, check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        raise HTTPException(422, "Enter a valid email address") from exc


def issue_session(conn, user_id):
    token = secrets.token_urlsafe(48)
    conn.execute(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(%s,%s,%s)",
        (hash_token(token), user_id, datetime.now(timezone.utc) + timedelta(hours=settings().session_hours)),
    )
    return token


def user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials is None:
        raise HTTPException(401, "Sign in to continue", headers={"WWW-Authenticate": "Bearer"})
    row = db.one(
        "SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id "
        "WHERE s.token_hash=%s AND s.expires_at>now()",
        (hash_token(credentials.credentials),),
    )
    if row is None:
        raise HTTPException(401, "Session expired. Sign in again.", headers={"WWW-Authenticate": "Bearer"})
    return row


def rate_limit(request: Request, scope: str, limit: int, seconds=60):
    # Persisted atomic limiter works across workers; proxy trust is configured at the ASGI server.
    address = request.client.host if request.client else "unknown"
    key = hash_token(f"{scope}:{address}")
    row = db.one(
        "INSERT INTO rate_limits(key,count,expires_at) VALUES(%s,1,now() + %s * interval '1 second') "
        "ON CONFLICT(key) DO UPDATE SET "
        "count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END, "
        "expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END "
        "RETURNING count",
        (key, seconds),
    )
    if row["count"] > limit:
        raise HTTPException(429, "Rate limit reached. Try again shortly.", headers={"Retry-After": str(seconds)})
