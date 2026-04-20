#!/usr/bin/env python3
"""Seed test users and applications through the public API.

This script:
- Logs in as an admin user.
- Creates 8 test users distributed across departments (at least one per department).
- Creates 20 applications with randomized access scopes.
- Uploads the same logo image for every application via signed S3 upload URL.

Usage:
  python scripts/seed_demo_data.py
  python scripts/seed_demo_data.py --base-url http://127.0.0.1:8000/api/v1
  python scripts/seed_demo_data.py --email admin@example.com --password '***'
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import random
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, request


DEFAULT_BASE_URL = "http://127.0.0.1:8000/api/v1"
DEFAULT_EMAIL = "samueliwelumo@gmail.com"
DEFAULT_PASSWORD = "642654737"
DEFAULT_USER_PASSWORD = "PortalDemo#8429"
DEFAULT_LOGO_PATH = Path(__file__).resolve().parents[2] / "portal" / "genlayer.png"

TEST_USER_NAMES = [
    ("Ava", "Nwosu"),
    ("Liam", "Okon"),
    ("Noah", "Eze"),
    ("Mia", "Adebayo"),
    ("Ethan", "Umeh"),
    ("Sophia", "Bello"),
    ("James", "Akin"),
    ("Grace", "Ike"),
]


class ApiError(RuntimeError):
    pass


def _json_dumps(data: Any) -> bytes:
    return json.dumps(data).encode("utf-8")


def http_json(
    method: str,
    url: str,
    *,
    token: str | None = None,
    payload: dict[str, Any] | None = None,
    timeout: int = 30,
) -> Any:
    headers = {"Accept": "application/json"}
    body: bytes | None = None

    if payload is not None:
        body = _json_dumps(payload)
        headers["Content-Type"] = "application/json"

    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = request.Request(url=url, data=body, headers=headers, method=method.upper())

    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            if not raw:
                return None
            return json.loads(raw)
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise ApiError(f"{method} {url} failed with {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise ApiError(f"{method} {url} failed: {exc.reason}") from exc


def http_put_bytes(url: str, content: bytes, *, content_type: str, timeout: int = 60) -> None:
    headers = {"Content-Type": content_type}
    req = request.Request(url=url, data=content, headers=headers, method="PUT")

    try:
        with request.urlopen(req, timeout=timeout):
            return
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise ApiError(f"PUT upload failed with {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise ApiError(f"PUT upload failed: {exc.reason}") from exc


def sanitize_slug(value: str) -> str:
    output = []
    prev_dash = False
    for ch in value.lower().strip():
        if ch.isalnum():
            output.append(ch)
            prev_dash = False
            continue
        if not prev_dash:
            output.append("-")
            prev_dash = True
    cleaned = "".join(output).strip("-")
    return cleaned or "app"


def choose_department_ids_for_app(
    mode: str,
    department_ids: list[int],
    rng: random.Random,
) -> list[int]:
    if mode == "all":
        return []
    if mode == "single":
        return [rng.choice(department_ids)]

    max_pick = min(4, len(department_ids))
    pick_count = rng.randint(2, max_pick)
    return rng.sample(department_ids, k=pick_count)


def upload_logo_and_get_public_url(
    *,
    base_url: str,
    token: str,
    slug: str,
    logo_bytes: bytes,
    logo_file_name: str,
    content_type: str,
) -> str:
    signed = http_json(
        "POST",
        f"{base_url}/admin/applications/logo-upload-url",
        token=token,
        payload={
            "slug": slug,
            "file_name": logo_file_name,
            "content_type": content_type,
        },
    )

    upload_url = signed.get("upload_url")
    public_url = signed.get("public_url")
    if not upload_url or not public_url:
        raise ApiError("Logo upload URL response is incomplete.")

    http_put_bytes(upload_url, logo_bytes, content_type=content_type)
    return public_url


def resolve_logo(path_arg: str | None) -> tuple[Path, bytes, str]:
    logo_path = Path(path_arg).expanduser().resolve() if path_arg else DEFAULT_LOGO_PATH
    if not logo_path.exists() or not logo_path.is_file():
        raise ApiError(f"Logo file not found: {logo_path}")

    content_type = mimetypes.guess_type(logo_path.name)[0] or "image/png"
    if not content_type.startswith("image/"):
        raise ApiError(f"Logo file must be an image. Detected content type: {content_type}")

    return logo_path, logo_path.read_bytes(), content_type


def create_test_users(
    *,
    base_url: str,
    token: str,
    departments: list[dict[str, Any]],
    rng: random.Random,
    user_password: str,
) -> list[dict[str, Any]]:
    department_ids = [int(item["id"]) for item in departments]
    rng.shuffle(department_ids)

    assignments = department_ids[:]
    assignments.append(rng.choice(department_ids))

    created: list[dict[str, Any]] = []
    for index, (first_name, last_name) in enumerate(TEST_USER_NAMES, start=1):
        department_id = assignments[index - 1]
        email = f"testuser{index}@example.com"

        payload = {
            "first_name": first_name,
            "last_name": last_name,
            "email": email,
            "password": user_password,
            "department_id": department_id,
        }

        user = http_json("POST", f"{base_url}/admin/users", token=token, payload=payload)
        created.append(user)

    return created


def create_applications(
    *,
    base_url: str,
    token: str,
    departments: list[dict[str, Any]],
    rng: random.Random,
    slug_suffix: str,
    logo_bytes: bytes,
    logo_file_name: str,
    content_type: str,
) -> list[dict[str, Any]]:
    department_ids = [int(item["id"]) for item in departments]

    modes = ["all"] * 7 + ["single"] * 7 + ["multi"] * 6
    rng.shuffle(modes)

    created: list[dict[str, Any]] = []
    for i, mode in enumerate(modes, start=1):
        name = f"Genlayer App {i:02d}"
        slug = sanitize_slug(f"genlayer-{slug_suffix}-{i:02d}")
        description = f"Demo application {i:02d} generated for access testing."
        app_url = f"https://apps.example.com/{slug}"

        department_selection = choose_department_ids_for_app(mode, department_ids, rng)
        access_scope = "ALL_AUTHENTICATED" if mode == "all" else "RESTRICTED"

        logo_url = upload_logo_and_get_public_url(
            base_url=base_url,
            token=token,
            slug=slug,
            logo_bytes=logo_bytes,
            logo_file_name=logo_file_name,
            content_type=content_type,
        )

        payload = {
            "name": name,
            "slug": slug,
            "description": description,
            "app_url": app_url,
            "logo_url": logo_url,
            "status": "ACTIVE",
            "access_scope": access_scope,
            "visibility_scope": "VISIBLE_TO_ALL",
            "department_ids": department_selection,
        }

        app = http_json("POST", f"{base_url}/admin/applications", token=token, payload=payload)
        created.append(app)

    return created


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed users and applications via API.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="API base URL (default: %(default)s)")
    parser.add_argument("--email", default=DEFAULT_EMAIL, help="Admin login email")
    parser.add_argument("--password", default=DEFAULT_PASSWORD, help="Admin login password")
    parser.add_argument(
        "--user-password",
        default=DEFAULT_USER_PASSWORD,
        help="Password used for newly created test users",
    )
    parser.add_argument(
        "--logo-path",
        default=None,
        help="Path to an image file to use as app logo (defaults to portal/genlayer.png)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Optional random seed for deterministic assignments",
    )
    args = parser.parse_args()

    rng = random.Random(args.seed)

    try:
        logo_path, logo_bytes, content_type = resolve_logo(args.logo_path)

        login = http_json(
            "POST",
            f"{args.base_url.rstrip('/')}/auth/login",
            payload={"email": args.email, "password": args.password},
        )
        token = login.get("tokens", {}).get("access")
        if not token:
            raise ApiError("Login succeeded but access token was not returned.")

        departments_payload = http_json(
            "GET",
            f"{args.base_url.rstrip('/')}/organization/departments",
            token=token,
        )

        available = [d for d in departments_payload if d.get("id") is not None]
        if not available:
            raise ApiError("No departments were returned by the API.")

        timestamp_tag = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

        users = create_test_users(
            base_url=args.base_url.rstrip('/'),
            token=token,
            departments=available,
            rng=rng,
            user_password=args.user_password,
        )

        apps = create_applications(
            base_url=args.base_url.rstrip('/'),
            token=token,
            departments=available,
            rng=rng,
            slug_suffix=timestamp_tag,
            logo_bytes=logo_bytes,
            logo_file_name=logo_path.name,
            content_type=content_type,
        )

        print("Seed complete.")
        print(f"Created users: {len(users)}")
        print(f"Created applications: {len(apps)}")
        print(f"Logo file used: {logo_path}")
        print(f"Test users password: {args.user_password}")

        return 0
    except ApiError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
