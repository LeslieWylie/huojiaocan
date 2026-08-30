from __future__ import annotations

import shutil
from pathlib import Path

from .repository import FileRepository


def seed_runtime(repository: FileRepository, seed_root: str | Path | None = None) -> bool:
    """Copy immutable, prebuilt index records into an empty runtime directory.

    The Vercel deployment uses an ephemeral ``/tmp`` filesystem.  The seed is a
    read-only deployment asset, not the source PDF and not a second display
    representation.  It only lets a cold serverless instance answer against
    the two demo documents before a durable repository is connected.

    Returns ``True`` when at least one seed file was copied.  Existing runtime
    records are never overwritten.
    """

    root = Path(seed_root) if seed_root else None
    if root is None or not root.exists():
        return False

    target_dirs = {
        "documents": repository.documents_dir,
        "indexes": repository.indexes_dir,
        "validations": repository.validations_dir,
        "jobs": repository.jobs_dir,
        "text": repository.text_dir,
    }
    copied = False
    for name, target in target_dirs.items():
        source = root / name
        if not source.is_dir():
            continue
        target.mkdir(parents=True, exist_ok=True)
        pattern = "*" if name == "text" else "*.json"
        for item in source.glob(pattern):
            if not item.is_file():
                continue
            destination = target / item.name
            if destination.exists():
                continue
            shutil.copyfile(item, destination)
            copied = True
    return copied
