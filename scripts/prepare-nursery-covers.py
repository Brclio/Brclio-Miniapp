#!/usr/bin/env python3
"""Compress already-generated nursery artwork; never generates substitute artwork."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--parts', action='store_true', help='Assemble imagegen work parts into the first manifest')
args = parser.parse_args()
manifest_path = ROOT / 'design/nursery-covers/manifest.json'
if args.parts:
    entries = []
    for file in sorted((ROOT / 'design/nursery-covers').glob('part-*.json')):
        entries.extend(json.loads(file.read_text()))
    if len(entries) != 47 or len({item['id'] for item in entries}) != 47:
        raise SystemExit('All 47 independent generated originals and prompt records must exist before preparing release covers')
else:
    entries = json.loads(manifest_path.read_text())['covers']

# Use catalog ordering without reimplementing source metadata in Python.
import subprocess
order = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./miniprogram/data/nursery-songs').SONGS.map(s=>s.id)))"], cwd=ROOT))
by_id = {item['id']: item for item in entries}
entries = [by_id[id] for id in order]
for item in entries:
    source = ROOT / 'artifacts/nursery-covers/originals' / (item['id'] + '.png')
    if not source.is_file():
        raise SystemExit(f'Missing generated original: {source}')
    target = ROOT / 'miniprogram/nursery/assets/covers' / (item['id'] + '.jpg')
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as original:
        if original.width != original.height:
            raise SystemExit(f'Original must be square: {source}')
        item['originalWidth'], item['originalHeight'] = original.size
        image = original.convert('RGB').resize((256, 256), Image.Resampling.LANCZOS)
    quality = 68
    while True:
        image.save(target, 'JPEG', quality=quality, optimize=True, progressive=True)
        if target.stat().st_size <= 24 * 1024 or quality <= 55:
            break
        quality -= 2
    item.update(finalPath=target.relative_to(ROOT).as_posix(), originalPath=source.relative_to(ROOT).as_posix(),
                width=256, height=256, bytes=target.stat().st_size, quality=quality,
                sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
                originalBytes=source.stat().st_size, originalSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                generator='built-in image_gen')
    # Public provenance identifies the generator output without exposing a home-directory prefix.
    if '/generated_images/' in item.get('sourcePath', ''):
        item['sourcePath'] = '$CODEX_HOME/generated_images/' + item['sourcePath'].split('/generated_images/', 1)[1]

manifest = {'schemaVersion': 1, 'createdOn': '2026-10-23', 'generator': 'built-in image_gen',
            'compression': {'format': 'JPEG', 'width': 256, 'height': 256, 'quality': '68, reduced only when needed to keep a file below 24 KiB',
                            'progressive': True, 'originalsBundled': False},
            'count': len(entries), 'totalBytes': sum(item['bytes'] for item in entries), 'covers': entries}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'count': len(entries), 'totalBytes': manifest['totalBytes'], 'originalBytes': sum(item['originalBytes'] for item in entries)}, indent=2))
