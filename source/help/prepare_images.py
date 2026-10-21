"""Prepare embedded JPEGs from real, reproducible app screenshots (requires Pillow).
Run tests/ui_features.py and help/capture_curved_plane.py first.
"""
from pathlib import Path
import shutil
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent
shots=ROOT/'help/shots/recent-tools';shots.mkdir(parents=True,exist_ok=True)
for name in ('emboss','measure','versions','preview','ribbon'):
 source=ROOT/'dist'/f'{name}-ui.png'
 if source.exists():shutil.copy2(source,shots/f'tools-{name}.png')
sources=list(shots.glob('*.png'))+list((ROOT/'help/shots/curved-plane').glob('*.png'))
for source in sources:
 image=Image.open(source).convert('RGB')
 image.save(ROOT/'help/img'/f'{source.stem}.jpg',quality=92,optimize=True)
print(f'Prepared {len(sources)} real app pictures.')
