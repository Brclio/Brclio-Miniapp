#!/usr/bin/env python3
"""Import individually generated image_gen assets; never synthesize artwork.

The historical filename is retained so an old rebuild command cannot silently
restore the retired procedural library. Original image_gen output stays intact;
only a 256px display copy is resized and PNG-compressed using Pillow.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / "design" / "builtin-avatars-v2"
COUNT = 1000
VERSION = "20261026"
SIZE = 256
MAX_BYTES = 128 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_prompts(path):
    value = json.loads(path.read_text(encoding="utf-8"))
    themes = value.get("themes")
    avatars = value.get("avatars")
    if (value.get("schemaVersion") != 2 or value.get("version") != VERSION
            or value.get("mode") != "builtin-imagegen" or not isinstance(themes, list)
            or len(themes) != 20 or not all(isinstance(item, str) and item for item in themes)
            or len(set(themes)) != 20 or not isinstance(avatars, list) or len(avatars) != COUNT):
        raise ValueError("Expected the complete v2 image_gen prompt manifest")
    titles, prompts = set(), set()
    for index, item in enumerate(avatars):
        title, prompt = item.get("title"), item.get("prompt")
        if (item.get("id") != index + 1 or item.get("themeIndex") != index % 20
                or item.get("theme") != themes[index % 20] or not isinstance(title, str)
                or not 1 <= len(title) <= 60 or any(ord(char) < 32 for char in title)
                or title in titles or not isinstance(prompt, str) or len(prompt) < 120 or prompt in prompts):
            raise ValueError(f"Invalid or repeated prompt/title/theme at ID {index + 1}")
        titles.add(title)
        prompts.add(prompt)
    return value


def read_generations(path, manifest):
    value = json.loads(path.read_text(encoding="utf-8"))
    records = value.get("entries")
    if (value.get("schemaVersion") != 1 or value.get("tool") != "image_gen"
            or not isinstance(records, list) or len(records) != COUNT):
        raise ValueError("Require 1,000 actual image_gen generation records before importing artwork")
    by_id = {}
    paths = set()
    for record in records:
        avatar_id = record.get("id")
        if not isinstance(avatar_id, int) or avatar_id < 1 or avatar_id > COUNT or avatar_id in by_id:
            raise ValueError("Invalid or repeated image_gen generation record ID")
        for key in ("sourcePath", "rawPath", "generatedAt", "originalSha256", "promptSha256"):
            if not isinstance(record.get(key), str) or not record[key]:
                raise ValueError(f"Missing image_gen provenance {key} for ID {avatar_id}")
        generated_at = datetime.fromisoformat(record["generatedAt"].replace("Z", "+00:00"))
        if generated_at.tzinfo is None or record["sourcePath"] in paths:
            raise ValueError(f"Generation must have a distinct tool output and timestamp for ID {avatar_id}")
        item = manifest["avatars"][avatar_id - 1]
        if record["promptSha256"] != digest(item["prompt"].encode("utf-8")):
            raise ValueError(f"Actual image_gen prompt differs from the recorded prompt at ID {avatar_id}")
        paths.add(record["sourcePath"])
        by_id[avatar_id] = record
    return by_id


def names_source(manifest):
    # Full creative prompts and provenance do not belong in a native package.
    themes = json.dumps(manifest["themes"], ensure_ascii=False, separators=(",", ":"))
    names = json.dumps([item["title"] for item in manifest["avatars"]], ensure_ascii=False, separators=(",", ":"))
    return ("'use strict';\n\n// Generated from design/builtin-avatars-v2/prompts.json; labels only, no images or prompts.\n"
            + f"const VERSION = '{VERSION}';\nconst THEMES = Object.freeze({themes});\n"
            + f"const NAMES = Object.freeze({names});\n\nmodule.exports = {{ VERSION, THEMES, NAMES }};\n")


def write_names(manifest):
    target = ROOT / "miniprogram" / "lib" / "avatar-names.js"
    target.write_text(names_source(manifest), encoding="utf-8")


def source_paths(directory):
    expected = {f"{avatar_id:04}.png" for avatar_id in range(1, COUNT + 1)}
    actual = {file.name for file in directory.glob("*.png")}
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise ValueError(f"Require exactly 1,000 originals; missing={len(missing)} {missing[:3]}, extra={extra[:3]}")
    files = [directory / f"{avatar_id:04}.png" for avatar_id in range(1, COUNT + 1)]
    if any(file.is_symlink() or not file.is_file() for file in files):
        raise ValueError("Each image_gen original must be a regular independent file")
    return files


def prepare(manifest, records, source, prepared):
    files = source_paths(source)
    stage = Path(tempfile.mkdtemp(prefix="avatars-", dir=prepared.parent))
    output = stage / "avatars"
    output.mkdir()
    original_hashes, display_hashes = set(), set()
    entries, total = [], 0
    try:
        for item, original in zip(manifest["avatars"], files):
            original_bytes = original.read_bytes()
            original_hash = digest(original_bytes)
            record = records[item["id"]]
            recorded_raw = Path(record["rawPath"])
            if not recorded_raw.is_absolute():
                recorded_raw = ROOT / recorded_raw
            if (original_hash in original_hashes or original_hash != record["originalSha256"]
                    or recorded_raw.resolve() != original.resolve()):
                raise ValueError(f"Original is repeated or differs from the actual image_gen record at ID {item['id']}")
            with Image.open(original) as image:
                if image.format != "PNG" or image.width != image.height or image.width < SIZE:
                    raise ValueError(f"Require one square PNG image_gen original for ID {item['id']}")
                image.load()
                source_size = {"width": image.width, "height": image.height}
                display = image.convert("RGBA" if "A" in image.getbands() else "RGB").resize((SIZE, SIZE), Image.Resampling.LANCZOS)
                target = output / original.name
                display.save(target, format="PNG", optimize=True)
            data = target.read_bytes()
            display_hash = digest(data)
            if display_hash in display_hashes:
                raise ValueError(f"Reused display artwork at ID {item['id']}")
            original_hashes.add(original_hash)
            display_hashes.add(display_hash)
            total += len(data)
            entries.append({
                "id": item["id"], "title": item["title"], "theme": item["theme"], "themeIndex": item["themeIndex"],
                "generator": "built-in image_gen", "generatedAt": record["generatedAt"],
                "promptSha256": digest(item["prompt"].encode("utf-8")),
                "sourcePath": os.path.relpath(original, ROOT), "sourceSha256": original_hash,
                "sourceWidth": source_size["width"], "sourceHeight": source_size["height"],
                "path": "web/avatars/" + original.name, "width": SIZE, "height": SIZE,
                "bytes": len(data), "sha256": display_hash,
            })
        if total > MAX_BYTES:
            raise ValueError(f"Display assets exceed 128 MiB: {total} bytes")
        report = {"schemaVersion": 2, "version": VERSION, "mode": "builtin-imagegen", "count": COUNT,
                  "importedAt": datetime.now(timezone.utc).isoformat(), "width": SIZE, "height": SIZE,
                  "totalBytes": total, "assets": entries}
        (stage / "assets.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if prepared.exists():
            shutil.rmtree(prepared)
        stage.rename(prepared)
        return report
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def apply_prepared(manifest, prepared, report):
    # The whole library has passed validation before the published source moves.
    target = ROOT / "web" / "avatars"
    backup = ROOT / "artifacts" / "avatar-redesign" / ("previous-avatars-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    if target.exists():
        target.rename(backup)
    try:
        (prepared / "avatars").rename(target)
    except BaseException:
        if backup.exists():
            backup.rename(target)
        raise
    write_names(manifest)
    (DESIGN / "assets.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompts", type=Path, default=DESIGN / "prompts.json")
    parser.add_argument("--source", type=Path, default=ROOT / "artifacts" / "avatar-redesign" / "raw")
    parser.add_argument("--generation", type=Path, default=ROOT / "artifacts" / "avatar-redesign" / "generation.json")
    parser.add_argument("--metadata-only", action="store_true", help="Update only the compact client names from the validated prompts")
    parser.add_argument("--apply", action="store_true", help="After validating all originals, replace the full library and retain the previous files locally")
    args = parser.parse_args()
    manifest = read_prompts(args.prompts)
    if args.metadata_only:
        if args.apply:
            parser.error("--metadata-only and --apply are mutually exclusive")
        write_names(manifest)
        print(json.dumps({"names": COUNT, "themes": 20, "version": VERSION}))
        return
    records = read_generations(args.generation, manifest)
    prepared = ROOT / "artifacts" / "avatar-redesign" / "prepared"
    prepared.parent.mkdir(parents=True, exist_ok=True)
    report = prepare(manifest, records, args.source.resolve(), prepared)
    if args.apply:
        apply_prepared(manifest, prepared, report)
    print(json.dumps({"count": COUNT, "version": VERSION, "bytes": report["totalBytes"], "applied": args.apply,
                      "prepared": str(prepared)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print(f"Avatar import aborted: {error}", file=sys.stderr)
        sys.exit(1)
