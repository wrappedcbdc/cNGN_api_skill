# cNGN encryption

The API encrypts payloads in both directions:

- **Requests** (`POST`/`PUT` bodies): you encrypt the JSON with **AES-256-CBC** using the
  encryption key from your dashboard.
- **Responses**: the API encrypts the `data` field to your **Ed25519 public key**; you
  decrypt locally with your private key.

The [official SDKs](https://github.com/wrappedcbdc) do both automatically. Implement this
by hand only when integrating directly over HTTP in an unsupported language.

## Contents

- [Keys and where they live](#keys-and-where-they-live)
- [Encrypting requests (AES-256-CBC)](#encrypting-requests-aes-256-cbc)
- [Decrypting responses (Ed25519 to Curve25519)](#decrypting-responses-ed25519-to-curve25519)
- [Generating the Ed25519 key pair](#generating-the-ed25519-key-pair)
- [Failure modes](#failure-modes)

## Keys and where they live

| Key | Direction | Where it lives |
| --- | --- | --- |
| API key (`cngn_test…` / `cngn_live…`) | Request auth | Your server + dashboard |
| Encryption key (AES) | Request body encryption | Your server + dashboard |
| Ed25519 public key | Response encryption, API side | Uploaded to dashboard |
| Ed25519 private key | Response decryption, your side | Your server only, never shared |

Each environment (test and live) has its own independent set of all four. A key from one
environment never works against the other's data.

## Encrypting requests (AES-256-CBC)

Every endpoint that accepts a body expects this wire format instead of plain JSON:

```json
{ "content": "<base64-encoded ciphertext>", "iv": "<base64-encoded 16-byte IV>" }
```

Steps:

1. SHA-256 hash your encryption key to derive a 32-byte AES key.
2. Generate a random 16-byte IV. Use a fresh one per request.
3. Encrypt the JSON string with AES-256-CBC (PKCS#7 padding).
4. Base64-encode the ciphertext and the IV; send them as `content` and `iv`.

The key is **hashed, not used raw**. Passing the key string straight to the cipher is the
most common cause of `400 Decryption failed`.

### TypeScript

```typescript
import { Buffer } from 'buffer';
import * as crypto from 'crypto';

export type AESEncryptionResponse = { iv: string; content: string };

export class AESCrypto {
    private static readonly ALGORITHM = 'aes-256-cbc';
    private static readonly IV_LENGTH = 16;

    private static prepareKey(key: string): Buffer {
        const hash = crypto.createHash('sha256');
        hash.update(key);
        return hash.digest();
    }

    public static encrypt(data: string, key: string): AESEncryptionResponse {
        const iv = crypto.randomBytes(this.IV_LENGTH);
        const cipher = crypto.createCipheriv(this.ALGORITHM, this.prepareKey(key), iv);

        let encrypted = cipher.update(data, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        return { content: encrypted, iv: iv.toString('base64') };
    }

    public static decrypt(encryptedData: AESEncryptionResponse, key: string): string {
        const iv = Buffer.from(encryptedData.iv, 'base64');
        const decipher = crypto.createDecipheriv(this.ALGORITHM, this.prepareKey(key), iv);

        let decrypted = decipher.update(encryptedData.content, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }
}
```

Usage: `AESCrypto.encrypt(JSON.stringify(payload), encryptionKey)` returns the object to
send as the request body. `decrypt` is for local round-trip testing only; the API never
sends AES-encrypted data back.

### Python

```python
# pip install cryptography
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
import os, base64


class AESCrypto:
    ALGORITHM = algorithms.AES
    IV_LENGTH = 16

    @staticmethod
    def prepare_key(key: str) -> bytes:
        digest = hashes.Hash(hashes.SHA256(), backend=default_backend())
        digest.update(key.encode('utf-8'))
        return digest.finalize()

    @staticmethod
    def encrypt(data: str, key: str) -> dict:
        iv = os.urandom(AESCrypto.IV_LENGTH)
        cipher = Cipher(AESCrypto.ALGORITHM(AESCrypto.prepare_key(key)),
                        modes.CBC(iv), backend=default_backend())
        encryptor = cipher.encryptor()

        padding_length = 16 - (len(data) % 16)
        padded_data = data + chr(padding_length) * padding_length
        encrypted = encryptor.update(padded_data.encode('utf-8')) + encryptor.finalize()

        return {
            'content': base64.b64encode(encrypted).decode('utf-8'),
            'iv': base64.b64encode(iv).decode('utf-8'),
        }

    @staticmethod
    def decrypt(encrypted_data: dict, key: str) -> str:
        iv = base64.b64decode(encrypted_data['iv'])
        encrypted_content = base64.b64decode(encrypted_data['content'])
        cipher = Cipher(AESCrypto.ALGORITHM(AESCrypto.prepare_key(key)),
                        modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()

        decrypted = decryptor.update(encrypted_content) + decryptor.finalize()
        return decrypted[:-decrypted[-1]].decode('utf-8')
```

### PHP

```php
<?php

class AESCrypto
{
    private const ALGORITHM = 'aes-256-cbc';
    private const IV_LENGTH = 16;

    private static function prepareKey(string $key): string
    {
        return hash('sha256', $key, true); // raw binary output
    }

    public static function encrypt(string $data, string $key): array
    {
        $iv = openssl_random_pseudo_bytes(self::IV_LENGTH);
        $encrypted = openssl_encrypt($data, self::ALGORITHM, self::prepareKey($key), OPENSSL_RAW_DATA, $iv);

        return ['content' => base64_encode($encrypted), 'iv' => base64_encode($iv)];
    }

    public static function decrypt(array $encryptedData, string $key): string
    {
        $iv = base64_decode($encryptedData['iv']);
        $encryptedContent = base64_decode($encryptedData['content']);

        return openssl_decrypt($encryptedContent, self::ALGORITHM, self::prepareKey($key), OPENSSL_RAW_DATA, $iv);
    }
}
```

## Decrypting responses (Ed25519 to Curve25519)

A success response carries an encrypted base64 string in `data`:

```json
{ "status": 200, "message": "Balance fetched successfully", "data": "kJ8vX2mN...==" }
```

The payload is encrypted with libsodium's `crypto_box` to your Ed25519 public key,
converted to Curve25519. The base64-decoded blob is laid out as:

| Bytes | Content |
| --- | --- |
| 0 to 23 | 24-byte nonce |
| 24 to (n-32) | ciphertext |
| last 32 | ephemeral public key |

The reference implementations take your OpenSSH-format private key (the `cngn_api_key`
file) directly: they locate the 64-byte key data after the `0x00 0x00 0x00 0x40` length
marker, convert it to Curve25519, and open the box.

### TypeScript

```typescript
import sodium from 'libsodium-wrappers';
import { Buffer } from 'buffer';

export class Ed25519Crypto {
    private static isInitialized = false;

    private static async initialize() {
        if (!this.isInitialized) {
            await sodium.ready;
            this.isInitialized = true;
        }
    }

    private static parseOpenSSHPrivateKey(privateKey: string): Uint8Array {
        const lines = privateKey.split('\n');
        const base64PrivateKey = lines.slice(1, -1).join('');
        const privateKeyBuffer = Buffer.from(base64PrivateKey, 'base64');

        const keyDataStart = privateKeyBuffer.indexOf(Buffer.from([0x00, 0x00, 0x00, 0x40]));
        if (keyDataStart === -1) {
            throw new Error('Unable to find Ed25519 key data');
        }

        return new Uint8Array(privateKeyBuffer.subarray(keyDataStart + 4, keyDataStart + 68));
    }

    public static async decryptWithPrivateKey(
        ed25519PrivateKey: string,
        encryptedData: string,
    ): Promise<string> {
        await this.initialize();

        const fullPrivateKey = this.parseOpenSSHPrivateKey(ed25519PrivateKey);
        const curve25519PrivateKey = sodium.crypto_sign_ed25519_sk_to_curve25519(fullPrivateKey);
        const encryptedBuffer = Buffer.from(encryptedData, 'base64');

        const nonce = encryptedBuffer.subarray(0, sodium.crypto_box_NONCEBYTES);
        const ephemeralPublicKey = encryptedBuffer.subarray(-sodium.crypto_box_PUBLICKEYBYTES);
        const ciphertext = encryptedBuffer.subarray(
            sodium.crypto_box_NONCEBYTES,
            -sodium.crypto_box_PUBLICKEYBYTES,
        );

        const decrypted = sodium.crypto_box_open_easy(
            ciphertext, nonce, ephemeralPublicKey, curve25519PrivateKey,
        );

        return sodium.to_string(decrypted);
    }
}
```

### Python

```python
# pip install pynacl
from nacl.public import PrivateKey, PublicKey, Box
from nacl.bindings import crypto_sign_ed25519_sk_to_curve25519
import base64, re


class Ed25519Crypto:
    @staticmethod
    def parse_openssh_private_key(private_key: str) -> bytes:
        stripped = re.sub(r'-----.* PRIVATE KEY-----', '', private_key).strip()
        stripped = re.sub(r"\s+", '', stripped)
        buffer = base64.b64decode(stripped)

        key_data_start = buffer.find(b'\x00\x00\x00\x40')
        if key_data_start == -1:
            raise Exception('Unable to find Ed25519 key data')

        return buffer[key_data_start + 4: key_data_start + 68]

    @staticmethod
    def decrypt_with_private_key(ed25519_private_key: str, encrypted_data: str) -> str:
        ed25519_bytes = Ed25519Crypto.parse_openssh_private_key(ed25519_private_key)
        curve25519_bytes = crypto_sign_ed25519_sk_to_curve25519(ed25519_bytes)
        private_key = PrivateKey(curve25519_bytes)

        buffer = base64.b64decode(encrypted_data)
        nonce = buffer[:24]
        ephemeral_public_key = PublicKey(buffer[-32:])
        ciphertext = buffer[24:-32]

        box = Box(private_key, ephemeral_public_key)
        return box.decrypt(ciphertext, nonce).decode('utf-8')
```

### PHP

```php
<?php

class Ed25519Crypto
{
    private static function parseOpenSSHPrivateKey(string $privateKey): string
    {
        $lines = explode("\n", $privateKey);
        $base64PrivateKey = implode('', array_slice($lines, 1, -1));
        $privateKeyBuffer = base64_decode($base64PrivateKey);

        $keyDataStart = strpos($privateKeyBuffer, pack('C*', 0x00, 0x00, 0x00, 0x40));
        if ($keyDataStart === false) {
            throw new Exception('Unable to find Ed25519 key data');
        }

        return substr($privateKeyBuffer, $keyDataStart + 4, 64);
    }

    public static function decryptWithPrivateKey(string $ed25519PrivateKey, string $encryptedData): string
    {
        if (!extension_loaded('sodium')) {
            throw new Exception("The sodium extension is not loaded");
        }

        $fullPrivateKey = self::parseOpenSSHPrivateKey($ed25519PrivateKey);
        $curve25519PrivateKey = sodium_crypto_sign_ed25519_sk_to_curve25519($fullPrivateKey);
        $encryptedBuffer = base64_decode($encryptedData);

        $nonce = substr($encryptedBuffer, 0, SODIUM_CRYPTO_BOX_NONCEBYTES);
        $ephemeralPublicKey = substr($encryptedBuffer, -SODIUM_CRYPTO_BOX_PUBLICKEYBYTES);
        $ciphertext = substr(
            $encryptedBuffer,
            SODIUM_CRYPTO_BOX_NONCEBYTES,
            -SODIUM_CRYPTO_BOX_PUBLICKEYBYTES
        );

        $keyPair = sodium_crypto_box_keypair_from_secretkey_and_publickey(
            $curve25519PrivateKey, $ephemeralPublicKey
        );

        $decrypted = sodium_crypto_box_open($ciphertext, $nonce, $keyPair);
        if ($decrypted === false) {
            throw new Exception('Decryption failed');
        }

        return $decrypted;
    }
}
```

Usage: `Ed25519Crypto.decryptWithPrivateKey(privateKeyFileContents, response.data)` returns
a JSON string; parse it to get the payload.

## Generating the Ed25519 key pair

```bash
ssh-keygen -t ed25519 -C "api@yourcompany.com" -f cngn_api_key -N ""
```

This produces `cngn_api_key` (private, keep secret) and `cngn_api_key.pub` (public, upload
to the dashboard for the matching environment). Each environment has its own key slot.

Generate the key **without a passphrase** (`-N ""`). A passphrase-protected key encrypts
the private section of the file, so the parsers above cannot find the key data and fail
with `Unable to find Ed25519 key data`. Check which you have: the second line of the file,
base64-decoded, reads `openssh-key-v1` then `none` for an unprotected key, or
`aes256-ctr`/`bcrypt` for a protected one. Protect the file with filesystem permissions
and a secrets manager instead.

## Failure modes

| Error | Cause |
| --- | --- |
| `400 Missing encryption data, key, or IV` | Body sent as plain JSON instead of `{content, iv}` |
| `400 Decryption failed` | Wrong AES key, key used raw instead of SHA-256 hashed, malformed base64, or a reused/corrupted IV |
| `400 No Test SSH Key found` / `No Live SSH Key found` | No Ed25519 public key uploaded for that environment |
| `Unable to find Ed25519 key data` (local) | The key is passphrase-protected, a `.pub` file was passed by mistake, or the file is not an OpenSSH-format Ed25519 key |

When decryption of a response fails locally, check that you are using the private key for
the **same environment** as the API key that made the request.
