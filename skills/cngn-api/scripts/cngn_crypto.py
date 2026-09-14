#!/usr/bin/env python3
"""Encrypt cNGN request bodies and decrypt cNGN response payloads.

The cNGN API encrypts both directions: request bodies are AES-256-CBC encrypted into
{"content", "iv"}, and the `data` field of a success response is sealed with libsodium's
crypto_box to the merchant's Ed25519 public key.

Requires: pip install cryptography pynacl

Usage:
    cngn_crypto.py encrypt '{"amount": 1000}' <encryption-key>
    cngn_crypto.py decrypt <base64-data> <path-to-ed25519-private-key>
    cngn_crypto.py selftest <encryption-key>

The encryption key may be passed as "-" to read it from the CNGN_ENCRYPTION_KEY
environment variable instead, so it never lands in shell history.
"""

import base64
import json
import os
import re
import sys

# AES-CBC operates on 16-byte blocks, so plaintext is padded up to a multiple of this.
BLOCK_SIZE = 16
# crypto_box nonce and public key sizes, fixed by libsodium.
NONCE_BYTES = 24
PUBLIC_KEY_BYTES = 32
# OpenSSH writes the 64-byte Ed25519 private key after a big-endian length marker of 0x40.
ED25519_KEY_LENGTH_MARKER = b"\x00\x00\x00\x40"
ED25519_KEY_BYTES = 64


def _require(module: str, package: str):
    """Import a dependency, or exit with the install command instead of a traceback."""
    try:
        return __import__(module, fromlist=["_"])
    except ImportError:
        sys.exit(f"Missing dependency '{module}'. Install it with: pip install {package}")


def prepare_key(key: str) -> bytes:
    """Derive the 32-byte AES key. The API hashes the key rather than using it raw."""
    hashes = _require("cryptography.hazmat.primitives.hashes", "cryptography")
    backends = _require("cryptography.hazmat.backends", "cryptography")

    digest = hashes.Hash(hashes.SHA256(), backend=backends.default_backend())
    digest.update(key.encode("utf-8"))
    return digest.finalize()


def encrypt(plaintext: str, key: str) -> dict:
    """AES-256-CBC encrypt a JSON string into the {content, iv} wire format."""
    ciphers = _require("cryptography.hazmat.primitives.ciphers", "cryptography")
    backends = _require("cryptography.hazmat.backends", "cryptography")

    iv = os.urandom(BLOCK_SIZE)
    cipher = ciphers.Cipher(
        ciphers.algorithms.AES(prepare_key(key)),
        ciphers.modes.CBC(iv),
        backend=backends.default_backend(),
    )
    encryptor = cipher.encryptor()

    padding_length = BLOCK_SIZE - (len(plaintext) % BLOCK_SIZE)
    padded = plaintext + chr(padding_length) * padding_length
    ciphertext = encryptor.update(padded.encode("utf-8")) + encryptor.finalize()

    return {
        "content": base64.b64encode(ciphertext).decode("utf-8"),
        "iv": base64.b64encode(iv).decode("utf-8"),
    }


def decrypt_aes(envelope: dict, key: str) -> str:
    """Reverse `encrypt`. Only useful for local round-trip checks; the API never
    sends AES-encrypted data back."""
    ciphers = _require("cryptography.hazmat.primitives.ciphers", "cryptography")
    backends = _require("cryptography.hazmat.backends", "cryptography")

    iv = base64.b64decode(envelope["iv"])
    ciphertext = base64.b64decode(envelope["content"])
    cipher = ciphers.Cipher(
        ciphers.algorithms.AES(prepare_key(key)),
        ciphers.modes.CBC(iv),
        backend=backends.default_backend(),
    )
    decryptor = cipher.decryptor()

    padded = decryptor.update(ciphertext) + decryptor.finalize()
    return padded[: -padded[-1]].decode("utf-8")


def parse_openssh_private_key(private_key: str) -> bytes:
    """Extract the raw 64-byte Ed25519 key from an OpenSSH-format private key file."""
    stripped = re.sub(r"-----.* PRIVATE KEY-----", "", private_key).strip()
    stripped = re.sub(r"\s+", "", stripped)

    try:
        buffer = base64.b64decode(stripped)
    except Exception:
        sys.exit("Private key is not valid base64. Is this an OpenSSH-format key file?")

    start = buffer.find(ED25519_KEY_LENGTH_MARKER)
    if start == -1:
        sys.exit(
            "Unable to find Ed25519 key data. Pass the private key file (cngn_api_key), "
            "not the public .pub file, and make sure it is an Ed25519 key."
        )

    return buffer[start + len(ED25519_KEY_LENGTH_MARKER) : start + len(ED25519_KEY_LENGTH_MARKER) + ED25519_KEY_BYTES]


def decrypt_response(encrypted_data: str, private_key_pem: str) -> str:
    """Open the crypto_box in a response `data` field and return the JSON string."""
    public = _require("nacl.public", "pynacl")
    bindings = _require("nacl.bindings", "pynacl")

    ed25519_bytes = parse_openssh_private_key(private_key_pem)
    curve25519_bytes = bindings.crypto_sign_ed25519_sk_to_curve25519(ed25519_bytes)

    try:
        buffer = base64.b64decode(encrypted_data)
    except Exception:
        sys.exit("Response data is not valid base64.")

    if len(buffer) <= NONCE_BYTES + PUBLIC_KEY_BYTES:
        sys.exit("Response data is too short to contain a nonce, ciphertext, and key.")

    nonce = buffer[:NONCE_BYTES]
    ephemeral_public_key = public.PublicKey(buffer[-PUBLIC_KEY_BYTES:])
    ciphertext = buffer[NONCE_BYTES:-PUBLIC_KEY_BYTES]

    box = public.Box(public.PrivateKey(curve25519_bytes), ephemeral_public_key)
    try:
        return box.decrypt(ciphertext, nonce).decode("utf-8")
    except Exception:
        sys.exit(
            "Decryption failed. Check the private key belongs to the same environment "
            "(test or live) as the API key that made the request."
        )


def _resolve_key(argument: str, env_var: str) -> str:
    """Allow '-' to mean 'read from this environment variable' so secrets stay out of
    shell history."""
    if argument != "-":
        return argument

    value = os.environ.get(env_var)
    if not value:
        sys.exit(f"Passed '-' but {env_var} is not set.")
    return value


def main(argv: list) -> int:
    if len(argv) < 2:
        print(__doc__.strip())
        return 1

    command = argv[1]

    if command == "encrypt" and len(argv) == 4:
        key = _resolve_key(argv[3], "CNGN_ENCRYPTION_KEY")
        print(json.dumps(encrypt(argv[2], key), indent=2))
        return 0

    if command == "decrypt" and len(argv) == 4:
        with open(argv[3], "r", encoding="utf-8") as handle:
            private_key = handle.read()
        print(decrypt_response(argv[2], private_key))
        return 0

    if command == "selftest" and len(argv) == 3:
        key = _resolve_key(argv[2], "CNGN_ENCRYPTION_KEY")
        payload = json.dumps({"amount": 1000, "note": "round-trip"})
        envelope = encrypt(payload, key)
        restored = decrypt_aes(envelope, key)
        if restored != payload:
            print("FAIL: round-trip did not reproduce the payload", file=sys.stderr)
            return 1
        print("OK: AES-256-CBC round-trip succeeded")
        return 0

    print(__doc__.strip())
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
