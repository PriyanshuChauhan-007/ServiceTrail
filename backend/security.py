"""Password/session primitives and API transport controls."""
import hashlib
import hmac
import secrets
import base64
import struct
import time
from pathlib import Path
from urllib.parse import urlsplit

from starlette.responses import JSONResponse

COOKIE = "opsbridge_session"
ITERATIONS = 600_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS).hex()
    return f"pbkdf2_sha256${ITERATIONS}${salt}${digest}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt, expected = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations)).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def field_cipher(settings):
    from cryptography.fernet import Fernet
    if settings.field_encryption_key:
        return Fernet(settings.field_encryption_key.encode())
    if settings.environment == "production":
        raise RuntimeError("Production requires FIELD_ENCRYPTION_KEY")
    # Stable local key, in the already-ignored backend/data directory only.
    path = Path(__file__).parent / "data" / "field-encryption.key"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as stream:
            stream.write(Fernet.generate_key())
        path.chmod(0o600)
    except FileExistsError:
        pass
    return Fernet(path.read_bytes())


def totp(secret, counter=None):
    counter = int(time.time()) // 30 if counter is None else counter
    digest = hmac.new(base64.b32decode(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return f"{(struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000:06d}"


class SecurityMiddleware:
    """Reject cross-origin browser writes and bound the actual streamed request body."""
    def __init__(self, app, settings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}

        async def secured_send(message):
            if message["type"] == "http.response.start":
                extra = {
                    "cache-control": "no-store", "x-content-type-options": "nosniff",
                    "x-frame-options": "DENY", "referrer-policy": "no-referrer",
                    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
                    "permissions-policy": "camera=(), microphone=(), geolocation=()",
                }
                if self.settings.environment == "production":
                    extra["strict-transport-security"] = "max-age=31536000; includeSubDomains"
                message["headers"] = [(k, v) for k, v in message.get("headers", []) if k.decode().lower() not in extra] + [(k.encode(), v.encode()) for k, v in extra.items()]
            await send(message)

        async def reject(code, detail):
            await JSONResponse({"detail": detail}, status_code=code)(scope, receive, secured_send)

        if scope["path"] != "/api/v1/health" and self.settings.public_origin and headers.get("host", "").lower() != urlsplit(self.settings.public_origin).netloc.lower():
            return await reject(400, "Invalid host")
        if scope["method"] not in {"GET", "HEAD", "OPTIONS"}:
            expected = self.settings.public_origin or f'{scope["scheme"]}://{headers.get("host", "")}'
            origin = headers.get("origin")
            if headers.get("sec-fetch-site") == "cross-site" or (origin is not None and origin != expected):
                return await reject(403, "Cross-origin mutations are forbidden")
            referer = headers.get("referer")
            if not origin and referer:
                parsed = urlsplit(referer)
                if f"{parsed.scheme}://{parsed.netloc}" != expected:
                    return await reject(403, "Cross-origin mutations are forbidden")
            upload = scope["path"].endswith("/evidence")
            maximum = self.settings.max_upload_bytes + 65536 if upload else 128 * 1024
            try:
                if int(headers.get("content-length", "0")) > maximum:
                    return await reject(413, "Request body exceeds size limit")
            except ValueError:
                return await reject(400, "Invalid content length")
            chunks, total = [], 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                total += len(message.get("body", b""))
                if total > maximum:
                    return await reject(413, "Request body exceeds size limit")
                chunks.append(message)
                if not message.get("more_body", False):
                    break
            iterator = iter(chunks)

            async def bounded_receive():
                return next(iterator, {"type": "http.request", "body": b"", "more_body": False})

            await self.app(scope, bounded_receive, secured_send)
        else:
            await self.app(scope, receive, secured_send)
