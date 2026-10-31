# Every test suite, one after the other, with a short summary at the end. Run after build.py:
#   python tests/all.py                  all of them
#   python tests/all.py sketch_lines     only the ones named (as many as you like)
#   python tests/all.py --skip link      all but these (link needs the AI link's port free, so no other copy running)
# Each suite runs on its own; a suite that fails prints its last lines. Exit code 1 when anything failed.
import os, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
# quick ones first, so a broken build shows up early; stl_editable and link take the longest
SUITES = ['help', 'run', 'features', 'ui_features', 'reliability', 'tutorials', 'planes', 'plane_ui', 'mesh_sketch', 'imports', 'sizing', 'paint', 'parts', 'movearrows', 'dragdrop',
          'doubleclick', 'copies', 'sketch_lines', 'sketch_redraw', 'sketch_tools', 'photo', 'touch', 'server', 'stl_editable', 'link']
TIMEOUT = 20 * 60

args = sys.argv[1:]
skip = set(args[args.index('--skip') + 1:]) if '--skip' in args else set()
only = [a for a in (args[:args.index('--skip')] if '--skip' in args else args)]
unknown = [n for n in only + list(skip) if n not in SUITES]
if unknown: raise SystemExit(f'No such suite: {", ".join(unknown)}. The suites: {", ".join(SUITES)}')
if not os.path.exists(os.path.join(SRC, 'local', '3DJames.html')): raise SystemExit('Build first: python build.py')

results = []
for name in (only or SUITES):
    if name in skip: continue
    t0 = time.time()
    print(f'== {name} ...', flush=True)
    try:
        p = subprocess.run([sys.executable, os.path.join(HERE, name + '.py')], cwd=SRC, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=TIMEOUT)
        ok, out = p.returncode == 0, (p.stdout + p.stderr)
    except subprocess.TimeoutExpired as e:
        ok, out = False, f'took longer than {TIMEOUT // 60} minutes\n' + ((e.stdout or b'').decode('utf-8', 'replace') if isinstance(e.stdout, bytes) else (e.stdout or ''))
    secs = time.time() - t0
    results.append((name, ok, secs))
    print(f'   {"PASS" if ok else "FAIL"} in {secs:.0f} s', flush=True)
    if not ok: print('   ' + '\n   '.join(out.strip().splitlines()[-15:]), flush=True)

failed = [n for n, ok, _ in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} suites passed in {sum(s for *_, s in results) / 60:.1f} min' + (f'. Failed: {", ".join(failed)}' if failed else ''))
sys.exit(1 if failed else 0)
